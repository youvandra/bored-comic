import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { buildMcpServer } from "./mcp.js";
import { x402Gate, x402Info } from "./x402.js";
import { resolveComicPath, startCleanup } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, "..", "..", "frontend");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "10mb" }));

app.use(express.static(FRONTEND_DIR));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "comicgen" });
});

app.get("/x402/info", (_req, res) => {
  res.json(x402Info());
});

app.post("/mcp", x402Gate, async (req, res) => {
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

// Serve generated comics (path-traversal safe)
app.get("/comics/:jobId/:file", (req, res) => {
  const filePath = resolveComicPath(req.params.jobId, req.params.file);
  if (!filePath) return res.status(400).json({ error: "invalid path" });
  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "not found" });
  });
});

startCleanup();

app.listen(config.port, () => {
  console.log(`BoredComic server running on port ${config.port}`);
});
