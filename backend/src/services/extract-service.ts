import type { ExtractCandidate, ExtractRequest } from "../schemas/extract.js";
import { aiFallbackExtract } from "../providers/ai-provider.js";
import { parseByLearnedWindows } from "../parsers/ml-window-parser.js";
import { parseByRules } from "../parsers/rule-parser.js";

const GENERIC_TITLE_PATTERN =
  /^(?:overview|date\s*&\s*location|date\s+and\s+location|share a flyer|accessible tickets?|more info|map|attendees|see all|sign in|find tickets?|add to calendar|date:|🗓|zurich|zürich)$/i;

const normalizeTitle = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();

const isGenericTitle = (value: string | undefined): boolean => {
  const normalized = normalizeTitle(value ?? "");
  return !normalized || GENERIC_TITLE_PATTERN.test(normalized) || normalized.length <= 1;
};

const cleanPageTitle = (value: string): string | undefined => {
  const cleaned = value
    .replace(/\s+\|\s+(?:Eventbrite|Meetup|Ticketmaster|AllEvents|Resident Advisor|RA|ETH Zurich).*$/i, "")
    .replace(/\s+-\s+(?:Eventbrite|Meetup|Ticketmaster|AllEvents|Resident Advisor|RA|ETH Zurich).*$/i, "")
    .replace(/\s+tickets?,.*$/i, "")
    .replace(/\s+tickets?$/i, "")
    .replace(/,\s*(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+.*$/i, "")
    .trim();
  return cleaned && !isGenericTitle(cleaned) ? cleaned : undefined;
};

const getPreferredTitle = (input: ExtractRequest): string | undefined => {
  const hints = [...(input.titleHints ?? []), input.pageTitle]
    .map((hint) => cleanPageTitle(hint))
    .filter((hint): hint is string => Boolean(hint));
  return hints.find((hint) => !isGenericTitle(hint));
};

const titleAlignsWithPreferred = (title: string, preferredTitle: string): boolean => {
  const titleNorm = normalizeTitle(title);
  const preferredNorm = normalizeTitle(preferredTitle);
  return titleNorm === preferredNorm || preferredNorm.includes(titleNorm) || titleNorm.includes(preferredNorm);
};

const shouldPreferMetadataTitle = (candidate: ExtractCandidate, input: ExtractRequest, preferredTitle: string): boolean => {
  if (isGenericTitle(candidate.title)) {
    return true;
  }
  if (titleAlignsWithPreferred(candidate.title, preferredTitle)) {
    return false;
  }
  const host = new URL(input.pageUrl).hostname;
  const detailPlatform = /\b(?:eventbrite|meetup|ticketmaster|allevents)\b|ra\.co$/i.test(host);
  const wordCount = normalizeTitle(candidate.title).split(/\s+/).filter(Boolean).length;
  return detailPlatform && wordCount <= 2;
};

const repairCandidates = (candidates: ExtractCandidate[], input: ExtractRequest): ExtractCandidate[] => {
  const preferredTitle = getPreferredTitle(input);
  if (!preferredTitle) {
    return candidates;
  }

  return candidates.map((candidate) => {
    if (!shouldPreferMetadataTitle(candidate, input, preferredTitle)) {
      return candidate;
    }

    const previousTitle = candidate.title;
    const locationFromPreviousTitle =
      !candidate.location && !isGenericTitle(previousTitle) && !titleAlignsWithPreferred(previousTitle, preferredTitle)
        ? previousTitle
        : undefined;
    return {
      ...candidate,
      title: preferredTitle,
      location: candidate.location || locationFromPreviousTitle,
      assumptions: [...candidate.assumptions, "Title repaired from page metadata."]
    };
  });
};

const dedupe = (candidates: ExtractCandidate[]): ExtractCandidate[] => {
  const seen = new Set<string>();
  const out: ExtractCandidate[] = [];
  for (const c of candidates) {
    const signature = `${c.title.toLowerCase()}|${c.date}|${c.startTime ?? ""}|${c.location ?? ""}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      out.push(c);
    }
  }
  return out;
};

const candidateCompleteness = (candidate: ExtractCandidate): number =>
  (candidate.title ? 2 : 0) +
  (candidate.date ? 2 : 0) +
  (candidate.startTime ? 1.5 : 0) +
  (candidate.endTime ? 1 : 0) +
  (candidate.location ? 1 : 0);

export const extractCandidates = async (input: ExtractRequest): Promise<ExtractCandidate[]> => {
  const learnedCandidates = dedupe(repairCandidates(parseByLearnedWindows(input), input)).slice(0, 12);
  const ruleCandidates = repairCandidates(parseByRules(input), input);
  const localCandidates = dedupe([...learnedCandidates, ...ruleCandidates])
    .sort((a, b) => candidateCompleteness(b) - candidateCompleteness(a) || b.confidence - a.confidence)
    .slice(0, 12);
  if (localCandidates.length >= 1) {
    return localCandidates;
  }
  const aiCandidates = await aiFallbackExtract(input);
  return dedupe(aiCandidates).slice(0, 12);
};
