import test from "node:test";
import assert from "node:assert/strict";
import { buildQueryAudit, countRows, formatRecordset, previewText, summarizeError } from "../../../src/shared/format.js";

test("format helpers produce stable JSON-safe output", () => {
  assert.equal(formatRecordset({ ok: true }), '{\n  "ok": true\n}');
  assert.equal(countRows([{ id: 1 }, { id: 2 }]), 2);
  assert.equal(countRows({ not: "an array" }), null);
  assert.equal(previewText("abcdef", 4), "abcd…");
});

test("buildQueryAudit hashes normalized queries and summarizeError handles errors", () => {
  const audit = buildQueryAudit("; -- comment\nSELECT * FROM Users");
  assert.equal(typeof audit.queryHash, "string");
  assert.equal(audit.queryPreview, "SELECT * FROM Users");
  assert.deepEqual(summarizeError(new Error("boom")), {
    name: "Error",
    message: "boom"
  });
  assert.deepEqual(summarizeError("boom"), {
    message: "boom"
  });
});
