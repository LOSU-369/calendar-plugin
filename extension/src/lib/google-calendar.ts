import type { CalendarInfo } from "../types";

const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

interface CalendarEventPayload {
  summary: string;
  description?: string;
  location?: string;
  source?: { title: string; url: string };
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
}

const getAuthToken = async (interactive: boolean): Promise<string> =>
  new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const lastError = chrome.runtime.lastError;
      if (lastError || !token) {
        reject(new Error(lastError?.message || "Unable to obtain Google auth token."));
        return;
      }
      resolve(token);
    });
  });

const gFetch = async <T>(token: string, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${GOOGLE_CALENDAR_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar API error (${response.status}): ${text}`);
  }
  return (await response.json()) as T;
};

export const getCalendarToken = async (): Promise<string> => {
  try {
    return await getAuthToken(false);
  } catch {
    return await getAuthToken(true);
  }
};

export const listWritableCalendars = async (): Promise<CalendarInfo[]> => {
  const token = await getCalendarToken();
  const result = await gFetch<{ items?: Array<{ id: string; summary: string; accessRole: string }> }>(
    token,
    "/users/me/calendarList?minAccessRole=writer"
  );
  return (result.items ?? []).filter((c) => ["owner", "writer"].includes(c.accessRole));
};

export const createGoogleCalendarEvent = async (calendarId: string, payload: CalendarEventPayload): Promise<void> => {
  const token = await getCalendarToken();
  await gFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
};

export const listNearbyEvents = async (
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<Array<{ summary?: string; start?: { dateTime?: string; date?: string }; location?: string; description?: string }>> => {
  const token = await getCalendarToken();
  const query = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: "true",
    maxResults: "100"
  });
  const result = await gFetch<{
    items?: Array<{ summary?: string; start?: { dateTime?: string; date?: string }; location?: string; description?: string }>;
  }>(token, `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`);
  return result.items ?? [];
};
