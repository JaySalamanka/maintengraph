// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { createHash, randomUUID } from "node:crypto";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { compareWithBaseline, loadBaseline, parseGateMode } from "./baseline";
import { loadConfig } from "./config";
import { parseCsvFile } from "./csv";
import { discoverCsvFiles } from "./discover";
import { buildReport, sortFindings, validateParsedFile } from "./engine";
import { OperationalError } from "./errors";
import { renderJson, renderMarkdown, renderSarif } from "./report";
import { createContainedDirectory, normalizeRelativePath, rejectSymlink } from "./security";
import { AssetTreeConfig, ExecuteOptions, ExecuteResult, Finding, ParsedFile } from "./types";

function configHash(config: AssetTreeConfig): string {
  return createHash("sha256").update(`${JSON.stringify(config, null, 2)}\n`).digest("hex");
}

async function writePrivateReport(path: string, contents: string, label: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rejectSymlink(path, `${label} report`);
    try {
      await rename(temporary, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM") throw error;
      await rejectSymlink(path, `${label} report`);
      await rm(path, { force: true });
      await rename(temporary, path);
    }
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function execute(options: ExecuteOptions): Promise<ExecuteResult> {
  const workspace = resolve(options.workspace);
  const gateMode = parseGateMode(options.gateMode);
  if (gateMode === "new" && !options.baselinePath) {
    throw new OperationalError("gate-mode new requires a baseline result path.");
  }
  const baseline = options.baselinePath ? await loadBaseline(workspace, options.baselinePath) : undefined;
  const loaded = await loadConfig(workspace, options.configPath ?? ".maintengraph.json", options.configRequired ?? false);
  const config: AssetTreeConfig = structuredClone(loaded.config);
  if (options.patterns && options.patterns.length > 0) config.files = [...options.patterns];
  if (options.failOn) config.gate.failOn = options.failOn;

  const files = await discoverCsvFiles(workspace, config.files, config.limits.maxFiles);
  const parsed: ParsedFile[] = [];
  let retainedFindings: Finding[] = [];
  for (const file of files) {
    const validated = validateParsedFile(await parseCsvFile(workspace, file, config), config);
    retainedFindings = sortFindings([...retainedFindings, ...validated.findings]).slice(0, config.limits.maxFindings);
    parsed.push({ ...validated, findings: [] });
  }
  const initialReport = buildReport(parsed, configHash(config), config, retainedFindings);
  const report = baseline ? compareWithBaseline(initialReport, baseline, gateMode) : initialReport;
  const markdown = renderMarkdown(report, options.auditUrl);
  const outputDirectory = await createContainedDirectory(workspace, options.outputDir ?? ".maintengraph");
  const absolutePaths = {
    json: resolve(outputDirectory, "results.json"),
    sarif: resolve(outputDirectory, "results.sarif"),
    markdown: resolve(outputDirectory, "summary.md"),
  };
  if (baseline) {
    const baselinePath = resolve(workspace, baseline.descriptor.path);
    const conflict = Object.entries(absolutePaths).find(([, reportPath]) => relative(baselinePath, reportPath) === "");
    if (conflict) {
      throw new OperationalError(`Baseline result path cannot also be the generated ${conflict[0]} report path.`);
    }
  }
  await writePrivateReport(absolutePaths.json, renderJson(report), "JSON");
  await writePrivateReport(absolutePaths.sarif, renderSarif(report), "SARIF");
  await writePrivateReport(absolutePaths.markdown, markdown, "Markdown");

  const paths = {
    json: normalizeRelativePath(relative(workspace, absolutePaths.json)),
    sarif: normalizeRelativePath(relative(workspace, absolutePaths.sarif)),
    markdown: normalizeRelativePath(relative(workspace, absolutePaths.markdown)),
  };
  const exitCode: 0 | 1 | 2 = report.summary.operationalErrors > 0 ? 2 : report.summary.passed ? 0 : 1;
  return { report, markdown, paths, exitCode };
}
