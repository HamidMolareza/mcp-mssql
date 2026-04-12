import test from "node:test";
import assert from "node:assert/strict";
import { parseTableReference, quoteSqlIdentifier } from "../../../src/sql/identifiers.js";

test("quoteSqlIdentifier escapes closing brackets", () => {
  assert.equal(quoteSqlIdentifier("dbo]Users", "Table"), "[dbo]]Users]");
  assert.throws(() => quoteSqlIdentifier("", "Table"), /Table is required/);
});

test("parseTableReference supports table and schema.table formats", () => {
  assert.deepEqual(parseTableReference("Users"), {
    schemaName: "dbo",
    tableName: "Users"
  });

  assert.deepEqual(parseTableReference("sales.Orders"), {
    schemaName: "sales",
    tableName: "Orders"
  });

  assert.throws(() => parseTableReference("sales.Orders", "dbo"), /Provide either `schema` or `schema.table`/);
  assert.throws(() => parseTableReference("sales.order-items"), /simple SQL identifiers/);
});
