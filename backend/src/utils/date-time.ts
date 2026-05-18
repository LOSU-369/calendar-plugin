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

const normalizeLookupToken = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

const monthNumber = (value: string | undefined): number | undefined => (value ? monthMap[normalizeLookupToken(value)] : undefined);

const timezoneAbbreviationMap: Record<string, string> = {
  edt: "America/New_York",
  est: "America/New_York",
  cdt: "America/Chicago",
  cst: "America/Chicago",
  mdt: "America/Denver",
  mst: "America/Denver",
  pdt: "America/Los_Angeles",
  pst: "America/Los_Angeles",
  cest: "Europe/Zurich",
  cet: "Europe/Zurich",
  mesz: "Europe/Zurich",
  mez: "Europe/Zurich",
  bst: "Europe/London",
  gmt: "UTC",
  hkt: "Asia/Hong_Kong",
  sgt: "Asia/Singapore",
  jst: "Asia/Tokyo",
  kst: "Asia/Seoul"
};

interface OrderedDateMatch {
  index: number;
  iso: string;
}

interface OrderedTimeMatch {
  index: number;
  time: string;
}

interface OrderedZonedDateTimeMatch {
  index: number;
  iso: string;
  time: string;
}

export interface ParsedDateTimeDetails {
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
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

const dedupeOrderedBy = <T extends { index: number }>(matches: T[], keyForMatch: (match: T) => string): T[] => {
  const seen = new Set<string>();
  return matches
    .sort((a, b) => a.index - b.index)
    .filter((match) => {
      const key = keyForMatch(match);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const numericDateRegex = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/g;
const isoDateRegex =
  /\b(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const slashIsoDateRegex = /\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/g;
const dashMonthDayRegex = /(?<![\d-])(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?(?![\d-])/g;
const chineseDateRegex = /(?<!\d)(?:(\d{4})\s*\u5e74\s*)?(\d{1,2})\s*\u6708\s*(\d{1,2})\s*(?:\u65e5|\u53f7)?/g;
const dayMonthNameRegex = /\b(\d{1,2})\.?\s+([A-Za-zÄÖÜäöüß]+)(?:,?\s+(\d{2,4}))?\b/gi;
const monthNameDayRegex = /\b([A-Za-z]+)\s+(\d{1,2})(?!\d)(?:,?\s*(\d{2,4}))?\b/g;
const isoDateTimeRegex =
  /\b\d{4}-\d{2}-\d{2}[T\s](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const twentyFourHourTimeRegex = /(?<!\d[./])\b(\d{1,2})([:.])(\d{2})\b(?!\s*(?:am|pm)\b)(?![./]\d)/gi;
const amPmTimeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
const trailingAmPmRangeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(?:-|[\u2010-\u2015]|to|bis)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
const singleHourUhrRegex = /\b(\d{1,2})(?::(\d{2}))?\s*uhr\b/gi;
const chineseTimeRegex =
  /(?:\u51cc\u6668|\u65e9\u4e0a|\u4e0a\u5348|\u4e2d\u5348|\u4e0b\u5348|\u665a\u4e0a|\u665a\u95f4|\u591c\u95f4)?\s*(\d{1,2})\s*[\u70b9\u6642\u65f6]\s*(?:\u534a|(\d{1,2})\s*\u5206?)?/g;
const safeDayMonthNameRegex = /\b(\d{1,2})\.?\s+([\p{L}]+)(?:,?\s+(\d{4}))?\b/giu;
const safeMonthNameDayRegex = /\b([\p{L}]+)\s+(\d{1,2})(?!\d)(?:,?\s*(\d{4}))?\b/giu;
const safeUhrRangeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(?:-|[\u2010-\u2015]|bis)\s*(\d{1,2})(?::(\d{2}))?\s*uhr\b/gi;
const isoTimezoneRegex = /\b\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})\b/i;
const utcOffsetRegex = /\b(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/i;
const timezoneAbbreviationRegex =
  /\b(EDT|EST|CDT|CST|MDT|MST|PDT|PST|CEST|CET|MESZ|MEZ|BST|GMT|HKT|SGT|JST|KST)\b/i;
const chineseTimezoneRegex =
  /(?:\u5317\u4eac\u65f6\u95f4|\u4e2d\u570b\u6a19\u6e96\u6642\u9593|\u4e2d\u56fd\u6807\u51c6\u65f6\u95f4|\u9999\u6e2f\u6642\u9593|\u9999\u6e2f\u65f6\u95f4|\u53f0\u5317\u6642\u9593|\u53f0\u5317\u65f6\u95f4)/;
const uhrRangeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(?:-|–|—|bis)\s*(\d{1,2})(?::(\d{2}))?\s*uhr\b/gi;

export const toIsoDate = (year: number, month: number, day: number): string =>
  `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

export const addDaysToIsoDate = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return toIsoDate(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
};

const addHoursToDateAndTime = (isoDate: string, time: string, hours: number): { iso: string; time: string } => {
  const [baseHour, baseMinute] = time.split(":").map(Number);
  const totalMinutes = baseHour * 60 + baseMinute + hours * 60;
  const minutesPerDay = 24 * 60;
  const dayOffset = Math.floor(totalMinutes / minutesPerDay);
  const minuteOfDay = ((totalMinutes % minutesPerDay) + minutesPerDay) % minutesPerDay;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return {
    iso: addDaysToIsoDate(isoDate, dayOffset),
    time: clampTime(hour, minute)
  };
};

const toMeridiemHour = (rawHour: number, meridiem: string): number => {
  if (meridiem.toLowerCase() === "pm" && rawHour < 12) {
    return rawHour + 12;
  }
  if (meridiem.toLowerCase() === "am" && rawHour === 12) {
    return 0;
  }
  return rawHour;
};

const toChineseHour = (rawHour: number, period: string | undefined): number => {
  if (!period) {
    return rawHour;
  }
  if (
    (period === "\u4e0b\u5348" || period === "\u665a\u4e0a" || period === "\u665a\u95f4" || period === "\u591c\u95f4") &&
    rawHour < 12
  ) {
    return rawHour + 12;
  }
  if ((period === "\u51cc\u6668" || period === "\u65e9\u4e0a" || period === "\u4e0a\u5348") && rawHour === 12) {
    return 0;
  }
  if (period === "\u4e2d\u5348" && rawHour < 11) {
    return rawHour + 12;
  }
  return rawHour;
};

const normalizeUtcOffset = (rawOffset: string): string => {
  if (rawOffset.toUpperCase() === "Z") {
    return "UTC";
  }
  const match = rawOffset.match(/^([+-])(\d{2}):?(\d{2})$/);
  return match ? `UTC${match[1]}${match[2]}:${match[3]}` : rawOffset;
};

const normalizeIsoDateTimeForDate = (value: string): string =>
  value
    .replace(" ", "T")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

const formatDateInTimeZone = (date: Date, timeZone: string): { iso: string; time: string } | undefined => {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const valueFor = (type: string): string | undefined => parts.find((part) => part.type === type)?.value;
    const year = valueFor("year");
    const month = valueFor("month");
    const day = valueFor("day");
    const hour = valueFor("hour");
    const minute = valueFor("minute");
    if (!year || !month || !day || !hour || !minute) {
      return undefined;
    }
    return {
      iso: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`
    };
  } catch {
    return undefined;
  }
};

const extractExplicitZonedDateTimesFromText = (text: string, targetTimezone: string): OrderedZonedDateTimeMatch[] => {
  const matches: OrderedZonedDateTimeMatch[] = [];
  const explicitIsoDateTimeRegex =
    /\b\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g;

  for (const match of text.matchAll(explicitIsoDateTimeRegex)) {
    const date = new Date(normalizeIsoDateTimeForDate(match[0]));
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const converted = formatDateInTimeZone(date, targetTimezone);
    if (!converted) {
      continue;
    }
    matches.push({
      index: match.index ?? 0,
      iso: converted.iso,
      time: converted.time
    });
  }

  return dedupeOrderedBy(matches, (match) => `${match.iso}T${match.time}`);
};

export const extractTimezoneFromText = (text: string): string | undefined => {
  const isoMatch = text.match(isoTimezoneRegex);
  if (isoMatch?.[1]) {
    return normalizeUtcOffset(isoMatch[1]);
  }

  const utcMatch = text.match(utcOffsetRegex);
  if (utcMatch) {
    return `UTC${utcMatch[1]}${utcMatch[2].padStart(2, "0")}:${(utcMatch[3] ?? "00").padStart(2, "0")}`;
  }

  if (chineseTimezoneRegex.test(text)) {
    return "Asia/Shanghai";
  }

  const abbreviationMatch = text.match(timezoneAbbreviationRegex);
  if (abbreviationMatch?.[1]) {
    return timezoneAbbreviationMap[abbreviationMatch[1].toLowerCase()];
  }

  return undefined;
};

export const extractDatesFromText = (text: string, now = new Date()): string[] => {
  const matches: OrderedDateMatch[] = [];
  for (const match of text.matchAll(isoDateRegex)) {
    addDateMatch(matches, match.index ?? 0, Number(match[1]), Number(match[2]), Number(match[3]));
  }
  for (const match of text.matchAll(slashIsoDateRegex)) {
    addDateMatch(matches, match.index ?? 0, Number(match[1]), Number(match[2]), Number(match[3]));
  }
  for (const match of text.matchAll(chineseDateRegex)) {
    addDateMatch(matches, match.index ?? 0, normalizeYear(match[1], now), Number(match[2]), Number(match[3]));
  }
  for (const match of text.matchAll(dashMonthDayRegex)) {
    addDateMatch(matches, match.index ?? 0, normalizeYear(match[3], now), Number(match[1]), Number(match[2]));
  }
  for (const match of text.matchAll(numericDateRegex)) {
    addDateMatch(matches, match.index ?? 0, normalizeYear(match[3], now), Number(match[2]), Number(match[1]));
  }
  for (const match of text.matchAll(safeDayMonthNameRegex)) {
    const month = monthNumber(match[2]);
    if (month) {
      addDateMatch(matches, match.index ?? 0, normalizeYear(match[3], now), month, Number(match[1]));
    }
  }
  for (const match of text.matchAll(safeMonthNameDayRegex)) {
    const month = monthNumber(match[1]);
    if (month) {
      addDateMatch(matches, match.index ?? 0, normalizeYear(match[3], now), month, Number(match[2]));
    }
  }
  return dedupeOrderedBy(matches, (match) => match.iso).map((match) => match.iso);
};

export const extractTimesFromText = (text: string): string[] => {
  const matches: OrderedTimeMatch[] = [];
  const coveredRangeSpans: Array<{ start: number; end: number }> = [];
  const inCoveredRange = (index: number): boolean => coveredRangeSpans.some((span) => index >= span.start && index < span.end);

  for (const match of text.matchAll(isoDateTimeRegex)) {
    const start = match.index ?? 0;
    coveredRangeSpans.push({ start, end: start + match[0].length });
    addTimeMatch(matches, start, Number(match[1]), Number(match[2]));
  }
  for (const match of text.matchAll(safeUhrRangeRegex)) {
    const start = match.index ?? 0;
    coveredRangeSpans.push({ start, end: start + match[0].length });
    addTimeMatch(matches, start, Number(match[1]), Number(match[2] ?? "0"));
    addTimeMatch(matches, start + 1, Number(match[3]), Number(match[4] ?? "0"));
  }
  for (const match of text.matchAll(trailingAmPmRangeRegex)) {
    const start = match.index ?? 0;
    const meridiem = match[5];
    coveredRangeSpans.push({ start, end: start + match[0].length });
    addTimeMatch(matches, start, toMeridiemHour(Number(match[1]), meridiem), Number(match[2] ?? "0"));
    addTimeMatch(matches, start + 1, toMeridiemHour(Number(match[3]), meridiem), Number(match[4] ?? "0"));
  }
  for (const match of text.matchAll(twentyFourHourTimeRegex)) {
    if (inCoveredRange(match.index ?? 0)) {
      continue;
    }
    addTimeMatch(matches, match.index ?? 0, Number(match[1]), Number(match[3]));
  }
  for (const match of text.matchAll(amPmTimeRegex)) {
    if (inCoveredRange(match.index ?? 0)) {
      continue;
    }
    const rawHour = Number(match[1]);
    const minute = Number(match[2] ?? "0");
    const meridiem = match[3].toLowerCase();
    addTimeMatch(matches, match.index ?? 0, toMeridiemHour(rawHour, meridiem), minute);
  }
  for (const match of text.matchAll(singleHourUhrRegex)) {
    const index = match.index ?? 0;
    if (inCoveredRange(index)) {
      continue;
    }
    addTimeMatch(matches, index, Number(match[1]), Number(match[2] ?? "0"));
  }
  for (const match of text.matchAll(chineseTimeRegex)) {
    const index = match.index ?? 0;
    if (inCoveredRange(index)) {
      continue;
    }
    const period = match[0].match(
      /\u51cc\u6668|\u65e9\u4e0a|\u4e0a\u5348|\u4e2d\u5348|\u4e0b\u5348|\u665a\u4e0a|\u665a\u95f4|\u591c\u95f4/
    )?.[0];
    addTimeMatch(matches, index, toChineseHour(Number(match[1]), period), match[0].includes("\u534a") ? 30 : Number(match[2] ?? "0"));
  }
  return dedupeOrderedBy(matches, (match) => match.time).map((match) => match.time);
};

export const parseDateFromText = (text: string, now = new Date()): string | undefined => extractDatesFromText(text, now)[0];

export const parseDateTimeDetailsFromText = (text: string, now = new Date(), targetTimezone?: string): ParsedDateTimeDetails => {
  const assumptions: string[] = [];
  const zonedDateTimes = targetTimezone ? extractExplicitZonedDateTimesFromText(text, targetTimezone) : [];
  if (zonedDateTimes.length) {
    const start = zonedDateTimes[0];
    const end = zonedDateTimes[1] ?? addHoursToDateAndTime(start.iso, start.time, 2);
    if (zonedDateTimes.length === 1) {
      assumptions.push("End time missing, defaulted to +2 hours.");
    }
    return {
      date: start.iso,
      endDate: end.iso,
      startTime: start.time,
      endTime: end.time,
      timezone: targetTimezone,
      allDay: false,
      assumptions
    };
  }

  const dates = extractDatesFromText(text, now);
  const times = extractTimesFromText(text);
  const timezone = extractTimezoneFromText(text);

  if (!dates.length) {
    assumptions.push("No explicit date found.");
    return { timezone, allDay: false, assumptions };
  }

  const startDate = dates[0];
  const endDate = dates.slice(1).find((candidate) => candidate >= startDate) ?? dates[1] ?? startDate;

  if (times.length >= 2) {
    return {
      date: startDate,
      endDate,
      startTime: times[0],
      endTime: times[1],
      timezone,
      allDay: false,
      assumptions
    };
  }

  if (times.length === 1) {
    const end = addHoursToDateAndTime(startDate, times[0], 2);
    assumptions.push("End time missing, defaulted to +2 hours.");
    return {
      date: startDate,
      endDate: end.iso,
      startTime: times[0],
      endTime: end.time,
      timezone,
      allDay: false,
      assumptions
    };
  }

  assumptions.push("No explicit time found.");
  return {
    date: startDate,
    endDate,
    timezone,
    allDay: true,
    assumptions
  };
};

export const parseTimeRangeFromText = (
  text: string,
  now = new Date(),
  targetTimezone?: string
): { startTime?: string; endTime?: string; timezone?: string; allDay: boolean; assumptions: string[] } => {
  const details = parseDateTimeDetailsFromText(text, now, targetTimezone);
  return {
    startTime: details.startTime,
    endTime: details.endTime,
    timezone: details.timezone,
    allDay: details.allDay,
    assumptions: details.assumptions
  };
};
