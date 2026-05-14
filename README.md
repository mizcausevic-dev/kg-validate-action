# kg-validate-action

A GitHub Action that validates JSON files against the ten **Kinetic Gain Protocol Suite** specifications. Drop it into a vendor's CI to fail the build when a published Suite document (AI Entity Card, Tool Disclosure, Clinical AI Card, AI Incident Card, etc.) regresses against its schema.

The Action auto-detects which Suite spec each file belongs to via its top-level version field — `aeo_version`, `clinical_ai_card_version`, `aup_version`, and so on — then validates against the bundled JSON Schema 2020-12 document for that spec.

## Quick start

Add a workflow file under `.github/workflows/`:

```yaml
name: Suite Validation

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mizcausevic-dev/kg-validate-action@v0.1.1
        with:
          files: '.well-known/**/*.json'
```

That's it. Failures appear as PR check annotations on the offending file/line.

## Inputs

| Input | Default | Description |
|---|---|---|
| `files` | `.well-known/**/*.json` | Glob pattern (resolved with [fast-glob](https://github.com/mrmlnc/fast-glob)) for JSON files to validate. Any glob works; `**`, `?`, `[...]`, brace expansion are all supported. |

## What gets validated

Any JSON file containing one of the following top-level fields is matched and validated:

| Version field | Spec | Vertical |
|---|---|---|
| `aeo_version` | AEO Protocol | Core |
| `provenance_version` | Prompt Provenance | Core |
| `agent_card_version` | Agent Card | Core |
| `evidence_version` | AI Evidence Format | Core |
| `tool_card_version` | MCP Tool Card | Core |
| `tutor_card_version` | AI Tutor Card | EdTech |
| `disclosure_version` | Student AI Disclosure | EdTech (FERPA / COPPA) |
| `aup_version` | Classroom AI AUP | EdTech |
| `clinical_ai_card_version` | Clinical AI Card | HealthTech (FDA SaMD + HIPAA) |
| `incident_card_version` | AI Incident Card | Cross-cutting (EU AI Act Article 73) |
| `decision_card_version` | AI Procurement Decision Card | Cross-cutting (buyer-side) |

Files that don't carry any of these fields are **skipped with a warning**, not failed. Files that do carry one but fail validation against the corresponding schema **fail the action**.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every matched file passed validation (or no recognized files were present and the glob matched nothing) |
| `1` | At least one file failed validation, failed to parse, or hit a schema-loading error |
| `2` | No file in the glob carried a recognized Suite version field |
| `3` | Usage error (missing input, runtime crash) |

## How it works

1. Composite action sets up Node.js 20 via `actions/setup-node`.
2. Installs `ajv`, `ajv-formats`, and `fast-glob` into the action's own directory (sandboxed; no global pollution).
3. Runs `validate.js`, which:
   - Expands the input glob
   - For each file: parses JSON, detects the spec by version field, loads the bundled schema, validates with ajv (JSON Schema 2020-12 draft, `strict: false`, `allErrors: true`)
   - Emits GitHub Actions workflow commands (`::error::`, `::warning::`) so failures surface as PR annotations on the offending file
   - Prints a human-readable summary and exits with the appropriate code

The ten schemas live in `schemas/` inside this repo, copied verbatim from the spec repos under [github.com/mizcausevic-dev](https://github.com/mizcausevic-dev). To keep up with spec releases, this Action versions independently of the specs — update the action version in your workflow to pull a newer schema bundle.

## Local use

You can run the same validator outside of GitHub Actions:

```bash
git clone https://github.com/mizcausevic-dev/kg-validate-action
cd kg-validate-action
npm install
node validate.js "path/to/your/**/*.json"
```

## License

MIT. The schemas this action ships with are also MIT (from their respective spec repos). Reference implementations like [`mcp-kinetic-gain`](https://github.com/mizcausevic-dev/mcp-kinetic-gain) are AGPL-3.0 — the split is deliberate.

## Related

- **Suite hub:** [suite.kineticgain.com](https://suite.kineticgain.com/)
- **Unified MCP server:** [`mcp-kinetic-gain`](https://github.com/mizcausevic-dev/mcp-kinetic-gain) — every spec as an MCP tool
- **Unified visualizer:** [`kinetic-gain-visualizer`](https://github.com/mizcausevic-dev/kinetic-gain-visualizer) — paste any Suite JSON, get a procurement-grade card
