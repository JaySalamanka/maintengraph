# Contributing

Thank you for improving MaintenGraph. Bug fixes, tests, documentation and
well-scoped rule proposals are welcome.

## Before opening a pull request

1. Discuss significant behavior or schema changes in an issue first.
2. Use only synthetic data that you created and are authorized to publish.
3. Add or update tests for behavior changes.
4. Run `npm ci --ignore-scripts`, `npm run check`, and `npm run pack:inspect`.
5. Rebuild and commit `dist/` with the corresponding source.
6. Keep the runtime offline and the Action permission model read-only.

Never submit customer data, private rulebooks, real identifiers, prompts,
credentials, proprietary manuals, screenshots or generated media copied from
another product.

## Developer Certificate of Origin

Every commit must include a `Signed-off-by` line added with `git commit -s`.
By signing off, you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/):
you created the contribution or otherwise have the right to submit it under the
project license.

Contributions are licensed under MPL-2.0. Maintainers may request changes for
security, determinism, compatibility, privacy, scope or long-term maintenance.
