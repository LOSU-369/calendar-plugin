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

type ReviewableFieldKey = "title" | "date" | "endDate" | "startTime" | "endTime" | "location";
type CandidateAlternatives = Partial<Record<ReviewableFieldKey, string[]>>;
type CandidateState = EventCandidate & {
  checked: boolean;
  alternatives?: CandidateAlternatives;
  unresolvedFields?: ReviewableFieldKey[];
};
type StatusKind = "success" | "error";

interface StatusState {
  kind: StatusKind;
  title: string;
  message: string;
  action?: {
    label: string;
    url: string;
  };
}

interface ReviewAppProps {
  mode: "popup" | "review";
}

const STATUS_COLLAPSE_THRESHOLD = 220;
const REVIEWABLE_FIELDS: ReviewableFieldKey[] = ["title", "date", "endDate", "startTime", "endTime", "location"];
const FIELD_LABELS: Record<ReviewableFieldKey, string> = {
  title: "title",
  date: "start date",
  endDate: "end date",
  startTime: "start time",
  endTime: "end time",
  location: "location"
};
const TIMEZONE_OPTIONS = [
  "Europe/Zurich",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo"
];

const toDateTime = (date: string, time: string): string => `${date}T${time}:00`;

const addDaysToIsoDate = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return [
    result.getUTCFullYear(),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0")
  ].join("-");
};

const compactMessage = (message: string): string => {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
};

const shouldCollapseMessage = (message: string): boolean =>
  message.length > STATUS_COLLAPSE_THRESHOLD || message.split("\n").length > 4;

const normalizeOption = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

const uniqueValues = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizeOption(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const getFieldValue = (candidate: EventCandidate, key: ReviewableFieldKey): string | undefined => {
  if (key === "endDate") {
    return candidate.endDate ?? candidate.date;
  }
  const value = candidate[key];
  return typeof value === "string" ? value : undefined;
};

const sameEventGroupKey = (candidate: CandidateState): string =>
  [
    candidate.date,
    candidate.endDate ?? candidate.date,
    candidate.startTime ?? "",
    candidate.endTime ?? "",
    candidate.allDay ? "all-day" : "timed",
    candidate.sourceUrl ?? ""
  ].join("|");

const formatEventSummary = (event: CandidateState, timezone: string): string => {
  const dateRange = event.endDate && event.endDate !== event.date ? `${event.date} - ${event.endDate}` : event.date;
  if (event.allDay) {
    return `${dateRange} · All day`;
  }

  const timeRange = [event.startTime, event.endTime].filter(Boolean).join(" - ");
  return [dateRange, timeRange, event.location].filter(Boolean).join(" · ") || timezone;
};

const googleCalendarDayUrl = (isoDate: string): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `https://calendar.google.com/calendar/u/0/r/day/${year}/${month}/${day}`;
};

const mergeCandidateGroup = (group: CandidateState[], groupIndex: number): CandidateState => {
  const base = group[0];
  const alternatives: CandidateAlternatives = {};
  const unresolvedFields: ReviewableFieldKey[] = [];

  for (const key of REVIEWABLE_FIELDS) {
    const options = uniqueValues(group.map((candidate) => getFieldValue(candidate, key)));
    if (options.length > 1) {
      alternatives[key] = options;
      unresolvedFields.push(key);
    }
  }

  if (!unresolvedFields.length) {
    return base;
  }

  return withDefaultEndFields({
    ...base,
    id: `${base.id}-merged-${groupIndex}`,
    evidence: uniqueValues(group.flatMap((candidate) => candidate.evidence)),
    assumptions: uniqueValues([...group.flatMap((candidate) => candidate.assumptions), "Merged similar event candidates for review."]),
    confidence: Math.max(...group.map((candidate) => candidate.confidence)),
    duplicateHint: group.find((candidate) => candidate.duplicateHint?.maybeDuplicate)?.duplicateHint ?? base.duplicateHint,
    alternatives,
    unresolvedFields
  });
};

const mergeSimilarCandidates = (candidates: EventCandidate[]): CandidateState[] => {
  const groups = new Map<string, CandidateState[]>();
  for (const candidate of candidates) {
    const prepared = withDefaultEndFields({ ...candidate, checked: true });
    const key = sameEventGroupKey(prepared);
    groups.set(key, [...(groups.get(key) ?? []), prepared]);
  }

  return Array.from(groups.values()).map((group, index) => (group.length > 1 ? mergeCandidateGroup(group, index) : group[0]));
};

const isReviewableFieldKey = (key: PropertyKey): key is ReviewableFieldKey =>
  REVIEWABLE_FIELDS.includes(key as ReviewableFieldKey);

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
  const eventTimezone = ensured.timezone ?? timezone;

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
    start: { dateTime: toDateTime(ensured.date, ensured.startTime), timeZone: eventTimezone },
    end: { dateTime: toDateTime(timedEndDate, ensured.endTime), timeZone: eventTimezone }
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
      {status.action ? (
        <a className="status-action" href={status.action.url} target="_blank" rel="noreferrer">
          {status.action.label}
        </a>
      ) : null}
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
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());

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
      setExpandedEventIds(new Set());
      setSession(loadedSession);
      setEvents(mergeSimilarCandidates(loadedSession?.candidates ?? []));

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

    const unresolvedEvent = selectedEvents.find((event) => event.unresolvedFields?.length);
    if (unresolvedEvent) {
      const fields = unresolvedEvent.unresolvedFields?.map((field) => FIELD_LABELS[field]).join(", ");
      setExpandedEventIds((previous) => new Set(previous).add(unresolvedEvent.id));
      setStatus({
        kind: "error",
        title: "Review required",
        message: `Please choose the correct ${fields} before creating "${unresolvedEvent.title}".`
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
        message: `Created ${selectedEvents.length} event(s) in ${calendarSummary ?? "the selected calendar"}.`,
        action: {
          label: "Open that day in Google Calendar",
          url: googleCalendarDayUrl(selectedEvents[0].date)
        }
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
        const next = withDefaultEndFields({ ...item, [key]: value } as CandidateState);
        if (!isReviewableFieldKey(key)) {
          return next;
        }
        const unresolvedFields = next.unresolvedFields?.filter((field) => field !== key);
        return {
          ...next,
          unresolvedFields: unresolvedFields?.length ? unresolvedFields : undefined
        };
      })
    );
  };

  const toggleEventExpanded = (eventId: string): void => {
    setExpandedEventIds((previous) => {
      const next = new Set(previous);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const selectOnlyEvent = (index: number, eventId: string): void => {
    setEvents((previous) =>
      previous.map((event, eventIndex) => ({
        ...event,
        checked: eventIndex === index
      }))
    );
    setExpandedEventIds((previous) => new Set(previous).add(eventId));
  };

  const renderFieldReview = (event: CandidateState, index: number, key: ReviewableFieldKey): JSX.Element | null => {
    const options = event.alternatives?.[key] ?? [];
    const unresolved = event.unresolvedFields?.includes(key);
    if (!options.length && !unresolved) {
      return null;
    }

    return (
      <div className="field-review">
        {unresolved ? (
          <div className="field-review-warning">
            <span className="review-icon" aria-hidden="true">
              !
            </span>
            <span>Please choose the correct {FIELD_LABELS[key]}.</span>
          </div>
        ) : null}
        {options.length ? (
          <div className="alternative-row" aria-label={`Possible ${FIELD_LABELS[key]} values`}>
            {options.map((option) => (
              <button
                type="button"
                className={normalizeOption(String(event[key] ?? "")) === normalizeOption(option) ? "alternative-chip selected-chip" : "alternative-chip"}
                key={option}
                onClick={() => updateField(index, key, option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
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
        {events.map((event, index) => {
          const isExpanded = expandedEventIds.has(event.id);
          return (
            <div className={`candidate-card ${event.checked ? "candidate-card-selected" : ""}`} key={event.id}>
              <div className="candidate-summary-row">
                <input
                  className="candidate-checkbox"
                  type="checkbox"
                  checked={event.checked}
                  aria-label={`Create ${event.title}`}
                  onChange={(changeEvent) => updateField(index, "checked", changeEvent.target.checked)}
                />
                <button
                  type="button"
                  className="candidate-summary-button"
                  aria-expanded={isExpanded}
                  onClick={() => toggleEventExpanded(event.id)}
                >
                  <span className="candidate-title-line">
                    <span className="candidate-title">{event.title}</span>
                    {event.unresolvedFields?.length ? <span className="review-badge">Review</span> : null}
                  </span>
                  <span className="candidate-summary-meta">{formatEventSummary(event, timezone)}</span>
                </button>
                <button type="button" className="only-button" onClick={() => selectOnlyEvent(index, event.id)}>
                  Only
                </button>
              </div>

              {isExpanded ? (
                <div className="candidate-details">
                  <label className="field-group">
                    <div className="field-label-row">
                      <span className="field-label-text">Title</span>
                    </div>
                    <input value={event.title} onChange={(changeEvent) => updateField(index, "title", changeEvent.target.value)} />
                    {renderFieldReview(event, index, "title")}
                  </label>

                  <div className="field-grid">
                    <label className="field-group">
                      <div className="field-label-row">
                        <span className="field-label-text">Start date</span>
                      </div>
                      <input type="date" value={event.date} onChange={(changeEvent) => updateField(index, "date", changeEvent.target.value)} />
                      {renderFieldReview(event, index, "date")}
                    </label>
                    <label className="field-group">
                      <div className="field-label-row">
                        <span className="field-label-text">End date</span>
                      </div>
                      <input
                        type="date"
                        value={event.endDate ?? event.date}
                        onChange={(changeEvent) => updateField(index, "endDate", changeEvent.target.value)}
                      />
                      {renderFieldReview(event, index, "endDate")}
                    </label>
                    <label className="field-group">
                      <div className="field-label-row">
                        <span className="field-label-text">Start time</span>
                      </div>
                      <input
                        type="time"
                        value={event.startTime ?? ""}
                        disabled={event.allDay}
                        onChange={(changeEvent) => updateField(index, "startTime", changeEvent.target.value || undefined)}
                      />
                      {renderFieldReview(event, index, "startTime")}
                    </label>
                    <label className="field-group">
                      <div className="field-label-row">
                        <span className="field-label-text">End time</span>
                      </div>
                      <input
                        type="time"
                        value={event.endTime ?? ""}
                        disabled={event.allDay}
                        onChange={(changeEvent) => updateField(index, "endTime", changeEvent.target.value || undefined)}
                      />
                      {renderFieldReview(event, index, "endTime")}
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

                  <details className="timezone-details">
                    <summary>Timezone: {event.timezone ?? timezone}</summary>
                    <label className="field-group timezone-field">
                      <span className="field-label-text">Event timezone</span>
                      <input
                        list={`timezone-options-${index}`}
                        value={event.timezone ?? timezone}
                        onChange={(changeEvent) => updateField(index, "timezone", changeEvent.target.value || undefined)}
                      />
                      <datalist id={`timezone-options-${index}`}>
                        {TIMEZONE_OPTIONS.map((option) => (
                          <option value={option} key={option} />
                        ))}
                      </datalist>
                    </label>
                  </details>

                  <label className="field-group">
                    <div className="field-label-row">
                      <span className="field-label-text">Location</span>
                    </div>
                    <input value={event.location ?? ""} onChange={(changeEvent) => updateField(index, "location", changeEvent.target.value)} />
                    {renderFieldReview(event, index, "location")}
                  </label>

                  <label className="field-group">
                    <div className="field-label-row">
                      <span className="field-label-text">Description</span>
                    </div>
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
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
