# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.1] - 2026-09-29

### Changed

- Updated direct and transitive minor/patch dependencies and rebuilt the reviewed bundles.
- Advanced CodeQL initialization and analysis together to pinned v4.38.2.

## [2.0.0] - 2026-09-29

### Added

- Evidence-aware review and release governance profiles.
- Governed physical-identity, evidence, review-status, object-class and legacy-ID columns.
- Deterministic blockers for unsupported certainty, duplicated physical identities,
  ambiguous migration ownership and catch-all ownership buckets.
- A field-tested asset reconciliation method, governed example and v1 migration guide.

### Changed

- Renamed the product and primary CLI from HierarchyGuard to MaintenGraph.
- Kept configuration v1 and the `hierarchyguard` executable as compatibility paths.
- Advanced the ruleset to `asset-governance@2`; v1 baselines must be regenerated.

## [1.0.1] - 2026-08-23

### Changed

- Updated the reproducible Action/CLI bundler and rebuilt the reviewed bundles.
- Kept CodeQL initialization and analysis on one pinned release.
- Made large-hierarchy test cleanup reliable on slower Windows filesystems.

## [1.0.0] - 2026-08-09

### Added

- Offline CSV validation for IDs, parent relationships, graph integrity,
  hierarchy depth, import ordering, declared levels, paths and unsafe cells.
- GitHub Action with read-only permissions and privacy-preserving summaries.
- Node.js CLI with deterministic JSON, Markdown and SARIF reports.
- Transparent hierarchy score, stable finding fingerprints and baseline mode.
- Bounded resource use, path containment, symlink defenses and atomic reports.
- Reproducible bundles, exact public-tree/package allowlists and no-egress tests.

[1.0.0]: https://github.com/JaySalamanka/hierarchyguard/releases/tag/v1.0.0
[1.0.1]: https://github.com/JaySalamanka/hierarchyguard/releases/tag/v1.0.1
[2.0.0]: https://github.com/JaySalamanka/maintengraph/releases/tag/v2.0.0
[2.0.1]: https://github.com/JaySalamanka/maintengraph/releases/tag/v2.0.1
[Unreleased]: https://github.com/JaySalamanka/maintengraph/compare/v2.0.1...HEAD
