import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { buildMcpServer } from "./mcp.js";
import { x402Gate, x402Info } from "./x402.js";
import { resolveComicPath, startCleanup } from "./storage.js";
import { getJob, getViews, incrementViews, resolveCharacterImagePath } from "./store.js";
import { rateLimit } from "./ratelimit.js";
import { renderReaderPage } from "./reader.js";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, "..", "..", "frontend");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "10mb" }));

app.use(express.static(FRONTEND_DIR));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "boredcomic" });
});

app.get("/x402/info", (_req, res) => {
  res.json(x402Info());
});

app.post("/mcp", rateLimit, x402Gate, async (req, res) => {
  const server = buildMcpServer(req.ip);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  }
});

app.all("/mcp", (_req, res) => {
  res.status(405).json({ error: "Method not allowed" });
});

app.get("/comics/:jobId/:file", (req, res) => {
  const filePath = resolveComicPath(req.params.jobId, req.params.file);
  if (!filePath) return res.status(400).json({ error: "invalid path" });
  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "not found" });
  });
});

// Hosted reader: shareable page per comic with server-rendered OG tags.
// Every human view increments the job's view counter — the audience signal
// that get_series feeds back to the generating agent.
app.get("/read/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).send(
      "<h1 style=\"font-family:sans-serif;text-align:center;margin-top:20vh\">Comic not found — it may have expired.</h1>",
    );
  }
  const views = incrementViews(job.jobId);
  const filesAvailable = fs.existsSync(path.join(config.comicDir, job.jobId, "cover.png"));
  return res.type("html").send(renderReaderPage({ job, views, filesAvailable }));
});

// JSON twin of the reader (and of the get_job MCP tool) for programmatic use.
app.get("/api/job/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || !job.delivery) return res.status(404).json({ error: "unknown or expired jobId" });
  const filesAvailable = fs.existsSync(path.join(config.comicDir, job.jobId, "cover.png"));
  return res.json({ ...job.delivery, views: getViews(job.jobId), filesAvailable });
});

// Character reference sheets live in the persistent data dir, not the
// TTL-swept comic dir — they must outlive any single job.
app.get("/characters/:characterId/:file", (req, res) => {
  const filePath = resolveCharacterImagePath(req.params.characterId, req.params.file);
  if (!filePath) return res.status(400).json({ error: "invalid path" });
  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "not found" });
  });
});

startCleanup();

app.listen(config.port, () => {
  console.log(`BoredComic server running on port ${config.port}`);
});
