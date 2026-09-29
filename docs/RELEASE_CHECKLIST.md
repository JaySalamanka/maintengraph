# Release assurance record — v2.0.1

Release date: 2026-09-29
Owner and maintainer: Mohammad Allatayfeh
License: MPL-2.0

This is the repeatable release gate. A checked item records technical or owner
verification; it is not a legal certification.

## Identity and public boundary

- [x] Owner authorized commercialization and public release of this repository.
- [x] MaintenGraph passed exact-name searches on GitHub and npm before adoption.
- [x] The rename preserves the immutable v1 release and legacy CLI alias.
- [x] No claim of trademark registration or CMMS-vendor endorsement is made.
- [x] Public fixtures and examples are synthetic and path-allowlisted.
- [x] MPL-2.0, SPDX ownership and third-party notices remain present.
- [x] Customer files, site-specific decisions and private source documents remain outside this repository.

## Product quality and security

- [x] Structural, parser, graph, baseline, governance, path, symlink,
      resource-limit, report, injection, CLI and Action tests pass.
- [x] Governance review and release behavior is covered by positive and negative tests.
- [x] The Action uses Node 24 with read-only repository permission and no secret.
- [x] Runtime no-egress and no-subprocess tests pass.
- [x] Compiled bundles reproduce from source in the same commit.
- [x] Exact repository and npm-package allowlists pass.
- [x] Clean tarball installation and both CLI-name smoke tests pass offline.
- [x] Dependency audit reports zero known vulnerabilities at the configured threshold.

## Publication

- [x] Method, rule reference, migration, privacy, security and support documents are included.
- [x] Stable version `2.0.1`, immutable tag `v2.0.1`, and moving major tag `v2`
      identify the reviewed release.
- [x] GitHub release artifacts are built from the exact tagged commit.
- [x] The Marketplace listing points to the release-owned Action metadata.

## Deliberately separate

- MaintenGraph validates the decision record; it does not invent or certify physical truth.
- npm publication requires owner authentication and is not required for the GitHub Action.
- Paid source review and customer delivery require a separate private intake channel and terms.
- A jurisdiction-specific trademark opinion remains an optional owner decision.
