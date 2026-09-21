# jero-pi technical reference

jero-pi is a Pi coding-agent extension package: review authority, SDD/OpenSpec
orchestration, subagents, persistent memory, and the shell layer — all
in-process Node, zero native binaries, zero install-time network.

Requires Pi 0.85.1 or newer (the tested minimum for `agent_settled`).

## Architecture

- **In-process review authority** (`lib/authority/`): START → consent →
  relay-reviewed lenses → freeze/classify → correction (plan + derived
  bounded edit) → targeted validation → acknowledge burn → maintenance.
  State lives under `.git/jero-review/` (CAS objects, lineage records,
  candidate views) and travels with the repository.
- **Pi host relay** (`lib/review-host-relay.ts`): renders the authority's
  reviewer/role prompts and runs the locked pi child; admission is always
  in-process. The `gentle-pi.review-relay/v1` cross-process handshake is
  deleted by design.
- **Client contract** (`lib/authority/client-contract.ts` + `wire-contract.ts`):
  the wire vocabulary is byte-pinned by the relocated golden vectors
  (`tests/fixtures/review-integration/`); those schema strings intentionally
  survive the identity pass.
- **Persistent memory** (`lib/memory.ts` + `mem_save`/`mem_read`/`mem_list`/
  `mem_search`): topic-keyed files under the memory root.

## Identity (jero namespace)

| Surface | Value |
|---|---|
| Commands | `/jero:*` (status/review-mode/persona/profiles/models/usage/doctor/agents/changes/background-subagents/review-session-permission/sdd-preflight/banner*/toggle*/install-*), `/jero-sdd-*` flows. Review lifecycle verbs (`inspect`/`start`/`answer-consent`/`assess`/`finalize`/`validate`) are `jero_review` tool operations, not slash commands |
| Environment | `JERO_PI_*` (AGENT_HOME honors `PI_CODING_AGENT_DIR`) |
| Config home | `~/.pi/jero/` (global), `<repo>/.pi/jero/` (project), `<repo>/.jero/policies/` (review policies) |
| Contracts | `jero.session-change/v1`, `jero.session-worktree/v1`, `jero.child-standing-review-permission/v1`, `jero.background-subagents/v1`, `jero.agent_model_profiles/v1`, `jero.verify-result/v1`, `jero.authority/v1` |
| Skills / assets | `jero` + `jero-*` skill names; `agents/jero-{explore,verify,worker}.md`; `jero/support/*` |

## Review Lens Selection

`review-risk`, `review-reliability`, `review-resilience`, and
`review-readability` are the review-lens vocabulary. The static orchestrator
and this reference never select, invoke, sequence, or retry those lenses;
any applicable runtime uses only its dynamically supplied instructions.

## Review authority operations

The review controller tool (`jero_review`) owns the lifecycle; capture slots
run through `jero_review_capture` with exactly one current collect binding.
Review outcomes and receipt state are informational; commit, push, pull-request, and release delivery follow ordinary repository policy.

Maintenance is explicit, audited, and fail-closed headless: RESET and RECOVER stay destructive, audited last resorts; every refusal answers in typed envelopes.

- **abandon** — needs lineage, expectedRevision, snapshotIdentity,
  capturedLensResults, findingsPresent, actor, reason; the exact eight-line
  authorization binding is derived and displayed for fresh UI approval.
- **reclaim** — quarantines a stuck authority directory destructively
  (audit record with quarantine name).
- **recover** — exactly six inputs: predecessorLineage,
  expectedPredecessorRevision, successorLineage, disposition, actor, reason;
  never a reset challenge, never a maintainerAuthorization.
- **reconcile-authority** — predecessor lineage and revision, plus successor lineage and revision; the exact seven-line binding with optional `anomalies=unchanged_target,malformed_recovery_authorization` in that exact order. It may quarantine only the bound invalid compact-v2 recovery successor; the predecessor stays untouched. The model supplies only lineage, actor, and reason — every binding is derived, displayed for
  fresh interactive approval, and refused headless.

`review dispose-result` is unsupported pending design. The legacy quarantine-legacy and alias-repair routes are retired: a jero-pi store never carries legacy authority (foreign `gentle-ai/reviews` and
`gentle-ai/review-transactions` stores are detected and refused).

## Dynamic RDD ownership

jero-pi dynamically supplies runtime-specific RDD instructions; the static orchestrator prompt does not define an RDD lifecycle. Dangerous-command safety remains independent and authoritative. Managed agents install under package-managed isolated installation (`<agent-home>/jero/managed-assets.json`, hash-proven); Project and user overrides may shadow a package asset, and renames from the upstream namespace migrate only untouched package-owned copies while always preserving user edits and routing.

## Skill names

Treat former package names such as `branch-pr`, `judgment-day`, and
`skill-creator` as legacy aliases in prose only; runtime skill selection should use
the prefixed `jero-branch-pr`, `jero-judgment-day`, `jero-skill-creator`, and
sibling `jero-*` names.

## Supply chain

All six companion dependencies are pinned exact; `@earendil-works/pi-tui`
is a `"*"` peer (the host bundles the pi-tui/pi-ai/pi-agent-core core
family; tests pin 0.85.1 to the tested host). Companions load through
`node_modules/` resource references in the `pi` manifest — the host's
documented contract for depending on other pi-packages; missing paths are
skipped silently, so "installed means usable" holds without a wrapper
layer. Nothing is bundled: pi-pretty and pi-lens carry platform-specific
native dependencies that must resolve per-platform through the host's
`npm install`; exact pins in `dependencies` govern the resolved versions.
The per-companion off switch is Pi's settings-level package/resource
filtering (plus pi-pretty's own `PRETTY_DISABLE_TOOLS`); the wrapper-era
`JERO_PI_PRETTY` env from the design matrix is retired with the wrapper.
`pnpm-workspace.yaml` enforces release age, trust no-downgrade, and no
exotic subdependency sources; the lockfile is committed; CI re-runs the
dependency audit and the packed-artifact assertion
(`scripts/verify-package-files.mjs`).
