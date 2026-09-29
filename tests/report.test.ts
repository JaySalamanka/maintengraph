// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { makeFinding } from "../src/finding";
import { renderConsole, renderMarkdown } from "../src/report";
import { AssetTreeReport } from "../src/types";

function reportWithMessage(message: string): AssetTreeReport {
  return {
    schemaVersion: "1.1",
    tool: { name: "maintengraph", version: "test", ruleset: "asset-governance@test" },
    configSha256: "0".repeat(64),
    inputs: [{ path: "asset-data/test.csv", sha256: "1".repeat(64), rows: 1 }],
    gate: { mode: "all", failOn: "error" },
    comparison: {
      baseline: null,
      newFindings: { total: 1, errors: 1, warnings: 0, notices: 0 },
      resolvedFindings: { total: 0, errors: 0, warnings: 0, notices: 0 },
      unchangedFindings: { total: 0, errors: 0, warnings: 0, notices: 0 },
    },
    summary: { files: 1, rows: 1, score: 0, errors: 1, warnings: 0, notices: 0, passed: false, operationalErrors: 0 },
    findings: [
      makeFinding({
        ruleId: "ATC001",
        severity: "error",
        message,
        suggestion: "Correct the row.",
        file: "asset-data/test.csv",
        line: 2,
        field: "name",
      }),
    ],
  };
}

describe("Markdown reporter", () => {
  it("escapes table and HTML injection", () => {
    const markdown = renderMarkdown(reportWithMessage("bad | <script>alert(1)</script> [evil](https://evil.test)\nnext"));
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("](https://evil.test)");
    expect(markdown).toContain("&#124;");
    expect(markdown).toContain("&lt;script&gt;");
  });

  it("publishes a counts-only GitHub summary unless details are explicitly enabled", () => {
    const redacted = renderMarkdown(reportWithMessage("SENSITIVE-ROW-VALUE"), undefined, { includeFindings: false });
    expect(redacted).not.toContain("SENSITIVE-ROW-VALUE");
    expect(redacted).not.toContain("asset-data/test.csv");
    expect(redacted).toContain("were not published to GitHub");
  });

  it("publishes baseline counts without exposing the baseline path", () => {
    const report = reportWithMessage("SENSITIVE-ROW-VALUE");
    report.gate.mode = "new";
    report.comparison.baseline = {
      path: "private/customer-baseline.json",
      sha256: "2".repeat(64),
      schemaVersion: "1.1",
      toolVersion: "test",
      ruleset: "asset-governance@2",
    };
    report.comparison.unchangedFindings = { total: 1, errors: 1, warnings: 0, notices: 0 };
    report.comparison.newFindings = { total: 0, errors: 0, warnings: 0, notices: 0 };
    const redacted = renderMarkdown(report, undefined, { includeFindings: false });
    expect(redacted).toContain("0 new, 0 resolved, 1 unchanged");
    expect(redacted).not.toContain("private/customer-baseline.json");
  });

  it("rejects a non-HTTPS audit link", () => {
    expect(() => renderMarkdown(reportWithMessage("test"), "http://example.invalid/audit")).toThrow(/HTTPS/);
  });

  it("contains an approved audit URL inside an angle-bracket destination", () => {
    const markdown = renderMarkdown(reportWithMessage("test"), "https://example.invalid/audit?q=one)two");
    expect(markdown).toContain("](<https://example.invalid/audit?q=one%29two>)");
  });

  it("removes terminal escape and control sequences from console output", () => {
    const consoleText = renderConsole(reportWithMessage("\u001b[31mRED\u001b[0m\nnext"));
    expect(consoleText).not.toContain("\u001b");
    expect(consoleText).not.toContain("\nnext");
    expect(consoleText).toContain("RED next");
  });

  it("assigns distinct fingerprints to distinct variants on the same row", () => {
    const base = {
      ruleId: "ATC010",
      severity: "warning" as const,
      message: "Path mismatch.",
      suggestion: "Correct it.",
      file: "tree.csv",
      line: 2,
      field: "path",
    };
    expect(makeFinding({ ...base, fingerprintVariant: "path-tail" }).fingerprint).not.toBe(
      makeFinding({ ...base, fingerprintVariant: "parent-prefix" }).fingerprint,
    );
  });
});
