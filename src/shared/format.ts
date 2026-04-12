import { createHash } from "node:crypto";
import { normalizeQuery } from "../sql/safety.js";

export function formatRecordset(recordset: unknown): string {
  return JSON.stringify(recordset, null, 2);
}

export function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    message: String(error)
  };
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function previewText(value: string, maxLength = 160): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

export function buildQueryAudit(query: string): Record<string, unknown> {
  const normalizedQuery = normalizeQuery(query);

  return {
    queryHash: hashText(normalizedQuery),
    queryPreview: previewText(normalizedQuery)
  };
}

export function countRows(recordset: unknown): number | null {
  return Array.isArray(recordset) ? recordset.length : null;
}
