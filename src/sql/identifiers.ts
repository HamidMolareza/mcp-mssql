import { SQL_IDENTIFIER } from "../config/targets.js";

export function quoteSqlIdentifier(identifier: string, label: string): string {
  const trimmed = identifier.trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  if (trimmed.includes("\u0000")) {
    throw new Error(`${label} contains invalid characters.`);
  }

  return `[${trimmed.replaceAll("]", "]]")}]`;
}

export function parseTableReference(
  tableReference: string,
  schema?: string
): { schemaName: string; tableName: string } {
  const reference = tableReference.trim();

  if (!reference) {
    throw new Error("Table name is required.");
  }

  const segments = reference
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 || segments.length > 2) {
    throw new Error("Use `table` or `schema.table` format.");
  }

  if (segments.length === 2 && schema?.trim()) {
    throw new Error("Provide either `schema` or `schema.table`, not both.");
  }

  const schemaName =
    segments.length === 2 ? (segments[0] ?? "").trim() : (schema?.trim() || "dbo").trim();
  const tableName = segments.at(-1)?.trim() ?? "";

  if (!SQL_IDENTIFIER.test(schemaName) || !SQL_IDENTIFIER.test(tableName)) {
    throw new Error("Schema and table names must be simple SQL identifiers.");
  }

  return { schemaName, tableName };
}
