// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) throw new Error("Package verification must run through npm so npm_execpath is available.");

function runNpm(arguments_, cwd) {
  return spawnSync(process.execPath, [npmExecPath, ...arguments_], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}.\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}

function relativeReadmeLinks(markdown) {
  const links = new Set();
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const destination = match[1]?.trim().replace(/^<|>$/g, "");
    if (!destination || destination.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(destination)) continue;
    links.add(destination.split("#", 1)[0]);
  }
  return [...links].sort();
}

const temporary = await mkdtemp(resolve(tmpdir(), "hierarchyguard-package-"));
try {
  const packed = runNpm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary],
    repository,
  );
  requireSuccess(packed, "npm pack");
  const payload = JSON.parse(packed.stdout);
  const files = (payload[0]?.files?.map((item) => item.path) ?? []).sort();
  const manifest = JSON.parse(readFileSync(resolve(repository, "release-allowlist.json"), "utf8"));
  const expected = [...manifest.packagePaths].sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    const missing = expected.filter((path) => !files.includes(path));
    const unexpected = files.filter((path) => !expected.includes(path));
    throw new Error(
      `Package allowlist mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`,
    );
  }

  const filename = payload[0]?.filename;
  if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
    throw new Error("npm pack did not report a tarball filename.");
  }
  const tarball = resolve(temporary, filename);
  if (!existsSync(tarball)) throw new Error("npm pack tarball is missing.");

  const consumer = resolve(temporary, "consumer");
  await mkdir(consumer, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(consumer, "package.json"),
    `${JSON.stringify({ name: "maintengraph-clean-install", private: true }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const installed = runNpm(
    ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball],
    consumer,
  );
  requireSuccess(installed, "Clean tarball install");

  const installedRoot = resolve(consumer, "node_modules", "maintengraph");
  const installedManifest = JSON.parse(await readFile(resolve(installedRoot, "package.json"), "utf8"));
  if (installedManifest.bin?.maintengraph !== "dist/cli/index.js" || installedManifest.bin?.hierarchyguard !== "dist/cli/index.js") {
    throw new Error("Package does not expose both the MaintenGraph CLI and the v1 compatibility alias.");
  }
  const readme = await readFile(resolve(installedRoot, "README.md"), "utf8");
  for (const link of relativeReadmeLinks(readme)) {
    if (!existsSync(resolve(installedRoot, link))) {
      throw new Error(`Packaged README link target is missing: ${link}`);
    }
  }

  await writeFile(
    resolve(consumer, "tree.csv"),
    "asset_id,parent_asset_id,name,path,level\nROOT,,Root,Root,1\n",
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(
    resolve(consumer, "config.json"),
    `${JSON.stringify({ version: 1, files: ["tree.csv"], gate: { failOn: "error" } })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const cli = resolve(installedRoot, "dist", "cli", "index.js");
  const deniedNetwork = pathToFileURL(resolve(repository, "scripts", "deny-network.mjs")).href;
  const smoke = spawnSync(
    process.execPath,
    ["--import", deniedNetwork, cli, "check", "tree.csv", "--config", "config.json", "--output-dir", "reports"],
    { cwd: consumer, encoding: "utf8", shell: false },
  );
  requireSuccess(smoke, "Installed CLI smoke test");
  if (`${smoke.stdout ?? ""}\n${smoke.stderr ?? ""}`.includes("HIERARCHYGUARD_NETWORK_EGRESS_BLOCKED")) {
    throw new Error("Installed CLI attempted network egress or a subprocess operation.");
  }
  const result = JSON.parse(await readFile(resolve(consumer, "reports", "results.json"), "utf8"));
  if (result.summary?.passed !== true || result.summary?.rows !== 1) {
    throw new Error("Installed CLI did not produce the expected passing result.");
  }

  process.stdout.write(
    `Exact package allowlist passed (${files.length} files); clean offline install, README links, and CLI smoke test passed.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
