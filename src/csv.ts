// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";

import { parse } from "csv-parse";

import { makeFinding } from "./finding";
import { normalizeRelativePath, rejectSymlinkPath } from "./security";
import { AssetRow, AssetTreeConfig, ParsedFile } from "./types";

interface CsvRecordWithInfo {
  record: string[];
  info: {
    lines: number;
  };
}

function malformed(relativePath: string, sha256: string | null, message: string): ParsedFile {
  return {
    input: { path: relativePath, sha256, rows: 0 },
    assets: [],
    findings: [
      makeFinding({
        ruleId: "ATC000",
        severity: "error",
        message,
        suggestion: "Correct the CSV structure or column mapping, then run the check again.",
        file: relativePath,
        line: 1,
        field: "file",
      }),
    ],
    operationalErrors: 1,
  };
}

export async function parseCsvFile(workspace: string, relativePath: string, config: AssetTreeConfig): Promise<ParsedFile> {
  const normalizedPath = normalizeRelativePath(relativePath);
  const absolutePath = resolve(workspace, normalizedPath);
  await rejectSymlinkPath(workspace, absolutePath, "Input file path");
  const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return malformed(normalizedPath, null, "Input path is not a regular file.");
    if (stat.size > config.limits.maxBytesPerFile) {
      return malformed(normalizedPath, null, `File exceeds the configured ${config.limits.maxBytesPerFile}-byte limit.`);
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return malformed(normalizedPath, sha256, "File is not valid UTF-8 text.");
  }

  const assets: AssetRow[] = [];
  let headers: string[] | undefined;
  try {
    const parser = Readable.from([text]).pipe(parse({
      bom: true,
      columns: false,
      info: true,
      max_record_size: Math.min(config.limits.maxBytesPerFile, config.limits.maxColumns * config.limits.maxFieldLength),
      relax_column_count: false,
      skip_empty_lines: true,
    }));
    for await (const item of parser as AsyncIterable<CsvRecordWithInfo>) {
      if (!headers) {
        const rawHeaders = item.record;
        if (rawHeaders.length > config.limits.maxColumns) {
          return malformed(normalizedPath, sha256, `CSV has ${rawHeaders.length} columns; configured maximum is ${config.limits.maxColumns}.`);
        }
        if (
          rawHeaders.some(
            (value) => !value
              || value !== value.trim()
              || value.length > Math.min(256, config.limits.maxFieldLength)
              || /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(value)
              || /^(?:__proto__|prototype|constructor)$/i.test(value),
          )
        ) {
          return malformed(normalizedPath, sha256, "CSV headers must be trimmed, printable, safe names within the configured field limit.");
        }
        if (new Set(rawHeaders).size !== rawHeaders.length) {
          return malformed(normalizedPath, sha256, "CSV contains duplicate column headers.");
        }
        headers = rawHeaders;
        const required = [
          config.columns.id,
          config.columns.parent,
          config.columns.name,
          ...(config.rules.governance.mode === "off"
            ? []
            : [
                config.columns.identity,
                config.columns.evidence,
                config.columns.reviewStatus,
                config.columns.objectClass,
              ].filter((value): value is string => Boolean(value))),
        ];
        const missing = required.filter((name) => !headers?.includes(name));
        if (missing.length > 0) {
          return malformed(normalizedPath, sha256, `Required mapped columns are missing: ${missing.join(", ")}.`);
        }
        continue;
      }
      if (assets.length >= config.limits.maxRowsPerFile) {
        return malformed(normalizedPath, sha256, `CSV exceeds the configured maximum of ${config.limits.maxRowsPerFile} rows.`);
      }
      if (item.record.length !== headers.length) {
        return malformed(normalizedPath, sha256, `Row ending on line ${item.info.lines} has the wrong number of columns.`);
      }
      const cells = Object.create(null) as Record<string, string>;
      for (const [index, header] of headers.entries()) {
        const value = item.record[index] ?? "";
        if (value.length > config.limits.maxFieldLength) {
          return malformed(normalizedPath, sha256, `A field on line ${item.info.lines} exceeds the configured limit.`);
        }
        cells[header] = value;
      }
      assets.push({
        id: cells[config.columns.id] ?? "",
        parentId: cells[config.columns.parent] ?? "",
        name: cells[config.columns.name] ?? "",
        path: cells[config.columns.path] ?? "",
        levelText: cells[config.columns.level] ?? "",
        line: item.info.lines,
        cells,
      });
    }
  } catch {
    return malformed(normalizedPath, sha256, "CSV parsing failed. Review quoting, delimiters, and row widths.");
  }

  if (!headers) return malformed(normalizedPath, sha256, "CSV file is empty.");
  if (assets.length === 0) return malformed(normalizedPath, sha256, "CSV contains no asset rows.");

  return {
    input: { path: normalizedPath, sha256, rows: assets.length },
    assets,
    findings: [],
    operationalErrors: 0,
  };
}
