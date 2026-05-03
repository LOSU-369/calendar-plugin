import type { CalendarInfo, PendingSession } from "../types";
import { chromeRuntimeSendMessage } from "./chrome-async";

interface MessageResult<T> {
  ok: boolean;
  error?: string;
  session?: PendingSession;
  calendars?: CalendarInfo[];
  token?: string;
}

const assertOk = <T>(response: MessageResult<T>): MessageResult<T> => {
  if (!response.ok) {
    throw new Error(response.error || "Background message failed.");
  }
  return response;
};

export const scanActiveTab = async (): Promise<PendingSession> => {
  const response = await chromeRuntimeSendMessage<MessageResult<PendingSession>>({ type: "SCAN_ACTIVE_TAB" });
  return assertOk(response).session as PendingSession;
};

export const getPendingSessionFromBackground = async (): Promise<PendingSession | undefined> => {
  const response = await chromeRuntimeSendMessage<MessageResult<PendingSession>>({ type: "GET_PENDING_SESSION" });
  return assertOk(response).session;
};

export const listCalendarsFromBackground = async (): Promise<CalendarInfo[]> => {
  const response = await chromeRuntimeSendMessage<MessageResult<CalendarInfo[]>>({ type: "LIST_CALENDARS" });
  return assertOk(response).calendars ?? [];
};

export const requestCalendarTokenFromBackground = async (): Promise<string> => {
  const response = await chromeRuntimeSendMessage<MessageResult<string>>({ type: "GET_AUTH_TOKEN" });
  return assertOk(response).token as string;
};
