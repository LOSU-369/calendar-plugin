import type { PendingSession, StoredSettings } from "../types";
import { chromeStorageGet, chromeStorageSet } from "./chrome-async";

const SETTINGS_KEY = "settings";
const PENDING_SESSION_KEY = "pendingSession";
const SELECTED_CALENDAR_ID_KEY = "selectedCalendarId";
const SELECTED_CALENDAR_SUMMARY_KEY = "selectedCalendarSummary";
const DEFAULT_BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:8787";

const defaultSettings: StoredSettings = {
  backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
  timezone: "Europe/Zurich",
  locale: "en-US",
  debug: false
};

export const getSettings = async (): Promise<StoredSettings> => {
  const data = await chromeStorageGet<{ settings?: StoredSettings }>([SETTINGS_KEY]);
  return { ...defaultSettings, ...(data.settings ?? {}) };
};

export const saveSettings = async (settings: StoredSettings): Promise<void> => {
  await chromeStorageSet({ [SETTINGS_KEY]: settings });
};

export const getSelectedCalendar = async (): Promise<{ id?: string; summary?: string }> => {
  const data = await chromeStorageGet<{ selectedCalendarId?: string; selectedCalendarSummary?: string }>([
    SELECTED_CALENDAR_ID_KEY,
    SELECTED_CALENDAR_SUMMARY_KEY
  ]);
  return { id: data.selectedCalendarId, summary: data.selectedCalendarSummary };
};

export const setSelectedCalendar = async (id: string, summary: string): Promise<void> => {
  await chromeStorageSet({
    [SELECTED_CALENDAR_ID_KEY]: id,
    [SELECTED_CALENDAR_SUMMARY_KEY]: summary
  });
};

export const savePendingSession = async (session: PendingSession): Promise<void> => {
  await chromeStorageSet({ [PENDING_SESSION_KEY]: session });
};

export const getPendingSession = async (): Promise<PendingSession | undefined> => {
  const data = await chromeStorageGet<{ pendingSession?: PendingSession }>([PENDING_SESSION_KEY]);
  return data.pendingSession;
};
