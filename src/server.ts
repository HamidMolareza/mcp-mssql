import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sql from "mssql";
import { z } from "zod";

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_@$#]*$/;
const WRITE_QUERY_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|create|merge|exec(?:ute)?|grant|revoke|deny)\b/i;
const READ_QUERY_PATTERN = /^(select|with)\b/i;

loadEnvFile(".env");

function loadEnvFile(fileName: string): void {
  const filePath = resolve(process.cwd(), fileName);

  if (!existsSync(filePath)) {
    return;
  }

  const fileContents = readFileSync(filePath, "utf8");

  for (const rawLine of fileContents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const value = line.slice(separatorIndex + 1).trim();
    process.env[key] = stripOptionalQuotes(value);
  }
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createPool() {
  return new sql.ConnectionPool({
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    server: requireEnv("DB_HOST"),
    database: requireEnv("DB_NAME"),
    options: {
      encrypt: false,
      trustServerCertificate: true
    }
  });
}

function quoteSqlIdentifier(identifier: string, label: string): string {
  const trimmed = identifier.trim();

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  if (trimmed.includes("\u0000")) {
    throw new Error(`${label} contains invalid characters.`);
  }

  return `[${trimmed.replaceAll("]", "]]")}]`;
}

function parseTableReference(
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
    segments.length === 2
      ? (segments[0] ?? "").trim()
      : (schema?.trim() || "dbo").trim();
  const tableName = segments.at(-1)?.trim() ?? "";

  if (!SQL_IDENTIFIER.test(schemaName) || !SQL_IDENTIFIER.test(tableName)) {
    throw new Error("Schema and table names must be simple SQL identifiers.");
  }

  return { schemaName, tableName };
}

function normalizeQuery(query: string): string {
  return query
    .replace(/--.*$/gmu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/^\s*;+/u, "")
    .trim();
}

function assertReadOnlyQuery(query: string): void {
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

function formatRecordset(recordset: unknown): string {
  return JSON.stringify(recordset, null, 2);
}

async function main(): Promise<void> {
  const pool = createPool();
  await pool.connect();

  const server = new McpServer(
    {
      name: "mssql-mcp-server",
      version: "1.2.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.registerTool(
    "list_databases",
    {
      description: "List databases available on the SQL Server instance.",
      annotations: {
        readOnlyHint: true
      }
    },
    async () => {
      const result = await pool.request().query(`
        SELECT
          name,
          database_id,
          create_date,
          compatibility_level,
          state_desc
        FROM sys.databases
        ORDER BY name
      `);

      return {
        content: [
          {
            type: "text",
            text: formatRecordset(result.recordset)
          }
        ]
      };
    }
  );

  server.registerTool(
    "list_tables",
    {
      description: "List base tables in the selected database, optionally filtered by schema.",
      inputSchema: {
        database: z.string().min(1).describe("Database name"),
        schema: z.string().min(1).optional().describe("Optional schema filter")
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ database, schema }) => {
      const databaseName = quoteSqlIdentifier(database, "Database name");
      const result = await pool
        .request()
        .input("schema", sql.NVarChar, schema?.trim() || null)
        .query(`
          SELECT
            TABLE_CATALOG,
            TABLE_SCHEMA,
            TABLE_NAME
          FROM ${databaseName}.INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE = 'BASE TABLE'
            AND (@schema IS NULL OR TABLE_SCHEMA = @schema)
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `);

      return {
        content: [
          {
            type: "text",
            text: formatRecordset({
              database: database.trim(),
              schema: schema?.trim() || null,
              tables: result.recordset
            })
          }
        ]
      };
    }
  );

  server.registerTool(
    "describe_table",
    {
      description: "Describe a table in a selected database.",
      inputSchema: {
        database: z.string().min(1).describe("Database name"),
        table: z.string().min(1).describe("Table name or schema-qualified table name"),
        schema: z.string().min(1).optional().describe("Optional schema when `table` is not qualified")
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ database, table, schema }) => {
      const databaseName = quoteSqlIdentifier(database, "Database name");
      const { schemaName, tableName } = parseTableReference(table, schema);
      const result = await pool
        .request()
        .input("schema", sql.NVarChar, schemaName)
        .input("table", sql.NVarChar, tableName)
        .query(`
          SELECT
            TABLE_CATALOG,
            TABLE_SCHEMA,
            TABLE_NAME,
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            CHARACTER_MAXIMUM_LENGTH,
            NUMERIC_PRECISION,
            NUMERIC_SCALE
          FROM ${databaseName}.INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @schema
            AND TABLE_NAME = @table
          ORDER BY ORDINAL_POSITION
        `);

      if (result.recordset.length === 0) {
        throw new Error(`Table not found: ${database.trim()}.${schemaName}.${tableName}`);
      }

      return {
        content: [
          {
            type: "text",
            text: formatRecordset({
              database: database.trim(),
              schema: schemaName,
              table: tableName,
              columns: result.recordset
            })
          }
        ]
      };
    }
  );

  server.registerTool(
    "query_sql",
    {
      description: "Run a read-only SQL query (SELECT/CTE only).",
      inputSchema: {
        sql: z.string().min(1).describe("Read-only SQL query")
      },
      annotations: {
        readOnlyHint: true
      }
    },
    async ({ sql: query }) => {
      assertReadOnlyQuery(query);

      const result = await pool.request().query(query);

      return {
        content: [
          {
            type: "text",
            text: formatRecordset(result.recordset)
          }
        ]
      };
    }
  );

  const shutdown = async (): Promise<void> => {
    await server.close().catch(() => undefined);
    await pool.close().catch(() => undefined);
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start mssql MCP server: ${message}`);
  process.exit(1);
});
