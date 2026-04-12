# `mcp-mssql`

MCP server for Microsoft SQL Server, designed for Codex and other MCP clients.

It supports:

- multiple SQL Server targets with different hosts, users, and passwords
- target descriptions so the AI can choose the right server
- database discovery and table inspection
- read-only SQL querying
- JSONL audit/security/error logs written to a file

## Features

- `list_targets`: list configured SQL Server targets and their descriptions
- `list_databases(target?)`: list databases on a target
- `list_tables(target?, database, schema?)`: list tables in a database
- `describe_table(target?, database, table, schema?)`: inspect a table schema
- `query_sql(target?, sql)`: run read-only `SELECT` / `WITH` queries

## Requirements

- Node.js 18+
- Access to one or more SQL Server instances

## Install

```bash
npm install
npm run build
```

## Scripts

```bash
npm run dev
npm run build
npm run check
npm run test
npm run test:watch
npm run ci
```

`npm run check` type-checks both source files and tests.

## Project structure

```text
src/
  app/
  config/
  logging/
  shared/
  sql/
  tools/
  server.ts
tests/
  unit/
docs/
  architecture.md
```

See `docs/architecture.md` for the refactor boundaries and maintenance rules.

## Configuration

You can configure this server in two ways:

- multi-target mode via `mssql-targets.json`
- legacy single-target mode via `.env`

### Multi-target mode

Create a file like `mssql-targets.json`:

```json
{
  "defaultTarget": null,
  "targets": [
    {
      "name": "app",
      "description": "Primary application server. Use for users, orders, products, and subscriptions.",
      "host": "192.168.0.20",
      "user": "sa",
      "password": "replace-me",
      "defaultDatabase": "master",
      "options": {
        "encrypt": false,
        "trustServerCertificate": true
      }
    },
    {
      "name": "analytics",
      "description": "Reporting and BI server. Use for dashboards, ETL outputs, and historical metrics.",
      "host": "192.168.0.30",
      "user": "report_user",
      "password": "replace-me",
      "defaultDatabase": "master",
      "options": {
        "encrypt": false,
        "trustServerCertificate": true
      }
    }
  ]
}
```

Notes:

- `defaultTarget` can be a target name, `null`, or omitted
- if `defaultTarget` is `null` and you have multiple targets, the caller must pass `target`
- the `description` field is important because the AI uses it to decide which target to use

### Legacy single-target mode

If you do not use `MSSQL_TARGETS_FILE`, the server falls back to `.env`:

```env
DB_HOST=localhost
DB_NAME=master
DB_USER=sa
DB_PASSWORD=your-password
DB_DESCRIPTION=Primary SQL Server target for application data
MSSQL_MCP_LOG_FILE=./logs/mssql-mcp.log.jsonl
```

You can copy from `.env.sample` as a starting point.

## Logging

Logs are written in JSON Lines format.

Default path:

```env
MSSQL_MCP_LOG_FILE=./logs/mssql-mcp.log.jsonl
```

Logged events include:

- server startup and shutdown
- database connection attempts
- tool start, success, and failure
- blocked unsafe SQL queries
- startup and runtime errors

`query_sql` logs:

- a SHA-256 hash of the normalized query
- a short query preview

This helps with audit and debugging without dumping full SQL into logs.

## Testing strategy

The test suite currently focuses on:

- pure helpers for env parsing, target normalization, SQL validation, and formatting
- runtime behavior for target selection and pool caching
- tool handlers with mocked `mssql` pools so refactors do not change MCP responses by accident

Run locally with:

```bash
npm run check
npm run test
npm run build
```

Or run everything with:

```bash
npm run ci
```

## Running locally

```bash
npm run build
node dist/server.js
```

Or in dev mode:

```bash
npm run dev
```

## Codex MCP configuration

Codex reads MCP server definitions from:

```text
~/.codex/config.toml
```

### Recommended Codex config

If your project lives at `/home/home/my-files/projects/mcp-mssql`, add this:

```toml
[mcp_servers.mssql]
command = "node"
args = ["/home/home/my-files/projects/mcp-mssql/dist/server.js"]
startup_timeout_ms = 20_000
env = { MSSQL_TARGETS_FILE = "/home/home/my-files/projects/mcp-mssql/mssql-targets.json", MSSQL_MCP_LOG_FILE = "/home/home/my-files/projects/mcp-mssql/logs/mssql-mcp.log.jsonl" }
```

Then build the project:

```bash
cd /home/home/my-files/projects/mcp-mssql
npm run build
```

You can verify it in Codex with:

```bash
codex mcp list
```

### Using the Codex CLI to add it automatically

Instead of editing `config.toml` manually, you can run:

```bash
codex mcp add mssql \
  --env MSSQL_TARGETS_FILE=/home/home/my-files/projects/mcp-mssql/mssql-targets.json \
  --env MSSQL_MCP_LOG_FILE=/home/home/my-files/projects/mcp-mssql/logs/mssql-mcp.log.jsonl \
  -- node /home/home/my-files/projects/mcp-mssql/dist/server.js
```

## How the AI chooses a target

The server exposes target descriptions through:

- the `list_targets` tool
- MCP server instructions sent at startup

Write target descriptions like this:

- good: `Use for payroll, employee attendance, leave requests, and HR reporting.`
- weak: `Another server.`

The clearer the description, the better the model can choose the right target automatically.

## Example tool usage

List targets:

```json
{}
```

List databases on a target:

```json
{
  "target": "app"
}
```

List tables in a specific database:

```json
{
  "target": "app",
  "database": "MyDatabase",
  "schema": "dbo"
}
```

Describe a table:

```json
{
  "target": "analytics",
  "database": "Warehouse",
  "table": "dbo.FactSales"
}
```

Run a read-only query:

```json
{
  "target": "app",
  "sql": "SELECT TOP 10 * FROM [MyDatabase].dbo.Users"
}
```

## Security notes

- only read-only SQL is allowed in `query_sql`
- `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `MERGE`, `EXEC`, and similar statements are blocked
- database names are safely quoted before dynamic metadata queries are built

## Files

- `src/server.ts`: bootstrap entrypoint
- `src/app/runtime.ts`: target resolution and pool lifecycle
- `src/tools/`: MCP tool handlers and registration
- `tests/unit/`: regression-focused unit tests
- `.env.sample`: sample legacy single-target config
- `mssql-targets.sample.json`: sample multi-target config
