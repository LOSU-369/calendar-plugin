import { useEffect, useMemo, useState } from "react";
import type { CalendarInfo, EventCandidate, PendingSession } from "../types";
import { createGoogleCalendarEvent } from "../lib/google-calendar";
import { getSelectedCalendar, setSelectedCalendar } from "../lib/storage";
import {
  getPendingSessionFromBackground,
  listCalendarsFromBackground,
  requestCalendarTokenFromBackground,
  scanActiveTab
} from "../lib/background-client";
import "./styles.css";

type CandidateState = EventCandidate & { checked: boolean };
type StatusKind = "success" | "error";

interface StatusState {
  kind: StatusKind;
  title: string;
  message: string;
}

interface ReviewAppProps {
  mode: "popup" | "review";
}

const STATUS_COLLAPSE_THRESHOLD = 220;

const toDateTime = (date: string, time: string): string => `${date}T${time}:00`;

const addDaysToIsoDate = (isoDate: string, days: number): string => {
  const result = new Date(`${isoDate}T00:00:00`);
  result.setDate(result.getDate() + days);
  return result.toISOString().slice(0, 10);
};

const compactMessage = (message: string): string => {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
};

const shouldCollapseMessage = (message: string): boolean =>
  message.length > STATUS_COLLAPSE_THRESHOLD || message.split("\n").length > 4;

const withDefaultEndFields = (candidate: CandidateState): CandidateState => {
  const endDate = candidate.endDate ?? candidate.date;
  if (candidate.allDay || !candidate.startTime || candidate.endTime) {
    return { ...candidate, endDate };
  }

  const start = new Date(toDateTime(candidate.date, candidate.startTime));
  const end = new Date(start);
  end.setHours(end.getHours() + 2);

  return {
    ...candidate,
    endDate,
    endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`
  };
};

const ensureTimedEndDate = (candidate: CandidateState): string => {
  const baseEndDate = candidate.endDate ?? candidate.date;
  if (!candidate.startTime || !candidate.endTime) {
    return baseEndDate;
  }

  const start = new Date(toDateTime(candidate.date, candidate.startTime));
  const end = new Date(toDateTime(baseEndDate, candidate.endTime));
  return end > start ? baseEndDate : addDaysToIsoDate(baseEndDate, 1);
};

const eventToPayload = (candidate: CandidateState, timezone: string) => {
  const ensured = withDefaultEndFields(candidate);

  if (ensured.allDay) {
    const exclusiveEndDate = addDaysToIsoDate(ensured.endDate ?? ensured.date, 1);
    return {
      summary: ensured.title,
      description: ensured.description,
      location: ensured.location,
      source: ensured.sourceUrl ? { title: "Source", url: ensured.sourceUrl } : undefined,
      start: { date: ensured.date },
      end: { date: exclusiveEndDate }
    };
  }

  if (!ensured.startTime || !ensured.endTime) {
    throw new Error(`Event "${ensured.title}" is missing a start or end time.`);
  }

  const timedEndDate = ensureTimedEndDate(ensured);
  return {
    summary: ensured.title,
    description: ensured.description,
    location: ensured.location,
    source: ensured.sourceUrl ? { title: "Source", url: ensured.sourceUrl } : undefined,
    start: { dateTime: toDateTime(ensured.date, ensured.startTime), timeZone: timezone },
    end: { dateTime: toDateTime(timedEndDate, ensured.endTime), timeZone: timezone }
  };
};

const StatusBanner = ({ status }: { status: StatusState | undefined }): JSX.Element | null => {
  if (!status) {
    return null;
  }

  const collapsible = shouldCollapseMessage(status.message);
  return (
    <div className={`status-banner status-${status.kind}`}>
      <div className="status-title">{status.title}</div>
      {collapsible ? (
        <details className="status-details">
          <summary>{compactMessage(status.message)}</summary>
          <div className="status-message">{status.message}</div>
        </details>
      ) : (
        <div className="status-message">{status.message}</div>
      )}
    </div>
  );
};

export const ReviewApp = ({ mode }: ReviewAppProps): JSX.Element => {
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<StatusState | undefined>();
  const [session, setSession] = useState<PendingSession | undefined>();
  const [events, setEvents] = useState<CandidateState[]>([]);
  const [calendarId, setCalendarId] = useState<string | undefined>();
  const [calendarSummary, setCalendarSummary] = useState<string | undefined>();
  const [timezone, setTimezone] = useState("Europe/Zurich");
  const [calendarOptions, setCalendarOptions] = useState<CalendarInfo[]>([]);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();

  const selectedCount = useMemo(() => events.filter((event) => event.checked).length, [events]);

  const hydrate = async (triggerScan: boolean): Promise<void> => {
    try {
      setLoading(true);
      setStatus(undefined);

      const selectedCalendar = await getSelectedCalendar();
      setCalendarId(selectedCalendar.id);
      setCalendarSummary(selectedCalendar.summary);

      const settingsRaw = await chrome.storage.local.get(["settings"]);
      setTimezone(settingsRaw.settings?.timezone || "Europe/Zurich");

      const loadedSession = triggerScan ? await scanActiveTab() : await getPendingSessionFromBackground();
      setSession(loadedSession);
      setEvents((loadedSession?.candidates ?? []).map((candidate) => withDefaultEndFields({ ...candidate, checked: true })));

      const errorRaw = await chrome.storage.local.get(["lastError"]);
      setLastError(errorRaw.lastError);

      if (!loadedSession?.candidates?.length) {
        setStatus({
          kind: "error",
          title: "No candidates found",
          message: "No event candidates were extracted from this page. Try Refresh scan or use the text selection menu."
        });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        title: "Scan failed",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void hydrate(mode === "popup");
  }, [mode]);

  const refreshScan = async (): Promise<void> => {
    await hydrate(true);
  };

  const openCalendarPicker = async (): Promise<void> => {
    try {
      setStatus(undefined);
      await requestCalendarTokenFromBackground();
      const calendars = await listCalendarsFromBackground();
      if (!calendars.length) {
        throw new Error("No writable Google Calendar was found for this account.");
      }
      setCalendarOptions(calendars);
      setShowCalendarPicker(true);
    } catch (error) {
      setStatus({
        kind: "error",
        title: "Calendar access failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const createSelected = async (): Promise<void> => {
    if (!calendarId) {
      setStatus({
        kind: "error",
        title: "Target calendar required",
        message: "Choose a target calendar before creating events."
      });
      return;
    }

    const selectedEvents = events.filter((event) => event.checked);
    if (!selectedEvents.length) {
      setStatus({
        kind: "error",
        title: "Nothing selected",
        message: "Select at least one event candidate before creating."
      });
      return;
    }

    try {
      setCreating(true);
      setStatus(undefined);

      for (const candidate of selectedEvents) {
        await createGoogleCalendarEvent(calendarId, eventToPayload(candidate, timezone));
      }

      await chrome.storage.local.set({ lastCreatedAt: new Date().toISOString() });
      setLastError(undefined);
      setStatus({
        kind: "success",
        title: "Events created",
        message: `Created ${selectedEvents.length} event(s) in ${calendarSummary ?? "the selected calendar"}.`
      });
    } catch (error) {
      setStatus({
        kind: "error",
        title: "Google Calendar create failed",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setCreating(false);
    }
  };

  const updateField = <K extends keyof CandidateState>(index: number, key: K, value: CandidateState[K]): void => {
    setEvents((previous) =>
      previous.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }
        return withDefaultEndFields({ ...item, [key]: value } as CandidateState);
      })
    );
  };

  return (
    <div className={`app app-${mode}`}>
      <h1 className="page-title">Event Extractor</h1>

      <div className="button-row">
        <button className="primary-button" onClick={createSelected} disabled={creating || loading}>
          Create selected ({selectedCount})
        </button>
        <button onClick={refreshScan} disabled={loading}>
          Refresh scan
        </button>
      </div>

      <div className="button-row">
        <button onClick={openCalendarPicker}>Change target calendar</button>
        <button onClick={() => chrome.runtime.openOptionsPage()}>Open settings</button>
      </div>

      <div className="info-line">
        <strong>Target calendar:</strong> {calendarSummary ?? "Not selected"}
      </div>
      <div className="info-line">
        <strong>Source:</strong> {session?.source ?? "-"}
      </div>

      {loading && <div className="status-banner status-info">Scanning the current page...</div>}

      <StatusBanner status={status} />

      {!status && lastError ? (
        <StatusBanner
          status={{
            kind: "error",
            title: "Last background error",
            message: lastError
          }}
        />
      ) : null}

      {showCalendarPicker ? (
        <div className="panel">
          <div className="panel-title-row">
            <h2 className="section-title">Select target calendar</h2>
            <button onClick={() => setShowCalendarPicker(false)}>Done</button>
          </div>
          <div className="calendar-list">
            {calendarOptions.map((calendar) => (
              <label key={calendar.id} className="calendar-item">
                <input
                  type="radio"
                  name="calendar"
                  checked={calendarId === calendar.id}
                  onChange={async () => {
                    setCalendarId(calendar.id);
                    setCalendarSummary(calendar.summary);
                    await setSelectedCalendar(calendar.id, calendar.summary);
                    setStatus({
                      kind: "success",
                      title: "Default calendar updated",
                      message: `New events will go to ${calendar.summary}.`
                    });
                  }}
                />
                <span>
                  {calendar.summary} ({calendar.accessRole})
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="candidate-list">
        {events.map((event, index) => (
          <div className="candidate-card" key={event.id}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={event.checked}
                onChange={(changeEvent) => updateField(index, "checked", changeEvent.target.checked)}
              />
              Create
            </label>

            <label className="field-group">
              <span>Title</span>
              <input value={event.title} onChange={(changeEvent) => updateField(index, "title", changeEvent.target.value)} />
            </label>

            <div className="field-grid">
              <label className="field-group">
                <span>Start date</span>
                <input type="date" value={event.date} onChange={(changeEvent) => updateField(index, "date", changeEvent.target.value)} />
              </label>
              <label className="field-group">
                <span>End date</span>
                <input
                  type="date"
                  value={event.endDate ?? event.date}
                  onChange={(changeEvent) => updateField(index, "endDate", changeEvent.target.value)}
                />
              </label>
              <label className="field-group">
                <span>Start time</span>
                <input
                  type="time"
                  value={event.startTime ?? ""}
                  disabled={event.allDay}
                  onChange={(changeEvent) => updateField(index, "startTime", changeEvent.target.value || undefined)}
                />
              </label>
              <label className="field-group">
                <span>End time</span>
                <input
                  type="time"
                  value={event.endTime ?? ""}
                  disabled={event.allDay}
                  onChange={(changeEvent) => updateField(index, "endTime", changeEvent.target.value || undefined)}
                />
              </label>
            </div>

            <label className="checkbox-row secondary-checkbox">
              <input
                type="checkbox"
                checked={event.allDay}
                onChange={(changeEvent) => updateField(index, "allDay", changeEvent.target.checked)}
              />
              All day
            </label>

            <label className="field-group">
              <span>Location</span>
              <input value={event.location ?? ""} onChange={(changeEvent) => updateField(index, "location", changeEvent.target.value)} />
            </label>

            <label className="field-group">
              <span>Description</span>
              <textarea value={event.description ?? ""} onChange={(changeEvent) => updateField(index, "description", changeEvent.target.value)} />
            </label>

            <div className="card-meta">
              <div>Confidence: {Math.round(event.confidence * 100)}%</div>
              <div className={event.duplicateHint?.maybeDuplicate ? "warning-text" : ""}>
                Possible duplicate: {event.duplicateHint?.maybeDuplicate ? "Yes" : "No"}
              </div>
              {event.duplicateHint?.reason ? <div>{event.duplicateHint.reason}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
