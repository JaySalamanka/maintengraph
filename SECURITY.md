# Security policy

## Supported versions

| Version | Security support |
|---|---|
| 1.x | Supported |
| Pre-release builds | Not supported |

Use an immutable full release tag such as `v1.0.0` or a reviewed commit SHA in
sensitive workflows. The moving `v1` tag is maintained for convenience.

## Report a vulnerability privately

Use GitHub's **Security → Report a vulnerability** form in this repository.
Do not open a public issue for a suspected vulnerability.

Include the affected version, impact, reproduction steps and the smallest safe
synthetic example. Never submit customer hierarchy files, credentials,
proprietary repository content or personal data. Reports that require sensitive
evidence should first request handling instructions without attaching it.

The maintainer targets acknowledgement within three business days and initial
triage within seven business days. Resolution and disclosure timing depend on
severity, complexity and coordination needs; these targets are not an SLA.

## Security boundaries

MaintenGraph is intended to run without secrets, write permissions,
telemetry, network egress or execution of CSV content. Regressions in path
containment, report privacy, resource limits, deterministic output, dependency
integrity or those runtime boundaries are security-sensitive.

GitHub security advisories are for product vulnerabilities only. They are not a
support channel or a place to send operational/customer data.
