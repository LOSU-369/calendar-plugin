const monthMap: Record<string, number> = {
  jan: 1,
  january: 1,
  januar: 1,
  feb: 2,
  february: 2,
  februar: 2,
  mar: 3,
  march: 3,
  maerz: 3,
  marz: 3,
  apr: 4,
  april: 4,
  may: 5,
  mai: 5,
  jun: 6,
  june: 6,
  juni: 6,
  jul: 7,
  july: 7,
  juli: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  dezember: 12
};

interface OrderedDateMatch {
  index: number;
  iso: string;
}

interface OrderedTimeMatch {
  index: number;
  time: string;
}

export interface ParsedDateTimeDetails {
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  assumptions: string[];
}

const normalizeYear = (value: string | undefined, now: Date): number =>
  Number(!value ? now.getFullYear() : value.length === 2 ? `20${value}` : value);

const clampTime = (hour: number, minute: number): string =>
  `${String(Math.max(0, Math.min(23, hour))).padStart(2, "0")}:${String(Math.max(0, Math.min(59, minute))).padStart(2, "0")}`;

const addDateMatch = (matches: OrderedDateMatch[], index: number, year: number, month: number, day: number): void => {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return;
  }
  matches.push({ index, iso: toIsoDate(year, month, day) });
};

const addTimeMatch = (matches: OrderedTimeMatch[], index: number, hour: number, minute: number): void => {
  matches.push({ index, time: clampTime(hour, minute) });
};

const dedupeOrdered = <T extends { index: number }>(matches: T[]): T[] => {
  const seen = new Set<string>();
  return matches
    .sort((a, b) => a.index - b.index)
    .filter((match) => {
      const key = JSON.stringify(match);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const numericDateRegex = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/g;
const dayMonthNameRegex = /\b(\d{1,2})\.?\s+([A-Za-z]+)\s+(\d{2,4})\b/g;
const monthNameDayRegex = /\b([A-Za-z]+)\s+(\d{1,2})(?!\d)(?:,?\s*(\d{2,4}))?\b/g;
const twentyFourHourTimeRegex = /(?<!\d[./])\b(\d{1,2})([:.])(\d{2})\b(?![./]\d)/g;
const amPmTimeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;

export const toIsoDate = (year: number, month: number, day: number): string =>
  `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

export const addDaysToIsoDate = (isoDate: string, days: number): string => {
  const result = new Date(`${isoDate}T00:00:00`);
  result.setDate(result.getDate() + days);
  return result.toISOString().slice(0, 10);
};

const addHoursToTime = (time: string, hours: number): string => {
  const [baseHour, baseMinute] = time.split(":").map(Number);
  return clampTime(baseHour + hours, baseMinute);
};

export const extractDatesFromText = (text: string, now = new Date()): string[] => {
  const matches: OrderedDateMatch[] = [];
  for (const match of text.matchAll(numericDateRegex)) {
    addDateMatch(matches, match.index ?? 0, normalizeYear(match[3], now), Number(match[2]), Number(match[1]));
  }
  for (const match of text.matchAll(dayMonthNameRegex)) {
    const month = monthMap[match[2].toLowerCase()];
    if (month) {
      addDateMatch(matches, match.index ?? 0, normalizeYear(match[3], now), month, Number(match[1]));
    }
  }
  for (const match of text.matchAll(monthNameDayRegex)) {
    const month = monthMap[match[1].toLowerCase()];
    if (month) {
      addDateMatch(matches, match.index ?? 0, normalizeYear(match[3], now), month, Number(match[2]));
    }
  }
  return dedupeOrdered(matches).map((match) => match.iso);
};

export const extractTimesFromText = (text: string): string[] => {
  const matches: OrderedTimeMatch[] = [];
  for (const match of text.matchAll(twentyFourHourTimeRegex)) {
    addTimeMatch(matches, match.index ?? 0, Number(match[1]), Number(match[3]));
  }
  for (const match of text.matchAll(amPmTimeRegex)) {
    const rawHour = Number(match[1]);
    const minute = Number(match[2] ?? "0");
    const meridiem = match[3].toLowerCase();
    let hour = rawHour;
    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    }
    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }
    addTimeMatch(matches, match.index ?? 0, hour, minute);
  }
  return dedupeOrdered(matches).map((match) => match.time);
};

export const parseDateFromText = (text: string, now = new Date()): string | undefined => extractDatesFromText(text, now)[0];

export const parseDateTimeDetailsFromText = (text: string, now = new Date()): ParsedDateTimeDetails => {
  const assumptions: string[] = [];
  const dates = extractDatesFromText(text, now);
  const times = extractTimesFromText(text);

  if (!dates.length) {
    assumptions.push("No explicit date found.");
    return { allDay: false, assumptions };
  }

  const startDate = dates[0];
  const endDate = dates.slice(1).find((candidate) => candidate >= startDate) ?? dates[1] ?? startDate;

  if (times.length >= 2) {
    return {
      date: startDate,
      endDate,
      startTime: times[0],
      endTime: times[1],
      allDay: false,
      assumptions
    };
  }

  if (times.length === 1) {
    assumptions.push("End time missing, defaulted to +2 hours.");
    return {
      date: startDate,
      endDate,
      startTime: times[0],
      endTime: addHoursToTime(times[0], 2),
      allDay: false,
      assumptions
    };
  }

  assumptions.push("No explicit time found.");
  return {
    date: startDate,
    endDate,
    allDay: true,
    assumptions
  };
};

export const parseTimeRangeFromText = (
  text: string,
  now = new Date()
): { startTime?: string; endTime?: string; allDay: boolean; assumptions: string[] } => {
  const details = parseDateTimeDetailsFromText(text, now);
  return {
    startTime: details.startTime,
    endTime: details.endTime,
    allDay: details.allDay,
    assumptions: details.assumptions
  };
};
