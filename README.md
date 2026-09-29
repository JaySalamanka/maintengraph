<p align="center">
  <img src="docs/assets/maintengraph-banner.svg" alt="MaintenGraph — evidence-aware CMMS quality gate" width="900">
</p>

<p align="center">
  <a href="https://github.com/JaySalamanka/maintengraph/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/JaySalamanka/maintengraph/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MPL-2.0" src="https://img.shields.io/badge/license-MPL--2.0-0b7285.svg"></a>
  <img alt="Node.js 22+" src="https://img.shields.io/badge/node-%3E%3D22-339933.svg">
  <img alt="Network egress: none" src="https://img.shields.io/badge/runtime%20egress-none-1f6feb.svg">
</p>

**MaintenGraph is an evidence-aware quality gate for CMMS asset hierarchies.**
It checks graph integrity, import readiness, physical-identity discipline,
evidence coverage and review status before a hierarchy reaches a CMMS.

No account. No telemetry. No customer-data upload. No automatic rewriting.

## From a valid tree to a defensible asset register

Traditional validators can prove that every parent exists. They cannot tell you
that two spreadsheet rows represent the same pump, that a shared panel was
duplicated under three consumers, or that a guessed placement was presented as
confirmed.

MaintenGraph adds a governed release layer:

- one physical identity cannot silently become multiple CMMS objects;
- every hierarchy claim can carry exact source or field-verification evidence;
- confirmed, accepted, provisional, open and rejected decisions remain explicit;
- physical records without identity keys are exposed;
- legacy identifiers cannot silently map to multiple current assets;
- catch-all buckets such as “Electrical Parts” can be prohibited;
- unresolved review records block release mode instead of disappearing into prose.

It also retains all v1 structural checks: IDs, parents, cycles, roots, depth,
ordering, levels, paths, sibling names, unsafe formulas and hidden characters.

MaintenGraph does **not** infer physical truth, merge assets, invent missing
values or certify a third-party importer. It makes the engineering decision
trail testable.

## GitHub Action

```yaml
name: Governed asset hierarchy

on:
  pull_request:
    paths:
      - "asset-data/**"
      - ".maintengraph.json"

permissions:
  contents: read

jobs:
  asset-governance:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - id: maintengraph
        uses: JaySalamanka/maintengraph@v2
        with:
          files: asset-data/**/*.csv
          config: .maintengraph.json
          fail-on: error
```

The Action requests no secret and no write permission. Aggregate counts are
published by default; finding details remain opt-in because asset identifiers
and source references may be operationally sensitive.

## Governed configuration

```json
{
  "version": 2,
  "files": ["asset-data/**/*.csv"],
  "columns": {
    "id": "asset_id",
    "parent": "parent_asset_id",
    "name": "name",
    "path": "path",
    "level": "level",
    "identity": "physical_identity",
    "evidence": "evidence",
    "reviewStatus": "review_status",
    "objectClass": "object_class",
    "legacyIds": "legacy_ids"
  },
  "rules": {
    "rootPolicy": "one",
    "maxDepth": 6,
    "requireParentBeforeChild": true,
    "pathSeparator": "/",
    "governance": {
      "mode": "review",
      "forbidGenericBuckets": true
    }
  },
  "gate": { "failOn": "error" }
}
```

Use `review` while reconciling sources. Switch to `release` only when the file
is intended for an approved import or controlled handoff. Release mode blocks
unresolved states and missing evidence instead of encouraging false certainty.

See the complete [asset governance method](docs/ASSET_GOVERNANCE_METHOD.md),
[rule reference](docs/RULE_REFERENCE.md), and synthetic
[governed example](examples/governed-assets.csv).

## CLI

Requires Node.js 22 or newer.

```bash
npx maintengraph check "asset-data/**/*.csv" \
  --config .maintengraph.json \
  --output-dir .maintengraph
```

The legacy `hierarchyguard` executable remains an alias in v2. Exit codes are
`0` for a passing gate, `1` when findings reach the configured threshold, and
`2` for malformed input, configuration or operational errors.

## Review without freezing legacy defects

Capture an approved result and fail only on new or more-severe findings:

```bash
maintengraph check "asset-data/**/*.csv" \
  --config .maintengraph.json \
  --baseline .maintengraph-baselines/main.json \
  --gate-mode new
```

Baselines are local, deterministic and ruleset-bound. HierarchyGuard v1
baselines must be regenerated for MaintenGraph v2; see the
[migration guide](docs/MIGRATION_V2.md).

## Evidence outputs

Every run writes:

- `results.json` — deterministic machine-readable evidence;
- `results.sarif` — compatible with SARIF consumers;
- `summary.md` — human-readable findings and correction guidance.

Input hashes, configuration hashes and stable finding fingerprints make changes
reviewable across runs. Generated reports may contain operational identifiers,
so treat the output directory as controlled data.

## Security and privacy

- Runtime network and subprocess access are blocked in verification tests.
- Absolute paths, traversal, symlinks and workspace escapes are rejected.
- CSV sizes, rows, columns, fields and findings are bounded.
- Reports are contained, atomic and owner-only where supported.
- Action and CLI bundles are reproducibly rebuilt and diffed in CI.
- Dependencies and workflow actions are pinned and reviewed.

Read [data handling](docs/DATA_HANDLING.md), [security](SECURITY.md), and
[support](SUPPORT.md).

## Development

```bash
npm ci --ignore-scripts
npm run check
npm run pack:inspect
```

MaintenGraph is created and maintained by **Mohammad Allatayfeh**. Copyright
2026 Mohammad Allatayfeh. Source code is licensed under the
[Mozilla Public License 2.0](LICENSE); product names and marks follow the
[marks policy](TRADEMARKS.md).
