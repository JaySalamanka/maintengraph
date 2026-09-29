// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { execute } from "../src/run";

const temporaryDirectories: string[] = [];

async function workspaceWith(...fixtures: string[]): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "hierarchyguard-test-"));
  temporaryDirectories.push(workspace);
  for (const fixture of fixtures) {
    await copyFile(resolve(process.cwd(), "fixtures", "synthetic", fixture), resolve(workspace, fixture));
  }
  return workspace;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("MaintenGraph engine", () => {
  it("passes a valid synthetic hierarchy with a perfect score", async () => {
    const workspace = await workspaceWith("valid.csv", "config.json");
    const result = await execute({
      workspace,
      patterns: ["valid.csv"],
      configPath: "config.json",
      configRequired: true,
      outputDir: "out",
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.summary).toMatchObject({ passed: true, score: 100, errors: 0, rows: 4 });
    expect(result.report.findings).toEqual([]);
  });

  it("detects universal graph blockers and unsafe cells", async () => {
    const workspace = await workspaceWith("invalid.csv", "config.json");
    const result = await execute({
      workspace,
      patterns: ["invalid.csv"],
      configPath: "config.json",
      configRequired: true,
      outputDir: "out",
    });
    const ruleIds = new Set(result.report.findings.map((finding) => finding.ruleId));

    expect(result.exitCode).toBe(1);
    expect(result.report.summary.passed).toBe(false);
    expect([...ruleIds]).toEqual(
      expect.arrayContaining(["ATC002", "ATC003", "ATC004", "ATC005", "ATC007", "ATC009", "ATC010", "ATC014"]),
    );
  });

  it("writes byte-identical JSON, SARIF, and Markdown for identical inputs", async () => {
    const workspace = await workspaceWith("valid.csv", "config.json");
    const first = await execute({
      workspace,
      patterns: ["valid.csv"],
      configPath: "config.json",
      configRequired: true,
      outputDir: "first",
    });
    const second = await execute({
      workspace,
      patterns: ["valid.csv"],
      configPath: "config.json",
      configRequired: true,
      outputDir: "second",
    });

    for (const kind of ["json", "sarif", "markdown"] as const) {
      expect(await readFile(resolve(workspace, first.paths[kind]), "utf8")).toBe(
        await readFile(resolve(workspace, second.paths[kind]), "utf8"),
      );
    }
  });

  it("returns operational exit code 2 while still writing reports for malformed CSV", async () => {
    const workspace = await workspaceWith("config.json");
    await writeFile(resolve(workspace, "bad.csv"), "wrong,headers\nvalue,other\n", "utf8");
    const result = await execute({
      workspace,
      patterns: ["bad.csv"],
      configPath: "config.json",
      configRequired: true,
      outputDir: "out",
    });

    expect(result.exitCode).toBe(2);
    expect(result.report.findings[0]?.ruleId).toBe("ATC000");
    expect(await readFile(resolve(workspace, result.paths.json), "utf8")).toContain('"operational_errors": 1');
  });

  it("accepts UTF-8 BOM, CRLF, and quoted commas", async () => {
    const workspace = await workspaceWith("config.json");
    const csv = '\uFEFFasset_id,parent_asset_id,name,path,level\r\nSYN-ROOT,,"SYNTHETIC, ROOT","SYNTHETIC, ROOT",1\r\n';
    await writeFile(resolve(workspace, "quoted.csv"), csv, "utf8");
    const result = await execute({
      workspace,
      patterns: ["quoted.csv"],
      configPath: "config.json",
      configRequired: true,
      outputDir: "out",
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.summary.rows).toBe(1);
  });

  it("rejects report path traversal", async () => {
    const workspace = await workspaceWith("valid.csv", "config.json");
    await expect(
      execute({
        workspace,
        patterns: ["valid.csv"],
        configPath: "config.json",
        configRequired: true,
        outputDir: "../outside",
      }),
    ).rejects.toThrow(/escapes the repository workspace/);
  });

  it("rejects the workspace root as the report directory", async () => {
    const workspace = await workspaceWith("valid.csv", "config.json");
    await expect(
      execute({
        workspace,
        patterns: ["valid.csv"],
        configPath: "config.json",
        configRequired: true,
        outputDir: ".",
      }),
    ).rejects.toThrow(/cannot be the repository workspace root/);
  });

  it("rejects unknown configuration properties", async () => {
    const workspace = await workspaceWith("valid.csv");
    await writeFile(resolve(workspace, "config.json"), '{"version":1,"telemetry":true}\n', "utf8");
    await expect(
      execute({
        workspace,
        patterns: ["valid.csv"],
        configPath: "config.json",
        configRequired: true,
        outputDir: "out",
      }),
    ).rejects.toThrow(/unknown property: telemetry/);
  });

  it("rejects control characters in the configured path separator", async () => {
    const workspace = await workspaceWith("valid.csv");
    await writeFile(resolve(workspace, "config.json"), '{"version":1,"rules":{"pathSeparator":"/\\n"}}\n', "utf8");
    await expect(
      execute({
        workspace,
        patterns: ["valid.csv"],
        configPath: "config.json",
        configRequired: true,
        outputDir: "out",
      }),
    ).rejects.toThrow(/pathSeparator must contain 1 to 16 printable characters/);
  });

  it("passes an evidence-backed governed release hierarchy", async () => {
    const workspace = await workspaceWith();
    await writeFile(
      resolve(workspace, "governed.csv"),
      [
        "asset_id,parent_asset_id,name,path,level,physical_identity,evidence,review_status,object_class,legacy_ids",
        "PLANT,,PLANT,PLANT,1,,FIELD-001,confirmed,system,",
        "P-101,PLANT,FEED PUMP,PLANT/FEED PUMP,2,PUMP-SERIAL-101,DRAWING-10#42;FIELD-002,confirmed,equipment,OLD-P-1",
        "M-101,P-101,ELECTRIC MOTOR,PLANT/FEED PUMP/ELECTRIC MOTOR,3,MOTOR-SERIAL-101,BOM-10#7,accepted,component,OLD-M-1",
      ].join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      resolve(workspace, "config.json"),
      JSON.stringify({
        version: 2,
        files: ["governed.csv"],
        columns: {
          id: "asset_id",
          parent: "parent_asset_id",
          name: "name",
          path: "path",
          level: "level",
          identity: "physical_identity",
          evidence: "evidence",
          reviewStatus: "review_status",
          objectClass: "object_class",
          legacyIds: "legacy_ids",
        },
        rules: {
          maxDepth: 6,
          governance: { mode: "release", forbidGenericBuckets: true },
        },
      }) + "\n",
      "utf8",
    );

    const result = await execute({ workspace, configPath: "config.json", configRequired: true, outputDir: "out" });
    expect(result.exitCode).toBe(0);
    expect(result.report.findings).toEqual([]);
  });

  it("blocks unsupported certainty, duplicate physical identities, and hidden ownership", async () => {
    const workspace = await workspaceWith();
    await writeFile(
      resolve(workspace, "unresolved.csv"),
      [
        "asset_id,parent_asset_id,name,path,level,physical_identity,evidence,review_status,object_class,legacy_ids",
        "PLANT,,PLANT,PLANT,1,,FIELD-001,confirmed,system,",
        "A-1,PLANT,ELECTRICAL PARTS,PLANT/ELECTRICAL PARTS,2,SAME-ASSET,,provisional,equipment,OLD-1",
        "A-2,PLANT,DRIVE,PLANT/DRIVE,2,SAME-ASSET,DRAWING-2#9,confirmed,equipment,OLD-1",
      ].join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      resolve(workspace, "config.json"),
      JSON.stringify({
        version: 2,
        files: ["unresolved.csv"],
        columns: {
          id: "asset_id",
          parent: "parent_asset_id",
          name: "name",
          path: "path",
          level: "level",
          identity: "physical_identity",
          evidence: "evidence",
          reviewStatus: "review_status",
          objectClass: "object_class",
          legacyIds: "legacy_ids",
        },
        rules: { governance: { mode: "release", forbidGenericBuckets: true } },
      }) + "\n",
      "utf8",
    );

    const result = await execute({ workspace, configPath: "config.json", configRequired: true, outputDir: "out" });
    const ruleIds = new Set(result.report.findings.map((finding) => finding.ruleId));
    expect(result.exitCode).toBe(1);
    expect([...ruleIds]).toEqual(expect.arrayContaining(["ATC021", "ATC022", "ATC024", "ATC025", "ATC026"]));
  });
});
