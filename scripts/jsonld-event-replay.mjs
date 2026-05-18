import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://localhost:8788";
const casesPath = process.argv[2] || path.join(rootDir, ".tmp", "event-jsonld-benchmark", "cases.json");
const artifactDir = path.join(rootDir, ".tmp", "event-jsonld-benchmark-replay");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const extractConcurrency = Number(process.env.BENCHMARK_EXTRACT_CONCURRENCY || 16);

const weights = { title: 2, date: 2, startTime: 1.5, endTime: 1, location: 1, timezone: 1 };

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

const runPool = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
      completed += 1;
      if (completed % 500 === 0 || completed === items.length) {
        console.log(`Replayed pages: ${completed}/${items.length}`);
      }
    }
  });
  await Promise.all(workers);
  return results;
};

const callExtract = async (testCase) => {
  const response = await fetch(`${backendBaseUrl}/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pageUrl: testCase.url,
      pageTitle: testCase.pageTitle,
      visibleText: testCase.visibleText,
      titleHints: testCase.titleHints,
      timezone: testCase.expected.timezone && !testCase.expected.timezone.startsWith("UTC") ? testCase.expected.timezone : "Europe/Zurich"
    })
  });
  if (!response.ok) {
    throw new Error(`Backend ${response.status}: ${await response.text()}`);
  }
  return response.json();
};

const addBucket = (bucket, key, result) => {
  bucket[key] ??= { count: 0, score: 0, total: 0, exactCount: 0, nearCount: 0 };
  const scored = result.bestCandidate
    ? scoreCandidate(result.bestCandidate, result.expected)
    : { score: 0, total: expectedWeightedTotal(result.expected) };
  bucket[key].count += 1;
  bucket[key].score += scored.score;
  bucket[key].total += scored.total;
  bucket[key].exactCount += result.bestAccuracy === 1 ? 1 : 0;
  bucket[key].nearCount += result.bestAccuracy >= 0.9 ? 1 : 0;
};

const finishBucket = (bucket) => {
  for (const item of Object.values(bucket)) {
    item.fieldAccuracy = item.total ? item.score / item.total : 0;
    item.exactAccuracy = item.count ? item.exactCount / item.count : 0;
    item.nearAccuracy = item.count ? item.nearCount / item.count : 0;
  }
};

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });

await fetch(`${backendBaseUrl}/health`).then((response) => {
  if (!response.ok) {
    throw new Error(`Backend health failed: ${response.status}`);
  }
});

const results = await runPool(cases, extractConcurrency, async (testCase) => {
  let candidates = [];
  let error;
  try {
    const extracted = await callExtract(testCase);
    candidates = extracted.candidates ?? [];
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const match = bestMatch(candidates, testCase.expected);
  return {
    source: testCase.source,
    language: testCase.language,
    region: testCase.region,
    siteType: testCase.siteType,
    url: testCase.url,
    expected: testCase.expected,
    error,
    candidateCount: candidates.length,
    bestAccuracy: match.accuracy,
    fields: match.fields,
    bestCandidate: match.candidate ? summarizeCandidate(match.candidate) : undefined
  };
});

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

const bySource = {};
const byLanguage = {};
const byRegion = {};
const bySiteType = {};
for (const result of results) {
  addBucket(bySource, result.source, result);
  addBucket(byLanguage, result.language, result);
  addBucket(byRegion, result.region, result);
  addBucket(bySiteType, result.siteType, result);
}
[bySource, byLanguage, byRegion, bySiteType].forEach(finishBucket);

const summary = {
  replayedCaseCount: cases.length,
  fieldAccuracy: totals.total ? totals.score / totals.total : 0,
  averageCaseAccuracy: results.length ? totals.caseAccuracy / results.length : 0,
  exactCaseAccuracy: results.length ? results.filter((result) => result.bestAccuracy === 1).length / results.length : 0,
  nearCaseAccuracy: results.length ? results.filter((result) => result.bestAccuracy >= 0.9).length / results.length : 0,
  passed90: totals.total ? totals.score / totals.total >= 0.9 : false,
  bySource,
  byLanguage,
  byRegion,
  bySiteType,
  failureExamples: results.filter((result) => result.bestAccuracy < 0.9).slice(0, 20),
  results
};

writeFileSync(path.join(artifactDir, "results.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
