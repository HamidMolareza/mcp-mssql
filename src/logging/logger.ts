import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger, LogLevel } from "../shared/types.js";

export function createLogger(logFilePath: string): Logger {
  const resolvedPath = resolve(process.cwd(), logFilePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const write = (level: LogLevel, event: string, data: Record<string, unknown> = {}) => {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data
    });

    try {
      appendFileSync(resolvedPath, `${entry}\n`, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to write log entry: ${message}`);
    }
  };

  return {
    logFilePath: resolvedPath,
    write,
    info: (event, data) => write("INFO", event, data),
    warn: (event, data) => write("WARN", event, data),
    error: (event, data) => write("ERROR", event, data)
  };
}
