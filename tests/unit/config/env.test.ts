import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureNonEmpty, loadEnvFile, requireEnv, stripOptionalQuotes } from "../../../src/config/env.js";

test("stripOptionalQuotes removes matching wrapping quotes", () => {
  assert.equal(stripOptionalQuotes('"value"'), "value");
  assert.equal(stripOptionalQuotes("'value'"), "value");
  assert.equal(stripOptionalQuotes("value"), "value");
});

test("loadEnvFile loads values without overriding existing env vars", () => {
  const directory = mkdtempSync(join(tmpdir(), "mssql-mcp-env-"));
  const envFile = join(directory, ".env.test");

  writeFileSync(
    envFile,
    ["DB_HOST=localhost", 'DB_USER="sa"', "IGNORED_LINE", "DB_PASSWORD=secret"].join("\n")
  );

  const previousCwd = process.cwd();
  const previousEnv = { ...process.env };
  process.chdir(directory);
  process.env.DB_PASSWORD = "existing";

  try {
    loadEnvFile(".env.test");
    assert.equal(process.env.DB_HOST, "localhost");
    assert.equal(process.env.DB_USER, "sa");
    assert.equal(process.env.DB_PASSWORD, "existing");
  } finally {
    process.chdir(previousCwd);
    rmSync(directory, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, previousEnv);
  }
});

test("requireEnv and ensureNonEmpty reject blank values", () => {
  const previousValue = process.env.TEST_REQUIRED_ENV;
  process.env.TEST_REQUIRED_ENV = "  ok  ";

  try {
    assert.equal(requireEnv("TEST_REQUIRED_ENV"), "ok");
    assert.equal(ensureNonEmpty("  value  ", "Label"), "value");
    assert.throws(() => ensureNonEmpty("   ", "Label"), /Label is required/);
  } finally {
    if (previousValue === undefined) {
      delete process.env.TEST_REQUIRED_ENV;
    } else {
      process.env.TEST_REQUIRED_ENV = previousValue;
    }
  }

  delete process.env.TEST_REQUIRED_ENV;
  assert.throws(() => requireEnv("TEST_REQUIRED_ENV"), /Missing required environment variable/);
});
