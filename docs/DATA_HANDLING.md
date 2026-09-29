# Data handling

MaintenGraph is an offline validator.

- It reads only CSV files selected by repository-relative globs.
- An optional baseline is an existing MaintenGraph result JSON read from a
  contained repository-relative path. Baselines are limited to 10 MiB and
  reject absolute paths, traversal, symbolic-link components, invalid UTF-8,
  malformed JSON, incompatible rulesets, operational errors, and incomplete
  finding details. A run rejects a baseline path that would be overwritten by
  any of its generated report files.
- It rejects absolute paths, traversal, symbolic-link inputs, oversized files,
  excessive rows/columns/fields, and output paths outside the workspace.
- It writes JSON, SARIF, and Markdown reports inside a contained local directory.
  Report directories and files request owner-only permissions (`0700`/`0600`)
  where the operating system supports POSIX modes, and writes use an atomic
  temporary-file replacement. Detailed reports still contain source-derived
  identifiers, paths, messages, and hashes, so the workspace itself must be
  access-controlled.
- MaintenGraph initiates no telemetry, analytics, external application request,
  AI call, account lookup, remote validation, or file upload. Its GitHub
  integration dependency contains transport-capable code used by the Actions
  ecosystem, but MaintenGraph does not invoke those network APIs.
- It needs no GitHub secret and the sample workflow grants only `contents: read`.
- It does not create pull-request comments. By default GitHub receives only
  aggregate counts and score in the job summary. Detailed paths and messages
  remain in runner-local reports unless the workflow owner explicitly sets
  `publish-details: true`, which sends them to GitHub annotations and the job
  summary.

GitHub-hosted runners, summaries, annotations, and logs remain subject to the
repository owner's GitHub settings and policies. Users are responsible for
deciding whether their hierarchy data may be processed in their selected runner
environment or published through the opt-in detail setting.

Do not send customer files through a public issue or an audit link. Paid intake
must use separately approved terms and a secure private channel.
