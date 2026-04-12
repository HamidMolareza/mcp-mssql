import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTargets, normalizeTarget } from "../../../src/config/targets.js";

test("normalizeTarget applies defaults and validates fields", () => {
  const target = normalizeTarget({
    name: "app",
    description: "Primary app database",
    host: "localhost",
    user: "sa",
    password: "secret",
    defaultDatabase: "master"
  });

  assert.deepEqual(target, {
    name: "app",
    description: "Primary app database",
    host: "localhost",
    user: "sa",
    password: "secret",
    defaultDatabase: "master",
    options: {
      encrypt: false,
      trustServerCertificate: true
    }
  });

  assert.throws(
    () =>
      normalizeTarget({
        name: "invalid-name",
        description: "x",
        host: "localhost",
        user: "sa",
        password: "secret",
        defaultDatabase: "master"
      }),
    /Invalid target name/
  );
});

test("loadTargets reads multi-target config and validates default target", () => {
  const directory = mkdtempSync(join(tmpdir(), "mssql-mcp-targets-"));
  const targetsFile = join(directory, "mssql-targets.json");
  const previousCwd = process.cwd();
  const previousEnv = { ...process.env };

  writeFileSync(
    targetsFile,
    JSON.stringify({
      defaultTarget: "app",
      targets: [
        {
          name: "app",
          description: "Application data",
          host: "localhost",
          user: "sa",
          password: "secret",
          defaultDatabase: "master"
        }
      ]
    })
  );

  process.chdir(directory);
  process.env.MSSQL_TARGETS_FILE = "mssql-targets.json";

  try {
    const config = loadTargets();
    assert.equal(config.defaultTarget, "app");
    assert.equal(config.targets.length, 1);
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
