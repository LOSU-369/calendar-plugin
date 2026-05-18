import { readFileSync } from "node:fs";
import path from "node:path";

export interface EventWindowRankerModel {
  version: 1;
  generatedAt: string;
  alpha: number;
  threshold: number;
  metrics?: {
    validationF1?: number;
    validationPrecision?: number;
    validationRecall?: number;
  };
  sampleCounts: {
    event: number;
    nonEvent: number;
  };
  tokenTotals: {
    event: number;
    nonEvent: number;
  };
  vocabularySize: number;
  tokenCounts: {
    event: Record<string, number>;
    nonEvent: Record<string, number>;
  };
}

const dateLikePattern =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|januar|februar|maerz|marz|mai|juni|juli|oktober|dezember)\s+\d{1,2})\b|(?:(?:\d{4}\s*)?\u5e74\s*)?\d{1,2}\s*\u6708\s*\d{1,2}/i;
const timeLikePattern =
  /\b(?:\d{1,2}[:.]\d{2}|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b|(?:\u51cc\u6668|\u65e9\u4e0a|\u4e0a\u5348|\u4e2d\u5348|\u4e0b\u5348|\u665a\u4e0a|\u665a\u95f4|\u591c\u95f4)?\s*\d{1,2}\s*[\u70b9\u6642\u65f6]/i;
const explicitRangePattern = /\b(?:to|until|bis|-)\b/i;
const labelPattern = /\b(?:date|time|when|location|venue|ort|raum|title|event|start|end)\s*[:：]/i;

let cachedModel: EventWindowRankerModel | null | undefined;

const normalizeText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\u00a0/g, " ")
    .toLowerCase();

export const tokenizeEventText = (value: string): string[] => {
  const normalized = normalizeText(value).slice(0, 4000);
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'/-]{1,48}/gu) ?? [];
  const tokens: string[] = [];

  if (dateLikePattern.test(normalized)) {
    tokens.push("__has_date__");
  }
  if (timeLikePattern.test(normalized)) {
    tokens.push("__has_time__");
  }
  if (explicitRangePattern.test(normalized)) {
    tokens.push("__has_range__");
  }
  if (labelPattern.test(normalized)) {
    tokens.push("__has_labeled_fields__");
  }
  if ((normalized.match(/\n/g) ?? []).length >= 2) {
    tokens.push("__multiline__");
  }

  const clippedWords = words.slice(0, 220);
  for (const word of clippedWords) {
    tokens.push(`w:${word}`);
  }
  for (let index = 0; index < clippedWords.length - 1; index += 1) {
    tokens.push(`b:${clippedWords[index]}_${clippedWords[index + 1]}`);
  }

  return tokens;
};

const defaultModelPath = (): string =>
  path.resolve(process.env.EVENT_RANKER_MODEL_PATH || path.join(process.cwd(), "model", "event-window-ranker.json"));

export const loadEventRankerModel = (): EventWindowRankerModel | undefined => {
  if (cachedModel !== undefined) {
    return cachedModel ?? undefined;
  }

  try {
    const raw = readFileSync(defaultModelPath(), "utf8");
    cachedModel = JSON.parse(raw) as EventWindowRankerModel;
    return cachedModel;
  } catch {
    cachedModel = null;
    return undefined;
  }
};

export const scoreEventWindow = (value: string): number | undefined => {
  const model = loadEventRankerModel();
  if (!model) {
    return undefined;
  }

  const tokens = tokenizeEventText(value);
  if (!tokens.length) {
    return 0;
  }

  const eventPrior = Math.log(model.sampleCounts.event / (model.sampleCounts.event + model.sampleCounts.nonEvent));
  const nonEventPrior = Math.log(model.sampleCounts.nonEvent / (model.sampleCounts.event + model.sampleCounts.nonEvent));
  const eventDenominator = model.tokenTotals.event + model.alpha * model.vocabularySize;
  const nonEventDenominator = model.tokenTotals.nonEvent + model.alpha * model.vocabularySize;
  let eventScore = eventPrior;
  let nonEventScore = nonEventPrior;

  for (const token of tokens) {
    const eventCount = model.tokenCounts.event[token];
    const nonEventCount = model.tokenCounts.nonEvent[token];
    if (eventCount === undefined && nonEventCount === undefined) {
      continue;
    }
    eventScore += Math.log(((eventCount ?? 0) + model.alpha) / eventDenominator);
    nonEventScore += Math.log(((nonEventCount ?? 0) + model.alpha) / nonEventDenominator);
  }

  const logOdds = Math.max(-60, Math.min(60, eventScore - nonEventScore));
  return 1 / (1 + Math.exp(-logOdds));
};
