// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = resolve(import.meta.dirname, "..");
const workspace = await mkdtemp(resolve(tmpdir(), "hierarchyguard-cli-"));
const cli = resolve(repository, "dist", "cli", "index.js");
const preload = pathToFileURL(resolve(repository, "scripts", "deny-network.mjs")).href;

function run(arguments_) {
  return spawnSync(process.execPath, ["--import", preload, cli, ...arguments_], {
    cwd: workspace,
    encoding: "utf8",
  });
}

function requireStatus(result, expected, label) {
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (text.includes("HIERARCHYGUARD_NETWORK_EGRESS_BLOCKED")) throw new Error(`${label} attempted egress or a subprocess operation.\n${text}`);
  if (result.status !== expected) throw new Error(`${label} returned ${result.status}; expected ${expected}.\n${text}`);
}

try {
  await copyFile(resolve(repository, "fixtures", "synthetic", "valid.csv"), resolve(workspace, "valid.csv"));
  await copyFile(resolve(repository, "fixtures", "synthetic", "invalid.csv"), resolve(workspace, "invalid.csv"));
  await copyFile(resolve(repository, "fixtures", "synthetic", "config.json"), resolve(workspace, "config.json"));

  const valid = run(["check", "valid.csv", "--config", "config.json", "--output-dir", "valid-report"]);
  requireStatus(valid, 0, "Valid CLI check");
  if (!valid.stdout.includes("MaintenGraph: PASS")) throw new Error("Valid CLI output did not report PASS.");

  const invalid = run(["check", "invalid.csv", "--config", "config.json", "--output-dir", "invalid-report"]);
  requireStatus(invalid, 1, "Invalid CLI check");
  if (!invalid.stdout.includes("MaintenGraph: FAIL")) throw new Error("Invalid CLI output did not report FAIL.");

  const unchanged = run([
    "check",
    "invalid.csv",
    "--config",
    "config.json",
    "--baseline",
    "invalid-report/results.json",
    "--gate-mode",
    "new",
    "--output-dir",
    "unchanged-report",
  ]);
  requireStatus(unchanged, 0, "Unchanged baseline CLI check");
  if (!unchanged.stdout.includes("Baseline 0 new") || !unchanged.stdout.includes("Gate new/error")) {
    throw new Error("Baseline CLI output did not report the new-only gate and delta.");
  }

  await writeFile(resolve(workspace, "malformed.json"), "{not-json}\n", "utf8");
  requireStatus(run(["check", "valid.csv", "--config", "malformed.json"]), 2, "Malformed config check");
  requireStatus(run(["check", "missing.csv", "--config", "config.json"]), 2, "No-match check");
  requireStatus(run(["check", "valid.csv", "--config", "config.json", "--gate-mode", "new"]), 2, "Missing baseline check");

  const packageJson = JSON.parse(await readFile(resolve(repository, "package.json"), "utf8"));
  const version = run(["--version"]);
  requireStatus(version, 0, "Version command");
  if (version.stdout.trim() !== packageJson.version) throw new Error("Bundled CLI version does not match package.json.");
  const help = run(["--help"]);
  requireStatus(help, 0, "Help command");
  if (!help.stdout.includes("maintengraph check") || !help.stdout.includes("--baseline") || !help.stdout.includes("--gate-mode")) {
    throw new Error("Bundled CLI help is incomplete.");
  }

  process.stdout.write("Bundled CLI exits 0/1/2 correctly and passed baseline, no-egress, help, and version checks.\n");
} finally {
  await rm(workspace, { force: true, recursive: true });
}
