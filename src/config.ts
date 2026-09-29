// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { OperationalError } from "./errors";
import { rejectSymlinkPath, resolveInside } from "./security";
import { AssetTreeConfig, ColumnConfig, DEFAULT_CONFIG, FailOn, GovernanceMode, RootPolicy } from "./types";

interface LoadedConfig {
  config: AssetTreeConfig;
  sha256: string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationalError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowed: readonly string[]): void {
  const approved = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !approved.has(key)).sort();
  if (unknown.length > 0) {
    throw new OperationalError(`${label} contains unknown ${unknown.length === 1 ? "property" : "properties"}: ${unknown.join(", ")}.`);
  }
}

function optionalString(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) {
    throw new OperationalError(`${label} must be a non-empty string.`);
  }
  return value;
}

function columnName(value: unknown, fallback: string, label: string): string {
  const parsed = optionalString(value, fallback, label);
  if (
    parsed !== parsed.trim()
    || parsed.length > 256
    || /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(parsed)
    || /^(?:__proto__|prototype|constructor)$/i.test(parsed)
  ) {
    throw new OperationalError(`${label} must be a trimmed column name of at most 256 printable characters.`);
  }
  return parsed;
}

function optionalColumnName(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return columnName(value, "", label);
}

function pathSeparator(value: unknown, fallback: string): string {
  const parsed = optionalString(value, fallback, "rules.pathSeparator");
  if (parsed.length > 16 || /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(parsed)) {
    throw new OperationalError("rules.pathSeparator must contain 1 to 16 printable characters.");
  }
  return parsed;
}

function optionalBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new OperationalError(`${label} must be true or false.`);
  return value;
}

function boundedInteger(value: unknown, fallback: number, label: string, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new OperationalError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

export function parseFailOn(value: unknown, fallback: FailOn = "error"): FailOn {
  if (value === undefined || value === "") return fallback;
  if (value === "error" || value === "warning" || value === "none") return value;
  throw new OperationalError("failOn must be error, warning, or none.");
}

function parseRootPolicy(value: unknown, fallback: RootPolicy): RootPolicy {
  if (value === undefined) return fallback;
  if (value === "any" || value === "one") return value;
  throw new OperationalError("rules.rootPolicy must be any or one.");
}

function parseGovernanceMode(value: unknown): GovernanceMode {
  if (value === undefined) return DEFAULT_CONFIG.rules.governance.mode;
  if (value === "off" || value === "review" || value === "release") return value;
  throw new OperationalError("rules.governance.mode must be off, review, or release.");
}

function parseConfig(raw: unknown): AssetTreeConfig {
  const root = objectValue(raw, "Configuration");
  rejectUnknownKeys(root, "Configuration", ["version", "files", "columns", "rules", "gate", "limits"]);
  if (root.version !== 1 && root.version !== 2) throw new OperationalError("Configuration version must be 1 or 2.");

  const files = root.files === undefined ? DEFAULT_CONFIG.files : root.files;
  if (
    !Array.isArray(files)
    || files.length === 0
    || files.length > 100
    || files.some(
      (item) => typeof item !== "string"
        || !item.trim()
        || item !== item.trim()
        || item.length > 512
        || /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(item),
    )
  ) {
    throw new OperationalError("files must contain 1 to 100 trimmed relative CSV globs of at most 512 printable characters.");
  }

  const columns = root.columns === undefined ? {} : objectValue(root.columns, "columns");
  const rules = root.rules === undefined ? {} : objectValue(root.rules, "rules");
  const gate = root.gate === undefined ? {} : objectValue(root.gate, "gate");
  const limits = root.limits === undefined ? {} : objectValue(root.limits, "limits");
  rejectUnknownKeys(
    columns,
    "columns",
    ["id", "parent", "name", "path", "level", "identity", "evidence", "reviewStatus", "objectClass", "legacyIds"],
  );
  rejectUnknownKeys(rules, "rules", ["rootPolicy", "maxDepth", "requireParentBeforeChild", "pathSeparator", "governance"]);
  rejectUnknownKeys(gate, "gate", ["failOn"]);
  rejectUnknownKeys(
    limits,
    "limits",
    ["maxFiles", "maxBytesPerFile", "maxRowsPerFile", "maxColumns", "maxFieldLength", "maxFindings"],
  );

  let maxDepth: number | null = DEFAULT_CONFIG.rules.maxDepth;
  if (rules.maxDepth !== undefined && rules.maxDepth !== null) {
    maxDepth = boundedInteger(rules.maxDepth, 1, "rules.maxDepth", 1, 100);
  }

  const parsedColumns: ColumnConfig = {
    id: columnName(columns.id, DEFAULT_CONFIG.columns.id, "columns.id"),
    parent: columnName(columns.parent, DEFAULT_CONFIG.columns.parent, "columns.parent"),
    name: columnName(columns.name, DEFAULT_CONFIG.columns.name, "columns.name"),
    path: columnName(columns.path, DEFAULT_CONFIG.columns.path, "columns.path"),
    level: columnName(columns.level, DEFAULT_CONFIG.columns.level, "columns.level"),
  };
  const optionalColumns = {
    identity: optionalColumnName(columns.identity, "columns.identity"),
    evidence: optionalColumnName(columns.evidence, "columns.evidence"),
    reviewStatus: optionalColumnName(columns.reviewStatus, "columns.reviewStatus"),
    objectClass: optionalColumnName(columns.objectClass, "columns.objectClass"),
    legacyIds: optionalColumnName(columns.legacyIds, "columns.legacyIds"),
  };
  for (const [key, value] of Object.entries(optionalColumns)) {
    if (value) parsedColumns[key as keyof typeof optionalColumns] = value;
  }
  if (new Set(Object.values(parsedColumns).filter((value): value is string => typeof value === "string")).size !== Object.keys(parsedColumns).length) {
    throw new OperationalError("Each configured logical column must map to a distinct CSV header.");
  }

  const governance = rules.governance === undefined ? {} : objectValue(rules.governance, "rules.governance");
  rejectUnknownKeys(
    governance,
    "rules.governance",
    ["mode", "evidenceSeparator", "legacyIdSeparator", "forbidGenericBuckets"],
  );
  const governanceMode = parseGovernanceMode(governance.mode);
  if (root.version === 1 && governanceMode !== "off") {
    throw new OperationalError("Governance modes require configuration version 2.");
  }
  if (governanceMode !== "off") {
    const missing = ["identity", "evidence", "reviewStatus", "objectClass"]
      .filter((key) => !(key in parsedColumns));
    if (missing.length > 0) {
      throw new OperationalError(`Governance mode requires columns.${missing.join(", columns.")}.`);
    }
  }

  return {
    version: root.version,
    files: files as string[],
    columns: parsedColumns,
    rules: {
      rootPolicy: parseRootPolicy(rules.rootPolicy, DEFAULT_CONFIG.rules.rootPolicy),
      maxDepth,
      requireParentBeforeChild: optionalBoolean(
        rules.requireParentBeforeChild,
        DEFAULT_CONFIG.rules.requireParentBeforeChild,
        "rules.requireParentBeforeChild",
      ),
      pathSeparator: pathSeparator(rules.pathSeparator, DEFAULT_CONFIG.rules.pathSeparator),
      governance: {
        mode: governanceMode,
        evidenceSeparator: pathSeparator(
          governance.evidenceSeparator,
          DEFAULT_CONFIG.rules.governance.evidenceSeparator,
        ),
        legacyIdSeparator: pathSeparator(
          governance.legacyIdSeparator,
          DEFAULT_CONFIG.rules.governance.legacyIdSeparator,
        ),
        forbidGenericBuckets: optionalBoolean(
          governance.forbidGenericBuckets,
          DEFAULT_CONFIG.rules.governance.forbidGenericBuckets,
          "rules.governance.forbidGenericBuckets",
        ),
      },
    },
    gate: {
      failOn: parseFailOn(gate.failOn, DEFAULT_CONFIG.gate.failOn),
    },
    limits: {
      maxFiles: boundedInteger(limits.maxFiles, DEFAULT_CONFIG.limits.maxFiles, "limits.maxFiles", 1, 100),
      maxBytesPerFile: boundedInteger(
        limits.maxBytesPerFile,
        DEFAULT_CONFIG.limits.maxBytesPerFile,
        "limits.maxBytesPerFile",
        1_024,
        5_000_000,
      ),
      maxRowsPerFile: boundedInteger(
        limits.maxRowsPerFile,
        DEFAULT_CONFIG.limits.maxRowsPerFile,
        "limits.maxRowsPerFile",
        1,
        50_000,
      ),
      maxColumns: boundedInteger(limits.maxColumns, DEFAULT_CONFIG.limits.maxColumns, "limits.maxColumns", 3, 100),
      maxFieldLength: boundedInteger(
        limits.maxFieldLength,
        DEFAULT_CONFIG.limits.maxFieldLength,
        "limits.maxFieldLength",
        16,
        10_000,
      ),
      maxFindings: boundedInteger(
        limits.maxFindings,
        DEFAULT_CONFIG.limits.maxFindings,
        "limits.maxFindings",
        1,
        10_000,
      ),
    },
  };
}

export async function loadConfig(
  workspace: string,
  relativePath = ".maintengraph.json",
  required = false,
): Promise<LoadedConfig> {
  const path = resolveInside(workspace, relativePath, "Configuration path");
  await rejectSymlinkPath(workspace, path, "Configuration path");
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !required) {
      const canonical = `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`;
      return {
        config: structuredClone(DEFAULT_CONFIG),
        sha256: createHash("sha256").update(canonical).digest("hex"),
      };
    }
    throw new OperationalError(`Unable to read configuration file: ${relativePath}`);
  }
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new OperationalError(`Configuration path is not a regular file: ${relativePath}`);
    if (stat.size > 65_536) throw new OperationalError(`Configuration file exceeds the 65536-byte limit: ${relativePath}`);
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new OperationalError(`Configuration is not valid UTF-8: ${relativePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new OperationalError(`Configuration is not valid JSON: ${relativePath}`);
  }
  return {
    config: parseConfig(parsed),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}
