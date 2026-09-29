// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BASELINE_MAX_BYTES } from "../src/baseline";
import { execute } from "../src/run";
import { GateMode } from "../src/types";

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hierarchyguard-baseline-test-"));
  temporaryDirectories.push(root);
  await writeFile(
    resolve(root, "config.json"),
    `${JSON.stringify({ version: 1, files: ["tree.csv"], gate: { failOn: "warning" } })}\n`,
    "utf8",
  );
  return root;
}

async function run(
  root: string,
  outputDir: string,
  options: { baselinePath?: string; gateMode?: GateMode } = {},
) {
  return execute({
    workspace: root,
    patterns: ["tree.csv"],
    configPath: "config.json",
    configRequired: true,
    outputDir,
    ...options,
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("baseline regression gating", () => {
  it("preserves strict gating by default and permits unchanged findings in new-only mode", async () => {
    const root = await workspace();
    await writeFile(root + "/tree.csv", "asset_id,parent_asset_id,name\nROOT,,Root\nA,ROOT,Asset A \n", "utf8");

    const baseline = await run(root, "baseline");
    expect(baseline.exitCode).toBe(1);
    expect(baseline.report.gate).toEqual({ mode: "all", failOn: "warning" });
    expect(baseline.report.comparison).toMatchObject({
      baseline: null,
      newFindings: { total: 1 },
      resolvedFindings: { total: 0 },
      unchangedFindings: { total: 0 },
    });

    const newOnly = await run(root, "new-only", {
      baselinePath: baseline.paths.json,
      gateMode: "new",
    });
    expect(newOnly.exitCode).toBe(0);
    expect(newOnly.report.summary).toMatchObject({ passed: true, warnings: 1 });
    expect(newOnly.report.comparison).toMatchObject({
      newFindings: { total: 0 },
      resolvedFindings: { total: 0 },
      unchangedFindings: { total: 1, warnings: 1 },
    });

    const strict = await run(root, "strict", { baselinePath: baseline.paths.json });
    expect(strict.exitCode).toBe(1);
    expect(strict.report.summary.passed).toBe(false);
    expect(strict.report.comparison.unchangedFindings.total).toBe(1);
  });

  it("reports deterministic new, resolved, and unchanged fingerprint counts", async () => {
    const root = await workspace();
    await writeFile(
      resolve(root, "tree.csv"),
      "asset_id,parent_asset_id,name\nROOT,,Root\nA,ROOT,Asset A \nB,ROOT,Asset B \n",
      "utf8",
    );
    const baseline = await run(root, "baseline");

    await writeFile(
      resolve(root, "tree.csv"),
      "asset_id,parent_asset_id,name\nROOT,,Root\nA,ROOT,Asset A\nB,ROOT,Asset B \nC,ROOT,Asset C \n",
      "utf8",
    );
    const result = await run(root, "current", { baselinePath: baseline.paths.json, gateMode: "new" });

    expect(result.exitCode).toBe(1);
    expect(result.report.comparison).toMatchObject({
      newFindings: { total: 1, warnings: 1 },
      resolvedFindings: { total: 1, warnings: 1 },
      unchangedFindings: { total: 1, warnings: 1 },
    });
    expect(result.report.findings.map((finding) => finding.baselineStatus)).toEqual(["unchanged", "new"]);
    expect(result.markdown.indexOf("| NEW |")).toBeLessThan(result.markdown.indexOf("| UNCHANGED |"));
    const json = JSON.parse(await readFile(resolve(root, result.paths.json), "utf8"));
    expect(json).toMatchObject({
      schema_version: "1.1",
      gate: { mode: "new", fail_on: "warning" },
      comparison: {
        new_findings: { total: 1 },
        resolved_findings: { total: 1 },
        unchanged_findings: { total: 1 },
      },
    });
    expect(json.findings.map((finding: { baseline_status: string }) => finding.baseline_status)).toEqual([
      "unchanged",
      "new",
    ]);
  });

  it("accepts a complete legacy 1.0 result", async () => {
    const root = await workspace();
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,Root\nA,ROOT,Asset A \n", "utf8");
    const generated = await run(root, "generated");
    const legacy = JSON.parse(await readFile(resolve(root, generated.paths.json), "utf8"));
    legacy.schema_version = "1.0";
    delete legacy.gate;
    delete legacy.comparison;
    legacy.findings[0].fingerprint = generated.report.findings[0]?.legacyFingerprintV1;
    await writeFile(resolve(root, "legacy.json"), `${JSON.stringify(legacy)}\n`, "utf8");

    const result = await run(root, "current", { baselinePath: "legacy.json", gateMode: "new" });
    expect(result.exitCode).toBe(0);
    expect(result.report.comparison.baseline).toMatchObject({ schemaVersion: "1.0" });
    expect(result.report.comparison.unchangedFindings.total).toBe(1);
  });

  it("requires the MaintenGraph tool and matching governance ruleset", async () => {
    const root = await workspace();
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,Root\n", "utf8");
    const generated = await run(root, "generated");
    const baseline = JSON.parse(await readFile(resolve(root, generated.paths.json), "utf8"));

    baseline.tool.name = "another-tool";
    await writeFile(resolve(root, "wrong-tool.json"), `${JSON.stringify(baseline)}\n`, "utf8");
    await expect(run(root, "wrong-tool", { baselinePath: "wrong-tool.json" })).rejects.toThrow(/tool.name/);

    baseline.tool.name = "maintengraph";
    baseline.tool.ruleset = "asset-governance@3";
    await writeFile(resolve(root, "wrong-ruleset.json"), `${JSON.stringify(baseline)}\n`, "utf8");
    await expect(run(root, "wrong-ruleset", { baselinePath: "wrong-ruleset.json" })).rejects.toThrow(/ruleset/);
  });

  it("treats a persisted fingerprint with increased severity as new", async () => {
    const root = await workspace();
    await writeFile(
      resolve(root, "config.json"),
      `${JSON.stringify({ version: 1, files: ["tree.csv"], gate: { failOn: "error" } })}\n`,
      "utf8",
    );
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,\n", "utf8");
    const generated = await run(root, "generated");
    const baseline = JSON.parse(await readFile(resolve(root, generated.paths.json), "utf8"));
    expect(baseline.findings).toHaveLength(1);
    expect(baseline.findings[0].severity).toBe("error");
    baseline.findings[0].severity = "warning";
    baseline.summary.errors = 0;
    baseline.summary.warnings = 1;
    await writeFile(resolve(root, "warning-baseline.json"), `${JSON.stringify(baseline)}\n`, "utf8");

    const result = await run(root, "current", { baselinePath: "warning-baseline.json", gateMode: "new" });
    expect(result.exitCode).toBe(1);
    expect(result.report.comparison).toMatchObject({
      newFindings: { total: 1, errors: 1 },
      resolvedFindings: { total: 0 },
      unchangedFindings: { total: 0 },
    });
  });

  it("keeps a finding unchanged when unrelated row insertion changes its physical line", async () => {
    const root = await workspace();
    await writeFile(
      resolve(root, "tree.csv"),
      "asset_id,parent_asset_id,name\nROOT,,Root\nA,ROOT,Asset A \nB,ROOT,Asset B\n",
      "utf8",
    );
    const baseline = await run(root, "baseline");
    const baselineFingerprint = baseline.report.findings[0]?.fingerprint;

    await writeFile(
      resolve(root, "tree.csv"),
      "asset_id,parent_asset_id,name\nROOT,,Root\nX,ROOT,Asset X\nB,ROOT,Asset B\nA,ROOT,Asset A \n",
      "utf8",
    );
    const result = await run(root, "current", { baselinePath: baseline.paths.json, gateMode: "new" });

    expect(result.exitCode).toBe(0);
    expect(result.report.findings[0]).toMatchObject({
      fingerprint: baselineFingerprint,
      baselineStatus: "unchanged",
      line: 5,
    });
    expect(result.report.comparison).toMatchObject({
      newFindings: { total: 0 },
      resolvedFindings: { total: 0 },
      unchangedFindings: { total: 1 },
    });
  });

  it("treats a replacement anonymous row at the same location as a new finding", async () => {
    const root = await workspace();
    await writeFile(
      resolve(root, "tree.csv"),
      "asset_id,parent_asset_id,name\nROOT,,Root\n,ROOT,Old anonymous row\n",
      "utf8",
    );
    const baseline = await run(root, "baseline");

    await writeFile(
      resolve(root, "tree.csv"),
      "asset_id,parent_asset_id,name\nROOT,,Root\n,ROOT,Replacement anonymous row\n",
      "utf8",
    );
    const result = await run(root, "current", { baselinePath: baseline.paths.json, gateMode: "new" });

    expect(result.exitCode).toBe(1);
    expect(result.report.findings[0]?.baselineStatus).toBe("new");
    expect(result.report.findings[0]?.fingerprint).not.toBe(baseline.report.findings[0]?.fingerprint);
    expect(result.report.comparison).toMatchObject({
      newFindings: { total: 1, errors: 1 },
      resolvedFindings: { total: 1, errors: 1 },
      unchangedFindings: { total: 0 },
    });
  });

  it("fails closed when baseline or current fingerprint details are truncated", async () => {
    const root = await workspace();
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,Root\n", "utf8");
    const completeBaseline = await run(root, "complete-baseline");

    await writeFile(
      resolve(root, "config.json"),
      `${JSON.stringify({
        version: 1,
        files: ["tree.csv"],
        gate: { failOn: "warning" },
        limits: { maxFindings: 1 },
      })}\n`,
      "utf8",
    );
    await writeFile(
      resolve(root, "tree.csv"),
      "asset_id,parent_asset_id,name\nROOT,,Root \nA,ROOT,Asset A \nB,ROOT,Asset B \n",
      "utf8",
    );
    const truncated = await run(root, "truncated");
    expect(truncated.report.findings[0]?.ruleId).toBe("ATC999");

    await expect(run(root, "baseline-truncated", { baselinePath: truncated.paths.json })).rejects.toThrow(/truncated|incomplete/);
    await expect(
      run(root, "current-truncated", { baselinePath: completeBaseline.paths.json, gateMode: "new" }),
    ).rejects.toThrow(/Current finding details are incomplete/);
  });

  it("rejects missing, malformed, inconsistent, escaping, and oversized baselines", async () => {
    const root = await workspace();
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,Root\n", "utf8");

    await expect(run(root, "missing-mode", { gateMode: "new" })).rejects.toThrow(/requires a baseline/);
    await writeFile(resolve(root, "malformed.json"), "{not-json}\n", "utf8");
    await expect(run(root, "malformed", { baselinePath: "malformed.json" })).rejects.toThrow(/not valid JSON/);
    await expect(run(root, "escape", { baselinePath: "../outside.json" })).rejects.toThrow(/escapes/);

    await writeFile(resolve(root, "oversized.json"), Buffer.alloc(BASELINE_MAX_BYTES + 1, 32));
    await expect(run(root, "oversized", { baselinePath: "oversized.json" })).rejects.toThrow(/exceeds/);

    const valid = await run(root, "valid-baseline");
    const inconsistent = JSON.parse(await readFile(resolve(root, valid.paths.json), "utf8"));
    inconsistent.summary.errors = 1;
    await writeFile(resolve(root, "inconsistent.json"), `${JSON.stringify(inconsistent)}\n`, "utf8");
    await expect(run(root, "inconsistent", { baselinePath: "inconsistent.json" })).rejects.toThrow(/incomplete or inconsistent/);
  });

  it("rejects a baseline reached through a symbolic-link directory", async () => {
    const root = await workspace();
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,Root\n", "utf8");
    await run(root, "real-baseline");
    const link = resolve(root, "baseline-link");
    await symlink(resolve(root, "real-baseline"), link, process.platform === "win32" ? "junction" : "dir");

    await expect(run(root, "current", { baselinePath: "baseline-link/results.json" })).rejects.toThrow(/symbolic link/);
  });

  it.each(["results.json", "results.sarif", "summary.md"])(
    "rejects a baseline that would be overwritten by generated %s output",
    async (filename) => {
      const root = await workspace();
      await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,Root\n", "utf8");
      const seed = await run(root, "seed");
      const collisionDirectory = resolve(root, "collision");
      await mkdir(collisionDirectory, { recursive: true });
      const collisionPath = resolve(collisionDirectory, filename);
      await copyFile(resolve(root, seed.paths.json), collisionPath);
      const original = await readFile(collisionPath, "utf8");

      await expect(
        run(root, "collision", { baselinePath: `collision/${filename}`, gateMode: "new" }),
      ).rejects.toThrow(/cannot also be the generated/);
      expect(await readFile(collisionPath, "utf8")).toBe(original);
    },
  );

  it("preserves exit code 2 for current operational errors in new-only mode", async () => {
    const root = await workspace();
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,Root\n", "utf8");
    const baseline = await run(root, "baseline");
    await writeFile(resolve(root, "tree.csv"), "wrong,headers\nvalue,other\n", "utf8");

    const result = await run(root, "current", { baselinePath: baseline.paths.json, gateMode: "new" });
    expect(result.exitCode).toBe(2);
    expect(result.report.summary).toMatchObject({ passed: false, operationalErrors: 1 });
  });
});
