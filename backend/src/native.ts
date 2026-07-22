// x402-native paid-tool handler.
//
// The OKX x402 facilitator replays the paid call as a single PLAIN-JSON POST
// (Accept: application/json, no `text/event-stream`) and settles payment on the
// response: it settles on a 2xx body and skips settlement on any >=400. The MCP
// StreamableHTTP transport rejects that plain POST with 406 (it demands
// text/event-stream) and, even when coaxed past that, answers with an SSE
// stream instead of a JSON body — so the facilitator can neither read a result
// nor settle. This handler bypasses the MCP transport for the three paid tools:
// it runs the tool to completion and returns the full result as one plain-JSON
// 200 body, which is exactly what the x402 buyer flow expects.
import type { Request, Response } from "express";
import { runPipeline, revisePage } from "./pipeline.js";
import { createCharacter, type CreateCharacterInput } from "./character.js";
import { getJob } from "./store.js";
import { inflight, etaSeconds } from "./mcp.js";
import { readerUrlFor } from "./reader.js";
import type { GenerateComicInput } from "./types.js";

export const PAID_TOOLS = new Set(["generate_comic", "revise_page", "create_character"]);

const NOOP_HOOKS = { setStatus: () => {} };

// Comics up to this many pages finish inside the request and return the full
// delivery in the 200 body. Longer ones (premium, 11-20 pages) would hold the
// HTTP connection for many minutes and risk the facilitator's own read timeout,
// so they run in the background and return a jobId + readerUrl the buyer polls.
const SYNC_MAX_PAGES = 10;

// JSON-RPC 2.0 success. `structuredContent` carries the delivery as data; the
// `content` text mirror keeps the response valid for MCP-style clients too.
function rpcResult(id: unknown, payload: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    result: {
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    },
  };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

// Handles a paid `tools/call` synchronously. Input is already validated by
// mcpPreflight (before payment) and payment is already verified by the x402
// middleware, so by the time we get here we only run the tool and return.
export async function handleNativePaidCall(req: Request, res: Response): Promise<void> {
  const body = req.body as {
    id?: unknown;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };
  const id = body?.id;
  const name = body?.params?.name ?? "";
  const args = body?.params?.arguments ?? {};

  try {
    if (name === "generate_comic") {
      const jobId = `cg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const gen = args as unknown as GenerateComicInput;

      // Long comics: run in the background and return a handle immediately.
      if (typeof gen.pages === "number" && gen.pages > SYNC_MAX_PAGES) {
        inflight.set(jobId, { kind: "generate", stage: "queued", startedAt: Date.now(), pages: gen.pages });
        void runPipeline(jobId, gen, {
          setStatus: (stage) => {
            const j = inflight.get(jobId);
            if (j) j.stage = stage;
          },
        })
          .then(() => { inflight.delete(jobId); })
          .catch((err) => {
            const j = inflight.get(jobId);
            if (j) j.error = err instanceof Error ? err.message : "Generation failed";
          });
        res.status(200).json(rpcResult(id, {
          jobId,
          status: "generating",
          stage: "queued",
          etaSeconds: etaSeconds(gen.pages),
          readerUrl: readerUrlFor(jobId),
          next: "Poll the free get_job tool with this jobId every ~15 seconds until it returns the full delivery.",
        }));
        return;
      }

      // Short comics: finish inside the request, return the full delivery.
      const delivery = await runPipeline(jobId, gen, NOOP_HOOKS);
      res.status(200).json(rpcResult(id, delivery));
      return;
    }

    if (name === "revise_page") {
      const jobId = String(args.jobId);
      await revisePage(jobId, Number(args.page), String(args.instruction), NOOP_HOOKS);
      const job = getJob(jobId);
      res.status(200).json(rpcResult(id, job?.delivery ?? { jobId, status: "revised" }));
      return;
    }

    if (name === "create_character") {
      const character = await createCharacter(args as unknown as CreateCharacterInput);
      res.status(200).json(rpcResult(id, character));
      return;
    }

    res.status(400).json(rpcError(id, -32601, `Unknown paid tool: ${name}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    // 5xx → the x402 middleware skips settlement, so a failed generation is
    // never charged to the buyer.
    res.status(502).json(rpcError(id, -32000, message));
  }
}
