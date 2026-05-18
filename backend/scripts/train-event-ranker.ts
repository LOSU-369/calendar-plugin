import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import type { EventWindowRankerModel } from "../src/ml/event-ranker.js";
import { tokenizeEventText } from "../src/ml/event-ranker.js";

interface LabelRow {
  filename?: string;
  file_name?: string;
  title: string;
  start_date: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  description?: string;
  location?: string;
}

interface TrainingSample {
  label: "event" | "nonEvent";
  text: string;
}

interface Metrics {
  precision: number;
  recall: number;
  f1: number;
}

const backendRoot = process.cwd();
const repoRoot = path.resolve(backendRoot, "..");
const modelDirectory = path.join(backendRoot, "model");
const modelPath = path.join(modelDirectory, "event-window-ranker.json");
const alpha = 1;

const parseCsvFile = (filePath: string): LabelRow[] =>
  parse(readFileSync(filePath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true
  }) as LabelRow[];

const formatDateRange = (row: LabelRow): string =>
  row.end_date && row.end_date !== row.start_date ? `${row.start_date} - ${row.end_date}` : row.start_date;

const formatTimeRange = (row: LabelRow): string => {
  if (row.start_time && row.end_time) {
    return `${row.start_time} - ${row.end_time}`;
  }
  if (row.start_time) {
    return row.start_time;
  }
  return "";
};

const buildPositiveVariants = (row: LabelRow): string[] => {
  const dateRange = formatDateRange(row);
  const timeRange = formatTimeRange(row);
  const lines = [
    row.title,
    `Date: ${dateRange}`,
    timeRange ? `Time: ${timeRange}` : "",
    row.location ? `Location: ${row.location}` : "",
    row.description ? `Description: ${row.description}` : ""
  ].filter(Boolean);

  return [
    lines.join("\n"),
    `${row.title}\n${dateRange}${timeRange ? `\n${timeRange}` : ""}${row.location ? `\n${row.location}` : ""}`,
    `Event: ${row.title}\nWhen: ${dateRange}${timeRange ? `, ${timeRange}` : ""}\nVenue: ${row.location ?? ""}\n${row.description ?? ""}`.trim()
  ];
};

const buildNegativeVariants = (row: LabelRow): string[] => [
  `${row.title}\n${row.description ?? ""}`.trim(),
  `${row.location ?? "Venue TBA"}\n${row.description ?? "Read more on the website."}`.trim(),
  `Read more about ${row.title}. Registration details and updates will appear later.`
];

const staticNoiseSamples = (): string[] => [
  "Home\nAbout\nProgram\nSpeakers\nContact\nSign in\nCreate account",
  "Registration closes soon. Copy link. External registration. Download calendar entry.",
  "Venue information will be announced later. Subscribe for updates and follow us on social media.",
  "Cookie preferences\nNecessary cookies\nAnalytics cookies\nSave settings",
  "Workshop materials, exhibitor details, sponsor logos, and accommodation tips.",
  "Conditions of participation. Payment details. Refund policy. Accessibility note."
];

const readMessyTextEntries = (): Map<string, string> => {
  const zipPath = path.join(repoRoot, "messy_texts.zip");
  const archive = new AdmZip(zipPath);
  const entries = new Map<string, string>();

  for (const entry of archive.getEntries()) {
    if (entry.isDirectory || !entry.entryName.toLowerCase().endsWith(".txt")) {
      continue;
    }
    entries.set(path.basename(entry.entryName), entry.getData().toString("utf8"));
  }

  return entries;
};

const dateOrTimeLinePattern =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2}|\d{1,2}[:.]\d{2}|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i;

const buildMessyPositiveWindows = (text: string): string[] => {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const windows: string[] = [text.slice(0, 2200)];
  const seen = new Set<string>(windows);

  for (let index = 0; index < lines.length; index += 1) {
    if (!dateOrTimeLinePattern.test(lines[index])) {
      continue;
    }
    const snippet = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 6)).join("\n");
    if (!seen.has(snippet)) {
      seen.add(snippet);
      windows.push(snippet);
    }
  }

  return windows;
};

const buildMessyNegativeWindows = (text: string): string[] => {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const negatives: string[] = [];

  for (let index = 0; index < lines.length; index += 4) {
    const snippet = lines.slice(index, index + 4).join("\n");
    if (!snippet || dateOrTimeLinePattern.test(snippet)) {
      continue;
    }
    negatives.push(snippet);
    if (negatives.length >= 8) {
      break;
    }
  }

  return negatives;
};

const buildSamples = (): TrainingSample[] => {
  const structuredRows = parseCsvFile(path.join(repoRoot, "ML Data", "labels.csv"));
  const messyRows = parseCsvFile(path.join(repoRoot, "messy_labels.csv"));
  const messyTexts = readMessyTextEntries();
  const samples: TrainingSample[] = [];

  for (const row of structuredRows) {
    buildPositiveVariants(row).forEach((text) => samples.push({ label: "event", text }));
    buildNegativeVariants(row).forEach((text) => samples.push({ label: "nonEvent", text }));
  }

  for (const row of messyRows) {
    const fileName = row.file_name || row.filename;
    const text = fileName ? messyTexts.get(fileName) : undefined;
    if (!text) {
      continue;
    }
    buildPositiveVariants(row).forEach((sample) => samples.push({ label: "event", text: sample }));
    buildMessyPositiveWindows(text).forEach((sample) => samples.push({ label: "event", text: sample }));
    buildMessyNegativeWindows(text).forEach((sample) => samples.push({ label: "nonEvent", text: sample }));
  }

  staticNoiseSamples().forEach((text) => samples.push({ label: "nonEvent", text }));
  return samples.filter((sample) => sample.text.trim().length >= 12);
};

const increment = (map: Map<string, number>, token: string): void => {
  map.set(token, (map.get(token) ?? 0) + 1);
};

const train = (samples: TrainingSample[], threshold: number, metrics?: Metrics): EventWindowRankerModel => {
  const eventCounts = new Map<string, number>();
  const nonEventCounts = new Map<string, number>();
  let eventTokenTotal = 0;
  let nonEventTokenTotal = 0;
  let eventSampleCount = 0;
  let nonEventSampleCount = 0;

  for (const sample of samples) {
    const tokens = tokenizeEventText(sample.text);
    if (!tokens.length) {
      continue;
    }
    if (sample.label === "event") {
      eventSampleCount += 1;
      for (const token of tokens) {
        increment(eventCounts, token);
        eventTokenTotal += 1;
      }
    } else {
      nonEventSampleCount += 1;
      for (const token of tokens) {
        increment(nonEventCounts, token);
        nonEventTokenTotal += 1;
      }
    }
  }

  const vocabulary = new Set<string>([...eventCounts.keys(), ...nonEventCounts.keys()]);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    alpha,
    threshold,
    metrics: metrics
      ? {
          validationF1: metrics.f1,
          validationPrecision: metrics.precision,
          validationRecall: metrics.recall
        }
      : undefined,
    sampleCounts: {
      event: eventSampleCount,
      nonEvent: nonEventSampleCount
    },
    tokenTotals: {
      event: eventTokenTotal,
      nonEvent: nonEventTokenTotal
    },
    vocabularySize: vocabulary.size,
    tokenCounts: {
      event: Object.fromEntries(eventCounts),
      nonEvent: Object.fromEntries(nonEventCounts)
    }
  };
};

const scoreWithModel = (model: EventWindowRankerModel, text: string): number => {
  const tokens = tokenizeEventText(text);
  const eventPrior = Math.log(model.sampleCounts.event / (model.sampleCounts.event + model.sampleCounts.nonEvent));
  const nonEventPrior = Math.log(model.sampleCounts.nonEvent / (model.sampleCounts.event + model.sampleCounts.nonEvent));
  const eventDenominator = model.tokenTotals.event + model.alpha * model.vocabularySize;
  const nonEventDenominator = model.tokenTotals.nonEvent + model.alpha * model.vocabularySize;
  let eventScore = eventPrior;
  let nonEventScore = nonEventPrior;

  for (const token of tokens) {
    const eventCount = model.tokenCounts.event[token];
    const nonEventCount = model.tokenCounts.nonEvent[token];
    if (eventCount === undefined && nonEventCount === undefined) {
      continue;
    }
    eventScore += Math.log(((eventCount ?? 0) + model.alpha) / eventDenominator);
    nonEventScore += Math.log(((nonEventCount ?? 0) + model.alpha) / nonEventDenominator);
  }

  const logOdds = Math.max(-60, Math.min(60, eventScore - nonEventScore));
  return 1 / (1 + Math.exp(-logOdds));
};

const evaluate = (model: EventWindowRankerModel, samples: TrainingSample[], threshold: number): Metrics => {
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const sample of samples) {
    const predictedEvent = scoreWithModel(model, sample.text) >= threshold;
    const actualEvent = sample.label === "event";
    if (predictedEvent && actualEvent) {
      tp += 1;
    } else if (predictedEvent && !actualEvent) {
      fp += 1;
    } else if (!predictedEvent && actualEvent) {
      fn += 1;
    }
  }

  const precision = tp === 0 ? 0 : tp / (tp + fp);
  const recall = tp === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
};

const pickThreshold = (trainingSamples: TrainingSample[], validationSamples: TrainingSample[]): { threshold: number; metrics: Metrics } => {
  const provisional = train(trainingSamples, 0.55);
  const thresholds = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75];
  let bestThreshold = thresholds[0];
  let bestMetrics = evaluate(provisional, validationSamples, bestThreshold);

  for (const threshold of thresholds.slice(1)) {
    const metrics = evaluate(provisional, validationSamples, threshold);
    if (metrics.f1 > bestMetrics.f1 || (metrics.f1 === bestMetrics.f1 && metrics.precision > bestMetrics.precision)) {
      bestThreshold = threshold;
      bestMetrics = metrics;
    }
  }

  return { threshold: bestThreshold, metrics: bestMetrics };
};

const main = (): void => {
  const samples = buildSamples();
  const trainingSamples = samples.filter((_sample, index) => index % 5 !== 0);
  const validationSamples = samples.filter((_sample, index) => index % 5 === 0);
  const { threshold, metrics } = pickThreshold(trainingSamples, validationSamples);
  const finalModel = train(samples, threshold, metrics);

  mkdirSync(modelDirectory, { recursive: true });
  writeFileSync(modelPath, `${JSON.stringify(finalModel, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        modelPath,
        sampleCounts: finalModel.sampleCounts,
        vocabularySize: finalModel.vocabularySize,
        threshold: finalModel.threshold,
        metrics: finalModel.metrics
      },
      null,
      2
    )
  );
};

main();
