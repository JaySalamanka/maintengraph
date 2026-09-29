// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

export const TOOL_NAME = "maintengraph";
export const LEGACY_TOOL_NAME = "hierarchyguard";
export const TOOL_VERSION = "2.0.1";
export const RULESET_VERSION = "asset-governance@2";

export type Severity = "error" | "warning" | "notice";
export type FailOn = "error" | "warning" | "none";
export type GateMode = "all" | "new";
export type BaselineStatus = "new" | "unchanged";
export type RootPolicy = "any" | "one";
export type GovernanceMode = "off" | "review" | "release";

export interface ColumnConfig {
  id: string;
  parent: string;
  name: string;
  path: string;
  level: string;
  identity?: string;
  evidence?: string;
  reviewStatus?: string;
  objectClass?: string;
  legacyIds?: string;
}

export interface RuleConfig {
  rootPolicy: RootPolicy;
  maxDepth: number | null;
  requireParentBeforeChild: boolean;
  pathSeparator: string;
  governance: {
    mode: GovernanceMode;
    evidenceSeparator: string;
    legacyIdSeparator: string;
    forbidGenericBuckets: boolean;
  };
}

export interface LimitConfig {
  maxFiles: number;
  maxBytesPerFile: number;
  maxRowsPerFile: number;
  maxColumns: number;
  maxFieldLength: number;
  maxFindings: number;
}

export interface AssetTreeConfig {
  version: 1 | 2;
  files: string[];
  columns: ColumnConfig;
  rules: RuleConfig;
  gate: {
    failOn: FailOn;
  };
  limits: LimitConfig;
}

export interface AssetRow {
  id: string;
  parentId: string;
  name: string;
  path: string;
  levelText: string;
  line: number;
  cells: Readonly<Record<string, string>>;
  fingerprintIdentity?: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  suggestion: string;
  file: string;
  line: number;
  field: string;
  assetId?: string;
  fingerprint: string;
  legacyFingerprintV1: string;
  baselineStatus: BaselineStatus;
}

export interface InputSummary {
  path: string;
  sha256: string | null;
  rows: number;
}

export interface ReportSummary {
  files: number;
  rows: number;
  score: number;
  errors: number;
  warnings: number;
  notices: number;
  passed: boolean;
  operationalErrors: number;
}

export interface FindingCounts {
  total: number;
  errors: number;
  warnings: number;
  notices: number;
}

export interface BaselineDescriptor {
  path: string;
  sha256: string;
  schemaVersion: string;
  toolVersion: string;
  ruleset: string;
}

export interface BaselineComparison {
  baseline: BaselineDescriptor | null;
  newFindings: FindingCounts;
  resolvedFindings: FindingCounts;
  unchangedFindings: FindingCounts;
}

export interface AssetTreeReport {
  schemaVersion: "1.1";
  tool: {
    name: string;
    version: string;
    ruleset: string;
  };
  configSha256: string;
  inputs: InputSummary[];
  gate: {
    mode: GateMode;
    failOn: FailOn;
  };
  comparison: BaselineComparison;
  summary: ReportSummary;
  findings: Finding[];
}

export interface ParsedFile {
  input: InputSummary;
  assets: AssetRow[];
  findings: Finding[];
  operationalErrors: number;
  findingStatistics?: {
    errors: number;
    warnings: number;
    notices: number;
    scorePenalty: number;
  };
}

export interface ExecuteOptions {
  workspace: string;
  patterns?: string[];
  configPath?: string;
  configRequired?: boolean;
  outputDir?: string;
  failOn?: FailOn;
  baselinePath?: string;
  gateMode?: GateMode;
  auditUrl?: string;
}

export interface ExecuteResult {
  report: AssetTreeReport;
  markdown: string;
  paths: {
    json: string;
    sarif: string;
    markdown: string;
  };
  exitCode: 0 | 1 | 2;
}

export const DEFAULT_CONFIG: AssetTreeConfig = {
  version: 1,
  files: ["asset-data/**/*.csv"],
  columns: {
    id: "asset_id",
    parent: "parent_asset_id",
    name: "name",
    path: "path",
    level: "level",
  },
  rules: {
    rootPolicy: "any",
    maxDepth: null,
    requireParentBeforeChild: true,
    pathSeparator: "/",
    governance: {
      mode: "off",
      evidenceSeparator: ";",
      legacyIdSeparator: ";",
      forbidGenericBuckets: false,
    },
  },
  gate: {
    failOn: "error",
  },
  limits: {
    maxFiles: 100,
    maxBytesPerFile: 5_000_000,
    maxRowsPerFile: 50_000,
    maxColumns: 100,
    maxFieldLength: 10_000,
    maxFindings: 1_000,
  },
};

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = {
  error: 0,
  warning: 1,
  notice: 2,
};
