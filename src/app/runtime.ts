import sql from "mssql";
import { summarizeError } from "../shared/format.js";
import type { AppRuntime, ConnectionTarget, CreatePool, Logger, SqlPool, TargetConfigFile } from "../shared/types.js";

export function createSqlPool(target: ConnectionTarget): SqlPool {
  return new sql.ConnectionPool({
    user: target.user,
    password: target.password,
    server: target.host,
    port: target.port,
    database: target.defaultDatabase,
    options: {
      encrypt: target.options?.encrypt ?? false,
      trustServerCertificate: target.options?.trustServerCertificate ?? true
    }
  }) as SqlPool;
}

export function createAppRuntime(
  config: TargetConfigFile,
  logger: Logger,
  poolFactory: CreatePool = createSqlPool
): AppRuntime {
  const targetMap = new Map(config.targets.map((target) => [target.name, target]));
  const poolCache = new Map<string, Promise<SqlPool>>();

  const getTarget = (targetName?: string): ConnectionTarget => {
    const normalizedTargetName = targetName?.trim();

    if (normalizedTargetName) {
      const target = targetMap.get(normalizedTargetName);

      if (!target) {
        throw new Error(`Unknown target: ${normalizedTargetName}`);
      }

      return target;
    }

    if (config.defaultTarget) {
      const defaultTarget = targetMap.get(config.defaultTarget);

      if (defaultTarget) {
        return defaultTarget;
      }
    }

    if (config.targets.length === 1) {
      return config.targets[0]!;
    }

    throw new Error("Multiple targets are configured. Specify the `target` argument.");
  };

  const getPool = async (targetName?: string): Promise<SqlPool> => {
    const target = getTarget(targetName);
    const existing = poolCache.get(target.name);

    if (existing) {
      return existing;
    }

    logger.info("db.connecting", {
      target: target.name,
      host: target.host,
      port: target.port ?? 1433,
      defaultDatabase: target.defaultDatabase
    });

    const poolPromise = Promise.resolve(poolFactory(target))
      .then(async (pool) => {
        await pool.connect();
        logger.info("db.connected", {
          target: target.name,
          host: target.host,
          port: target.port ?? 1433,
          defaultDatabase: target.defaultDatabase
        });
        return pool;
      })
      .catch((error) => {
        poolCache.delete(target.name);
        logger.error("db.connection_failed", {
          target: target.name,
          host: target.host,
          port: target.port ?? 1433,
          defaultDatabase: target.defaultDatabase,
          error: summarizeError(error)
        });
        throw error;
      });

    poolCache.set(target.name, poolPromise);
    return poolPromise;
  };

  const executeAudited = async <T>(
    toolName: string,
    context: Record<string, unknown>,
    action: () => Promise<{ response: T; audit?: Record<string, unknown> }>
  ): Promise<T> => {
    const startedAt = Date.now();
    logger.info("tool.started", { tool: toolName, ...context });

    try {
      const { response, audit } = await action();
      logger.info("tool.succeeded", {
        tool: toolName,
        durationMs: Date.now() - startedAt,
        ...context,
        ...audit
      });
      return response;
    } catch (error) {
      logger.error("tool.failed", {
        tool: toolName,
        durationMs: Date.now() - startedAt,
        ...context,
        error: summarizeError(error)
      });
      throw error;
    }
  };

  const shutdown = async (): Promise<void> => {
    logger.info("server.shutdown_started");
    await Promise.all(
      [...poolCache.values()].map(async (poolPromise) =>
        poolPromise.then((pool) => pool.close()).catch(() => undefined)
      )
    );
    logger.info("server.shutdown_completed");
  };

  return {
    config,
    logger,
    getTarget,
    getPool,
    executeAudited,
    shutdown
  };
}
