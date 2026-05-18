import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const rootDir = process.cwd();
const artifactDir = path.join(rootDir, ".tmp", "event-jsonld-benchmark");
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://localhost:8787";
const limit = Number(process.env.BENCHMARK_LIMIT || process.argv[2] || 1000);
const fetchConcurrency = Number(process.env.BENCHMARK_FETCH_CONCURRENCY || 12);
const extractConcurrency = Number(process.env.BENCHMARK_EXTRACT_CONCURRENCY || 8);
const fetchTimeoutMs = Number(process.env.BENCHMARK_FETCH_TIMEOUT_MS || 12_000);

const sources = [
  {
    name: "eventbrite",
    sitemapIndex: "https://www.eventbrite.com/sitemap_xml/sitemap_index.xml",
    sitemapPattern: /event_pages\d+\.xml\.gz$/i,
    urlPattern: /\/e\/.+-tickets-\d+/i,
    targetShare: 0.4,
    siteType: "ticketing-platform"
  },
  {
    name: "eventfrog",
    sitemapIndex: "http://eventfrog.ch/myinterfaces/cms/googlesitemap-overview.xml",
    sitemapPattern: /eventfrog\.[a-z-]+-\d+\.xml\.gz$/i,
    urlPattern: /\/p\/.+\d+\.html$/i,
    rejectPattern: /\/p\/gruppen\//i,
    targetShare: 0.35,
    siteType: "ticketing-platform"
  },
  {
    name: "dice",
    sitemapIndex: "https://dice.fm/sitemaps/sitemap.xml",
    sitemapPattern: /\/sitemap\d+\.xml$/i,
    urlPattern: /\/event\//i,
    targetShare: 0.25,
    siteType: "music-ticketing"
  }
];

const weights = {
  title: 2,
  date: 2,
  startTime: 1.5,
  endTime: 1,
  location: 1,
  timezone: 1
};

const userAgent = "Mozilla/5.0 EventExtractorBenchmark/0.1";

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const sourceByName = new Map(sources.map((source) => [source.name, source]));

const detectLanguage = (text) => {
  if (/[\p{Script=Han}]/u.test(text)) {
    return "zh";
  }
  if (/[äöüß]|(?:\b(?:und|oder|datum|zeit|uhr|ort|raum|veranstaltung|märz|maerz|oktober)\b)/i.test(text)) {
    return "de";
  }
  return "en";
};

const stringifyCountry = (value) => {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && typeof value.name === "string") {
    return value.name;
  }
  return undefined;
};

const inferRegion = (record, location, url) => {
  const address = Array.isArray(record.location) ? record.location[0]?.address : record.location?.address;
  const country = normalize(stringifyCountry(address?.addressCountry));
  const combined = normalize(`${location ?? ""} ${address?.addressRegion ?? ""} ${address?.addressLocality ?? ""} ${url}`);
  if (country.includes("us") || country.includes("united states") || /\b(?:ny|ca|tx|wa|ma|il|fl|dc)\b/.test(combined)) {
    return "US";
  }
  if (country.includes("ch") || country.includes("switzerland") || combined.includes("zurich") || combined.includes("zürich")) {
    return "Europe";
  }
  if (
    country.includes("de") ||
    country.includes("germany") ||
    country.includes("france") ||
    country.includes("italy") ||
    country.includes("spain") ||
    country.includes("uk") ||
    country.includes("united kingdom") ||
    country.includes("netherlands")
  ) {
    return "Europe";
  }
  if (country.includes("cn") || country.includes("china") || country.includes("hong kong") || country.includes("taiwan")) {
    return "China";
  }
  if (/\b(?:china|hong kong|taipei|shanghai|beijing|shenzhen|guangzhou)\b/.test(combined) || /[\p{Script=Han}]/u.test(location ?? "")) {
    return "China";
  }
  if (url.includes(".ch/") || url.includes("eventfrog.ch")) {
    return "Europe";
  }
  return "Other";
};

const isBlockedError = (error) => /HTTP (?:401|403|407|429)|captcha|access denied|forbidden|blocked/i.test(error ?? "");

const titleMatches = (actual, expected) => {
  const actualNorm = normalize(actual);
  const expectedNorm = normalize(expected);
  return actualNorm === expectedNorm || actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm);
};

const locationMatches = (actual, expected) => {
  const actualNorm = normalize(actual);
  const expectedNorm = normalize(expected);
  return Boolean(actualNorm && expectedNorm && (actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm)));
};

const fieldMatches = (candidate, key, expectedValue) => {
  if (!expectedValue) {
    return undefined;
  }
  if (key === "title") {
    return titleMatches(candidate.title, expectedValue);
  }
  if (key === "location") {
    return locationMatches(candidate.location, expectedValue);
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

const fetchText = async (url) => {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": userAgent },
    signal: AbortSignal.timeout(fetchTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (url.endsWith(".gz")) {
    return zlib.gunzipSync(buffer).toString("utf8");
  }
  return buffer.toString("utf8");
};

const extractLocs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].trim());

const mapLimitForSource = (source) => Math.ceil(limit * source.targetShare);
const harvestLimitForSource = (source) => Math.ceil(mapLimitForSource(source) * 2.5);

const collectUrlsForSource = async (source) => {
  const indexXml = await fetchText(source.sitemapIndex);
  const sitemapUrls = extractLocs(indexXml).filter((url) => source.sitemapPattern.test(url));
  const out = [];
  const seen = new Set();
  const target = harvestLimitForSource(source);

  for (const sitemapUrl of sitemapUrls) {
    if (out.length >= target) {
      break;
    }
    const sitemapXml = await fetchText(sitemapUrl);
    for (const url of extractLocs(sitemapXml)) {
      if (!source.urlPattern.test(url) || source.rejectPattern?.test(url) || seen.has(url)) {
        continue;
      }
      seen.add(url);
      out.push({ source: source.name, url });
      if (out.length >= target) {
        break;
      }
    }
  }

  return out;
};

const runPool = async (items, concurrency, worker, progressLabel) => {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
      completed += 1;
      if (progressLabel && (completed % 500 === 0 || completed === items.length)) {
        console.log(`${progressLabel}: ${completed}/${items.length}`);
      }
    }
  });
  await Promise.all(workers);
  return results;
};

const parseJsonLdBlocks = (html) => {
  const blocks = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return blocks;
};

const visitRecords = (value, visitor) => {
  if (!value) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => visitRecords(item, visitor));
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  visitor(value);
  Object.values(value).forEach((item) => visitRecords(item, visitor));
};

const schemaTypes = (record) => {
  const raw = record["@type"];
  return (Array.isArray(raw) ? raw : [raw]).filter((item) => typeof item === "string");
};

const isEventRecord = (record) => schemaTypes(record).some((type) => /event$/i.test(type));

const cleanText = (value) =>
  typeof value === "string"
    ? value
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : undefined;

const stringifyAddress = (value) => {
  if (typeof value === "string") {
    return cleanText(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return [
    cleanText(value.streetAddress),
    cleanText(value.addressLocality),
    cleanText(value.addressRegion),
    cleanText(value.postalCode),
    cleanText(value.addressCountry)
  ]
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .join(", ");
};

const stringifyLocation = (value) => {
  if (typeof value === "string") {
    return cleanText(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyLocation).filter(Boolean).join("; ") || undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return [cleanText(value.name), stringifyAddress(value.address)].filter(Boolean).join(", ") || undefined;
};

const isoDatePart = (value) => {
  const match = cleanText(value)?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
};

const isoTimePart = (value) => {
  const match = cleanText(value)?.match(/^\d{4}-\d{2}-\d{2}[T\s](\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : undefined;
};

const isoTimezonePart = (value) => {
  const match = cleanText(value)?.match(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(Z|[+-]\d{2}:?\d{2})/i);
  if (!match?.[1]) {
    return undefined;
  }
  if (match[1].toUpperCase() === "Z") {
    return "UTC";
  }
  const offset = match[1].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  return `UTC${offset}`;
};

const rawTextFromHtml = (html) =>
  cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )?.slice(0, 12000) ?? "";

const eventContextFromRecord = (record) => {
  const name = cleanText(record.name);
  const startDate = cleanText(record.startDate);
  const endDate = cleanText(record.endDate);
  const location = stringifyLocation(record.location);
  const description = cleanText(record.description);
  const lines = [
    name ? `Event title: ${name}` : undefined,
    startDate ? `Date and Time: ${[startDate, endDate].filter(Boolean).join(" - ")}` : undefined,
    location ? `Location: ${location}` : undefined,
    description ? `Description: ${description.slice(0, 1000)}` : undefined
  ].filter(Boolean);
  return lines.join("\n");
};

const expectedFromRecord = (record) => {
  const title = cleanText(record.name);
  const date = isoDatePart(record.startDate);
  const startTime = isoTimePart(record.startDate);
  const endTime = isoTimePart(record.endDate);
  const timezone = cleanText(record.eventSchedule?.scheduleTimezone) || isoTimezonePart(record.startDate);
  const location = cleanText(record.location?.name) || stringifyLocation(record.location);
  if (!title || !date) {
    return undefined;
  }
  return {
    title,
    date,
    ...(startTime ? { startTime } : {}),
    ...(endTime && endTime !== startTime ? { endTime } : {}),
    ...(timezone ? { timezone } : {}),
    ...(location ? { location } : {})
  };
};

const pageTitleFromHtml = (html) => cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || "Untitled page";

const caseFromPage = async ({ source, url }) => {
  const html = await fetchText(url);
  const eventRecords = [];
  parseJsonLdBlocks(html).forEach((block) => {
    visitRecords(block, (record) => {
      if (isEventRecord(record)) {
        eventRecords.push(record);
      }
    });
  });
  const record = eventRecords.find((item) => expectedFromRecord(item));
  if (!record) {
    throw new Error("No usable JSON-LD Event record");
  }
  const expected = expectedFromRecord(record);
  const structuredText = eventContextFromRecord(record);
  const rawTextExcerpt = rawTextFromHtml(html);
  const language = detectLanguage(`${expected.title} ${record.description ?? ""} ${rawTextExcerpt.slice(0, 2000)}`);
  const location = stringifyLocation(record.location);
  return {
    source,
    language,
    region: inferRegion(record, location, url),
    siteType: sourceByName.get(source)?.siteType ?? "unknown",
    url,
    pageTitle: pageTitleFromHtml(html),
    visibleText: [structuredText, rawTextExcerpt].filter(Boolean).join("\n").slice(0, 40000),
    structuredText,
    rawTextExcerpt,
    titleHints: [expected.title].filter(Boolean),
    expected
  };
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

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });

await fetch(`${backendBaseUrl}/health`).then((response) => {
  if (!response.ok) {
    throw new Error(`Backend health failed: ${response.status}`);
  }
});

console.log(`Collecting up to ${limit} event URLs...`);
const collectedBySource = await Promise.all(sources.map(collectUrlsForSource));
const collectedUrls = collectedBySource.flat();
writeFileSync(path.join(artifactDir, "collected-urls.json"), `${JSON.stringify(collectedUrls, null, 2)}\n`, "utf8");

console.log(`Fetching JSON-LD gold labels from ${collectedUrls.length} URLs...`);
const fetched = await runPool(collectedUrls, fetchConcurrency, async (item) => {
  try {
    return { ok: true, case: await caseFromPage(item) };
  } catch (error) {
    return { ok: false, source: item.source, url: item.url, error: error instanceof Error ? error.message : String(error) };
  }
}, "Fetched pages");
const usableFetched = fetched.filter((item) => item.ok).map((item) => item.case);
const casesBySource = new Map(sources.map((source) => [source.name, []]));
for (const testCase of usableFetched) {
  casesBySource.get(testCase.source)?.push(testCase);
}
const cases = [];
for (const source of sources) {
  cases.push(...(casesBySource.get(source.name) ?? []).slice(0, mapLimitForSource(source)));
}
if (cases.length < limit) {
  const seen = new Set(cases.map((testCase) => testCase.url));
  for (const testCase of usableFetched) {
    if (cases.length >= limit) {
      break;
    }
    if (!seen.has(testCase.url)) {
      seen.add(testCase.url);
      cases.push(testCase);
    }
  }
}
const harvestFailures = fetched
  .filter((item) => !item.ok)
  .map((item) => ({ ...item, blocked: isBlockedError(item.error) }));
writeFileSync(path.join(artifactDir, "cases.json"), `${JSON.stringify(cases, null, 2)}\n`, "utf8");
writeFileSync(path.join(artifactDir, "harvest-failures.json"), `${JSON.stringify(harvestFailures, null, 2)}\n`, "utf8");

console.log(`Running extraction benchmark for ${cases.length} JSON-LD event pages...`);
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
    bestCandidate: match.candidate ? summarizeCandidate(match.candidate) : undefined,
    candidates: candidates.slice(0, 5).map(summarizeCandidate)
  };
}, "Extracted pages");

const totals = results.reduce(
  (acc, result) => {
    const scored = result.bestCandidate
      ? scoreCandidate(result.bestCandidate, result.expected)
      : { score: 0, total: expectedWeightedTotal(result.expected), fields: {} };
    acc.score += scored.score;
    acc.total += scored.total;
    acc.caseAccuracy += result.bestAccuracy;
    acc.fieldCounts += Object.keys(result.expected).length;
    return acc;
  },
  { score: 0, total: 0, caseAccuracy: 0, fieldCounts: 0 }
);

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
  for (const bucketSummary of Object.values(bucket)) {
    bucketSummary.fieldAccuracy = bucketSummary.total ? bucketSummary.score / bucketSummary.total : 0;
    bucketSummary.exactAccuracy = bucketSummary.count ? bucketSummary.exactCount / bucketSummary.count : 0;
    bucketSummary.nearAccuracy = bucketSummary.count ? bucketSummary.nearCount / bucketSummary.count : 0;
  }
};

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

const exactCaseAccuracy = results.length ? results.filter((result) => result.bestAccuracy === 1).length / results.length : 0;
const nearCaseAccuracy = results.length ? results.filter((result) => result.bestAccuracy >= 0.9).length / results.length : 0;
const blockedCount = harvestFailures.filter((item) => item.blocked).length;

const summary = {
  requestedLimit: limit,
  collectedUrlCount: collectedUrls.length,
  fetchedUrlCount: fetched.length,
  harvestedCaseCount: cases.length,
  accessiblePageCount: cases.length,
  blockedPageCount: blockedCount,
  harvestFailureCount: harvestFailures.length,
  fieldAccuracy: totals.total ? totals.score / totals.total : 0,
  averageCaseAccuracy: results.length ? totals.caseAccuracy / results.length : 0,
  exactCaseAccuracy,
  nearCaseAccuracy,
  passed90: totals.total ? totals.score / totals.total >= 0.9 : false,
  bySource,
  byLanguage,
  byRegion,
  bySiteType,
  results
};

writeFileSync(path.join(artifactDir, "results.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
const compactSummary = {
  ...summary,
  results: undefined,
  failureExamples: results.filter((result) => result.bestAccuracy < 0.9).slice(0, 20)
};
const formatPercent = (value) => `${(value * 100).toFixed(2)}%`;
const tableForBucket = (bucket) =>
  ["| bucket | count | field accuracy | exact | near |", "|---|---:|---:|---:|---:|"]
    .concat(
      Object.entries(bucket).map(
        ([key, value]) =>
          `| ${key} | ${value.count} | ${formatPercent(value.fieldAccuracy)} | ${formatPercent(value.exactAccuracy)} | ${formatPercent(value.nearAccuracy)} |`
      )
    )
    .join("\n");
const topFailures = results
  .filter((result) => result.bestAccuracy < 0.9)
  .sort((a, b) => a.bestAccuracy - b.bestAccuracy)
  .slice(0, 20);
const report = [
  "# Event JSON-LD Benchmark",
  "",
  `- Requested pages: ${limit}`,
  `- Collected URLs: ${collectedUrls.length}`,
  `- Accessible pages with usable JSON-LD Event ground truth: ${cases.length}`,
  `- Blocked pages: ${blockedCount}`,
  `- Harvest failures total: ${harvestFailures.length}`,
  `- Field-level accuracy: ${formatPercent(summary.fieldAccuracy)}`,
  `- Case exact accuracy: ${formatPercent(exactCaseAccuracy)}`,
  `- Case near accuracy (>=90% weighted fields): ${formatPercent(nearCaseAccuracy)}`,
  "",
  "## By Language",
  tableForBucket(byLanguage),
  "",
  "## By Region",
  tableForBucket(byRegion),
  "",
  "## By Site Type",
  tableForBucket(bySiteType),
  "",
  "## By Source",
  tableForBucket(bySource),
  "",
  "## Top 20 Failures",
  topFailures.length
    ? topFailures
        .map(
          (failure, index) =>
            `${index + 1}. ${failure.source} ${failure.url} accuracy=${formatPercent(failure.bestAccuracy)} expected=${JSON.stringify(
              failure.expected
            )} actual=${JSON.stringify(failure.bestCandidate)}`
        )
        .join("\n")
    : "No failures below 90% weighted field accuracy.",
  ""
].join("\n");
writeFileSync(path.join(artifactDir, "report.md"), report, "utf8");
console.log(JSON.stringify(compactSummary, null, 2));
