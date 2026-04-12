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
