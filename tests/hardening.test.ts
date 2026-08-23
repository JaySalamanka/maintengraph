// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { execute } from "../src/run";

const temporaryDirectories: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "hierarchyguard-hardening-"));
  temporaryDirectories.push(path);
  return path;
}

async function writeConfig(root: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(resolve(root, "config.json"), `${JSON.stringify({ version: 1, ...value })}\n`, "utf8");
}

async function run(root: string, options: { failOn?: "error" | "warning" | "none" } = {}) {
  return execute({
    workspace: root,
    patterns: ["tree.csv"],
    configPath: "config.json",
    configRequired: true,
    outputDir: "out",
    ...options,
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
}, 30_000);

describe("input hardening", () => {
  it("returns exit code 2 and a report for invalid UTF-8", async () => {
    const root = await workspace();
    await writeConfig(root, {});
    await writeFile(resolve(root, "tree.csv"), Buffer.from([0xff, 0xfe, 0xfd]));
    const result = await run(root);
    expect(result.exitCode).toBe(2);
    expect(result.report.findings[0]?.message).toMatch(/not valid UTF-8/);
  });

  it("returns exit code 2 for duplicate CSV headers", async () => {
    const root = await workspace();
    await writeConfig(root, {});
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name,name\nROOT,,Root,Other\n", "utf8");
    const result = await run(root);
    expect(result.exitCode).toBe(2);
    expect(result.report.findings[0]?.message).toMatch(/duplicate column headers/);
  });

  it("does not echo malformed customer cell contents in parser findings", async () => {
    const root = await workspace();
    await writeConfig(root, {});
    await writeFile(
      resolve(root, "tree.csv"),
      'asset_id,parent_asset_id,name\nROOT,,"SECRET-CELL\n',
      "utf8",
    );
    const result = await run(root);
    expect(result.exitCode).toBe(2);
    expect(result.report.findings[0]?.message).toMatch(/CSV parsing failed/);
    expect(JSON.stringify(result.report)).not.toContain("SECRET-CELL");
  });

  it("rejects dangerous or non-printable CSV headers", async () => {
    const root = await workspace();
    await writeConfig(root, {});
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name,__proto__\nROOT,,Root,value\n", "utf8");
    const result = await run(root);
    expect(result.exitCode).toBe(2);
    expect(result.report.findings[0]?.message).toMatch(/trimmed, printable, safe names/);
  });

  it("enforces configured row and field limits", async () => {
    const rowRoot = await workspace();
    await writeConfig(rowRoot, { limits: { maxRowsPerFile: 1 } });
    await writeFile(
      resolve(rowRoot, "tree.csv"),
      "asset_id,parent_asset_id,name,path,level\nROOT,,Root,,\nCHILD,ROOT,Child,,\n",
      "utf8",
    );
    expect((await run(rowRoot)).report.findings[0]?.message).toMatch(/configured maximum (?:is|of) 1/);

    const fieldRoot = await workspace();
    await writeConfig(fieldRoot, { limits: { maxFieldLength: 16 } });
    await writeFile(
      resolve(fieldRoot, "tree.csv"),
      "asset_id,parent_asset_id,name,path,level\nROOT,,12345678901234567,,\n",
      "utf8",
    );
    expect((await run(fieldRoot)).report.findings[0]?.message).toMatch(/exceeds the configured limit/);
  });

  it("rejects an oversized file before hashing or parsing it", async () => {
    const root = await workspace();
    await writeConfig(root, { limits: { maxBytesPerFile: 1024 } });
    await writeFile(resolve(root, "tree.csv"), Buffer.alloc(1025, 65));
    const result = await run(root);
    expect(result.exitCode).toBe(2);
    expect(result.report.inputs[0]?.sha256).toBeNull();
    expect(result.report.findings[0]?.message).toMatch(/1024-byte limit/);
  });

  it("rejects absolute, drive-relative, traversal, and control-character globs", async () => {
    const root = await workspace();
    await writeConfig(root, {});
    await writeFile(resolve(root, "tree.csv"), "asset_id,parent_asset_id,name\nROOT,,Root\n", "utf8");
    for (const pattern of [
      "/tmp/tree.csv",
      "C:tree.csv",
      "../tree.csv",
      "tree.csv\nother.csv",
      "{/etc,fixtures}/**/*.csv",
      "{C:/Windows,fixtures}/**/*.csv",
      "{//server/share,fixtures}/**/*.csv",
    ]) {
      await expect(
        execute({ workspace: root, patterns: [pattern], configPath: "config.json", configRequired: true, outputDir: "out" }),
      ).rejects.toThrow(/relative|cannot contain|trimmed, printable|brace expansion/);
    }
  });
});

describe("graph and gate behavior", () => {
  it("detects case-folding collisions, root-policy violations, and maximum depth", async () => {
    const root = await workspace();
    await writeConfig(root, { rules: { rootPolicy: "one", maxDepth: 2 } });
    await writeFile(
      resolve(root, "tree.csv"),
      [
        "asset_id,parent_asset_id,name,path,level",
        "ROOT,,Root,,1",
        "root,,Other Root,,1",
        "CHILD,ROOT,Child,,2",
        "GRAND,CHILD,Grandchild,,3",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await run(root);
    const rules = result.report.findings.map((finding) => finding.ruleId);
    expect(rules).toEqual(expect.arrayContaining(["ATC002", "ATC006", "ATC008"]));
  });

  it("honors warning and none quality gates", async () => {
    const root = await workspace();
    await writeConfig(root, {});
    await writeFile(
      resolve(root, "tree.csv"),
      "asset_id,parent_asset_id,name,path,level\nROOT,,Root ,,\n",
      "utf8",
    );
    expect((await run(root, { failOn: "warning" })).exitCode).toBe(1);
    expect((await run(root, { failOn: "none" })).exitCode).toBe(0);
  });

  it("handles a deep hierarchy without call-stack recursion", async () => {
    const root = await workspace();
    await writeConfig(root, { rules: { requireParentBeforeChild: false } });
    const dataRows = ["NODE-0,,Node 0,,"];
    for (let index = 1; index < 12_000; index += 1) {
      dataRows.push(`NODE-${index},NODE-${index - 1},Node ${index},,`);
    }
    const rows = ["asset_id,parent_asset_id,name,path,level", ...dataRows.reverse()];
    await writeFile(resolve(root, "tree.csv"), `${rows.join("\n")}\n`, "utf8");
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(result.report.summary).toMatchObject({ rows: 12_000, score: 100 });
    expect(await readFile(resolve(root, result.paths.json), "utf8")).toContain('"rows": 12000');
  }, 20_000);

  it("memoizes invalid depth across a long orphan chain", async () => {
    const root = await workspace();
    await writeConfig(root, { rules: { requireParentBeforeChild: false }, gate: { failOn: "none" } });
    const dataRows = ["NODE-0,MISSING,Node 0,,"];
    for (let index = 1; index < 8_000; index += 1) {
      dataRows.push(`NODE-${index},NODE-${index - 1},Node ${index},,`);
    }
    const rows = ["asset_id,parent_asset_id,name,path,level", ...dataRows.reverse()];
    await writeFile(resolve(root, "tree.csv"), `${rows.join("\n")}\n`, "utf8");
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(result.report.summary).toMatchObject({ rows: 8_000, errors: 1 });
    expect(result.report.findings.some((finding) => finding.ruleId === "ATC003")).toBe(true);
  }, 20_000);

  it("bounds cycle messages in long cycles", async () => {
    const root = await workspace();
    await writeConfig(root, {});
    const rows = ["asset_id,parent_asset_id,name,path,level"];
    for (let index = 0; index < 20; index += 1) {
      rows.push(`NODE-${index},NODE-${(index + 1) % 20},Node ${index},,`);
    }
    await writeFile(resolve(root, "tree.csv"), `${rows.join("\n")}\n`, "utf8");
    const result = await run(root);
    const cycleMessages = result.report.findings.filter((finding) => finding.ruleId === "ATC005").map((finding) => finding.message);
    expect(cycleMessages).toHaveLength(20);
    expect(Math.max(...cycleMessages.map((message) => message.length))).toBeLessThan(300);
  });

  it("keeps complete counts and score while strictly bounding finding details", async () => {
    const root = await workspace();
    await writeConfig(root, { limits: { maxFindings: 1 }, gate: { failOn: "none" } });
    await writeFile(
      resolve(root, "tree.csv"),
      [
        "asset_id,parent_asset_id,name,path,level",
        "ROOT,,Root , , ",
        "A,ROOT,Asset A , , ",
        "B,ROOT,Asset B , , ",
        "C,ROOT,Asset C , , ",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(result.report.summary).toMatchObject({ rows: 4, warnings: 12, score: 75 });
    expect(result.report.findings).toHaveLength(1);
    expect(result.report.findings[0]?.ruleId).toBe("ATC999");
  });
});
