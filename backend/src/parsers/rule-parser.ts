import { randomUUID } from "node:crypto";
import type { ExtractCandidate, ExtractRequest } from "../schemas/extract.js";
import { parseDateFromText, parseDateTimeDetailsFromText } from "../utils/date-time.js";

const KEYWORDS = [
  "termin",
  "date",
  "time",
  "raum",
  "ort",
  "location",
  "deadline",
  "zielgruppe",
  "meet your lab",
  "info session",
  "vortrag",
  "presentation",
  "meeting",
  "lecture"
];

const META_LINE_PATTERN =
  /\b(?:chf|eur|usd|free|gratis|kostenlos|spot available|registration|anmeldung|copy link|externe anmeldung|external registration)\b|(?:\u514d\u8d39|\u62a5\u540d|\u8d2d\u7968|\u7968\u4ef7|\u5143)/i;

const LOCATION_REJECT_PATTERN =
  /\b(?:keine platz|keine freie|spots? available|spot available|sold out|fully booked|ausverkauft|verfugbar|verfuegbar|members only|nur fur|nur fuer|login|anmeldung|registration)\b|(?:\u767b\u5f55|\u767b\u5165|\u62a5\u540d|\u6ce8\u518c|\u540d\u989d|\u552e\u7f44)/i;

const LOCATION_HINT_PATTERN =
  /\b(?:bar|room|raum|hall|saal|lab|campus|zentrum|center|centre|auditorium|lounge|cafe|club|building|gebaude|gebaeude|church|chapel|kirche|bethaus|stadion|stadium|theater|theatre|theatersaal|haus|strasse|street|zoom)\b|(?:\u7ebf\u4e0a|\u5728\u7ebf|\u817e\u8baf\u4f1a\u8bae|\u573a\u9986|\u5267\u9662|\u535a\u7269\u9986|\u5927\u5385|\u6559\u5ba4|\u8bb2\u5802|\u4f1a\u573a|\u5c55\u5385)/i;

const NOTICE_REJECT_PATTERN =
  /\b(?:anmeldefenster|registration closes|registration close|anmeldung schliesst|schliesst am|meldeschluss|anmeldeschluss|closing time)\b/i;

const FORM_REJECT_PATTERN =
  /\b(?:was isst du|lebensmittelanforderungen|food requirements|dietary requirements|allerg|special requirements)\b/i;

const COOKIE_REJECT_PATTERN =
  /\b(?:cookie|cookies|datenschutz|privacy policy|personal data|personliche daten|persoenliche daten|benutzerfreundlichkeit)\b/i;

const GENERIC_TITLE_REJECT_PATTERN =
  /^(?:description|location|start|end|time|date|details|detail|forum&contact|forum and contact|contact|conditions of participation|social media|useful links|login|information|info|download calendar entry|add to calendar|copy link|share|register|apply now|external registration|externe anmeldung|jeweils(?:\s+\w+)?\s+am:?|jeweils|\u65f6\u95f4|\u65e5\u671f|\u5730\u70b9|\u5730\u5740|\u8be6\u60c5|\u6d3b\u52a8\u8be6\u60c5|\u7b80\u4ecb|\u62a5\u540d|\u8d2d\u7968)$/i;

const METADATA_HEADING_PATTERN = /^(?:start|end|date|time|date\/time|datum|datum\/zeit|location|ort|raum|venue|anlage|\u65f6\u95f4|\u65e5\u671f|\u5730\u70b9|\u5730\u5740|\u573a\u5730|\u4f1a\u573a)$/i;
const START_LABEL_PATTERN = /^(?:start|begin|from)$/i;
const END_LABEL_PATTERN = /^(?:end|until|to)$/i;
const DESCRIPTION_LABEL_PATTERN = /^(?:description|about)$/i;
const LOCATION_LABEL_PATTERN = /^(?:location|venue|ort|raum|place|\u5730\u70b9|\u5730\u5740|\u573a\u5730|\u4f1a\u573a)$/i;
const TITLE_VALUE_LABEL_PATTERN = /^(?:title|titel|event title|lesson title|session title|name|bezeichnung|\u6807\u9898|\u6d3b\u52a8\u6807\u9898|\u540d\u79f0)$/i;
const CATEGORY_LABEL_PATTERN = /^(?:category|type|sportart|event type|genre|discipline)$/i;
const DATE_TIME_VALUE_LABEL_PATTERN = /^(?:date(?:\s*(?:\/|and)\s*time)?|datum(?:\s*(?:\/|und)\s*zeit)?|when|time|zeit|\u65f6\u95f4|\u65e5\u671f|\u6d3b\u52a8\u65f6\u95f4)$/i;
const FACILITY_LABEL_PATTERN = /^(?:location|venue|ort|raum|anlage|facility|place|room|\u5730\u70b9|\u5730\u5740|\u573a\u5730|\u4f1a\u573a)$/i;
const DESCRIPTION_VALUE_LABEL_PATTERN = /^(?:description|beschreibung|about|inhalt|details|content|\u63cf\u8ff0|\u7b80\u4ecb|\u8be6\u60c5|\u5185\u5bb9)$/i;
const NUMBER_LABEL_PATTERN = /^(?:number|nummer|id|code|kursnummer)$/i;
const ACTION_TITLE_REJECT_PATTERN =
  /^(?:tickets? kaufen|buy tickets?|ticket(?:s)?|download calendar entry|add to calendar|copy link|share|register|apply now|book now|reserve now|external registration|externe anmeldung|\u62a5\u540d|\u7acb\u5373\u62a5\u540d|\u8d2d\u7968|\u4e70\u7968|\u5206\u4eab|\u590d\u5236\u94fe\u63a5)$/i;
const WEEKDAY_ONLY_PATTERN =
  /^(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)$/i;

const normalizeHeuristicText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

const isRejectedNoticeOrForm = (value: string): boolean => {
  const normalized = normalizeHeuristicText(value);
  return NOTICE_REJECT_PATTERN.test(normalized) || FORM_REJECT_PATTERN.test(normalized) || COOKIE_REJECT_PATTERN.test(normalized);
};

const isGenericTitleHeading = (value: string): boolean => {
  const normalized = normalizeHeuristicText(value).replace(/\s+/g, " ");
  return GENERIC_TITLE_REJECT_PATTERN.test(normalized);
};

const isRejectedInteractiveTitle = (value: string): boolean => ACTION_TITLE_REJECT_PATTERN.test(normalizeHeuristicText(value));

const cleanTitleCandidate = (value: string): string => {
  return value.trim().replace(/^\d+[.)]\s*/, "").trim();
};

type StructuredFieldKey = "title" | "category" | "datetime" | "location" | "description" | "number";

const getStructuredFieldKey = (value: string): StructuredFieldKey | undefined => {
  const normalized = normalizeHeuristicText(value).replace(/\s+/g, " ").replace(/[:：]+$/u, "");
  if (TITLE_VALUE_LABEL_PATTERN.test(normalized)) {
    return "title";
  }
  if (CATEGORY_LABEL_PATTERN.test(normalized)) {
    return "category";
  }
  if (DATE_TIME_VALUE_LABEL_PATTERN.test(normalized)) {
    return "datetime";
  }
  if (FACILITY_LABEL_PATTERN.test(normalized)) {
    return "location";
  }
  if (DESCRIPTION_VALUE_LABEL_PATTERN.test(normalized)) {
    return "description";
  }
  if (NUMBER_LABEL_PATTERN.test(normalized)) {
    return "number";
  }
  return undefined;
};

const hasDateOrTimeSignal = (text: string): boolean => {
  const dateLike =
    /\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b/.test(text) ||
    /\b\d{4}\/\d{1,2}\/\d{1,2}\b/.test(text) ||
    /(?<![\d-])\d{1,2}-\d{1,2}(?![\d-])/.test(text) ||
    /(?:(?:\d{4}\s*)?\u5e74\s*)?\d{1,2}\s*\u6708\s*\d{1,2}\s*(?:\u65e5|\u53f7)?/.test(text) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|januar|februar|maerz|marz|mai|juni|juli|august|september|oktober|november|dezember)\b/i.test(
      text
    );
  const timeLike =
    /\b\d{1,2}[:.]\d{2}\b/.test(text) ||
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text) ||
    /(?:\u51cc\u6668|\u65e9\u4e0a|\u4e0a\u5348|\u4e2d\u5348|\u4e0b\u5348|\u665a\u4e0a|\u665a\u95f4|\u591c\u95f4)?\s*\d{1,2}\s*[\u70b9\u6642\u65f6]/.test(text);
  const uhrLike = /\b\d{1,2}(?::\d{2})?\s*(?:uhr|(?:-|[\u2010-\u2015]|bis)\s*\d{1,2}(?::\d{2})?\s*uhr)\b/i.test(text);
  return dateLike || timeLike || uhrLike;
};

const linesAround = (lines: string[], index: number): string[] => lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 6));

const isStructuredFieldLabel = (value: string): boolean => Boolean(getStructuredFieldKey(value));

const isNoiseLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (isStructuredFieldLabel(trimmed)) {
    return true;
  }
  if (isGenericTitleHeading(trimmed) || isRejectedInteractiveTitle(trimmed)) {
    return true;
  }
  if (hasDateOrTimeSignal(trimmed) || META_LINE_PATTERN.test(trimmed) || isRejectedNoticeOrForm(trimmed)) {
    return true;
  }
  if (/^[/-\s]+$/.test(trimmed)) {
    return true;
  }
  return false;
};

const scoreTitle = (line: string): number => {
  if (isNoiseLine(line)) {
    return Number.NEGATIVE_INFINITY;
  }
  const comparableLine = line.replace(/^\d+[.)]\s*/, "").trim();
  let score = 0;
  if (/^\d+[.)]\s+\S/.test(line)) {
    score += 3;
  }
  if (/^[\p{Lu}][\p{L}\p{N}\s'’"&:+()/-]{3,140}$/u.test(comparableLine)) {
    score += 5;
  }
  if (/[\p{Script=Han}]/u.test(comparableLine) && comparableLine.length >= 3 && comparableLine.length <= 120) {
    score += 7;
  }
  if (/^[\p{Lu}\d&.-]{2,8}$/u.test(comparableLine)) {
    score += 7;
  }
  if (!/[.!?]/.test(comparableLine)) {
    score += 2;
  }
  if (!/[,/]/.test(comparableLine)) {
    score += 1;
  }
  const wordCount = comparableLine.split(/\s+/).length;
  if (wordCount >= 2 && wordCount <= 8) {
    score += 1;
  }
  return score;
};

const getInputTitleHints = (input: ExtractRequest): string[] =>
  (input.titleHints ?? [])
    .map((hint) => hint.trim())
    .filter((hint) => hint && !isGenericTitleHeading(hint) && !isRejectedInteractiveTitle(hint));

const scoreHintAlignment = (line: string, input: ExtractRequest): number => {
  const normalizedLine = normalizeHeuristicText(line);
  let best = 0;

  for (const hint of getInputTitleHints(input)) {
    const normalizedHint = normalizeHeuristicText(hint);
    if (normalizedLine === normalizedHint) {
      best = Math.max(best, 8);
    } else if (normalizedHint.includes(normalizedLine) || normalizedLine.includes(normalizedHint)) {
      best = Math.max(best, 5);
    }
  }

  return best;
};

const titleContextBoost = (lines: string[], index: number): number => {
  const previous = lines[index - 1]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  let boost = 0;
  const previousKey = previous ? getStructuredFieldKey(previous) : undefined;
  const nextKey = next ? getStructuredFieldKey(next) : undefined;

  if (previous && isGenericTitleHeading(previous)) {
    boost += 2;
  }

  if (previousKey === "title") {
    boost += 10;
  } else if (previousKey === "category") {
    boost += 5;
  }

  if (next && METADATA_HEADING_PATTERN.test(normalizeHeuristicText(next))) {
    boost += 3;
  }

  if (nextKey === "datetime") {
    boost += 8;
  } else if (nextKey === "location" || nextKey === "description") {
    boost += 2;
  }

  return boost;
};

const hasStrongTitleBefore = (lines: string[], index: number): boolean => {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 10); cursor -= 1) {
    const line = lines[cursor]?.trim();
    if (line && scoreTitle(line) >= 8) {
      return true;
    }
  }
  return false;
};

const inferTitleCandidates = (lines: string[], index: number, fallback: string, input: ExtractRequest): string[] => {
  const previousCandidates = [];
  for (let cursor = index - 1; cursor >= Math.max(0, index - 10); cursor -= 1) {
    const line = lines[cursor]?.trim();
    if (!line) {
      continue;
    }
    const score = scoreTitle(line);
    if (Number.isFinite(score)) {
      previousCandidates.push({
        line,
        score,
        distance: index - cursor,
        adjustedScore: score + titleContextBoost(lines, cursor) + scoreHintAlignment(line, input) - (index - cursor) * 0.75
      });
    }
  }

  previousCandidates.sort((a, b) => b.adjustedScore - a.adjustedScore || b.score - a.score || a.distance - b.distance);

  const windowStart = Math.max(0, index - 8);
  const windowEnd = Math.min(lines.length, index + 1);
  const candidates = lines
    .slice(windowStart, windowEnd)
    .map((line, localIndex) => ({
      line: line.trim(),
      score: scoreTitle(line.trim()),
      distance: Math.abs(index - (windowStart + localIndex)),
      adjustedScore:
        scoreTitle(line.trim()) +
        titleContextBoost(lines, windowStart + localIndex) +
        scoreHintAlignment(line.trim(), input) -
        Math.abs(index - (windowStart + localIndex)) * 0.75
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.adjustedScore - a.adjustedScore || b.score - a.score || a.distance - b.distance);

  const combined = [...previousCandidates, ...candidates]
    .filter((item) => item.score >= 7)
    .sort((a, b) => b.adjustedScore - a.adjustedScore || b.score - a.score || a.distance - b.distance);

  const uniqueTitles = Array.from(
    new Map(
      combined.map((item) => [
        normalizeHeuristicText(item.line),
        {
          line: item.line,
          adjustedScore: item.adjustedScore
        }
      ])
    ).values()
  );

  const selected = uniqueTitles.slice(0, 3).map((item) => item.line);
  if (selected.length) {
    return selected;
  }

  const fallbackTitle = isGenericTitleHeading(fallback) || isRejectedInteractiveTitle(fallback) ? "Untitled Event" : fallback.slice(0, 80);
  return [fallbackTitle];
};

const inferStructuredTitles = (lines: string[], metadataIndex: number, fallback: string, input: ExtractRequest): string[] => {
  const hintTitles = getInputTitleHints(input).slice(0, 4);
  const options: string[] = [];

  const addOption = (value: string | undefined): void => {
    if (!value) {
      return;
    }
    const trimmed = cleanTitleCandidate(value);
    if (!trimmed || isGenericTitleHeading(trimmed) || isRejectedInteractiveTitle(trimmed)) {
      return;
    }
    if (scoreTitle(trimmed) < 6 && !hintTitles.some((hint) => normalizeHeuristicText(hint) === normalizeHeuristicText(trimmed))) {
      return;
    }
    if (!options.some((option) => normalizeHeuristicText(option) === normalizeHeuristicText(trimmed))) {
      options.push(trimmed);
    }
  };

  for (let cursor = metadataIndex - 1; cursor >= Math.max(0, metadataIndex - 8); cursor -= 1) {
    const line = lines[cursor]?.trim();
    if (!line || isGenericTitleHeading(line)) {
      continue;
    }
    if (scoreTitle(line) >= 7) {
      addOption(line);
    }
  }

  inferTitleCandidates(lines, metadataIndex, fallback, input).forEach(addOption);
  hintTitles.forEach(addOption);

  if (options.length) {
    return options.slice(0, 3);
  }

  return hintTitles.length ? hintTitles.slice(0, 2) : [];
};

const cleanLocation = (value: string): string | undefined => {
  const cleaned = value.replace(/^[\s,/-]+|[\s,/-]+$/g, "").trim();
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    return undefined;
  }
  return cleaned || undefined;
};

const isLocationLike = (value: string): boolean => {
  const trimmed = value.trim();
  const normalized = normalizeHeuristicText(trimmed);
  if (!trimmed) {
    return false;
  }
  if (WEEKDAY_ONLY_PATTERN.test(normalized)) {
    return false;
  }
  if (META_LINE_PATTERN.test(trimmed) || META_LINE_PATTERN.test(normalized)) {
    return false;
  }
  if (hasDateOrTimeSignal(trimmed)) {
    return false;
  }
  if (LOCATION_REJECT_PATTERN.test(normalized) || isRejectedNoticeOrForm(trimmed)) {
    return false;
  }
  if (/^chf\b/i.test(normalized) || /^[\d\s.,/-]+$/.test(trimmed)) {
    return false;
  }
  return trimmed.length <= 80;
};

const scoreLocationCandidate = (value: string): number => {
  if (!isLocationLike(value)) {
    return Number.NEGATIVE_INFINITY;
  }

  const trimmed = value.trim();
  const normalized = normalizeHeuristicText(trimmed);
  let score = 0;

  if (LOCATION_HINT_PATTERN.test(normalized)) {
    score += 4;
  }
  if (/^[A-Z]{2,}\s+[\p{Lu}\p{Ll}][\p{L}\d .'-]{2,60}$/u.test(trimmed)) {
    score += 4;
  }
  if (/^[A-Z][A-Za-z0-9 .,&'/-]{2,60}$/.test(trimmed)) {
    score += 2;
  }
  if (trimmed.split(/\s+/).length <= 4) {
    score += 1;
  }
  if (!/[.!?]/.test(trimmed)) {
    score += 1;
  }

  return score;
};

const inferLocation = (lines: string[], index: number): string | undefined => {
  for (let cursor = index; cursor < Math.min(lines.length, index + 16); cursor += 1) {
    const line = lines[cursor]?.trim() ?? "";
    const explicit = line.match(/(?:raum|ort|location|venue|place|\u5730\u70b9|\u5730\u5740|\u573a\u5730|\u4f1a\u573a)\s*[:：-]\s*(.+)$/i);
    if (explicit) {
      const cleaned = cleanLocation(explicit[1]);
      if (cleaned && isLocationLike(cleaned)) {
        return cleaned;
      }
    }
    if (LOCATION_LABEL_PATTERN.test(normalizeHeuristicText(line).replace(/[:：]+$/u, ""))) {
      for (let forward = cursor + 1; forward < Math.min(lines.length, cursor + 5); forward += 1) {
        const candidate = cleanLocation(lines[forward] ?? "");
        if (candidate && isLocationLike(candidate)) {
          return candidate;
        }
      }
    }
  }

  const context = lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 7));
  for (const line of context) {
    const explicit = line.match(/(?:raum|ort|location|venue|\u5730\u70b9|\u5730\u5740|\u573a\u5730|\u4f1a\u573a)\s*[:：\-]?\s*(.+)$/i);
    if (explicit) {
      return cleanLocation(explicit[1]);
    }
  }

  for (const line of context) {
    const slashParts = line.split("/").map((part) => part.trim()).filter(Boolean);
    if (slashParts.length >= 2 && META_LINE_PATTERN.test(slashParts[0])) {
      const locationCandidate = cleanLocation(slashParts[slashParts.length - 1]);
      if (locationCandidate && isLocationLike(locationCandidate)) {
        return locationCandidate;
      }
    }
  }

  for (let cursor = 0; cursor < context.length; cursor += 1) {
    if (
      !META_LINE_PATTERN.test(context[cursor]) &&
      !LOCATION_REJECT_PATTERN.test(normalizeHeuristicText(context[cursor])) &&
      !isRejectedNoticeOrForm(context[cursor])
    ) {
      continue;
    }
    let bestCandidate: string | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let forward = cursor + 1; forward < Math.min(context.length, cursor + 4); forward += 1) {
      const candidate = context[forward].trim();
      if (!candidate || candidate === "/") {
        continue;
      }
      const score = scoreLocationCandidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    if (bestCandidate) {
      return cleanLocation(bestCandidate);
    }
  }

  let bestFallback: string | undefined;
  let bestFallbackScore = Number.NEGATIVE_INFINITY;
  for (const line of context.slice(1)) {
    const trimmed = line.trim();
    if (/^[A-Z]{2,}\s*[A-Z]?\s*\d[\w\s,.-]*$/i.test(trimmed)) {
      const score = scoreLocationCandidate(trimmed) + 2;
      if (score > bestFallbackScore) {
        bestFallbackScore = score;
        bestFallback = trimmed;
      }
    }
    if (/^[A-Z][A-Za-z-]{2,}$/.test(trimmed) || /^[A-Z][A-Za-z0-9 .,&'/-]{2,60}$/.test(trimmed)) {
      const score = scoreLocationCandidate(trimmed);
      if (score > bestFallbackScore) {
        bestFallbackScore = score;
        bestFallback = trimmed;
      }
    }
  }

  return bestFallback ? cleanLocation(bestFallback) : undefined;
};

const inferStructuredLocation = (lines: string[], index: number): string | undefined => {
  for (let cursor = index; cursor < Math.min(lines.length, index + 12); cursor += 1) {
    const line = lines[cursor]?.trim();
    if (!line) {
      continue;
    }

    if (LOCATION_LABEL_PATTERN.test(normalizeHeuristicText(line))) {
      for (let forward = cursor + 1; forward < Math.min(lines.length, cursor + 5); forward += 1) {
        const candidate = cleanLocation(lines[forward] ?? "");
        if (candidate && isLocationLike(candidate)) {
          return candidate;
        }
      }
    }
  }

  return inferLocation(lines, index);
};

const inferStructuredDescription = (lines: string[], index: number): string | undefined => {
  for (let cursor = index; cursor < Math.min(lines.length, index + 14); cursor += 1) {
    const line = lines[cursor]?.trim();
    if (!line) {
      continue;
    }

    if (DESCRIPTION_LABEL_PATTERN.test(normalizeHeuristicText(line))) {
      const descriptionLines: string[] = [];
      for (let forward = cursor + 1; forward < Math.min(lines.length, cursor + 6); forward += 1) {
        const candidate = lines[forward]?.trim();
        if (!candidate || isGenericTitleHeading(candidate) || METADATA_HEADING_PATTERN.test(normalizeHeuristicText(candidate))) {
          break;
        }
        descriptionLines.push(candidate);
      }
      if (descriptionLines.length) {
        return descriptionLines.join("\n").slice(0, 1000);
      }
    }
  }

  return undefined;
};

const INLINE_EVENT_LINE_PATTERN =
  /^[•*\-–—]?\s*(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\w{2,},?\s*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?).*$/i;

const LOCALIZED_INLINE_EVENT_LINE_PATTERN =
  /^[\s*.-]*(?:(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag),?\s+)?(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}\.?\s+[\p{L}]+(?:,?\s+\d{4})?).*$/iu;

const extractInlineEventTitleAndLocation = (
  line: string
): { title?: string; location?: string; description?: string } => {
  const withoutUrls = line
    .replace(/\((https?:\/\/[^)]+)\)/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^[•*\-–—]\s*/, "")
    .trim();

  const structuredMatch = withoutUrls.match(
    /^(?:[A-Za-z]{2,9},?\s+)?(?<date>\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*,?\s*(?<time>\d{1,2}(?::|\.)\d{2}(?:\s*(?:am|pm))?)\s*(?:\((?<location>[^)]+)\))?\s*(?<title>.+)$/i
  );

  if (!structuredMatch?.groups) {
    const localizedMatch = withoutUrls.match(
      /^(?:(?:[\p{L}]+),?\s+)?(?<date>\d{1,2}\.?\s+[\p{L}]+(?:,?\s+\d{4})?)\s*,?\s*(?<time>\d{1,2}(?::\d{2})?\s*(?:uhr|(?:-|[\u2010-\u2015]|bis)\s*\d{1,2}(?::\d{2})?\s*uhr))(?:\s*,\s*(?<title>[^,]+))?/iu
    );
    if (!localizedMatch?.groups) {
      return {};
    }
    return {
      title: localizedMatch.groups.title?.trim() || undefined,
      description: withoutUrls
    };
  }

  const title = structuredMatch.groups.title
    ?.replace(/\([^)]*\)$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .trim();
  const usableTitle =
    title && !/^(?:-|[\u2010-\u2015]|to|bis)\s*\d{1,2}(?::\d{2})?\s*(?:[A-Z]{2,5})?$/i.test(title) ? title : undefined;

  const location = structuredMatch.groups.location?.trim();

  return {
    title: usableTitle,
    location: location || undefined,
    description: withoutUrls
  };
};

const inferInlineTitle = (lines: string[], index: number, fallback: string, input: ExtractRequest): string | undefined => {
  const nearbyCandidates: Array<{ line: string; adjustedScore: number }> = [];
  for (let cursor = index - 1; cursor >= Math.max(0, index - 5); cursor -= 1) {
    const line = lines[cursor]?.trim();
    if (
      !line ||
      scoreLocationCandidate(line) >= 5 ||
      hasDateOrTimeSignal(line) ||
      isGenericTitleHeading(line) ||
      isRejectedInteractiveTitle(line)
    ) {
      continue;
    }
    const score = scoreTitle(line);
    const hintBoost = scoreHintAlignment(line, input);
    if (Number.isFinite(score) || hintBoost > 0 || (line.length <= 120 && !/[.!?]$/.test(line))) {
      nearbyCandidates.push({
        line: line.replace(/^\d+[.)]\s*/, ""),
        adjustedScore: Math.max(Number.isFinite(score) ? score : 0, 0) + hintBoost - (index - cursor) * 0.75
      });
    }
  }
  nearbyCandidates.sort((a, b) => b.adjustedScore - a.adjustedScore || a.line.length - b.line.length);
  if (nearbyCandidates.length) {
    return nearbyCandidates[0].line;
  }

  return inferTitleCandidates(lines, index, fallback, input)[0];
};

const extractLocationFromMetaLine = (line: string): string | undefined => {
  const slashParts = line.split("/").map((part) => part.trim()).filter(Boolean);
  const tail = slashParts.length >= 2 ? slashParts[slashParts.length - 1] : line.match(/(?:verf\S*gbar|available)\s*(.+)$/i)?.[1];
  const cleaned = cleanLocation(tail ?? "");
  return cleaned && isLocationLike(cleaned) ? cleaned : undefined;
};

const inferInlineLocation = (lines: string[], index: number, fallback?: string, preferFollowing = false): string | undefined => {
  if (fallback) {
    return fallback;
  }

  if (preferFollowing) {
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 3); cursor += 1) {
      const line = lines[cursor]?.trim();
      if (!line) {
        continue;
      }
      const metaLocation = extractLocationFromMetaLine(line);
      if (metaLocation) {
        return metaLocation;
      }
      if (scoreLocationCandidate(line) >= 5) {
        return cleanLocation(line);
      }
    }
  }

  for (let cursor = index - 1; cursor >= Math.max(0, index - 3); cursor -= 1) {
    const line = lines[cursor]?.trim();
    if (!line) {
      continue;
    }
    if (scoreLocationCandidate(line) >= 5) {
      return cleanLocation(line);
    }
  }

  return undefined;
};

const extractInlineDateCandidates = (lines: string[], input: ExtractRequest): ExtractCandidate[] => {
  const candidates: ExtractCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line || (!INLINE_EVENT_LINE_PATTERN.test(line) && !LOCALIZED_INLINE_EVENT_LINE_PATTERN.test(line)) || !hasDateOrTimeSignal(line)) {
      continue;
    }

    const details = parseDateTimeDetailsFromText(line, new Date(), input.timezone);
    if (!details.date) {
      continue;
    }

    const extracted = extractInlineEventTitleAndLocation(line);
    const primaryTitle = extracted.title?.trim() || inferInlineTitle(lines, index, input.pageTitle || "Untitled Event", input);
    if (!primaryTitle || isGenericTitleHeading(primaryTitle) || isRejectedInteractiveTitle(primaryTitle) || isStructuredFieldLabel(primaryTitle)) {
      continue;
    }

    const descriptionLines = [line];
    const nextLine = lines[index + 1]?.trim();
    if (nextLine && !hasDateOrTimeSignal(nextLine) && !isRejectedNoticeOrForm(nextLine)) {
      descriptionLines.push(nextLine);
    }

    candidates.push({
      id: randomUUID(),
      title: primaryTitle,
      date: details.date!,
      endDate: details.endDate ?? details.date,
      startTime: details.startTime,
      endTime: details.endTime,
      timezone: details.timezone,
      allDay: details.allDay,
      location: inferInlineLocation(lines, index, extracted.location, !extracted.title),
      description: descriptionLines.join("\n"),
      sourceUrl: input.pageUrl,
      evidence: [line],
      confidence: details.allDay ? 0.8 : 0.9,
      assumptions: details.assumptions
    });
  }

  return uniqueBySignature(candidates);
};

const extractLabeledFieldCandidates = (lines: string[], input: ExtractRequest): ExtractCandidate[] => {
  const fieldValues: Record<StructuredFieldKey, string[]> = {
    title: [],
    category: [],
    datetime: [],
    location: [],
    description: [],
    number: []
  };
  const datetimeIndexes: number[] = [];

  const pushFieldValue = (key: StructuredFieldKey, rawValue: string | undefined): void => {
    if (!rawValue) {
      return;
    }
    const value = rawValue.trim();
    if (!value) {
      return;
    }
    if (!fieldValues[key].some((item) => normalizeHeuristicText(item) === normalizeHeuristicText(value))) {
      fieldValues[key].push(value);
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    const inlineMatch = line.match(/^([^:：]+)[:：]\s+(.+)$/);
    if (inlineMatch) {
      const inlineKey = getStructuredFieldKey(inlineMatch[1] ?? "");
      if (inlineKey) {
        if (inlineKey === "datetime") {
          const datetimeLines = [inlineMatch[2]];
          for (let forward = index + 1; forward < Math.min(lines.length, index + 9); forward += 1) {
            const candidate = lines[forward]?.trim();
            if (!candidate || isStructuredFieldLabel(candidate)) {
              break;
            }
            datetimeLines.push(candidate);
          }
          pushFieldValue(inlineKey, datetimeLines.join("\n"));
        } else {
          pushFieldValue(inlineKey, inlineMatch[2]);
        }
        if (inlineKey === "datetime") {
          datetimeIndexes.push(index);
        }
        continue;
      }
    }

    const key = getStructuredFieldKey(line);
    if (!key) {
      continue;
    }
    if (key === "datetime") {
      datetimeIndexes.push(index);
    }

    const maxLookahead = key === "description" ? 6 : key === "datetime" ? 8 : 3;
    const valueLines: string[] = [];
    for (let forward = index + 1; forward < Math.min(lines.length, index + 1 + maxLookahead); forward += 1) {
      const candidate = lines[forward]?.trim();
      if (!candidate) {
        continue;
      }
      if (isStructuredFieldLabel(candidate)) {
        break;
      }
      if (key !== "description" && key !== "datetime" && valueLines.length >= 1) {
        break;
      }
      if (key === "datetime" && valueLines.length >= 5) {
        break;
      }
      valueLines.push(candidate);
    }

    if (valueLines.length) {
      pushFieldValue(key, key === "description" ? valueLines.join("\n") : valueLines.join(" "));
    }
  }

  const detailText = fieldValues.datetime.join("\n");
  const details = detailText
    ? parseDateTimeDetailsFromText(detailText, new Date(), input.timezone)
    : { allDay: false, assumptions: ["No explicit date found."] };
  if (!details.date) {
    return [];
  }

  const primaryCategory = fieldValues.category[0]?.trim();
  const primaryFieldTitle = fieldValues.title[0]?.trim();
  const nearbyTitleCandidates = Array.from(
    new Set(datetimeIndexes.flatMap((index) => inferStructuredTitles(lines, index, "", input)))
  );
  const titleScores = new Map<string, { title: string; score: number }>();
  const addScoredTitleOption = (value: string | undefined, score: number): void => {
    if (!value) {
      return;
    }
    const trimmed = cleanTitleCandidate(value);
    if (!trimmed || isStructuredFieldLabel(trimmed) || isGenericTitleHeading(trimmed) || isRejectedInteractiveTitle(trimmed)) {
      return;
    }
    const normalized = normalizeHeuristicText(trimmed);
    const existing = titleScores.get(normalized);
    if (!existing || score > existing.score) {
      titleScores.set(normalized, { title: trimmed, score });
    }
  };

  const scoreCompositeTitle = (value: string): number => {
    const normalized = normalizeHeuristicText(value);
    let score = Math.max(scoreTitle(value), 0);

    if (primaryFieldTitle && normalized === normalizeHeuristicText(primaryFieldTitle)) {
      score += 24;
    }
    if (primaryCategory && normalized === normalizeHeuristicText(primaryCategory)) {
      score += 10;
    }
    if (
      primaryFieldTitle &&
      primaryCategory &&
      normalized.includes(normalizeHeuristicText(primaryFieldTitle)) &&
      normalized.includes(normalizeHeuristicText(primaryCategory))
    ) {
      score += 48;
    }
    if (/[:\-–(]/.test(value)) {
      score += 6;
    }
    return score;
  };

  if (primaryFieldTitle) {
    addScoredTitleOption(primaryFieldTitle, scoreCompositeTitle(primaryFieldTitle) + 20);
  }
  if (primaryCategory) {
    addScoredTitleOption(primaryCategory, scoreCompositeTitle(primaryCategory));
  }
  for (const nearbyTitle of nearbyTitleCandidates) {
    addScoredTitleOption(nearbyTitle, scoreCompositeTitle(nearbyTitle) + 34);
  }

  const pageTitleCandidate = input.pageTitle
    .split("|")[0]
    ?.split(" - ")[0]
    ?.trim();
  if (pageTitleCandidate && !nearbyTitleCandidates.length) {
    addScoredTitleOption(pageTitleCandidate, scoreCompositeTitle(pageTitleCandidate) + 26);
  }

  for (const hint of getInputTitleHints(input)) {
    addScoredTitleOption(hint, scoreCompositeTitle(hint) + 20);
  }

  if (primaryFieldTitle && primaryCategory && normalizeHeuristicText(primaryFieldTitle) !== normalizeHeuristicText(primaryCategory)) {
    addScoredTitleOption(`${primaryCategory}: ${primaryFieldTitle}`, scoreCompositeTitle(`${primaryCategory}: ${primaryFieldTitle}`) + 12);
    addScoredTitleOption(`${primaryFieldTitle} (${primaryCategory})`, scoreCompositeTitle(`${primaryFieldTitle} (${primaryCategory})`) + 8);
  }

  const titleOptions = Array.from(titleScores.values())
    .sort((a, b) => b.score - a.score || a.title.length - b.title.length)
    .map((entry) => entry.title);

  if (!titleOptions.length) {
    return [];
  }

  const locationParts = [...fieldValues.location].filter((value) => !isRejectedNoticeOrForm(value));
  const location = locationParts.length
    ? locationParts
        .map((value) => cleanLocation(value))
        .filter((value): value is string => Boolean(value))
        .join(", ")
    : undefined;

  const description = fieldValues.description[0] || undefined;
  const evidence = [
    ...fieldValues.title,
    ...fieldValues.category,
    ...fieldValues.datetime,
    ...fieldValues.location
  ].slice(0, 8);

  return titleOptions.slice(0, 3).map((title, index) => ({
    id: randomUUID(),
    title,
    date: details.date!,
    endDate: details.endDate ?? details.date,
    startTime: details.startTime,
    endTime: details.endTime,
    timezone: details.timezone,
    allDay: details.allDay,
    location,
    description,
    sourceUrl: input.pageUrl,
    evidence,
    confidence: (details.allDay ? 0.84 : 0.9) - index * 0.08,
    assumptions: index === 0 ? details.assumptions : [...details.assumptions, "Alternative title candidate."]
  }));
};

const extractStructuredCandidates = (lines: string[], input: ExtractRequest): ExtractCandidate[] => {
  const candidates: ExtractCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line || !START_LABEL_PATTERN.test(normalizeHeuristicText(line))) {
      continue;
    }

    const startDate = parseDateFromText(lines[index + 1] ?? "");
    if (!startDate) {
      continue;
    }

    let endIndex = -1;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      if (END_LABEL_PATTERN.test(normalizeHeuristicText(lines[cursor] ?? ""))) {
        endIndex = cursor;
        break;
      }
    }

    const endDate = endIndex >= 0 ? parseDateFromText(lines[endIndex + 1] ?? "") : undefined;
    const metadataBlock = lines.slice(index, Math.min(lines.length, (endIndex >= 0 ? endIndex : index) + 4)).join("\n");
    const details = parseDateTimeDetailsFromText(metadataBlock, new Date(), input.timezone);
    const titles = inferStructuredTitles(lines, index, input.pageTitle || "Untitled Event", input);
    if (!titles.length) {
      continue;
    }
    titles.slice(0, 2).forEach((title, titleIndex) => {
      candidates.push({
        id: randomUUID(),
        title,
        date: startDate,
        endDate: endDate ?? details.endDate ?? startDate,
        startTime: details.startTime,
        endTime: details.endTime,
        timezone: details.timezone,
        allDay: details.allDay,
        location: inferStructuredLocation(lines, endIndex >= 0 ? endIndex : index),
        description: inferStructuredDescription(lines, endIndex >= 0 ? endIndex : index) ?? metadataBlock.slice(0, 1000),
        sourceUrl: input.pageUrl,
        evidence: lines.slice(Math.max(0, index - 2), Math.min(lines.length, (endIndex >= 0 ? endIndex : index) + 4)),
        confidence: (details.allDay ? 0.84 : 0.88) - titleIndex * 0.08,
        assumptions: titleIndex === 0 ? details.assumptions : [...details.assumptions, "Alternative title candidate."]
      });
    });
  }

  return uniqueBySignature(candidates);
};

const uniqueBySignature = (candidates: ExtractCandidate[]): ExtractCandidate[] => {
  const seen = new Set<string>();
  const out: ExtractCandidate[] = [];
  for (const candidate of candidates) {
    const signature = [
      candidate.title.toLowerCase(),
      candidate.date,
      candidate.endDate ?? candidate.date,
      candidate.startTime ?? "all-day",
      candidate.endTime ?? "",
      candidate.location ?? ""
    ].join("|");
    if (!seen.has(signature)) {
      out.push(candidate);
      seen.add(signature);
    }
  }
  return out;
};

export const parseByRules = (input: ExtractRequest): ExtractCandidate[] => {
  const text = `${input.selectedText ?? ""}\n${input.visibleText}`.slice(0, 80000);
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const labeledFieldCandidates = extractLabeledFieldCandidates(lines, input);
  if (labeledFieldCandidates.length) {
    return uniqueBySignature(labeledFieldCandidates).slice(0, 12);
  }

  const inlineDateCandidates = extractInlineDateCandidates(lines, input);
  if (inlineDateCandidates.length) {
    return inlineDateCandidates.slice(0, 12);
  }

  const structuredCandidates = extractStructuredCandidates(lines, input);
  if (structuredCandidates.length) {
    return structuredCandidates.slice(0, 12);
  }

  const candidates: ExtractCandidate[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeHeuristicText(line);
    if (!KEYWORDS.some((keyword) => normalizedLine.includes(keyword)) && !hasDateOrTimeSignal(line)) {
      continue;
    }
    if (isRejectedNoticeOrForm(line)) {
      continue;
    }

    const contextLines = linesAround(lines, index);
    const joinedContext = contextLines.join("\n");
    const details = parseDateTimeDetailsFromText(joinedContext, new Date(), input.timezone);
    if (!details.date) {
      continue;
    }
    const parsedDate = details.date;

    const titles = inferTitleCandidates(lines, index, input.pageTitle || "Untitled Event", input);
    const usableTitles = titles.filter(
      (title) => !META_LINE_PATTERN.test(title) && !isRejectedNoticeOrForm(title) && !isGenericTitleHeading(title) && !isRejectedInteractiveTitle(title)
    );
    if (!usableTitles.length) {
      continue;
    }
    if (!hasStrongTitleBefore(lines, index) && scoreTitle(usableTitles[0]) < 8) {
      continue;
    }

    usableTitles.slice(0, 2).forEach((title, titleIndex) => {
      candidates.push({
        id: randomUUID(),
        title,
        date: parsedDate,
        endDate: details.endDate,
        startTime: details.startTime,
        endTime: details.endTime,
        timezone: details.timezone,
        allDay: details.allDay,
        location: inferLocation(lines, index),
        description: contextLines.join("\n").slice(0, 1000),
        sourceUrl: input.pageUrl,
        evidence: contextLines.slice(0, 5),
        confidence: (details.allDay ? 0.64 : 0.82) - titleIndex * 0.08,
        assumptions: titleIndex === 0 ? details.assumptions : [...details.assumptions, "Alternative title candidate."]
      });
    });
  }

  return uniqueBySignature(candidates).slice(0, 12);
};
