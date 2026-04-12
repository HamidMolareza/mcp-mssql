import test from "node:test";
import assert from "node:assert/strict";
import { assertReadOnlyQuery, normalizeQuery } from "../../../src/sql/safety.js";

test("normalizeQuery removes comments and leading semicolons", () => {
  assert.equal(normalizeQuery("; -- comment\nSELECT * FROM Users /* block */"), "SELECT * FROM Users");
});

test("assertReadOnlyQuery only allows SELECT or WITH statements", () => {
  assert.doesNotThrow(() => assertReadOnlyQuery("SELECT TOP 1 * FROM Users"));
  assert.doesNotThrow(() => assertReadOnlyQuery("WITH cte AS (SELECT 1 AS id) SELECT * FROM cte"));
  assert.throws(() => assertReadOnlyQuery("DELETE FROM Users"), /read-only SQL statements/);
  assert.throws(() => assertReadOnlyQuery("EXEC dbo.DoThing"), /read-only SQL statements/);
  assert.throws(() => assertReadOnlyQuery(""), /cannot be empty/);
});
