# Migrating from HierarchyGuard v1

MaintenGraph v2 is the successor to HierarchyGuard. The v1 Action remains pinned
at `JaySalamanka/hierarchyguard@v1`; GitHub repository redirects preserve that
reference after the repository rename.

## Compatibility

- Configuration version 1 remains valid and runs structural checks.
- The legacy `hierarchyguard` CLI command remains as an alias.
- v1 baselines must be regenerated because the tool name and ruleset changed.
- New defaults are `.maintengraph.json` and `.maintengraph/`.
- Governance rules are opt-in through configuration version 2.

## Recommended migration

1. Change the Action reference to `JaySalamanka/maintengraph@v2`.
2. Rename the configuration to `.maintengraph.json`.
3. Start with `rules.governance.mode: "review"`.
4. Add the four governed columns and resolve the resulting evidence gaps.
5. Generate a new baseline only after the findings have been reviewed.
6. Switch to `release` for import or controlled handoff branches.

Do not convert provisional records to confirmed merely to make the gate green.
The gate is useful only when uncertainty remains honest.
