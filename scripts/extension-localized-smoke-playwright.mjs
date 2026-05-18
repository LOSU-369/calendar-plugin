import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import playwright from "../.tmp/playwright-run/node_modules/playwright/index.js";

const { chromium } = playwright;
const rootDir = process.cwd();
const extensionDir = path.join(rootDir, "extension", "dist");
const profileDir = path.join(rootDir, ".tmp", "playwright-localized-profile");
const artifactDir = path.join(rootDir, ".tmp", "extension-localized-smoke");
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://localhost:8788";

const cases = [
  {
    name: "zh-visible-text",
    path: "/zh.html",
    selection: true,
    expected: {
      title: "\u672a\u6765\u57ce\u5e02\u8bb2\u5ea7\uff1aAI \u4e0e\u57ce\u5e02\u66f4\u65b0",
      date: "2026-05-19",
      startTime: "19:30",
      timezone: "Asia/Shanghai",
      location: "\u4e0a\u6d77\u56fe\u4e66\u9986\u4e1c\u9986"
    },
    html: `
      <main id="event">
        <h1>\u672a\u6765\u57ce\u5e02\u8bb2\u5ea7\uff1aAI \u4e0e\u57ce\u5e02\u66f4\u65b0</h1>
        <p>\u65f6\u95f4\uff1a2026\u5e745\u670819\u65e5 \u5468\u4e8c \u665a\u4e0a7\u70b9\u534a \u5317\u4eac\u65f6\u95f4</p>
        <p>\u5730\u70b9\uff1a\u4e0a\u6d77\u56fe\u4e66\u9986\u4e1c\u9986 7\u697c\u62a5\u544a\u5385</p>
      </main>`
  },
  {
    name: "de-visible-text",
    path: "/de.html",
    expected: {
      title: "SAZ",
      date: "2026-05-19",
      startTime: "16:00",
      endTime: "23:30",
      timezone: "Europe/Zurich",
      location: "CAB Vorhof"
    },
    html: `
      <main>
        <h1>SAZ</h1>
        <p>Dienstag, 19.5.2026, 16:00 - 23:30 MESZ</p>
        <p>CHF 5.- 84 Plaetze verfuegbar</p>
        <p>CAB Vorhof</p>
      </main>`
  },
  {
    name: "en-us-visible-text",
    path: "/en.html",
    expected: {
      title: "Night at the Museum: Curator Talk",
      date: "2026-05-19",
      startTime: "19:00",
      timezone: "America/New_York",
      location: "Brooklyn Museum"
    },
    html: `
      <main>
        <h1>Night at the Museum: Curator Talk</h1>
        <p>Date and Time: May 19, 2026, 7 PM EDT</p>
        <p>Location: Brooklyn Museum, Brooklyn, NY</p>
      </main>`
  }
];

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const fieldMatches = (candidate, key, expectedValue) => {
  if (!expectedValue) {
    return undefined;
  }
  if (key === "title" || key === "location") {
    const actual = normalize(candidate[key]);
    const expected = normalize(expectedValue);
    return actual === expected || actual.includes(expected) || expected.includes(actual);
  }
  return candidate[key] === expectedValue;
};

const scoreCandidate = (candidate, expected) => {
  const weights = { title: 2, date: 2, startTime: 1.5, endTime: 1, location: 1, timezone: 1 };
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

const server = http.createServer((request, response) => {
  const testCase = cases.find((item) => item.path === request.url);
  if (!testCase) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>${testCase.expected.title}</title>${testCase.html}`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 390, height: 844 },
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
    await page.goto(`http://127.0.0.1:${port}${testCase.path}`, { waitUntil: "domcontentloaded" });
    if (testCase.selection) {
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector("#event"));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
    }
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
    const candidates = scanPayload.response.session?.candidates ?? [];
    const match = bestMatch(candidates, testCase.expected);
    results.push({
      name: testCase.name,
      expected: testCase.expected,
      candidateCount: candidates.length,
      bestAccuracy: match.accuracy,
      fields: match.fields,
      bestCandidate: match.candidate ? summarizeCandidate(match.candidate) : undefined,
      candidates: candidates.slice(0, 5).map(summarizeCandidate)
    });
    await page.close();
  }
} finally {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
}

const summary = {
  caseCount: results.length,
  averageCaseAccuracy: results.reduce((sum, result) => sum + result.bestAccuracy, 0) / Math.max(results.length, 1),
  passed90: results.every((result) => result.bestAccuracy >= 0.9),
  results
};

writeFileSync(path.join(artifactDir, "results.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
