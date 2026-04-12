const WRITE_QUERY_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|create|merge|exec(?:ute)?|grant|revoke|deny)\b/i;
const READ_QUERY_PATTERN = /^(select|with)\b/i;

export function normalizeQuery(query: string): string {
  return query
    .replace(/--.*$/gmu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/^\s*;+/u, "")
    .trim();
}

export function assertReadOnlyQuery(query: string): void {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    throw new Error("SQL query cannot be empty.");
  }

  if (WRITE_QUERY_PATTERN.test(normalizedQuery)) {
    throw new Error("Only read-only SQL statements are allowed.");
  }

  if (!READ_QUERY_PATTERN.test(normalizedQuery)) {
    throw new Error("Query must start with SELECT or WITH.");
  }
}
