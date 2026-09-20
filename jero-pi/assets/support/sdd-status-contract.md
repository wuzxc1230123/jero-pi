# SDD Status and Action Context Contract

Shared OpenSpec-style contract for Gentle Pi SDD phases. Use this before acting on a change so orchestration and executors do not guess state, paths, or edit scope.

## Purpose

Any phase that selects, continues, applies, verifies, syncs, or archives an SDD change MUST first produce or consume structured status. The status is the handoff between the parent orchestrator and phase executor.

## Change Selection

- If a change name is provided, use that exact change after confirming it exists in the selected artifact store.
- If no change name is provided, infer only when the active change is unambiguous from session state or there is exactly one active change.
- If multiple active changes match or the active change is unclear, ask the user to choose. Do not guess.
- If no active changes exist, report that no SDD change is active and suggest starting one.

## Native Engine

- The in-process authority's `gentle-ai.sdd-status/v2` projection (rendered by `/jero-sdd-status`) is the sole status authority for every store. It is read-only: inspect its native projection unchanged and never launch a phase, prepare consent, or grant roots while reading it.
- If native status is unavailable, malformed, or does not select the requested change/workspace, stop and report that failure. Do not construct a local status, infer readiness from artifacts, substitute continuation, or bypass it through Engram.
- `nextRecommended`, `dependencies`, `blockedReasons`, `actionContext`, and optional `phaseInstructions` are producer facts. Route only by their typed values, never by prose or a local lifecycle graph. A genuine blocker's human-readable explanation belongs in `blockedReasons`; a non-blocking diagnostic belongs in `notes`; neither belongs in `nextRecommended`.
- Runtime-attempt authority is separate from status: managed remediation launches are acquire/settle-wrapped by the package runtime in-process (`proceed`, `blocked`, or `complete` routing); apply/verify single-flight is enforced through this same authoritative projection.
- Only explicitly authorized `/jero-sdd-continue` may resolve continuation; it routes by the same projection and grants no source roots.

## Bounded Planning Routing

For authoritative native status, route only by the bounded `nextRecommended` token and dependency states; never infer a route from prose. Keep genuine blockers in `blockedReasons` and non-blocking diagnostics in `notes`, never in `nextRecommended`, and report them without discarding them to enable a route.

| `nextRecommended` | Planning route |
| --- | --- |
| `propose` | `sdd-proposal` |
| `spec` | `sdd-spec` |
| `design` | `sdd-design` |
| `tasks` | `sdd-tasks` |

Native unprefixed tokens are the only automatic planning routes. Prefixed or locally derived status tokens never authorize a phase.

These planning routes remain runnable when missing planning artifacts leave `dependencies.apply: blocked`; do not require apply readiness to produce those artifacts. This is a planning-only exception, not permission to run apply or another blocked non-planning phase.

Before any planning launch, stop for ambiguous change selection, unresolved session preflight, or unsafe action context. Carry `actionContext` and prove planned writes are within the authoritative workspace or allowed edit roots; workspace-planning without allowed edit roots remains read-only. Planning does not bypass the init guard, pre-proposal gate, or phase approval requirements.

## Bounded Execution Routing

| Native `nextRecommended` | Pi executor |
| --- | --- |
| `apply` | `sdd-apply` |
| `verify` | `sdd-verify` |
| `remediate` | `sdd-remediate` |
| `archive` | `sdd-archive` |

Execute only a native selected action whose dependency and `actionContext` permit it. Unknown, malformed, blocked, or unsupported actions stop before work; no local route, prefixed token, or prose can replace them. `notes` is separate from `blockedReasons` and never gates: report a non-empty `notes` value as informational and proceed when the dependency and `blockedReasons` gates allow. Manual `sdd-sync` remains its intentional local resolver and is never an automatic native-status dispatch.

## Status Schema

Consume the native v2 projection (`schemaName: gentle-ai.sdd-status`, `schemaVersion: 2`) losslessly. Its producer-defined selection, artifact locators, task progress, seven dependencies, `actionContext`, `blockedReasons`, optional execution instructions, remediation state, and `nextRecommended` are status facts, not a Pi schema to recreate.

## Action Context Guard

The orchestrator MUST carry `actionContext` into any phase launch.

- If `mode: workspace-planning` and `allowedEditRoots` is empty, stop before editing, verifying implementation ownership, syncing specs, or archiving. Treat linked repos and folders as read-only planning context.
- If `allowedEditRoots` is present, only edit or move files within those roots.
- If a phase cannot prove a file is inside the authoritative workspace or allowed edit roots, stop and ask for clarification.

## Native Runtime Attempt Authority

The compact SDD runtime attempt authority is separate from artifact dispatch and status. It is artifact-store agnostic: the same acquire/settle discipline applies to `openspec`, `engram`, `both`, and `none` stores. Its payload MUST NOT be embedded in the SDD v1 status schema above; status reports artifact state only, never attempt tokens or attempt counters. No OpenSpec or Engram attempt ledger may be created or mirrored by Pi.

Managed remediation launches are acquire/settle-wrapped automatically by the package runtime (in-process, no CLI): the authority returns exactly one routing state from `proceed|blocked|complete` — launch only on `proceed`, stop on `blocked` or `complete` — and the runtime settles after the run. `sdd-apply` and `sdd-verify` are not attempt-wrapped; the orchestrator enforces their single-flight through the authoritative status projection: never two runtime-bearing actors for one change, never a launch that status does not admit. `reset` is never automatic and requires an explicit maintainer scope decision.

For the exact compact acquire/settle shapes and the full field semantics, see the `Native Runtime Attempt Authority` section of the lazy-loaded `SDD Orchestrator Workflow` contract. Do not look up `assets/...` paths at runtime; those are package source paths before installation.

## Status Output

Every command or agent that acts on a change MUST show or consume status before doing phase work:

- active change selection and how it was resolved;
- artifact statuses and paths/topics used as context;
- task progress and unchecked task list when tasks exist;
- next recommended action;
- any `actionContext` or edit-root warnings.
