import type { ExtractCandidate, ExtractRequest } from "../schemas/extract.js";
import { aiFallbackExtract } from "../providers/ai-provider.js";
import { parseByRules } from "../parsers/rule-parser.js";

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

export const extractCandidates = async (input: ExtractRequest): Promise<ExtractCandidate[]> => {
  const ruleCandidates = parseByRules(input);
  if (ruleCandidates.length >= 1) {
    return dedupe(ruleCandidates).slice(0, 12);
  }
  const aiCandidates = await aiFallbackExtract(input);
  return dedupe([...ruleCandidates, ...aiCandidates]).slice(0, 12);
};
