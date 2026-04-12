import test from "node:test";
import assert from "node:assert/strict";
import { createAppRuntime } from "../../../src/app/runtime.js";
import type { ConnectionTarget, Logger, SqlPool } from "../../../src/shared/types.js";

function createLogger(): Logger {
  return {
    logFilePath: "/tmp/mock.log",
    write: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}

function createTarget(name: string): ConnectionTarget {
  return {
    name,
    description: `${name} database`,
    host: `${name}.local`,
    user: "sa",
    password: "secret",
    defaultDatabase: "master"
  };
}

test("createAppRuntime resolves explicit, default, and single targets", () => {
  const app = createTarget("app");
  const analytics = createTarget("analytics");

  const runtime = createAppRuntime(
    {
      defaultTarget: "analytics",
      targets: [app, analytics]
    },
    createLogger(),
    () => {
      throw new Error("pool factory should not run in this test");
    }
  );

  assert.equal(runtime.getTarget("app").name, "app");
  assert.equal(runtime.getTarget().name, "analytics");

  const singleTargetRuntime = createAppRuntime(
    {
      targets: [app]
    },
    createLogger(),
    () => {
      throw new Error("pool factory should not run in this test");
    }
  );

  assert.equal(singleTargetRuntime.getTarget().name, "app");
  assert.throws(() => runtime.getTarget("missing"), /Unknown target/);
});

test("createAppRuntime caches pools and closes them during shutdown", async () => {
  const createdPools: SqlPool[] = [];
  let closeCount = 0;

  const runtime = createAppRuntime(
    {
      defaultTarget: "app",
      targets: [createTarget("app")]
    },
    createLogger(),
    () => {
      const pool: SqlPool = {
        connect: async () => undefined,
        close: async () => {
          closeCount += 1;
        },
        request: () => {
          throw new Error("request should not run in this test");
        }
      };

      createdPools.push(pool);
      return pool;
    }
  );

  const firstPool = await runtime.getPool();
  const secondPool = await runtime.getPool("app");

  assert.equal(firstPool, secondPool);
  assert.equal(createdPools.length, 1);

  await runtime.shutdown();
  assert.equal(closeCount, 1);
});
