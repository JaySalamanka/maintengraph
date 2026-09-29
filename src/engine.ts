// SPDX-FileCopyrightText: 2026 Mohammad Allatayfeh
// SPDX-License-Identifier: MPL-2.0

import { createHash } from "node:crypto";

import { initialComparison, qualityGateFails } from "./baseline";
import { makeFinding } from "./finding";
import {
  AssetRow,
  AssetTreeConfig,
  AssetTreeReport,
  Finding,
  ParsedFile,
  RULESET_VERSION,
  SEVERITY_ORDER,
  Severity,
  TOOL_NAME,
  TOOL_VERSION,
} from "./types";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;
const FORMULA_PREFIX = /^\s*(?:[=+@]|-(?!\d+(?:\.\d+)?$))/;
const REVIEW_STATUSES = new Set(["confirmed", "accepted", "provisional", "open", "rejected"]);
const RELEASE_STATUSES = new Set(["confirmed", "accepted"]);
const OBJECT_CLASSES = new Set([
  "system",
  "location",
  "assembly",
  "equipment",
  "component",
  "signal",
  "control",
  "logical",
  "reference",
  "spare",
]);
const IDENTITY_CLASSES = new Set(["assembly", "equipment", "component"]);
const GENERIC_BUCKET = /^(?:misc(?:ellaneous)?|other|others|electrical parts?|auxiliar(?:y|ies)(?: systems?)?|general parts?|unassigned|unknown)$/i;

function canonical(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeLabel(value: string): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function assignRowFingerprintIdentities(rows: AssetRow[]): void {
  const idCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.id.trim()) idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
  }

  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const uniqueAssetId = row.id.trim() && idCounts.get(row.id) === 1;
    const base = uniqueAssetId
      ? `asset:${row.id}`
      : `row:${createHash("sha256")
          .update(JSON.stringify(Object.entries(row.cells).sort(([left], [right]) => compareText(left, right))))
          .digest("hex")}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    row.fingerprintIdentity = `${base}:occurrence:${occurrence}`;
  }
}

function rowFinding(
  file: string,
  row: AssetRow,
  ruleId: string,
  severity: "error" | "warning" | "notice",
  field: string,
  message: string,
  suggestion: string,
  fingerprintVariant?: string,
): Finding {
  const assetId = safeLabel(row.id);
  return makeFinding({
    ruleId,
    severity,
    message,
    suggestion,
    file,
    line: row.line,
    field,
    ...(row.fingerprintIdentity ? { fingerprintIdentity: row.fingerprintIdentity } : {}),
    ...(fingerprintVariant ? { fingerprintVariant } : {}),
    ...(assetId ? { assetId } : {}),
  });
}

function findCycles(rows: AssetRow[], byId: Map<string, AssetRow>): string[][] {
  const complete = new Set<string>();
  const cycles = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.id || byId.get(row.id) !== row || complete.has(row.id)) continue;
    const path: string[] = [];
    const position = new Map<string, number>();
    let current = row.id;
    while (!complete.has(current)) {
      const seenAt = position.get(current);
      if (seenAt !== undefined) {
        const cycle = path.slice(seenAt);
        const key = [...cycle].sort().join("\u0000");
        cycles.set(key, cycle);
        break;
      }
      position.set(current, path.length);
      path.push(current);
      const parent = byId.get(current)?.parentId ?? "";
      if (!parent || parent === current || !byId.has(parent)) break;
      current = parent;
    }
    for (const id of path) complete.add(id);
  }
  return [...cycles.values()].sort((left, right) => compareText(left.join("\u0000"), right.join("\u0000")));
}

function graphDepth(id: string, byId: Map<string, AssetRow>, memo: Map<string, number | null>): number | undefined {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = id;
  let depth = 0;
  while (true) {
    if (memo.has(current)) {
      const cached = memo.get(current);
      if (cached === null || cached === undefined) {
        for (const node of chain) memo.set(node, null);
        return undefined;
      }
      depth = cached;
      break;
    }
    if (seen.has(current)) {
      for (const node of chain) memo.set(node, null);
      return undefined;
    }
    const row = byId.get(current);
    if (!row) {
      for (const node of chain) memo.set(node, null);
      return undefined;
    }
    seen.add(current);
    chain.push(current);
    if (!row.parentId.trim()) break;
    if (!byId.has(row.parentId)) {
      for (const node of chain) memo.set(node, null);
      return undefined;
    }
    current = row.parentId;
  }
  for (const node of chain.reverse()) {
    depth += 1;
    memo.set(node, depth);
  }
  return memo.get(id) ?? undefined;
}

export function validateParsedFile(parsed: ParsedFile, config: AssetTreeConfig): ParsedFile {
  const file = parsed.input.path;
  const rows = parsed.assets;
  assignRowFingerprintIdentities(rows);
  const retained: Record<Severity, Finding[]> = { error: [], warning: [], notice: [] };
  const counts: Record<Severity, number> = { error: 0, warning: 0, notice: 0 };
  const rowSeverities = new Map<number, Severity>();
  const findings = {
    push(...items: Finding[]): number {
      for (const finding of items) {
        counts[finding.severity] += 1;
        const existing = rowSeverities.get(finding.line);
        if (!existing || SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[existing]) {
          rowSeverities.set(finding.line, finding.severity);
        }
        if (retained[finding.severity].length < config.limits.maxFindings) {
          retained[finding.severity].push(finding);
        }
      }
      return counts.error + counts.warning + counts.notice;
    },
  };
  findings.push(...parsed.findings);
  const byId = new Map<string, AssetRow>();
  const exactGroups = new Map<string, AssetRow[]>();
  const foldedGroups = new Map<string, AssetRow[]>();

  for (const row of rows) {
    if (!row.id.trim()) {
      findings.push(rowFinding(file, row, "ATC001", "error", config.columns.id, "Asset ID is required.", "Enter a stable unique asset ID."));
    }
    if (!row.name.trim()) {
      findings.push(rowFinding(file, row, "ATC001", "error", config.columns.name, "Asset name is required.", "Enter a clear asset name."));
    }

    for (const [field, value] of Object.entries(row.cells)) {
      if (value && value !== value.trim()) {
        findings.push(
          rowFinding(file, row, "ATC012", "warning", field, `Field '${field}' has leading or trailing whitespace.`, "Remove boundary whitespace without changing the intended value."),
        );
      }
      if (CONTROL_CHARACTERS.test(value)) {
        findings.push(
          rowFinding(file, row, "ATC013", "warning", field, `Field '${field}' contains a control character.`, "Remove non-printing control characters."),
        );
      }
      if (FORMULA_PREFIX.test(value)) {
        findings.push(
          rowFinding(file, row, "ATC014", "warning", field, `Field '${field}' may execute as a spreadsheet formula.`, "Store the value as inert text before spreadsheet delivery."),
        );
      }
    }

    if (!row.id) continue;
    const exact = exactGroups.get(row.id) ?? [];
    exact.push(row);
    exactGroups.set(row.id, exact);
    const foldedId = canonical(row.id);
    const folded = foldedGroups.get(foldedId) ?? [];
    folded.push(row);
    foldedGroups.set(foldedId, folded);
    if (!byId.has(row.id)) byId.set(row.id, row);
  }

  if (config.rules.governance.mode !== "off") {
    const releaseMode = config.rules.governance.mode === "release";
    const identityGroups = new Map<string, AssetRow[]>();
    const legacyOwners = new Map<string, AssetRow[]>();
    const identityColumn = config.columns.identity as string;
    const evidenceColumn = config.columns.evidence as string;
    const reviewStatusColumn = config.columns.reviewStatus as string;
    const objectClassColumn = config.columns.objectClass as string;

    for (const row of rows) {
      const status = canonical(row.cells[reviewStatusColumn] ?? "");
      const objectClass = canonical(row.cells[objectClassColumn] ?? "");
      const identity = (row.cells[identityColumn] ?? "").trim();
      const evidence = (row.cells[evidenceColumn] ?? "")
        .split(config.rules.governance.evidenceSeparator)
        .map((value) => value.trim())
        .filter(Boolean);

      if (!REVIEW_STATUSES.has(status)) {
        findings.push(rowFinding(
          file,
          row,
          "ATC020",
          "error",
          reviewStatusColumn,
          "Review status must be confirmed, accepted, provisional, open, or rejected.",
          "Assign an explicit epistemic status; do not imply certainty through omission.",
        ));
      } else if (releaseMode && !RELEASE_STATUSES.has(status)) {
        findings.push(rowFinding(
          file,
          row,
          "ATC021",
          "error",
          reviewStatusColumn,
          `Review status '${status}' is not releasable.`,
          "Resolve the decision with evidence, explicitly accept it, or remove the row from the release dataset.",
        ));
      } else if (!releaseMode && (status === "provisional" || status === "open" || status === "rejected")) {
        findings.push(rowFinding(
          file,
          row,
          "ATC021",
          "notice",
          reviewStatusColumn,
          `Review status '${status}' requires disposition before release.`,
          "Preserve the uncertainty during review and resolve it before switching to release mode.",
        ));
      }

      if (!OBJECT_CLASSES.has(objectClass)) {
        findings.push(rowFinding(
          file,
          row,
          "ATC027",
          "error",
          objectClassColumn,
          "Object class is not part of the governed vocabulary.",
          "Classify the row as system, location, assembly, equipment, component, signal, control, logical, reference, or spare.",
        ));
      }

      if (status !== "rejected" && evidence.length === 0) {
        findings.push(rowFinding(
          file,
          row,
          "ATC022",
          releaseMode ? "error" : "warning",
          evidenceColumn,
          "The hierarchy claim has no source or field-verification evidence reference.",
          "Reference the drawing, BOM, register, inspection, or approved decision that supports this row.",
        ));
      }

      if (IDENTITY_CLASSES.has(objectClass) && !identity) {
        findings.push(rowFinding(
          file,
          row,
          "ATC023",
          releaseMode ? "error" : "warning",
          identityColumn,
          "A physical object has no physical-identity key.",
          "Assign a stable identity only after the physical equivalence is supported; do not derive it from a repeated tag alone.",
        ));
      }
      if (identity) {
        const key = canonical(identity);
        const group = identityGroups.get(key) ?? [];
        group.push(row);
        identityGroups.set(key, group);
      }

      if (config.columns.legacyIds) {
        const legacyIds = new Set(
          (row.cells[config.columns.legacyIds] ?? "")
            .split(config.rules.governance.legacyIdSeparator)
            .map((value) => canonical(value))
            .filter(Boolean),
        );
        for (const legacyId of legacyIds) {
          const owners = legacyOwners.get(legacyId) ?? [];
          owners.push(row);
          legacyOwners.set(legacyId, owners);
        }
      }

      if (config.rules.governance.forbidGenericBuckets && GENERIC_BUCKET.test(row.name.trim())) {
        findings.push(rowFinding(
          file,
          row,
          "ATC026",
          releaseMode ? "error" : "warning",
          config.columns.name,
          "Generic catch-all grouping hides physical ownership.",
          "Place each retained part, control, signal, or reference beneath its evidenced physical or functional owner.",
        ));
      }
    }

    for (const group of identityGroups.values()) {
      if (group.length < 2) continue;
      for (const row of group) {
        findings.push(rowFinding(
          file,
          row,
          "ATC024",
          "error",
          identityColumn,
          "Physical-identity key is assigned to more than one CMMS object.",
          "Represent one physical asset once, consolidate proven duplicate representations, and retain former IDs as history.",
        ));
      }
    }

    for (const group of legacyOwners.values()) {
      const distinctAssets = new Set(group.map((row) => row.id));
      if (distinctAssets.size < 2) continue;
      for (const row of group) {
        findings.push(rowFinding(
          file,
          row,
          "ATC025",
          releaseMode ? "error" : "warning",
          config.columns.legacyIds as string,
          "Legacy ID is claimed by more than one current object.",
          "Resolve the migration identity or document a single current owner before release.",
        ));
      }
    }
  }

  for (const [id, group] of [...exactGroups.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (group.length < 2) continue;
    for (const row of group) {
      findings.push(
        rowFinding(file, row, "ATC002", "error", config.columns.id, `Asset ID '${safeLabel(id)}' is duplicated.`, "Assign a distinct stable ID to every row.", "exact-duplicate"),
      );
    }
  }

  for (const group of foldedGroups.values()) {
    const distinct = new Set(group.map((row) => row.id));
    if (distinct.size < 2) continue;
    for (const row of group) {
      findings.push(
        rowFinding(file, row, "ATC002", "error", config.columns.id, "Asset IDs collide when case and Unicode presentation are normalized.", "Use IDs that remain distinct under case-insensitive comparison.", "canonical-collision"),
      );
    }
  }

  for (const row of rows) {
    if (!row.id || !row.parentId.trim()) continue;
    if (row.parentId === row.id) {
      findings.push(rowFinding(file, row, "ATC004", "error", config.columns.parent, "An asset cannot be its own parent.", "Choose a different existing parent or make this row a root."));
      continue;
    }
    const parent = byId.get(row.parentId);
    if (!parent) {
      findings.push(
        rowFinding(file, row, "ATC003", "error", config.columns.parent, `Parent '${safeLabel(row.parentId)}' does not exist in this file.`, "Add the parent row or correct the parent ID."),
      );
      continue;
    }
    if (config.rules.requireParentBeforeChild && parent.line > row.line) {
      findings.push(
        rowFinding(file, row, "ATC007", "warning", config.columns.parent, "Parent row appears after its child.", "Place parent rows before child rows for import-ready ordering."),
      );
    }
  }

  for (const cycle of findCycles(rows, byId)) {
    const shown = cycle.slice(0, 8).map(safeLabel).join(" -> ");
    const description = cycle.length > 8 ? `${shown} -> ... (+${cycle.length - 8} more)` : shown;
    for (const id of cycle) {
      const row = byId.get(id);
      if (!row) continue;
      findings.push(
        rowFinding(file, row, "ATC005", "error", config.columns.parent, `Hierarchy cycle detected: ${description}.`, "Break the cycle by assigning at least one node to a parent outside the cycle or to root."),
      );
    }
  }

  const roots = rows.filter((row) => row.id.trim() && !row.parentId.trim());
  if (config.rules.rootPolicy === "one" && roots.length !== 1) {
    findings.push(
      makeFinding({
        ruleId: "ATC006",
        severity: "error",
        message: `Configuration requires one root, but ${roots.length} root rows were found.`,
        suggestion: "Choose one root or change rules.rootPolicy to 'any'.",
        file,
        line: 1,
        field: config.columns.parent,
      }),
    );
  }

  const memo = new Map<string, number | null>();
  for (const row of rows) {
    if (!row.id || byId.get(row.id) !== row) continue;
    const depth = graphDepth(row.id, byId, memo);
    if (depth !== undefined && config.rules.maxDepth !== null && depth > config.rules.maxDepth) {
      findings.push(
        rowFinding(file, row, "ATC008", "error", config.columns.id, `Computed depth ${depth} exceeds configured maximum ${config.rules.maxDepth}.`, "Move the row to a shallower parent or revise the explicit maximum-depth policy."),
      );
    }
    if (row.levelText.trim()) {
      const declared = Number(row.levelText);
      if (!Number.isInteger(declared) || declared < 1) {
        findings.push(rowFinding(file, row, "ATC009", "warning", config.columns.level, "Declared level is not a positive integer.", "Enter the graph depth as a positive integer.", "invalid-level"));
      } else if (depth !== undefined && declared !== depth) {
        findings.push(
          rowFinding(file, row, "ATC009", "warning", config.columns.level, `Declared level ${declared} does not match computed depth ${depth}.`, "Update the declared level or correct the parent relationship.", "depth-mismatch"),
        );
      }
    }

    if (row.path.trim()) {
      const segments = row.path.split(config.rules.pathSeparator).map((part) => canonical(part)).filter(Boolean);
      const finalSegment = segments.at(-1) ?? "";
      if (row.name.trim() && finalSegment !== canonical(row.name)) {
        findings.push(rowFinding(file, row, "ATC010", "warning", config.columns.path, "Path does not end with the row name.", "Make the last path segment match the asset name.", "path-tail"));
      }
      const parent = byId.get(row.parentId);
      if (parent?.path.trim()) {
        const expectedPrefix = `${parent.path}${config.rules.pathSeparator}`;
        if (!row.path.startsWith(expectedPrefix)) {
          findings.push(rowFinding(file, row, "ATC010", "warning", config.columns.path, "Child path does not extend its parent's path.", "Build the child path from the complete parent path.", "parent-prefix"));
        }
      }
    }
  }

  const siblingNames = new Map<string, AssetRow[]>();
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const key = `${canonical(row.parentId)}\u0000${canonical(row.name)}`;
    const group = siblingNames.get(key) ?? [];
    group.push(row);
    siblingNames.set(key, group);
  }
  for (const group of siblingNames.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      findings.push(rowFinding(file, row, "ATC011", "warning", config.columns.name, "Sibling name is duplicated under the same parent.", "Differentiate the names or confirm that separate rows are intentional."));
    }
  }

  let scorePenalty = 0;
  for (const severity of rowSeverities.values()) {
    if (severity === "error") scorePenalty += 1;
    else if (severity === "warning") scorePenalty += 0.25;
    else scorePenalty += 0.05;
  }
  return {
    ...parsed,
    findings: sortFindings([...retained.error, ...retained.warning, ...retained.notice]),
    findingStatistics: {
      errors: counts.error,
      warnings: counts.warning,
      notices: counts.notice,
      scorePenalty,
    },
  };
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) =>
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || compareText(left.file, right.file)
      || left.line - right.line
      || compareText(left.field, right.field)
      || compareText(left.ruleId, right.ruleId)
      || compareText(left.message, right.message),
  );
}

function statisticsFor(file: ParsedFile): NonNullable<ParsedFile["findingStatistics"]> {
  if (file.findingStatistics) return file.findingStatistics;
  const counts = { errors: 0, warnings: 0, notices: 0, scorePenalty: 0 };
  const rowSeverities = new Map<number, Severity>();
  for (const finding of file.findings) {
    if (finding.severity === "error") counts.errors += 1;
    else if (finding.severity === "warning") counts.warnings += 1;
    else counts.notices += 1;
    const existing = rowSeverities.get(finding.line);
    if (!existing || SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[existing]) {
      rowSeverities.set(finding.line, finding.severity);
    }
  }
  for (const severity of rowSeverities.values()) {
    if (severity === "error") counts.scorePenalty += 1;
    else if (severity === "warning") counts.scorePenalty += 0.25;
    else counts.scorePenalty += 0.05;
  }
  return counts;
}

function scoreReport(files: ParsedFile[]): number {
  const totalRows = files.reduce((total, file) => total + file.assets.length, 0);
  if (totalRows === 0) return 0;
  const penalty = files.reduce((total, file) => total + statisticsFor(file).scorePenalty, 0);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - penalty / totalRows))));
}

export function buildReport(
  files: ParsedFile[],
  configSha256: string,
  config: AssetTreeConfig,
  retainedFindings?: Finding[],
): AssetTreeReport {
  const statistics = files.map(statisticsFor);
  const errors = statistics.reduce((total, value) => total + value.errors, 0);
  const warnings = statistics.reduce((total, value) => total + value.warnings, 0);
  const notices = statistics.reduce((total, value) => total + value.notices, 0);
  const totalFindings = errors + warnings + notices;
  const candidates = sortFindings(retainedFindings ?? files.flatMap((file) => file.findings));
  const detailLimit = totalFindings > config.limits.maxFindings ? config.limits.maxFindings - 1 : config.limits.maxFindings;
  let findings = candidates.slice(0, detailLimit);
  if (totalFindings > detailLimit) {
    const omitted = totalFindings - detailLimit;
    const firstFile = files[0]?.input.path ?? "asset-data";
    findings.push(
      makeFinding({
        ruleId: "ATC999",
        severity: "notice",
        message: `${omitted} additional findings were omitted by the configured report limit.`,
        suggestion: "Correct the highest-severity findings first, then rerun the check.",
        file: firstFile,
        line: 1,
        field: "file",
      }),
    );
    findings = sortFindings(findings);
  }

  const operationalErrors = files.reduce((total, file) => total + file.operationalErrors, 0);
  const rows = files.reduce((total, file) => total + file.input.rows, 0);
  const passed = operationalErrors === 0 && !qualityGateFails(errors, warnings, config.gate.failOn);

  return {
    schemaVersion: "1.1",
    tool: { name: TOOL_NAME, version: TOOL_VERSION, ruleset: RULESET_VERSION },
    configSha256,
    inputs: files.map((file) => file.input).sort((left, right) => compareText(left.path, right.path)),
    gate: { mode: "all", failOn: config.gate.failOn },
    comparison: initialComparison(errors, warnings, notices),
    summary: {
      files: files.length,
      rows,
      score: scoreReport(files),
      errors,
      warnings,
      notices,
      passed,
      operationalErrors,
    },
    findings,
  };
}
