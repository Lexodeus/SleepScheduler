import { addEventListener, callable, removeEventListener, toaster } from "@decky/api";
import { useEffect, useState } from "react";

declare const SteamClient: any;

export type EventKind = "sleep" | "wake";

export interface ScheduledEvent {
  id: string;
  kind: EventKind;
  /** Unix time in seconds */
  at: number;
}

export interface ScheduleState {
  events: ScheduledEvent[];
  /** Unix time the wake timer is set to, or null */
  alarm: number | null;
  error: string | null;
}

const getState = callable<[], ScheduleState>("get_state");
const addEventCall = callable<[kind: EventKind, at: number], ScheduleState>("add_event");
const updateEventCall = callable<[id: string, kind: EventKind, at: number], ScheduleState>("update_event");
const removeEventCall = callable<[id: string], ScheduleState>("remove_event");
const clearEventsCall = callable<[], ScheduleState>("clear_events");
const ackSleep = callable<[id: string], void>("ack_sleep");

let state: ScheduleState = { events: [], alarm: null, error: null };
const listeners = new Set<(state: ScheduleState) => void>();

function setState(next: ScheduleState) {
  state = next;
  listeners.forEach((listener) => listener(state));
}

export const refreshState = () => getState().then(setState);
export const addEvent = (kind: EventKind, at: number) => addEventCall(kind, at).then(setState);
export const updateEvent = (id: string, kind: EventKind, at: number) => updateEventCall(id, kind, at).then(setState);
export const removeEvent = (id: string) => removeEventCall(id).then(setState);
export const clearEvents = () => clearEventsCall().then(setState);

export function useSchedule() {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    refreshState();
    return () => void listeners.delete(setCurrent);
  }, []);
  return current;
}

/** Re-renders every second, so relative times stay current. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Runs for as long as the plugin is loaded, panel open or not. The backend decides when to sleep;
 * the frontend starts Steam's own suspend, the same one the power button uses.
 */
export function startListening() {
  const stateListener = addEventListener<[ScheduleState]>("state", setState);
  const sleepListener = addEventListener<[string]>("sleep_now", async (id) => {
    await ackSleep(id);
    SteamClient.System.SuspendPC();
  });
  const warnListener = addEventListener<[string, number]>("sleep_warning", (_id, seconds) => {
    toaster.toast({
      title: "Sleep Scheduler",
      body: `Going to sleep in ${Math.max(1, Math.round(seconds))} seconds. Clear it in the plugin to cancel.`,
    });
  });
  refreshState();
  return () => {
    removeEventListener("state", stateListener);
    removeEventListener("sleep_now", sleepListener);
    removeEventListener("sleep_warning", warnListener);
  };
}
