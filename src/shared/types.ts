export type LogLevel = "INFO" | "WARN" | "ERROR";

export type ConnectionTarget = {
  name: string;
  description: string;
  host: string;
  user: string;
  password: string;
  defaultDatabase: string;
  port?: number;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
  };
};

export type TargetConfigFile = {
  defaultTarget?: string | null;
  targets: ConnectionTarget[];
};

export type Logger = {
  logFilePath: string;
  write: (level: LogLevel, event: string, data?: Record<string, unknown>) => void;
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
};

export type JsonRecord = Record<string, unknown>;

export type ToolResponse = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

export type SqlQueryResult = {
  recordset: unknown[];
};

export type SqlRequest = {
  input: (name: string, type: unknown, value: unknown) => SqlRequest;
  query: (query: string) => Promise<SqlQueryResult>;
};

export type SqlPool = {
  connect: () => Promise<void>;
  close: () => Promise<void>;
  request: () => SqlRequest;
};

export type CreatePool = (target: ConnectionTarget) => SqlPool;

export type AuditedActionResult<T> = {
  response: T;
  audit?: JsonRecord;
};

export type ExecuteAudited = <T>(
  toolName: string,
  context: JsonRecord,
  action: () => Promise<AuditedActionResult<T>>
) => Promise<T>;

export type AppRuntime = {
  config: TargetConfigFile;
  logger: Logger;
  getTarget: (targetName?: string) => ConnectionTarget;
  getPool: (targetName?: string) => Promise<SqlPool>;
  executeAudited: ExecuteAudited;
  shutdown: () => Promise<void>;
};
