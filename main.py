import asyncio
import json
import os
import subprocess
import time
import uuid

import decky

# The wake timer is the RTC alarm. It is root-only, which is why the plugin has the root flag.
ALARM = "/sys/class/rtc/rtc0/wakealarm"
SCHEDULE_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "schedule.json")
KINDS = ("sleep", "wake")

# A sleep missed by more than this (the Deck was already asleep or off) is dropped instead of run late
SLEEP_GRACE = 120
# Seconds before a sleep that the "going to sleep" toast shows
WARN_BEFORE = 60
# Seconds to wait for Steam to start the suspend before suspending through systemd instead
SLEEP_ACK_TIMEOUT = 15
TICK = 2


def _clean_env():
    # Decky's LD_LIBRARY_PATH breaks system binaries started from the backend
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = ""
    return env


def _read_alarm():
    try:
        with open(ALARM) as f:
            value = f.read().strip()
        return int(value) if value else None
    except Exception:
        return None


def _write_alarm(at):
    # The kernel refuses a new alarm while one is set, so clear it first
    with open(ALARM, "w") as f:
        f.write("0")
    if at:
        with open(ALARM, "w") as f:
            f.write(str(int(at)))


class Plugin:
    events = []
    armed = None  # wake time this plugin set the RTC alarm to
    warned = set()
    sleep_acked = None
    error = None

    # ---- storage ----

    def _load(self):
        try:
            with open(SCHEDULE_FILE) as f:
                data = json.load(f)
            self.events = [
                {"id": str(e["id"]), "kind": e["kind"], "at": int(e["at"])}
                for e in data.get("events", [])
                if e.get("kind") in KINDS
            ]
            self.armed = data.get("armed")
        except FileNotFoundError:
            self.events = []
        except Exception as e:
            decky.logger.error(f"Could not read the schedule: {e!r}")
            self.events = []

    def _save(self):
        os.makedirs(os.path.dirname(SCHEDULE_FILE), exist_ok=True)
        tmp = SCHEDULE_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"events": self.events, "armed": self.armed}, f)
        os.replace(tmp, SCHEDULE_FILE)

    def _state(self):
        return {
            "events": sorted(self.events, key=lambda e: e["at"]),
            "alarm": _read_alarm(),
            "error": self.error,
        }

    async def _changed(self):
        self._sync_alarm()
        self._save()
        await decky.emit("state", self._state())

    # ---- wake timer ----

    def _sync_alarm(self):
        """Point the RTC alarm at the next wake event, or clear it if this plugin set it and none is left."""
        now = time.time()
        wakes = [e["at"] for e in self.events if e["kind"] == "wake" and e["at"] > now]
        target = min(wakes) if wakes else None
        current = _read_alarm()
        try:
            if target:
                if current != target:
                    _write_alarm(target)
                    decky.logger.info(f"Wake timer set for {target}")
                self.armed = target
            elif self.armed is not None:
                # Only clear an alarm this plugin set, never someone else's
                if current == self.armed:
                    _write_alarm(None)
                    decky.logger.info("Wake timer cleared")
                self.armed = None
            self.error = None
        except Exception as e:
            self.error = f"Could not set the wake timer: {e}"
            decky.logger.error(self.error)

    # ---- sleep ----

    async def _sleep_now(self, event_id):
        decky.logger.info(f"Scheduled sleep {event_id}: asking Steam to suspend")
        self._sync_alarm()
        self.sleep_acked = None
        # Steam's own suspend (same path as the power button) is started by the frontend
        await decky.emit("sleep_now", event_id)
        deadline = time.monotonic() + SLEEP_ACK_TIMEOUT
        while time.monotonic() < deadline:
            if self.sleep_acked == event_id:
                return
            await asyncio.sleep(0.5)
        decky.logger.warning("Steam did not start the suspend; suspending through systemd")
        subprocess.run(["systemctl", "suspend"], env=_clean_env(), check=False)

    async def _tick(self):
        now = time.time()
        due = [e for e in self.events if e["at"] <= now]
        sleep_id = None
        for e in due:
            self.events.remove(e)
            self.warned.discard(e["id"])
            if e["kind"] == "sleep":
                if now - e["at"] <= SLEEP_GRACE:
                    sleep_id = e["id"]
                else:
                    decky.logger.info(f"Skipped sleep {e['id']}: missed by {int(now - e['at'])} s")
            else:
                decky.logger.info(f"Wake {e['id']} done")

        for e in self.events:
            if e["kind"] == "sleep" and e["at"] - now <= WARN_BEFORE and e["id"] not in self.warned:
                self.warned.add(e["id"])
                await decky.emit("sleep_warning", e["id"], int(e["at"] - now))

        if due:
            await self._changed()
        elif self.armed and _read_alarm() != self.armed:
            # Something cleared the alarm (it fired, or another program reset it): set it again
            self._sync_alarm()

        if sleep_id:
            await self._sleep_now(sleep_id)

    # ---- frontend calls ----

    async def get_state(self):
        return self._state()

    async def add_event(self, kind, at):
        if kind not in KINDS:
            raise ValueError(f"Unknown event type {kind}")
        if int(at) <= time.time():
            raise ValueError("That time has already passed")
        self.events.append({"id": uuid.uuid4().hex[:8], "kind": kind, "at": int(at)})
        await self._changed()
        return self._state()

    async def update_event(self, event_id, kind, at):
        if kind not in KINDS:
            raise ValueError(f"Unknown event type {kind}")
        if int(at) <= time.time():
            raise ValueError("That time has already passed")
        for e in self.events:
            if e["id"] == event_id:
                e["kind"] = kind
                e["at"] = int(at)
                self.warned.discard(event_id)
        await self._changed()
        return self._state()

    async def remove_event(self, event_id):
        self.events = [e for e in self.events if e["id"] != event_id]
        self.warned.discard(event_id)
        await self._changed()
        return self._state()

    async def clear_events(self):
        self.events = []
        self.warned.clear()
        await self._changed()
        return self._state()

    async def ack_sleep(self, event_id):
        self.sleep_acked = event_id

    # ---- lifecycle ----

    async def _main(self):
        self._load()
        await self._changed()
        decky.logger.info(f"Sleep Scheduler started with {len(self.events)} events")
        while True:
            try:
                await self._tick()
            except Exception as e:
                decky.logger.error(f"Schedule check failed: {e!r}")
            await asyncio.sleep(TICK)

    async def _unload(self):
        # Keep the wake timer: a scheduled wake should still happen if Decky restarts while the Deck sleeps
        decky.logger.info("Sleep Scheduler unloaded")

    async def _uninstall(self):
        if self.armed and _read_alarm() == self.armed:
            _write_alarm(None)
