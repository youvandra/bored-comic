import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { handleNativePaidCall, PAID_TOOLS } from "./native.js";

// Minimal Express Response stub that records status + JSON body and asserts the
// x402-native contract: a plain res.json() (application/json), never an SSE
// stream and never a 406.
function mockRes() {
  const rec: { status: number; body: unknown; sse: boolean } = { status: 0, body: undefined, sse: false };
  const res = {
    statusCode: 200,
    status(code: number) {
      rec.status = code;
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      rec.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "content-type" && String(value).includes("text/event-stream")) rec.sse = true;
    },
    write() {
      rec.sse = true;
    },
  } as unknown as Response;
  return { res, rec };
}

test("PAID_TOOLS lists the three metered tools", () => {
  assert.ok(PAID_TOOLS.has("generate_comic"));
  assert.ok(PAID_TOOLS.has("revise_page"));
  assert.ok(PAID_TOOLS.has("create_character"));
});

test("native handler answers plain JSON (no SSE, no 406) for an unknown tool", async () => {
  const req = { body: { id: 7, method: "tools/call", params: { name: "nope", arguments: {} } } } as unknown as Request;
  const { res, rec } = mockRes();
  await handleNativePaidCall(req, res);
  assert.equal(rec.sse, false);
  assert.notEqual(rec.status, 406);
  assert.equal(rec.status, 400);
  const body = rec.body as { jsonrpc: string; id: unknown; error?: { message: string } };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 7);
  assert.ok(body.error?.message.includes("Unknown paid tool"));
});

test("native handler failures return >=400 JSON so payment isn't settled", async () => {
  // revise_page on an unknown jobId throws inside the pipeline → mapped to a
  // 5xx JSON-RPC error, which the x402 middleware treats as no-settle.
  const req = {
    body: { id: 1, method: "tools/call", params: { name: "revise_page", arguments: { jobId: "cg_missing", page: 1, instruction: "brighter" } } },
  } as unknown as Request;
  const { res, rec } = mockRes();
  await handleNativePaidCall(req, res);
  assert.equal(rec.sse, false);
  assert.ok(rec.status >= 400);
  const body = rec.body as { jsonrpc: string; error?: unknown };
  assert.equal(body.jsonrpc, "2.0");
  assert.ok(body.error);
});
