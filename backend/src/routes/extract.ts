import { Router } from "express";
import { extractRequestSchema, extractResponseSchema } from "../schemas/extract.js";
import { extractCandidates } from "../services/extract-service.js";

export const extractRouter = Router();

extractRouter.post("/", async (req, res) => {
  const parsed = extractRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.issues
    });
    return;
  }
  try {
    const candidates = await extractCandidates(parsed.data);
    const payload = extractResponseSchema.parse({ candidates });
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: "Extraction failed",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});
