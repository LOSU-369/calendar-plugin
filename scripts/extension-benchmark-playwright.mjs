import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import playwright from "../.tmp/playwright-run/node_modules/playwright/index.js";

const { chromium } = playwright;
const rootDir = process.cwd();
const extensionDir = path.join(rootDir, "extension", "dist");
const profileDir = path.join(rootDir, ".tmp", "playwright-benchmark-profile");
const artifactDir = path.join(rootDir, ".tmp", "event-benchmark");
const casesPath = process.argv[2] || path.join(rootDir, "scripts", "event-benchmark-cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://localhost:8787";

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const titleMatches = (actual, expected) => {
  const actualNorm = normalize(actual);
  const expectedNorm = normalize(expected);
  return actualNorm === expectedNorm || actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm);
};

const fieldMatches = (candidate, key, expectedValue) => {
  if (!expectedValue) {
    return undefined;
  }
  if (key === "title") {
    return titleMatches(candidate.title, expectedValue);
  }
  if (key === "location") {
    return normalize(candidate.location).includes(normalize(expectedValue));
  }
  return candidate[key] === expectedValue;
};

const scoreCandidate = (candidate, expected) => {
  const weights = {
    title: 2,
    date: 2,
    startTime: 1.5,
    endTime: 1,
    location: 1
  };
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

const expectedWeightedTotal = (expected) => {
  const weights = {
    title: 2,
    date: 2,
    startTime: 1.5,
    endTime: 1,
    location: 1
  };
  return Object.entries(weights).reduce((sum, [field, weight]) => (expected[field] ? sum + weight : sum), 0);
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

const aggregateResults = (items) =>
  items.reduce(
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

rmSync(profileDir, { recursive: true, force: true });
rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1400, height: 1000 },
  args: [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check"
  ]
});

const results = [];
try {
  let serviceWorker = context.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"));
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  const bridge = await context.newPage();
  await bridge.goto(`chrome-extension://${extensionId}/src/options/index.html`, { waitUntil: "domcontentloaded" });
  await bridge.evaluate(
    (settings) => chrome.storage.local.set({ settings }),
    { backendBaseUrl, timezone: "Europe/Zurich", locale: "en-US", debug: false }
  );

  for (const testCase of cases) {
    const page = await context.newPage();
    let candidates = [];
    let error;
    let pageTitle = "";
    let visibleTextExcerpt = "";
    try {
      await page.goto(testCase.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 18_000 }).catch(() => undefined);
      await page.evaluate(() => window.scrollTo(0, 240));
      await page.waitForTimeout(900);
      await page.bringToFront();
      pageTitle = await page.title();
      const scanPayload = await bridge.evaluate(
        () =>
          new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "SCAN_ACTIVE_TAB" }, (response) => {
              resolve({
                error: chrome.runtime.lastError?.message,
                response
              });
            });
          })
      );

      if (scanPayload.error || !scanPayload.response?.ok) {
        throw new Error(JSON.stringify(scanPayload));
      }
      candidates = scanPayload.response.session?.candidates ?? [];
      visibleTextExcerpt = String(scanPayload.response.session?.visibleText ?? "").slice(0, 4000);
      await page.screenshot({ path: path.join(artifactDir, `${testCase.name}.png`), fullPage: false });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      await page.screenshot({ path: path.join(artifactDir, `${testCase.name}.png`), fullPage: false }).catch(() => undefined);
      visibleTextExcerpt = await page
        .locator("body")
        .innerText({ timeout: 2000 })
        .then((text) => text.slice(0, 4000))
        .catch(() => visibleTextExcerpt);
    } finally {
      await page.close();
    }

    const match = bestMatch(candidates, testCase.expected);
    const blockedBySite = Boolean(testCase.automationBlocked && error);
    results.push({
      name: testCase.name,
      url: testCase.url,
      automationBlocked: testCase.automationBlocked,
      blockedBySite,
      expected: testCase.expected,
      error,
      pageTitle,
      visibleTextExcerpt,
      candidateCount: candidates.length,
      bestAccuracy: match.accuracy,
      fields: match.fields,
      bestCandidate: match.candidate ? summarizeCandidate(match.candidate) : undefined,
      candidates: candidates.map(summarizeCandidate)
    });
  }
} finally {
  await context.close();
}

const totals = aggregateResults(results);
const accessibleResults = results.filter((result) => !result.blockedBySite);
const accessibleTotals = aggregateResults(accessibleResults);

const summary = {
  fieldAccuracy: totals.total ? totals.score / totals.total : 0,
  averageCaseAccuracy: results.length ? totals.caseAccuracy / results.length : 0,
  passed90: totals.total ? totals.score / totals.total >= 0.9 : false,
  accessibleFieldAccuracy: accessibleTotals.total ? accessibleTotals.score / accessibleTotals.total : 0,
  accessibleAverageCaseAccuracy: accessibleResults.length ? accessibleTotals.caseAccuracy / accessibleResults.length : 0,
  passed90Accessible: accessibleTotals.total ? accessibleTotals.score / accessibleTotals.total >= 0.9 : false,
  caseCount: results.length,
  accessibleCaseCount: accessibleResults.length,
  blockedBySiteCount: results.length - accessibleResults.length,
  results
};

writeFileSync(path.join(artifactDir, "results.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
