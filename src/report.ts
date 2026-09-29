// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { AssetTreeReport, Finding } from "./types";

const RULES: Readonly<Record<string, { name: string; description: string }>> = {
  ATC000: { name: "Malformed input", description: "The file cannot be safely parsed with the configured CSV contract." },
  ATC001: { name: "Required value", description: "A universally required hierarchy value is missing." },
  ATC002: { name: "Unique asset ID", description: "Asset IDs must remain unique under exact and case-insensitive comparison." },
  ATC003: { name: "Parent exists", description: "Every non-root parent reference must resolve in the checked file." },
  ATC004: { name: "No self-parent", description: "An asset cannot directly reference itself as parent." },
  ATC005: { name: "Acyclic hierarchy", description: "Parent relationships must not create a cycle." },
  ATC006: { name: "Root policy", description: "The root count must match the explicit configuration." },
  ATC007: { name: "Parent ordering", description: "Import-oriented flat files should place a parent before its children." },
  ATC008: { name: "Configured depth", description: "Computed graph depth must not exceed an explicit configured maximum." },
  ATC009: { name: "Declared level", description: "An optional declared level should match computed graph depth." },
  ATC010: { name: "Path consistency", description: "An optional path should extend the parent path and end with the row name." },
  ATC011: { name: "Distinct sibling name", description: "Sibling names should be distinguishable under the same parent." },
  ATC012: { name: "Boundary whitespace", description: "Values should not contain unintended leading or trailing whitespace." },
  ATC013: { name: "Control character", description: "Values should not contain non-printing control characters." },
  ATC014: { name: "Formula-safe value", description: "Cells should remain inert when opened in spreadsheet software." },
  ATC999: { name: "Finding limit", description: "The configured finding limit truncated the report." },
};

export function sanitizePlainText(value: string, maximum = 1_000): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function markdownCell(value: string): string {
  return sanitizePlainText(value, 300)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replace(/[\\`*_[\]{}()!:@]/g, (character) => `&#${character.codePointAt(0)};`)
    .replace(/\bwww\./gi, (value) => `${value.slice(0, -1)}&#46;`);
}

function safeAuditUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("audit-url must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("audit-url must use HTTPS and cannot contain credentials.");
  }
  return url.toString();
}

function markdownLinkDestination(value: string): string {
  return `<${value.replaceAll("(", "%28").replaceAll(")", "%29")}>`;
}

function publicFinding(finding: Finding): Record<string, unknown> {
  return {
    fingerprint: finding.fingerprint,
    baseline_status: finding.baselineStatus,
    rule_id: finding.ruleId,
    severity: finding.severity,
    ...(finding.assetId ? { asset_id: finding.assetId } : {}),
    field: finding.field,
    message: finding.message,
    suggestion: finding.suggestion,
    location: {
      path: finding.file,
      line: finding.line,
    },
  };
}

function diagnosticFindings(report: AssetTreeReport): Finding[] {
  if (report.gate.mode !== "new" || !report.comparison.baseline) return report.findings;
  return [
    ...report.findings.filter((finding) => finding.baselineStatus === "new"),
    ...report.findings.filter((finding) => finding.baselineStatus === "unchanged"),
  ];
}

export function renderJson(report: AssetTreeReport): string {
  const value = {
    schema_version: report.schemaVersion,
    tool: report.tool,
    config_sha256: report.configSha256,
    inputs: report.inputs,
    gate: {
      mode: report.gate.mode,
      fail_on: report.gate.failOn,
    },
    comparison: {
      baseline: report.comparison.baseline
        ? {
            path: report.comparison.baseline.path,
            sha256: report.comparison.baseline.sha256,
            schema_version: report.comparison.baseline.schemaVersion,
            tool_version: report.comparison.baseline.toolVersion,
            ruleset: report.comparison.baseline.ruleset,
          }
        : null,
      new_findings: report.comparison.newFindings,
      resolved_findings: report.comparison.resolvedFindings,
      unchanged_findings: report.comparison.unchangedFindings,
    },
    summary: {
      files: report.summary.files,
      rows: report.summary.rows,
      score: report.summary.score,
      errors: report.summary.errors,
      warnings: report.summary.warnings,
      notices: report.summary.notices,
      passed: report.summary.passed,
      operational_errors: report.summary.operationalErrors,
    },
    findings: report.findings.map(publicFinding),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function renderMarkdown(
  report: AssetTreeReport,
  auditUrl?: string,
  options: { includeFindings?: boolean } = {},
): string {
  const status = report.summary.passed ? "PASS" : "FAIL";
  const includeFindings = options.includeFindings ?? true;
  const lines = [
    `# MaintenGraph — ${status}`,
    "",
    `**Score:** ${report.summary.score}/100  `,
    `**Rows:** ${report.summary.rows} across ${report.summary.files} file(s)  `,
    `**Findings:** ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.notices} notice(s)`,
    `**Gate:** ${report.gate.mode === "new" ? "new findings only" : "all findings"}; fail on ${report.gate.failOn}`,
    "",
    "The score is a generic structural signal, not target-CMMS certification or an import guarantee.",
  ];

  if (report.comparison.baseline) {
    lines.push(
      "",
      `**Baseline delta:** ${report.comparison.newFindings.total} new, ${report.comparison.resolvedFindings.total} resolved, ${report.comparison.unchangedFindings.total} unchanged finding(s).`,
    );
  }

  const orderedFindings = diagnosticFindings(report);
  if (orderedFindings.length > 0 && includeFindings) {
    lines.push("", "## Highest-priority findings", "");
    if (report.comparison.baseline) {
      lines.push("| Baseline status | Severity | Rule | File:line | Field | Finding |", "|---|---|---|---|---|---|");
    } else {
      lines.push("| Severity | Rule | File:line | Field | Finding |", "|---|---|---|---|---|");
    }
    for (const finding of orderedFindings.slice(0, 50)) {
      lines.push(
        report.comparison.baseline
          ? `| ${finding.baselineStatus.toUpperCase()} | ${finding.severity.toUpperCase()} | ${finding.ruleId} | ${markdownCell(`${finding.file}:${finding.line}`)} | ${markdownCell(finding.field)} | ${markdownCell(finding.message)} |`
          : `| ${finding.severity.toUpperCase()} | ${finding.ruleId} | ${markdownCell(`${finding.file}:${finding.line}`)} | ${markdownCell(finding.field)} | ${markdownCell(finding.message)} |`,
      );
    }
    if (orderedFindings.length > 50) lines.push("", `${orderedFindings.length - 50} more finding(s) are available in the JSON report.`);
  } else if (orderedFindings.length === 0) {
    lines.push("", "Hierarchy structure passed the configured generic checks.");
  } else {
    lines.push(
      "",
      "Detailed paths and finding messages were not published to GitHub. They remain in the generated local report files.",
    );
  }

  const approvedUrl = safeAuditUrl(auditUrl);
  if (approvedUrl) {
    lines.push(
      "",
      "## Need a human-reviewed correction plan?",
      "",
      `[Request a fixed-scope Hierarchy Health Audit](${markdownLinkDestination(approvedUrl)}) for engineering review, prioritized corrections, and delivery guidance. Do not send confidential files until secure intake terms are confirmed.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderConsole(report: AssetTreeReport): string {
  const lines = [
    `MaintenGraph: ${report.summary.passed ? "PASS" : "FAIL"}`,
    `Score ${report.summary.score}/100 | ${report.summary.rows} rows | ${report.summary.errors} errors | ${report.summary.warnings} warnings`,
    `Gate ${report.gate.mode}/${report.gate.failOn}`,
  ];
  if (report.comparison.baseline) {
    lines.push(
      `Baseline ${report.comparison.newFindings.total} new | ${report.comparison.resolvedFindings.total} resolved | ${report.comparison.unchangedFindings.total} unchanged`,
    );
  }
  const orderedFindings = diagnosticFindings(report);
  for (const finding of orderedFindings.slice(0, 5)) {
    lines.push(
      sanitizePlainText(
        `${report.comparison.baseline ? `${finding.baselineStatus.toUpperCase()} ` : ""}${finding.severity.toUpperCase()} ${finding.ruleId} ${finding.file}:${finding.line} ${finding.message}`,
        1_200,
      ),
    );
  }
  if (orderedFindings.length > 5) lines.push(`... ${orderedFindings.length - 5} more finding(s) in the generated reports.`);
  return lines.join("\n");
}

export function renderSarif(report: AssetTreeReport): string {
  const usedRuleIds = [...new Set(report.findings.map((finding) => finding.ruleId))].sort();
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            informationUri: "https://github.com/JaySalamanka/maintengraph",
            rules: usedRuleIds.map((ruleId) => ({
              id: ruleId,
              name: RULES[ruleId]?.name ?? ruleId,
              shortDescription: { text: RULES[ruleId]?.description ?? "Asset hierarchy finding." },
              help: { text: RULES[ruleId]?.description ?? "Review the reported asset hierarchy finding." },
            })),
          },
        },
        results: report.findings.map((finding) => ({
          ruleId: finding.ruleId,
          baselineState: finding.baselineStatus,
          level: finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "note",
          message: { text: `${finding.message} ${finding.suggestion}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file.split("/").map(encodeURIComponent).join("/") },
                region: { startLine: Math.max(1, finding.line) },
              },
            },
          ],
          partialFingerprints: { primaryLocationLineHash: finding.fingerprint },
        })),
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
