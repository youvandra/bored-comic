import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { buildGenServer, buildToolsServer } from "./mcp.js";
import { mcpPaidRoute, mcpPreflight, send402Challenge, x402Info } from "./x402.js";
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
  res.json({
    ...x402Info(),
    tiers: {
      basic: { endpoint: "/gen/basic", pages: "1-5", price: "$0.50" },
      standard: { endpoint: "/gen/standard", pages: "6-10", price: "$1.00" },
      premium: { endpoint: "/gen/premium", pages: "11-20", price: "$3.00" },
    },
    tools: { endpoint: "/mcp", reviseAndCreateCharacter: `$${config.x402PriceUsd}` },
  });
});

// ─── Tier config ────────────────────────────────────────────────────────────

interface TierConfig {
  path: string;
  maxPages: number;
  price: string;
  name: string;
  desc: string;
}

const TIERS: TierConfig[] = [
  { path: "/gen/basic",    maxPages: 5,  price: "0.50", name: "Generate Comic Basic",    desc: "BoredComic Basic — 1-5 page comics" },
  { path: "/gen/standard", maxPages: 10, price: "1.00", name: "Generate Comic Standard", desc: "BoredComic Standard — 6-10 page comics" },
  { path: "/gen/premium",  maxPages: 20, price: "3.00", name: "Generate Comic Premium",  desc: "BoredComic Premium — 11-20 page comics" },
];

// ─── Generic MCP route factory ──────────────────────────────────────────────

function createMcpHandler(server: ReturnType<typeof buildGenServer | typeof buildToolsServer>) {
  return async (req: express.Request, res: express.Response) => {
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
  };
}

// ─── Gen endpoints: generate_comic only ─────────────────────────────────────

for (const tier of TIERS) {
  const handler = createMcpHandler(buildGenServer(tier.maxPages, tier.price, tier.name));

  app.post(
    tier.path,
    rateLimit,
    mcpPreflight(tier.maxPages),
    mcpPaidRoute(`POST ${tier.path}`, tier.desc, tier.price),
    handler,
  );

  // Marketplace validator probe
  app.get(tier.path, (_req, res) => {
    send402Challenge(_req, res, tier.desc, tier.price);
  });
}

// ─── Tools endpoint: revise_page, create_character ──────────────────────────

const toolsHandler = createMcpHandler(buildToolsServer(config.x402PriceUsd));

app.post(
  "/mcp",
  rateLimit,
  mcpPreflight(),
  mcpPaidRoute("POST /mcp", "BoredComic Tools — revise and create characters", config.x402PriceUsd),
  toolsHandler,
);

app.get("/mcp", (_req, res) => {
  send402Challenge(_req, res, "BoredComic Tools — revise and create characters", config.x402PriceUsd);
});

app.all("/mcp", (_req, res) => {
  res.status(405).json({ error: "Method not allowed" });
});

// ─── Static file routes ─────────────────────────────────────────────────────

app.get("/comics/:jobId/:file", (req, res) => {
  const filePath = resolveComicPath(req.params.jobId, req.params.file);
  if (!filePath) return res.status(400).json({ error: "invalid path" });
  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "not found" });
  });
});

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

app.get("/api/job/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || !job.delivery) return res.status(404).json({ error: "unknown or expired jobId" });
  const filesAvailable = fs.existsSync(path.join(config.comicDir, job.jobId, "cover.png"));
  return res.json({ ...job.delivery, views: getViews(job.jobId), filesAvailable });
});

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
  console.log(`  Gen endpoints: ${TIERS.map((t) => `${t.path} (1-${t.maxPages} pages, $${t.price})`).join(", ")}`);
  console.log(`  Tools endpoint: /mcp (revise_page, create_character @ $${config.x402PriceUsd})`);
});
