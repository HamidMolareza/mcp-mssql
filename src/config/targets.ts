import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { requireEnv, ensureNonEmpty } from "./env.js";
import type { ConnectionTarget, TargetConfigFile } from "../shared/types.js";

export const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_@$#]*$/;

export function loadTargets(): TargetConfigFile {
  const targetsFile = process.env.MSSQL_TARGETS_FILE?.trim();

  if (targetsFile) {
    const filePath = resolve(process.cwd(), targetsFile);

    if (!existsSync(filePath)) {
      throw new Error(`Targets file not found: ${filePath}`);
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<TargetConfigFile>;
    const targets = (parsed.targets ?? []).map(normalizeTarget);

    if (targets.length === 0) {
      throw new Error("Targets file must include at least one target.");
    }

    if (
      parsed.defaultTarget !== undefined &&
      parsed.defaultTarget !== null &&
      !targets.some((target) => target.name === parsed.defaultTarget)
    ) {
      throw new Error(`Unknown defaultTarget: ${parsed.defaultTarget}`);
    }

    return parsed.defaultTarget !== undefined
      ? {
          defaultTarget: parsed.defaultTarget,
          targets
        }
      : {
          targets
        };
  }

  return {
    defaultTarget: "default",
    targets: [
      normalizeTarget({
        name: "default",
        description:
          process.env.DB_DESCRIPTION?.trim() ||
          "Default SQL Server target loaded from DB_* environment variables.",
        host: requireEnv("DB_HOST"),
        user: requireEnv("DB_USER"),
        password: requireEnv("DB_PASSWORD"),
        defaultDatabase: requireEnv("DB_NAME")
      })
    ]
  };
}

export function normalizeTarget(input: Partial<ConnectionTarget>): ConnectionTarget {
  const name = ensureNonEmpty(input.name ?? "", "Target name");

  if (!SQL_IDENTIFIER.test(name)) {
    throw new Error(`Invalid target name: ${name}`);
  }

  const normalizedTarget: ConnectionTarget = {
    name,
    description: ensureNonEmpty(input.description ?? "", `Description for target ${name}`),
    host: ensureNonEmpty(input.host ?? "", `Host for target ${name}`),
    user: ensureNonEmpty(input.user ?? "", `User for target ${name}`),
    password: ensureNonEmpty(input.password ?? "", `Password for target ${name}`),
    defaultDatabase: ensureNonEmpty(
      input.defaultDatabase ?? "",
      `Default database for target ${name}`
    ),
    options: {
      encrypt: input.options?.encrypt ?? false,
      trustServerCertificate: input.options?.trustServerCertificate ?? true
    }
  };

  if (input.port !== undefined) {
    if (!Number.isInteger(input.port) || input.port <= 0) {
      throw new Error(`Invalid port for target ${name}`);
    }

    normalizedTarget.port = input.port;
  }

  return normalizedTarget;
}
