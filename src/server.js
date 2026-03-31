import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { config } from "./config.js";
import { handleSchedulerTurn } from "./agent/schedulerAgent.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, "..", "public");

app.use(cors());
app.use(express.json());
app.use(express.static(publicPath));

app.get("/api/health", (_, res) => {
  res.json({ ok: true, timezone: config.timezone });
});

app.post("/api/session", (_, res) => {
  res.json({ sessionId: randomUUID() });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, text } = req.body || {};
    if (!sessionId || !text) {
      res.status(400).json({ error: "sessionId and text are required." });
      return;
    }

    const result = await handleSchedulerTurn({
      sessionId,
      userText: text,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Agent failed to process the request.",
      details: error.message,
    });
  }
});

app.get(/.*/, (_, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Smart Scheduler running on http://localhost:${config.port}`);
});
