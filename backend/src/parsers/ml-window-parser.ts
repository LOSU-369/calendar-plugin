import type { ExtractCandidate, ExtractRequest } from "../schemas/extract.js";
import { scoreEventWindow, loadEventRankerModel } from "../ml/event-ranker.js";
import { parseByRules } from "./rule-parser.js";

interface RankedWindow {
  text: string;
  score: number;
}

const anchorPattern =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|januar|februar|maerz|marz|mai|juni|juli|oktober|dezember)\s+\d{1,2}|\d{1,2}[:.]\d{2}|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b|(?:(?:\d{4}\s*)?\u5e74\s*)?\d{1,2}\s*\u6708\s*\d{1,2}|(?:\u51cc\u6668|\u65e9\u4e0a|\u4e0a\u5348|\u4e2d\u5348|\u4e0b\u5348|\u665a\u4e0a|\u665a\u95f4|\u591c\u95f4)?\s*\d{1,2}\s*[\u70b9\u6642\u65f6]/i;

const normalizeWindowSignature = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const buildRankedWindows = (input: ExtractRequest): RankedWindow[] => {
  const model = loadEventRankerModel();
  if (!model) {
    return [];
  }

  const text = `${input.selectedText ?? ""}\n${input.visibleText}`.slice(0, 80000);
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const ranked: RankedWindow[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!anchorPattern.test(line)) {
      continue;
    }

    const windowLines = lines.slice(Math.max(0, index - 4), Math.min(lines.length, index + 13));
    const textWindow = windowLines.join("\n");
    const signature = normalizeWindowSignature(textWindow);
    if (!signature || seen.has(signature)) {
      continue;
    }
    seen.add(signature);

    const score = scoreEventWindow(textWindow);
    if (score === undefined || score < model.threshold) {
      continue;
    }
    ranked.push({ text: textWindow, score });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, 8);
};

const annotateMlCandidate = (candidate: ExtractCandidate, score: number): ExtractCandidate => ({
  ...candidate,
  confidence: Math.max(candidate.confidence, Math.min(0.97, 0.54 + score * 0.42)),
  assumptions: [...candidate.assumptions, "Event window prioritized by trained ranker."]
});

export const parseByLearnedWindows = (input: ExtractRequest): ExtractCandidate[] => {
  const rankedWindows = buildRankedWindows(input);
  if (!rankedWindows.length) {
    return [];
  }

  const candidates: ExtractCandidate[] = [];
  for (const rankedWindow of rankedWindows) {
    const parsed = parseByRules({
      ...input,
      visibleText: rankedWindow.text,
      selectedText: undefined
    });
    parsed.forEach((candidate) => candidates.push(annotateMlCandidate(candidate, rankedWindow.score)));
  }

  return candidates;
};
