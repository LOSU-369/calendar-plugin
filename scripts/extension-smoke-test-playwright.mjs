import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import playwright from "../.tmp/playwright-run/node_modules/playwright/index.js";

const { chromium } = playwright;

const rootDir = process.cwd();
const extensionDir = path.join(rootDir, "extension", "dist");
const profileDir = path.join(rootDir, ".tmp", "playwright-extension-profile");
const screenshotPath = path.join(rootDir, ".tmp", "extension-review-smoke.png");
const targetUrl = process.argv[2] || "https://www.reformiert-zuerich.ch/4.php?read_group=1706";
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://localhost:8787";

rmSync(profileDir, { recursive: true, force: true });
mkdirSync(path.dirname(screenshotPath), { recursive: true });

const summarizeCandidate = (candidate) => ({
  title: candidate.title,
  date: candidate.date,
  endDate: candidate.endDate,
  startTime: candidate.startTime,
  endTime: candidate.endTime,
  location: candidate.location,
  timezone: candidate.timezone,
  confidence: candidate.confidence
});

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

try {
  let serviceWorker = context.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"));
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.evaluate(() => window.scrollTo(0, 240));
  await page.waitForTimeout(800);

  const bridge = await context.newPage();
  await bridge.goto(`chrome-extension://${extensionId}/src/options/index.html`, { waitUntil: "domcontentloaded" });
  await bridge.evaluate(
    (settings) => chrome.storage.local.set({ settings }),
    { backendBaseUrl, timezone: "Europe/Zurich", locale: "en-US", debug: false }
  );
  await page.bringToFront();

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
    throw new Error(JSON.stringify(scanPayload, null, 2));
  }

  const candidates = scanPayload.response.session?.candidates ?? [];

  const review = await context.newPage();
  await review.goto(`chrome-extension://${extensionId}/src/review/index.html`, { waitUntil: "domcontentloaded" });
  await review.waitForTimeout(1200);
  await review.screenshot({ path: screenshotPath, fullPage: true });

  console.log(
    JSON.stringify(
      {
        ok: true,
        targetUrl,
        extensionId,
        candidateCount: candidates.length,
        candidates: candidates.map(summarizeCandidate),
        screenshotPath
      },
      null,
      2
    )
  );
} finally {
  await context.close();
}
