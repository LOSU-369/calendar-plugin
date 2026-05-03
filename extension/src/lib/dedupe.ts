import type { EventCandidate } from "../types";
import { listNearbyEvents } from "./google-calendar";

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const similarity = (a: string, b: string): number => {
  const sa = new Set(normalize(a).split(" ").filter(Boolean));
  const sb = new Set(normalize(b).split(" ").filter(Boolean));
  const common = [...sa].filter((w) => sb.has(w)).length;
  return common / Math.max(sa.size, sb.size, 1);
};

const toIso = (candidate: EventCandidate, timezone: string): { startIso: string; endIso: string } | null => {
  if (candidate.allDay) {
    const start = new Date(`${candidate.date}T00:00:00`);
    const end = new Date(`${(candidate.endDate ?? candidate.date)}T00:00:00`);
    end.setDate(end.getDate() + 1);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }
  if (!candidate.startTime) {
    return null;
  }
  const endTime = candidate.endTime ?? candidate.startTime;
  const start = new Date(`${candidate.date}T${candidate.startTime}:00`);
  const end = new Date(`${candidate.endDate ?? candidate.date}T${endTime}:00`);
  if (end <= start) {
    end.setHours(end.getHours() + 2);
  }
  if (timezone) {
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

export const checkPotentialDuplicate = async (
  candidate: EventCandidate,
  calendarId: string,
  timezone: string
): Promise<{ maybeDuplicate: boolean; reason?: string }> => {
  const baseRange = toIso(candidate, timezone);
  if (!baseRange) {
    return { maybeDuplicate: false };
  }
  const start = new Date(baseRange.startIso);
  const min = new Date(start);
  min.setHours(min.getHours() - 12);
  const max = new Date(start);
  max.setHours(max.getHours() + 12);
  const events = await listNearbyEvents(calendarId, min.toISOString(), max.toISOString());
  const title = candidate.title ?? "";
  const location = candidate.location ?? "";
  for (const item of events) {
    const titleSimilarity = similarity(title, item.summary ?? "");
    const sameStart = (item.start?.dateTime || item.start?.date || "").startsWith(candidate.date);
    const locationSimilarity = location && item.location ? similarity(location, item.location) : 0;
    const descHasUrl = Boolean(candidate.sourceUrl && item.description?.includes(candidate.sourceUrl));
    if ((titleSimilarity >= 0.8 && sameStart) || (locationSimilarity >= 0.85 && sameStart) || descHasUrl) {
      return {
        maybeDuplicate: true,
        reason: "Title/start/location/source URL looks similar to an existing calendar event."
      };
    }
  }
  return { maybeDuplicate: false };
};
