import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://localhost:8788";
const artifactDir = path.join(rootDir, ".tmp", "parser-regression");
const casesPath = process.argv[2] || path.join(rootDir, "scripts", "parser-regression-cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));

const weights = {
  title: 2,
  date: 2,
  endDate: 1,
  startTime: 1.5,
  endTime: 1,
  location: 1,
  timezone: 1
};

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const textMatches = (actual, expected) => {
  const actualNorm = normalize(actual);
  const expectedNorm = normalize(expected);
  return actualNorm === expectedNorm || actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm);
};

const fieldMatches = (candidate, key, expectedValue) => {
  if (!expectedValue) {
    return undefined;
  }
  if (key === "title" || key === "location") {
    return textMatches(candidate[key], expectedValue);
  }
  return candidate[key] === expectedValue;
};

const expectedWeightedTotal = (expected) =>
  Object.entries(weights).reduce((sum, [field, weight]) => (expected[field] ? sum + weight : sum), 0);

const scoreCandidate = (candidate, expected) => {
  let score = 0;
  let total = 0;
  const fields = {};
  for (const [field, weight] of Object.entries(weights)) {
    const matched = fieldMatches(candidate, field, expected[field]);
    if (matched === undefined) {
      continue;
    }
    total += weight;
    if (matched) {
      score += weight;
    }
    fields[field] = matched;
  }
  return { score, total, accuracy: total ? score / total : 0, fields };
};

const bestMatch = (candidates, expected) => {
  let best = { candidate: undefined, score: 0, total: 0, accuracy: 0, fields: {} };
  for (const candidate of candidates) {
    const scored = scoreCandidate(candidate, expected);
    if (scored.accuracy > best.accuracy) {
      best = { candidate, ...scored };
    }
  }
  return best;
};

const summarizeCandidate = (candidate) => ({
  title: candidate.title,
  date: candidate.date,
  endDate: candidate.endDate,
  startTime: candidate.startTime,
  endTime: candidate.endTime,
  timezone: candidate.timezone,
  location: candidate.location,
  confidence: candidate.confidence
});

const callExtract = async (testCase) => {
  const response = await fetch(`${backendBaseUrl}/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pageUrl: testCase.pageUrl,
      pageTitle: testCase.pageTitle,
      visibleText: testCase.visibleText,
      titleHints: testCase.titleHints,
      timezone: testCase.expected.timezone || "Europe/Zurich"
    })
  });
  if (!response.ok) {
    throw new Error(`Backend ${response.status}: ${await response.text()}`);
  }
  return response.json();
};

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });

await fetch(`${backendBaseUrl}/health`).then((response) => {
  if (!response.ok) {
    throw new Error(`Backend health failed: ${response.status}`);
  }
});

const results = [];
for (const testCase of cases) {
  let candidates = [];
  let error;
  try {
    const extracted = await callExtract(testCase);
    candidates = extracted.candidates ?? [];
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const match = bestMatch(candidates, testCase.expected);
  results.push({
    name: testCase.name,
    language: testCase.language,
    region: testCase.region,
    siteType: testCase.siteType,
    expected: testCase.expected,
    error,
    candidateCount: candidates.length,
    bestAccuracy: match.accuracy,
    fields: match.fields,
    bestCandidate: match.candidate ? summarizeCandidate(match.candidate) : undefined,
    candidates: candidates.slice(0, 5).map(summarizeCandidate)
  });
}

const totals = results.reduce(
  (acc, result) => {
    const scored = result.bestCandidate
      ? scoreCandidate(result.bestCandidate, result.expected)
      : { score: 0, total: expectedWeightedTotal(result.expected) };
    acc.score += scored.score;
    acc.total += scored.total;
    acc.caseAccuracy += result.bestAccuracy;
    return acc;
  },
  { score: 0, total: 0, caseAccuracy: 0 }
);

const byLanguage = {};
const byRegion = {};
const bySiteType = {};
for (const result of results) {
  for (const [bucket, key] of [
    [byLanguage, result.language],
    [byRegion, result.region],
    [bySiteType, result.siteType]
  ]) {
    bucket[key] ??= { count: 0, score: 0, total: 0 };
    const scored = result.bestCandidate
      ? scoreCandidate(result.bestCandidate, result.expected)
      : { score: 0, total: expectedWeightedTotal(result.expected) };
    bucket[key].count += 1;
    bucket[key].score += scored.score;
    bucket[key].total += scored.total;
  }
}
for (const bucket of [byLanguage, byRegion, bySiteType]) {
  for (const summary of Object.values(bucket)) {
    summary.fieldAccuracy = summary.total ? summary.score / summary.total : 0;
  }
}

const summary = {
  caseCount: results.length,
  fieldAccuracy: totals.total ? totals.score / totals.total : 0,
  averageCaseAccuracy: results.length ? totals.caseAccuracy / results.length : 0,
  passed90: totals.total ? totals.score / totals.total >= 0.9 : false,
  byLanguage,
  byRegion,
  bySiteType,
  failures: results.filter((result) => result.bestAccuracy < 0.9),
  results
};

writeFileSync(path.join(artifactDir, "results.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
