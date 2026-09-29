#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { parseGateMode } from "../baseline";
import { parseFailOn } from "../config";
import { OperationalError } from "../errors";
import { renderConsole } from "../report";
import { execute } from "../run";
import { FailOn, GateMode, TOOL_VERSION } from "../types";

interface CliOptions {
  patterns: string[];
  configPath: string;
  configRequired: boolean;
  outputDir: string;
  failOn?: FailOn;
  baselinePath?: string;
  gateMode: GateMode;
}

const HELP = `MaintenGraph ${TOOL_VERSION}

Usage:
  maintengraph check [CSV globs...] [options]

Options:
  --config <path>       JSON configuration path (default: .maintengraph.json)
  --output-dir <path>   Contained report directory (default: .maintengraph)
  --fail-on <severity>  error, warning, or none
  --baseline <path>     Existing MaintenGraph result JSON inside the workspace
  --gate-mode <mode>    all or new (default: all)
  --version             Print the version
  --help                Show this help
`;

function optionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new OperationalError(`${name} requires a value.`);
  return value;
}

function parseArgs(args: string[]): CliOptions | "help" | "version" {
  if (args.length === 0 || args.includes("--help")) return "help";
  if (args.includes("--version")) return "version";
  if (args[0] !== "check") throw new OperationalError("The first argument must be 'check'.");

  const patterns: string[] = [];
  let configPath = ".maintengraph.json";
  let configRequired = false;
  let outputDir = ".maintengraph";
  let failOn: FailOn | undefined;
  let baselinePath: string | undefined;
  let gateMode: GateMode = "all";
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--config") {
      configPath = optionValue(args, index, argument);
      configRequired = true;
      index += 1;
    } else if (argument === "--output-dir") {
      outputDir = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--fail-on") {
      failOn = parseFailOn(optionValue(args, index, argument));
      index += 1;
    } else if (argument === "--baseline") {
      baselinePath = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--gate-mode") {
      gateMode = parseGateMode(optionValue(args, index, argument));
      index += 1;
    } else if (argument?.startsWith("--")) {
      throw new OperationalError(`Unknown option: ${argument}`);
    } else if (argument) {
      patterns.push(argument);
    }
  }
  return {
    patterns,
    configPath,
    configRequired,
    outputDir,
    gateMode,
    ...(failOn ? { failOn } : {}),
    ...(baselinePath ? { baselinePath } : {}),
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (parsed === "version") {
    process.stdout.write(`${TOOL_VERSION}\n`);
    return;
  }
  const result = await execute({
    workspace: process.cwd(),
    ...(parsed.patterns.length > 0 ? { patterns: parsed.patterns } : {}),
    configPath: parsed.configPath,
    configRequired: parsed.configRequired,
    outputDir: parsed.outputDir,
    ...(parsed.failOn ? { failOn: parsed.failOn } : {}),
    ...(parsed.baselinePath ? { baselinePath: parsed.baselinePath } : {}),
    gateMode: parsed.gateMode,
  });
  process.stdout.write(`${renderConsole(result.report)}\n`);
  process.stdout.write(`JSON: ${result.paths.json}\nSARIF: ${result.paths.sarif}\nMarkdown: ${result.paths.markdown}\n`);
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`MaintenGraph operational error: ${message}\n`);
  process.exitCode = 2;
});
