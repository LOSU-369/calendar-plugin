import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { extractRouter } from "./routes/extract.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "event-extractor-backend",
    timestamp: new Date().toISOString()
  });
});

app.use("/extract", extractRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({
    error: "Unhandled server error",
    detail: err.message
  });
});

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
