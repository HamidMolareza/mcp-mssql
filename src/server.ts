import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sql from "mssql";
import { z } from "zod";

const pool = new sql.ConnectionPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST!,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
});

await pool.connect();

const server = new Server(
  {
    name: "mssql-mcp-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.tool(
  "list_tables",
  {},
  async () => {
    const result = await pool.request().query(`
      SELECT TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE='BASE TABLE'
    `);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.recordset, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "describe_table",
  {
    table: z.string()
  },
  async ({ table }) => {
    const result = await pool.request()
      .input("table", sql.NVarChar, table)
      .query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @table
      `);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.recordset, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "query_sql",
  {
    sql: z.string()
  },
  async ({ sql: query }) => {

    if (/drop|delete|truncate|alter/i.test(query)) {
      throw new Error("Dangerous query blocked.");
    }

    const result = await pool.request().query(query);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.recordset, null, 2)
        }
      ]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
