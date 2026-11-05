import { definePlugin } from "@decky/api";
import {
  ButtonItem,
  DialogButton,
  Dropdown,
  DropdownItem,
  Field,
  Focusable,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { useEffect, useState } from "react";
import { FaMoon } from "react-icons/fa";
import {
  addEvent,
  clearEvents,
  EventKind,
  removeEvent,
  ScheduledEvent,
  startListening,
  updateEvent,
  useNow,
  useSchedule,
} from "./backend";
import {
  DateTime,
  dayOptions,
  defaultDateTime,
  formatClock,
  formatDay,
  formatRelative,
  normalize,
  toDateTime,
  toUnix,
} from "./time";

const kindLabels: Record<EventKind, string> = { sleep: "Sleep", wake: "Wake" };
const kindOptions = (Object.keys(kindLabels) as EventKind[]).map((kind) => ({ data: kind, label: kindLabels[kind] }));
const hourOptions = Array.from({ length: 12 }, (_, i) => ({ data: i + 1, label: `${i + 1}` }));
const minuteOptions = Array.from({ length: 60 }, (_, i) => ({ data: i, label: String(i).padStart(2, "0") }));
const periodOptions = [
  { data: false, label: "AM" },
  { data: true, label: "PM" },
];

const rowStyle = { display: "flex", gap: "6px", width: "100%" };
const cellStyle = { flex: 1, minWidth: 0 };
const smallButton = { minWidth: 0, flex: 1, padding: "6px 0" };
const noteStyle = { fontSize: "12px", opacity: 0.7, marginTop: "6px" };

function errorText(e: unknown) {
  const text = e instanceof Error ? e.message : String(e);
  return text.split("\n").filter(Boolean).pop() ?? text;
}

/*
 * Form values live outside the components. Opening a dropdown moves focus to its menu in Steam's main window,
 * and Decky re-mounts the panel when focus comes back, which reset values kept in component state.
 */
interface Draft {
  kind: EventKind;
  value: DateTime;
}
const ui = {
  drafts: new Map<string, Draft>(), // "new", or the id of the event being edited
  editingId: null as string | null,
};
const uiListeners = new Set<() => void>();
const uiChanged = () => uiListeners.forEach((listener) => listener());

function useUi() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    uiListeners.add(listener);
    return () => void uiListeners.delete(listener);
  }, []);
  return ui;
}

function getDraft(key: string, initial: ScheduledEvent | null): Draft {
  let draft = ui.drafts.get(key);
  if (!draft) {
    draft = initial
      ? { kind: initial.kind, value: toDateTime(initial.at) }
      : { kind: "sleep", value: defaultDateTime() };
    ui.drafts.set(key, draft);
  }
  return draft;
}

function setDraft(key: string, draft: Draft) {
  ui.drafts.set(key, { ...draft, value: normalize(draft.value) });
  uiChanged();
}

function setEditing(id: string | null) {
  if (ui.editingId) ui.drafts.delete(ui.editingId);
  ui.editingId = id;
  uiChanged();
}

/** Type, date and time fields with a save button, used for a new event and for editing one in place. */
function EventForm({
  draftKey,
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  draftKey: string;
  initial: ScheduledEvent | null;
  saveLabel: string;
  onSave: (kind: EventKind, at: number) => Promise<void>;
  onCancel?: () => void;
}) {
  useUi();
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const draft = getDraft(draftKey, initial);
  // Today with a time that has passed shows as tomorrow, also when the time passes while the panel is open
  const value = normalize(draft.value, new Date(now * 1000));
  const at = toUnix(value, new Date(now * 1000));
  const update = (change: Partial<DateTime>) => setDraft(draftKey, { ...draft, value: { ...value, ...change } });

  const save = async () => {
    setError(null);
    try {
      await onSave(draft.kind, toUnix(value));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <PanelSectionRow>
        <DropdownItem
          label="Type"
          rgOptions={kindOptions}
          selectedOption={draft.kind}
          onChange={(option) => setDraft(draftKey, { ...draft, kind: option.data })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Date" childrenLayout="below" bottomSeparator="none">
          <Dropdown
            rgOptions={dayOptions(new Date(now * 1000))}
            selectedOption={value.day}
            onChange={(option) => update({ day: option.data })}
          />
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Time" childrenLayout="below" bottomSeparator="none">
          <Focusable style={rowStyle}>
            <div style={cellStyle}>
              <Dropdown
                rgOptions={hourOptions}
                selectedOption={value.hour}
                onChange={(option) => update({ hour: option.data })}
              />
            </div>
            <div style={cellStyle}>
              <Dropdown
                rgOptions={minuteOptions}
                selectedOption={value.minute}
                onChange={(option) => update({ minute: option.data })}
              />
            </div>
            <div style={cellStyle}>
              <Dropdown
                rgOptions={periodOptions}
                selectedOption={value.pm}
                onChange={(option) => update({ pm: option.data })}
              />
            </div>
          </Focusable>
          <div style={noteStyle}>{`${formatDay(at, now)} at ${formatClock(at)}, ${formatRelative(at, now)}`}</div>
        </Field>
      </PanelSectionRow>
      {error && (
        <PanelSectionRow>
          <div style={{ color: "#ff6b6b", fontSize: "12px" }}>{error}</div>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <Focusable style={{ ...rowStyle, padding: "8px 0" }}>
          <DialogButton style={smallButton} onClick={save}>
            {saveLabel}
          </DialogButton>
          {onCancel && (
            <DialogButton style={smallButton} onClick={onCancel}>
              Cancel
            </DialogButton>
          )}
        </Focusable>
      </PanelSectionRow>
    </>
  );
}

function EventRow({ event, now }: { event: ScheduledEvent; now: number }) {
  return (
    <PanelSectionRow>
      <Field label={`${kindLabels[event.kind]} at ${formatClock(event.at)}`} childrenLayout="below">
        <div style={{ ...noteStyle, marginTop: 0, marginBottom: "8px" }}>
          {`${formatDay(event.at, now)}, ${formatRelative(event.at, now)}`}
          {event.note ? <div>{event.note}</div> : null}
        </div>
        <Focusable style={rowStyle}>
          <DialogButton style={smallButton} onClick={() => setEditing(event.id)}>
            Edit
          </DialogButton>
          <DialogButton style={smallButton} onClick={() => removeEvent(event.id)}>
            Clear
          </DialogButton>
        </Focusable>
      </Field>
    </PanelSectionRow>
  );
}

function Content() {
  const { editingId } = useUi();
  const { events, alarm, error } = useSchedule();
  const now = useNow();
  const upcoming = events.filter((event) => event.at > now - 5);
  const alarmText = alarm
    ? `Wake timer set for ${formatDay(alarm, now).replace(/^(Today|Tomorrow)$/, (day) => day.toLowerCase())} at ${formatClock(alarm)}.`
    : "No wake timer set.";

  return (
    <>
      <PanelSection title="Upcoming">
        {upcoming.length === 0 && (
          <PanelSectionRow>
            <div style={{ fontSize: "13px", opacity: 0.7 }}>Nothing scheduled.</div>
          </PanelSectionRow>
        )}
        {upcoming.map((event) =>
          event.id === editingId ? (
            <EventForm
              key={event.id}
              draftKey={event.id}
              initial={event}
              saveLabel="Save"
              onSave={async (kind, at) => {
                await updateEvent(event.id, kind, at);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <EventRow key={event.id} event={event} now={now} />
          ),
        )}
        {upcoming.length > 1 && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={clearEvents}>
              Clear all
            </ButtonItem>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <div style={{ fontSize: "12px", opacity: 0.7, lineHeight: 1.4 }}>
            {error ?? alarmText} Wake only works from sleep, not when the Deck is turned off.
          </div>
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="New event">
        <EventForm
          draftKey="new"
          initial={null}
          saveLabel="Add to schedule"
          onSave={async (kind, at) => {
            await addEvent(kind, at);
            ui.drafts.delete("new");
            uiChanged();
          }}
        />
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  const stopListening = startListening();
  return {
    name: "Sleep Scheduler",
    titleView: <div className={staticClasses.Title}>Sleep Scheduler</div>,
    content: <Content />,
    icon: <FaMoon />,
    onDismount() {
      stopListening();
    },
  };
});
