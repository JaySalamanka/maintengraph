// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "release-allowlist.json"), "utf8"));
const allowedPaths = new Set(manifest.allowedPaths);
const ignoredRootDirectories = new Set([".git", "node_modules", "coverage", ".cache", ".tmp", ".assettree", ".hierarchyguard", ".maintengraph"]);
const allowedDirectories = new Set();
for (const path of allowedPaths) {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) allowedDirectories.add(parts.slice(0, index).join("/"));
}
const findings = [];
const visiblePaths = [];
const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["OpenAI-style key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["Stripe live key", /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ["absolute Windows user path", /[A-Za-z]:[\\/]Users[\\/]/i],
  ["UNC path", /(?:^|[\s"'=])\\\\[A-Za-z0-9][A-Za-z0-9.-]{1,62}\\[A-Za-z0-9$._-]{1,80}(?:\\|$)/m],
  ["Unix home path", /\/(?:Users|home)\/[A-Za-z0-9._-]+\//],
];
const firstPartyNetworkPattern = /(?:node:)?(?:http2?|https|net|tls|dns|dgram)(?:["']|\/)|\b(?:fetch|WebSocket)\s*\(/;

function normalized(path) {
  return relative(root, path).split(sep).join("/");
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const path = resolve(directory, entry.name);
    const rel = normalized(path);
    const rootEntry = !rel.includes("/");
    if (rootEntry && entry.isDirectory() && ignoredRootDirectories.has(rel)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      findings.push(`symbolic link is not allowed: ${rel}`);
      continue;
    }
    if (entry.isDirectory()) {
      if (!allowedDirectories.has(rel)) findings.push(`unexpected directory: ${rel}`);
      walk(path);
      continue;
    }
    if (!entry.isFile()) {
      findings.push(`non-file entry is not allowed: ${rel}`);
      continue;
    }
    visiblePaths.push(rel);
    if (!allowedPaths.has(rel)) findings.push(`unexpected file: ${rel}`);
    if (entry.name.endsWith(".map")) findings.push(`source map is not allowed: ${rel}`);
    if (stat.size > 5_000_000) findings.push(`file exceeds 5 MB: ${rel}`);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    } catch {
      findings.push(`file is not strict UTF-8 text: ${rel}`);
      continue;
    }
    for (const [label, pattern] of secretPatterns) {
      if (pattern.test(text)) findings.push(`${label} in ${rel}`);
    }
    if (rel.startsWith("src/") && firstPartyNetworkPattern.test(text)) {
      findings.push(`first-party network capability in ${rel}`);
    }
  }
}

function gitExecutable() {
  if (process.env.GIT_EXECUTABLE) return process.env.GIT_EXECUTABLE;
  const probe = spawnSync("git", ["--version"], { encoding: "utf8", shell: false });
  if (!probe.error && probe.status === 0) return "git";
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return undefined;
  const desktopRoot = resolve(process.env.LOCALAPPDATA, "GitHubDesktop");
  if (!existsSync(desktopRoot)) return undefined;
  for (const name of readdirSync(desktopRoot).filter((value) => value.startsWith("app-")).sort().reverse()) {
    const candidate = resolve(desktopRoot, name, "resources", "app", "git", "cmd", "git.exe");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

walk(root);
for (const expected of [...allowedPaths].sort()) {
  if (!visiblePaths.includes(expected)) findings.push(`expected file is missing: ${expected}`);
}

for (const [path, expected] of Object.entries(manifest.fixtureSha256)) {
  const actual = createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
  if (actual !== expected) findings.push(`synthetic fixture hash changed without manifest review: ${path}`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const typeSource = readFileSync(resolve(root, "src", "types.ts"), "utf8");
const sourceVersion = typeSource.match(/TOOL_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (sourceVersion !== packageJson.version) findings.push("TOOL_VERSION does not match package.json version");
if (packageJson.license !== manifest.projectLicense) findings.push("package.json license does not match the reviewed project license");
if (packageLock.packages?.[""]?.license !== manifest.projectLicense) findings.push("package-lock.json root license does not match the reviewed project license");
if (packageJson.author?.name !== manifest.copyrightHolder) findings.push("package author does not match the reviewed copyright holder");
if (packageJson.repository?.url !== manifest.repositoryUrl) findings.push("package repository does not match the reviewed source location");
if (packageJson.homepage !== manifest.homepageUrl) findings.push("package homepage does not match the reviewed source location");
if (manifest.status === "public-release") {
  if (packageJson.private === true) findings.push("public release package cannot retain private:true");
  if (packageJson.publishConfig?.access !== "public" || packageJson.publishConfig?.provenance !== true) {
    findings.push("public release package must require public access and npm provenance");
  }
  if (packageJson.bugs?.url !== manifest.bugsUrl) findings.push("package bug tracker does not match the reviewed public location");
}

const licenseHash = createHash("sha256").update(readFileSync(resolve(root, "LICENSE"))).digest("hex");
if (licenseHash !== manifest.licenseSha256) findings.push("LICENSE does not match the reviewed official MPL-2.0 text");

const expectedCopyright = `SPDX-FileCopyrightText: 2026 ${manifest.copyrightHolder}`;
const expectedLicense = `SPDX-License-Identifier: ${manifest.projectLicense}`;
for (const path of manifest.spdxHeaderPaths) {
  const prefix = readFileSync(resolve(root, path), "utf8").slice(0, 512);
  if (!prefix.includes(expectedCopyright) || !prefix.includes(expectedLicense)) {
    findings.push(`missing reviewed SPDX header: ${path}`);
  }
}

const licenseStatePaths = [
  "CONTRIBUTING.md",
  "NOTICE",
  "README.md",
  "fixtures/synthetic/README.md",
  "package-lock.json",
  "package.json",
];
const contradictoryLicensePattern = /\bUNLICENSED\b|all[- ]rights[- ]reserved|pending public-license decision/i;
for (const path of licenseStatePaths) {
  if (contradictoryLicensePattern.test(readFileSync(resolve(root, path), "utf8"))) {
    findings.push(`contradictory pre-MPL license language remains in ${path}`);
  }
}
const noticeText = readFileSync(resolve(root, "NOTICE"), "utf8");
if (!noticeText.includes("https://mozilla.org/MPL/2.0/") || noticeText.includes("http://mozilla.org/MPL/2.0/")) {
  findings.push("NOTICE does not use the reviewed MPL-2.0 Exhibit A URL");
}

if (existsSync(resolve(root, ".git"))) {
  const git = gitExecutable();
  if (!git) {
    findings.push("Git repository exists but no Git executable was found for tracked-tree verification");
  } else {
    const tracked = spawnSync(git, ["ls-files", "-z"], { cwd: root, encoding: "utf8", shell: false });
    if (tracked.status !== 0) {
      findings.push("git ls-files failed during tracked-tree verification");
    } else {
      const trackedPaths = tracked.stdout.split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/")).sort();
      const expectedPaths = [...allowedPaths].sort();
      if (JSON.stringify(trackedPaths) !== JSON.stringify(expectedPaths)) {
        findings.push("tracked Git paths do not exactly match release-allowlist.json");
      }
    }
  }
}

if (findings.length > 0) {
  process.stderr.write("Public tree verification failed:\n");
  for (const finding of [...new Set(findings)].sort()) process.stderr.write(`- ${finding}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Exact public tree verification passed (${visiblePaths.length} files).\n`);
}
