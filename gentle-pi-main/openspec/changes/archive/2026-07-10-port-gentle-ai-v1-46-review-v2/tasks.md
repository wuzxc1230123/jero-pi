# Tasks: Port gentle-ai v1.46.0 Review v2

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,200 across 20–26 files |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Units 1 → 2 → 3 → 4 as autonomous uncommitted review slices; no PR/commit |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

Maintainer-approved `size:exception` recorded from the explicit instruction to implement the complete forecasted change automatically; delivery remains uncommitted.

## Suggested Work Units

| Unit | Goal | Verification | Rollback boundary |
|---|---|---|---|
| 1 | Installed refuter | Asset/package/runtime tests | Refuter-only files/hunks |
| 2 | Canonical orchestration contract | Contract parity test | Contract/replica files |
| 3 | Routing and runtime safety | Routing/gate/harness tests | Runtime/routing files |
| 4 | Parent integration and final proof | Full suite/package check | Integration/docs files |

## Unit 1: Review-refuter asset

- [x] 1.1 **RED:** In `tests/{package-manifest,sdd-agent-tools}.test.ts` and `tests/runtime-harness.mjs`, fail Package permissions/Explicit override scenarios for source, packaged, installed, forced-refresh identity, exact tools, forbidden capabilities, and untouched overrides. Run `node --experimental-strip-types --test tests/package-manifest.test.ts tests/sdd-agent-tools.test.ts && pnpm run test:harness`.
- [x] 1.2 **GREEN:** Create `assets/agents/review-refuter.md` with identity `review-refuter` and exactly `read`, `grep`, `find`; add package proof to `scripts/verify-package-files.mjs` while preserving generic installation in `lib/sdd-preflight.ts`.
- [x] 1.3 **REFACTOR/triangulate:** Add malformed/override cases and rerun 1.1. Roll back only the new asset and test/verifier hunks.

## Unit 2: Canonical contract and replicas

- [x] 2.1 **RED:** Extend `tests/review-ledger-contract.test.ts` with named parity clauses for Precision limits, Terminal rows, Persistence fallback, Actor counts, Mode-specific voting, Fail-closed handling, Scoped re-review, Round limit, and Judgment Day exception. Run `node --experimental-strip-types --test tests/review-ledger-contract.test.ts`.
- [x] 2.2 **GREEN:** Update `skills/_shared/review-ledger-contract.md`, four `assets/agents/review-*.md`, three `assets/agents/jd-*.md`, and `skills/judgment-day/{SKILL.md,references/prompts-and-formats.md}` for one/two sweeps, severity/info rules, 0/1/3 complete-list batching, per-ID voting, persistence, two-round convergence, and two-judge/zero-refuter parity.
- [x] 2.3 **REFACTOR/triangulate:** Remove replica drift without weakening role-specific clauses; rerun 2.1. Roll back only canonical/replica changes.

## Unit 3: Deterministic routing and safety

- [x] 3.1 **RED:** Rewrite `tests/{review-triggers,review-gate}.test.ts` and `tests/runtime-harness.mjs` for trivial/ambiguous/ordinary, 399/400/401, hot/trivial-hot, ceiling, advice continuation, dangerous confirmation, and no-delivery scenarios. Run `node --experimental-strip-types --test tests/review-triggers.test.ts tests/review-gate.test.ts && pnpm run test:harness`.
- [x] 3.2 **GREEN:** Replace rules in `lib/review-triggers.ts` with const-derived flat typed evidence/plans and deterministic precedence; update `extensions/gentle-ai.ts` to collect conservative evidence, notify, return `undefined`, then independently call `confirmCommand`.
- [x] 3.3 **REFACTOR/triangulate:** Add stable-lens-order and incomplete-evidence cases; rerun 3.1. Roll back only routing/runtime and associated test hunks.

## Unit 4: Integration and clean verification

- [x] 4.1 **RED:** Add lens-only-chain/parent-ownership and package/docs assertions in `tests/{review-ledger-contract,orchestrator-budget,package-manifest}.test.ts`; target all orchestration scenarios plus Verification stop.
- [x] 4.2 **GREEN:** Align `assets/{orchestrator.md,orchestrator-delegation.md,chains/4r-review.chain.md}`, `skills/gentle-ai/SKILL.md`, `README.md`, and package checks; keep `package.json` version/scripts unchanged.
- [x] 4.3 **REFACTOR/verify:** Run `node --experimental-strip-types --test tests/review-ledger-contract.test.ts tests/orchestrator-budget.test.ts tests/package-manifest.test.ts`, `pnpm test`, `node scripts/verify-package-files.mjs`, `git diff --check`, and `git status --short`; leave work unstaged/uncommitted and unpublished. Roll back only Unit 4 files; retain passing Units 1–3.
