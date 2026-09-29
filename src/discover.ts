// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { lstat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import fg from "fast-glob";

import { OperationalError } from "./errors";
import { normalizeRelativePath } from "./security";

function validatePattern(pattern: string): string {
  if (pattern !== pattern.trim() || pattern.length > 512 || /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(pattern)) {
    throw new OperationalError("File globs must be trimmed, printable, and at most 512 characters.");
  }
  const normalized = normalizeRelativePath(pattern.trim());
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new OperationalError("File globs must be non-empty and relative to the repository workspace.");
  }
  if (normalized.split("/").includes("..")) {
    throw new OperationalError(`File glob cannot contain '..': ${pattern}`);
  }
  if (/[{}()!:]/.test(normalized)) {
    throw new OperationalError("File globs cannot use brace expansion, extglobs, negation, or colon syntax.");
  }
  return normalized;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function discoverCsvFiles(workspace: string, patterns: string[], maxFiles: number): Promise<string[]> {
  const root = resolve(workspace);
  if (patterns.length === 0 || patterns.length > 100) {
    throw new OperationalError("Provide 1 to 100 CSV file globs.");
  }
  const validated = patterns.map(validatePattern);
  const matches = fg.stream(validated, {
    cwd: root,
    absolute: false,
    onlyFiles: true,
    unique: true,
    dot: false,
    followSymbolicLinks: false,
    suppressErrors: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/.maintengraph/**", "**/.hierarchyguard/**", "**/.assettree/**"],
  });
  const files: string[] = [];
  for await (const value of matches as AsyncIterable<string | Buffer>) {
    const match = typeof value === "string" ? value : value.toString("utf8");
    const normalized = normalizeRelativePath(match);
    if (normalized.length > 1_024 || /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(normalized)) {
      throw new OperationalError("A discovered file path contains unsupported characters or exceeds 1024 characters.");
    }
    if (extname(normalized).toLowerCase() !== ".csv") {
      throw new OperationalError(`V1 accepts CSV files only: ${normalized}`);
    }
    const absolute = resolve(root, normalized);
    const relation = relative(root, absolute);
    if (relation === ".." || relation.startsWith(`..${sep}`)) {
      throw new OperationalError(`Discovered file escapes the workspace: ${normalized}`);
    }
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new OperationalError(`Input file cannot be a symbolic link: ${normalized}`);
    }
    files.push(normalized);
    if (files.length > maxFiles) {
      throw new OperationalError(`Matched more than the configured maximum of ${maxFiles} files.`);
    }
  }
  if (files.length === 0) {
    throw new OperationalError(`No CSV files matched: ${validated.join(", ")}`);
  }
  return files.sort(compareText);
}
