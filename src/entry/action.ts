// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import * as core from "@actions/core";

import { parseGateMode } from "../baseline";
import { parseFailOn } from "../config";
import { renderMarkdown, sanitizePlainText } from "../report";
import { execute } from "../run";
import { Finding } from "../types";

function parseBooleanInput(name: string, fallback: boolean): boolean {
  const value = core.getInput(name).trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function parseAnnotationLimit(): number {
  const value = Number(core.getInput("max-annotations") || "50");
  if (!Number.isInteger(value) || value < 0 || value > 200) {
    throw new Error("max-annotations must be an integer from 0 to 200.");
  }
  return value;
}

function annotate(finding: Finding): void {
  const properties = {
    title: sanitizePlainText(`${finding.ruleId}: ${finding.field}`, 120),
    file: sanitizePlainText(finding.file, 1_024),
    startLine: Math.max(1, finding.line),
    endLine: Math.max(1, finding.line),
  };
  const message = sanitizePlainText(`${finding.message} ${finding.suggestion}`, 1_000);
  if (finding.severity === "error") core.error(message, properties);
  else if (finding.severity === "warning") core.warning(message, properties);
  else core.notice(message, properties);
}

async function main(): Promise<void> {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const configPath = core.getInput("config") || ".maintengraph.json";
  const patterns = core.getMultilineInput("files", { trimWhitespace: true }).filter(Boolean);
  const failOnInput = core.getInput("fail-on").trim();
  const baselinePath = core.getInput("baseline").trim();
  const gateMode = parseGateMode(core.getInput("gate-mode").trim());
  const publishDetails = parseBooleanInput("publish-details", false);
  const result = await execute({
    workspace,
    ...(patterns.length > 0 ? { patterns } : {}),
    configPath,
    configRequired: configPath !== ".maintengraph.json",
    outputDir: core.getInput("output-dir") || ".maintengraph",
    ...(failOnInput ? { failOn: parseFailOn(failOnInput) } : {}),
    ...(baselinePath ? { baselinePath } : {}),
    gateMode,
  });

  if (publishDetails) {
    const findings = result.report.gate.mode === "new"
      ? result.report.findings.filter((finding) => finding.baselineStatus === "new")
      : result.report.findings;
    for (const finding of findings.slice(0, parseAnnotationLimit())) annotate(finding);
  }
  await core.summary.addRaw(renderMarkdown(result.report, undefined, { includeFindings: publishDetails })).write();
  core.setOutput("passed", String(result.report.summary.passed));
  core.setOutput("score", String(result.report.summary.score));
  core.setOutput("error-count", String(result.report.summary.errors));
  core.setOutput("warning-count", String(result.report.summary.warnings));
  core.setOutput("new-count", String(result.report.comparison.newFindings.total));
  core.setOutput("resolved-count", String(result.report.comparison.resolvedFindings.total));
  core.setOutput("unchanged-count", String(result.report.comparison.unchangedFindings.total));
  core.setOutput("json-path", result.paths.json);
  core.setOutput("sarif-path", result.paths.sarif);
  core.setOutput("markdown-path", result.paths.markdown);

  if (result.exitCode !== 0) {
    core.setFailed(
      result.exitCode === 2
        ? "Asset hierarchy input or configuration is malformed. Review the generated summary."
        : "Asset hierarchy findings reached the configured failure severity.",
    );
  }
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
