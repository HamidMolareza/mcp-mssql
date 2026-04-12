import assert from "node:assert/strict";
import type { AppRuntime, ConnectionTarget, Logger, SqlPool, SqlRequest } from "../../../src/shared/types.js";

export function createMockLogger(): Logger {
  return {
    logFilePath: "/tmp/mock.log",
    write: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}

export function createMockRuntime(overrides: Partial<AppRuntime> = {}): AppRuntime {
  const defaultTarget: ConnectionTarget = {
    name: "app",
    description: "Application data",
    host: "localhost",
    user: "sa",
    password: "secret",
    defaultDatabase: "master"
  };

  return {
    config: {
      defaultTarget: defaultTarget.name,
      targets: [defaultTarget]
    },
    logger: createMockLogger(),
    getTarget: () => defaultTarget,
    getPool: async () => {
      throw new Error("getPool override is required");
    },
    executeAudited: async (_toolName, _context, action) => {
      const { response } = await action();
      return response;
    },
    shutdown: async () => undefined,
    ...overrides
  };
}

export function createMockPool(rows: unknown[], requestHook?: (query: string) => void): SqlPool {
  const request: SqlRequest = {
    input: () => request,
    query: async (query) => {
      requestHook?.(query);
      return { recordset: rows };
    }
  };

  return {
    connect: async () => undefined,
    close: async () => undefined,
    request: () => request
  };
}

export function readTextContent(response: { content: Array<{ type: string; text: string }> }): unknown {
  assert.equal(response.content.length, 1);
  return JSON.parse(response.content[0]!.text);
}
