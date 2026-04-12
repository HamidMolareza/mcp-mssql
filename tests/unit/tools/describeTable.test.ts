import test from "node:test";
import assert from "node:assert/strict";
import { buildDescribeTableHandler } from "../../../src/tools/describeTable.js";
import { createMockPool, createMockRuntime, readTextContent } from "./helpers.js";

test("describe_table returns columns for the resolved schema and table", async () => {
  const handler = buildDescribeTableHandler(
    createMockRuntime({
      getPool: async () =>
        createMockPool([{ COLUMN_NAME: "Id", DATA_TYPE: "int" }])
    })
  );

  const response = await handler({ database: "master", table: "sales.Orders" });
  assert.deepEqual(readTextContent(response), {
    target: "app",
    database: "master",
    schema: "sales",
    table: "Orders",
    columns: [{ COLUMN_NAME: "Id", DATA_TYPE: "int" }]
  });
});

test("describe_table throws when the table does not exist", async () => {
  const handler = buildDescribeTableHandler(
    createMockRuntime({
      getPool: async () => createMockPool([])
    })
  );

  await assert.rejects(
    () => handler({ database: "master", table: "dbo.Missing" }),
    /Table not found/
  );
});
