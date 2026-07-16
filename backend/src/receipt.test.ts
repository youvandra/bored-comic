import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("sha256Hex matches known vector", async () => {
  const { sha256Hex } = await import("./receipt.js");
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("buildIntegrity hashes existing files and skips missing ones", async () => {
  const { buildIntegrity, sha256Hex } = await import("./receipt.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boredcomic-receipt-"));
  fs.writeFileSync(path.join(dir, "cover.png"), "COVER");

  const integrity = buildIntegrity(dir, ["cover.png", "missing.png"]);
  assert.equal(integrity.algorithm, "sha256");
  assert.equal(integrity.files["cover.png"], sha256Hex(Buffer.from("COVER")));
  assert.equal(integrity.files["missing.png"], undefined);
});

test("buildReceipt is unsigned without a secret but still carries the payload hash", async () => {
  const { buildReceipt } = await import("./receipt.js");
  const { config } = await import("./config.js");

  const original = config.receiptSecret;
  try {
    (config as { receiptSecret: string }).receiptSecret = "";
    const receipt = buildReceipt("cg_1", { algorithm: "sha256", files: { "a.png": "deadbeef" } });
    assert.equal(receipt.signature, null);
    assert.equal(receipt.jobId, "cg_1");
    assert.match(receipt.payloadSha256, /^[0-9a-f]{64}$/);
  } finally {
    (config as { receiptSecret: string }).receiptSecret = original;
  }
});

test("buildReceipt signs deterministically with a secret", async () => {
  const { buildReceipt } = await import("./receipt.js");
  const { config } = await import("./config.js");
  const { createHmac } = await import("node:crypto");

  const original = config.receiptSecret;
  try {
    (config as { receiptSecret: string }).receiptSecret = "test-secret";
    const receipt = buildReceipt("cg_2", { algorithm: "sha256", files: { "a.png": "deadbeef" } });
    assert.ok(receipt.signature);
    const expected = createHmac("sha256", "test-secret")
      .update(`${receipt.jobId}.${receipt.payloadSha256}.${receipt.issuedAt}`)
      .digest("hex");
    assert.equal(receipt.signature, expected);
  } finally {
    (config as { receiptSecret: string }).receiptSecret = original;
  }
});

test("buildLicense carries provenance", async () => {
  const { buildLicense, sha256Hex } = await import("./receipt.js");
  const license = buildLicense("model-x", 42, "a cat astronaut");
  assert.match(license.usage, /commercially/);
  assert.equal(license.provenance.imageModel, "model-x");
  assert.equal(license.provenance.seed, 42);
  assert.equal(license.provenance.promptSha256, sha256Hex("a cat astronaut"));
});
