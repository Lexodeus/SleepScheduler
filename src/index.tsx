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
import { useState } from "react";
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
import { defaultTime, formatClock, formatDay, formatRelative, nextOccurrence, TimeOfDay, toTimeOfDay } from "./time";

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

/** Type and time fields with a save button, used for a new event and for editing one in place. */
function EventForm({
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: ScheduledEvent | null;
  saveLabel: string;
  onSave: (kind: EventKind, at: number) => Promise<void>;
  onCancel?: () => void;
}) {
  const now = useNow();
  const [kind, setKind] = useState<EventKind>(initial?.kind ?? "sleep");
  const [time, setTime] = useState<TimeOfDay>(initial ? toTimeOfDay(new Date(initial.at * 1000)) : defaultTime());
  const [error, setError] = useState<string | null>(null);
  const at = nextOccurrence(time, new Date(now * 1000));

  const save = async () => {
    setError(null);
    try {
      await onSave(kind, nextOccurrence(time));
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
          selectedOption={kind}
          onChange={(option) => setKind(option.data)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Time" childrenLayout="below" bottomSeparator="none">
          <Focusable style={rowStyle}>
            <div style={cellStyle}>
              <Dropdown
                rgOptions={hourOptions}
                selectedOption={time.hour}
                onChange={(option) => setTime({ ...time, hour: option.data })}
              />
            </div>
            <div style={cellStyle}>
              <Dropdown
                rgOptions={minuteOptions}
                selectedOption={time.minute}
                onChange={(option) => setTime({ ...time, minute: option.data })}
              />
            </div>
            <div style={cellStyle}>
              <Dropdown
                rgOptions={periodOptions}
                selectedOption={time.pm}
                onChange={(option) => setTime({ ...time, pm: option.data })}
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

function EventRow({ event, now, onEdit }: { event: ScheduledEvent; now: number; onEdit: () => void }) {
  return (
    <PanelSectionRow>
      <Field label={`${kindLabels[event.kind]} at ${formatClock(event.at)}`} childrenLayout="below">
        <div style={{ ...noteStyle, marginTop: 0, marginBottom: "8px" }}>
          {`${formatDay(event.at, now)}, ${formatRelative(event.at, now)}`}
        </div>
        <Focusable style={rowStyle}>
          <DialogButton style={smallButton} onClick={onEdit}>
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
  const { events, alarm, error } = useSchedule();
  const now = useNow();
  const [editingId, setEditingId] = useState<string | null>(null);
  // A new key empties the new-event form after adding
  const [formKey, setFormKey] = useState(0);
  const upcoming = events.filter((event) => event.at > now - 5);

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
              initial={event}
              saveLabel="Save"
              onSave={async (kind, at) => {
                await updateEvent(event.id, kind, at);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <EventRow key={event.id} event={event} now={now} onEdit={() => setEditingId(event.id)} />
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
            {error ?? (alarm ? `Wake timer set for ${formatClock(alarm)}.` : "No wake timer set.")} Wake only works
            from sleep, not when the Deck is turned off.
          </div>
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="New event">
        <EventForm
          key={formKey}
          initial={null}
          saveLabel="Add to schedule"
          onSave={async (kind, at) => {
            await addEvent(kind, at);
            setFormKey((key) => key + 1);
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
