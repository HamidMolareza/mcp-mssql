import type { ConnectionTarget } from "../shared/types.js";

export function buildInstructions(
  targets: ConnectionTarget[],
  defaultTarget?: string | null
): string {
  const lines = [
    "Use the SQL Server tools with the `target` argument to choose the correct server.",
    "If the task does not specify a target, choose based on the descriptions below."
  ];

  for (const target of targets) {
    const defaultSuffix = target.name === defaultTarget ? " (default target)" : "";
    lines.push(
      `- ${target.name}${defaultSuffix}: ${target.description}. Host: ${target.host}. Default database: ${target.defaultDatabase}.`
    );
  }

  return lines.join("\n");
}
