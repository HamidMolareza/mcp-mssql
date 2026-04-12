# Architecture

The server is now split into small, testable modules so the MCP contract can stay stable while the internals evolve.

## Layout

- `src/server.ts`: bootstrap, signal handling, and stdio transport wiring
- `src/app/`: runtime creation, pool lifecycle, and startup instructions
- `src/config/`: `.env` loading and target configuration parsing
- `src/logging/`: JSONL logger creation
- `src/sql/`: SQL identifier handling and read-only query validation
- `src/tools/`: one module per MCP tool plus registration wiring
- `src/shared/`: shared types and formatting helpers
- `tests/unit/`: focused tests for helpers, runtime behavior, and tool handlers

## Refactor guardrails

- keep MCP tool names, inputs, and JSON text outputs backward compatible
- validate read-only SQL before execution
- isolate `mssql` connection management behind the runtime layer
- prefer pure helper functions so they remain easy to test without a live SQL Server
