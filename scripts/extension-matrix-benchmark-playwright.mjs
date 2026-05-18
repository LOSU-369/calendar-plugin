import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import playwright from "../.tmp/playwright-run/node_modules/playwright/index.js";

const { chromium } = playwright;
const rootDir = process.cwd();
const extensionDir = path.join(rootDir, "extension", "dist");
const profileDir = path.join(rootDir, ".tmp", "playwright-matrix-profile");
const artifactDir = path.join(rootDir, ".tmp", "event-matrix-benchmark");
const casesPath = process.argv[2] || path.join(rootDir, "scripts", "event-benchmark-cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://localhost:8787";

const variants = [
  { name: "desktop-top-100", viewport: { width: 1400, height: 1000 }, zoom: 1, scrollRatio: 0 },
  { name: "desktop-middle-090", viewport: { width: 1400, height: 1000 }, zoom: 0.9, scrollRatio: 0.35 },
  { name: "desktop-lower-125", viewport: { width: 1400, height: 1000 }, zoom: 1.25, scrollRatio: 0.75 },
  { name: "mobile-top-100", viewport: { width: 390, height: 844 }, zoom: 1, scrollRatio: 0 },
  { name: "mobile-middle-090", viewport: { width: 390, height: 844 }, zoom: 0.9, scrollRatio: 0.35 },
  { name: "mobile-lower-125", viewport: { width: 390, height: 844 }, zoom: 1.25, scrollRatio: 0.75 }
];

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
  const weights = { title: 2, date: 2, startTime: 1.5, endTime: 1, location: 1 };
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
    const variantResults = [];
    let blockedBySite = false;
    try {
      await page.goto(testCase.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 18_000 }).catch(() => undefined);

      for (const variant of variants) {
        let candidates = [];
        let error;
        try {
          await page.setViewportSize(variant.viewport);
          await page.evaluate(({ zoom, scrollRatio }) => {
            document.documentElement.style.zoom = String(zoom);
            const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo(0, maxScroll * scrollRatio);
          }, variant);
          await page.waitForTimeout(900);
          await page.bringToFront();
          const scanPayload = await bridge.evaluate(
            () =>
              new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "SCAN_ACTIVE_TAB" }, (response) => {
                  resolve({ error: chrome.runtime.lastError?.message, response });
                });
              })
          );
          if (scanPayload.error || !scanPayload.response?.ok) {
            throw new Error(JSON.stringify(scanPayload));
          }
          candidates = scanPayload.response.session?.candidates ?? [];
          await page.screenshot({
            path: path.join(artifactDir, `${testCase.name}-${variant.name}.png`),
            fullPage: false
          });
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
          if (testCase.automationBlocked) {
            blockedBySite = true;
          }
        }

        const match = bestMatch(candidates, testCase.expected);
        variantResults.push({
          variant,
          error,
          candidateCount: candidates.length,
          bestAccuracy: match.accuracy,
          fields: match.fields,
          bestCandidate: match.candidate ? summarizeCandidate(match.candidate) : undefined
        });
      }
    } catch (caught) {
      blockedBySite = Boolean(testCase.automationBlocked);
      variantResults.push({
        variant: variants[0],
        error: caught instanceof Error ? caught.message : String(caught),
        candidateCount: 0,
        bestAccuracy: 0,
        fields: {}
      });
    } finally {
      await page.close();
    }

    results.push({
      name: testCase.name,
      url: testCase.url,
      automationBlocked: testCase.automationBlocked,
      blockedBySite,
      expected: testCase.expected,
      variants: variantResults
    });
  }
} finally {
  await context.close();
}

const accessibleVariants = results.flatMap((result) => (result.blockedBySite ? [] : result.variants));
const averageVariantAccuracy = accessibleVariants.length
  ? accessibleVariants.reduce((sum, result) => sum + result.bestAccuracy, 0) / accessibleVariants.length
  : 0;
const failedVariants = accessibleVariants.filter((result) => result.bestAccuracy < 0.9);

const summary = {
  caseCount: results.length,
  variantCount: variants.length,
  accessibleVariantCount: accessibleVariants.length,
  blockedBySiteCount: results.filter((result) => result.blockedBySite).length,
  averageVariantAccuracy,
  passed90AllAccessibleVariants: failedVariants.length === 0 && averageVariantAccuracy >= 0.9,
  failedVariantCount: failedVariants.length,
  results
};

writeFileSync(path.join(artifactDir, "results.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
