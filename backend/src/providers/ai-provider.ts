import { randomUUID } from "node:crypto";
import type { ExtractCandidate, ExtractRequest } from "../schemas/extract.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

interface OpenAIResponse {
  output_text?: string;
}

const GENERIC_AI_TITLE_REJECT_PATTERN =
  /^(?:download calendar entry|description|location|start|end|details|detail|forum&contact|forum and contact|contact|login|information|info)$/i;

const promptForExtraction = (input: ExtractRequest): string => {
  const signalText = input.selectedText?.trim() ? `Selected text:\n${input.selectedText}\n\n` : "";
  return [
    "You extract calendar event candidates from webpage text and, when provided, from the visible-page screenshot.",
    "Return strict JSON only. No prose.",
    "Schema: {\"candidates\": [{\"title\": string, \"date\": \"YYYY-MM-DD\", \"endDate\"?: \"YYYY-MM-DD\", \"startTime\"?: \"HH:mm\", \"endTime\"?: \"HH:mm\", \"timezone\"?: string, \"allDay\": boolean, \"location\"?: string, \"description\"?: string, \"evidence\": string[], \"confidence\": number, \"assumptions\": string[] }]}",
    "Never invent facts. If missing, leave fields empty and record assumptions.",
    "Price or fee is not a title and not a location.",
    "If an event spans multiple days, keep the true endDate.",
    "Do not use generic section headings, navigation labels, or action buttons as the event title.",
    "Return up to 12 candidates.",
    `Timezone: ${input.timezone}`,
    `Page title: ${input.pageTitle}`,
    `Page URL: ${input.pageUrl}`,
    signalText,
    `Visible text:\n${input.visibleText.slice(0, 25000)}`
  ].join("\n");
};

const buildResponseInput = (input: ExtractRequest): unknown => {
  const content: Array<Record<string, string>> = [
    {
      type: "input_text",
      text: promptForExtraction(input)
    }
  ];

  if (input.screenshotBase64?.startsWith("data:image/")) {
    content.push({
      type: "input_image",
      image_url: input.screenshotBase64,
      detail: "auto"
    });
  }

  return [
    {
      role: "user",
      content
    }
  ];
};

export const aiFallbackExtract = async (input: ExtractRequest): Promise<ExtractCandidate[]> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return [];
  }
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: buildResponseInput(input),
      temperature: 0.1
    })
  });
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as OpenAIResponse;
  if (!data.output_text) {
    return [];
  }
  try {
    const parsed = JSON.parse(data.output_text) as {
      candidates?: Array<Omit<ExtractCandidate, "id" | "sourceUrl">>;
    };
    return (parsed.candidates ?? [])
      .filter((candidate) => candidate.title?.trim() && !GENERIC_AI_TITLE_REJECT_PATTERN.test(candidate.title.trim()))
      .map((c) => ({
        id: randomUUID(),
        title: c.title,
        date: c.date,
        endDate: c.endDate,
        startTime: c.startTime,
        endTime: c.endTime,
        timezone: c.timezone,
        allDay: c.allDay,
        location: c.location,
        description: c.description,
        sourceUrl: input.pageUrl,
        evidence: c.evidence ?? [],
        confidence: Math.max(0, Math.min(1, c.confidence ?? 0.55)),
        assumptions: c.assumptions ?? ["AI fallback used."]
      }));
  } catch {
    return [];
  }
};
