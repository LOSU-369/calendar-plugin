import { z } from "zod";

export const extractRequestSchema = z.object({
  pageUrl: z.string().url(),
  pageTitle: z.string().min(1).max(500),
  visibleText: z.string().min(1).max(100000),
  selectedText: z.string().max(30000).optional(),
  titleHints: z.array(z.string().min(1).max(200)).max(12).optional(),
  screenshotBase64: z.string().max(15_000_000).optional(),
  timezone: z.string().min(1).default("Europe/Zurich"),
  locale: z.string().optional()
});

export const candidateSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  allDay: z.boolean(),
  location: z.string().optional(),
  description: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  evidence: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string())
});

export const extractResponseSchema = z.object({
  candidates: z.array(candidateSchema)
});

export type ExtractRequest = z.infer<typeof extractRequestSchema>;
export type ExtractCandidate = z.infer<typeof candidateSchema>;
export type ExtractResponse = z.infer<typeof extractResponseSchema>;
