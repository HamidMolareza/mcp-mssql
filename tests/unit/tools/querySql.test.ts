import test from "node:test";
import assert from "node:assert/strict";
import { buildQuerySqlHandler } from "../../../src/tools/querySql.js";
import { createMockPool, createMockRuntime, readTextContent } from "./helpers.js";

test("query_sql runs read-only queries and returns rows", async () => {
  let executedQuery = "";
  const handler = buildQuerySqlHandler(
    createMockRuntime({
      getPool: async () => createMockPool([{ id: 1 }], (query) => {
        executedQuery = query;
      })
    })
  );

  const response = await handler({ sql: "SELECT 1 AS id" });
  assert.equal(executedQuery, "SELECT 1 AS id");
  assert.deepEqual(readTextContent(response), {
    target: "app",
    rows: [{ id: 1 }]
  });
});

test("query_sql blocks unsafe statements before executing them", async () => {
  let wasWarned = false;
  const runtime = createMockRuntime({
    logger: {
      ...createMockRuntime().logger,
      warn: () => {
        wasWarned = true;
      }
    },
    getPool: async () => createMockPool([{ id: 1 }])
  });
  const handler = buildQuerySqlHandler(runtime);

  await assert.rejects(() => handler({ sql: "DELETE FROM Users" }), /read-only SQL statements/);
  assert.equal(wasWarned, true);
});
