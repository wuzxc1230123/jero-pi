# Proposal: Port gentle-ai v1.46.0 Review v2

## Intent

gentle-pi’s older gate misroutes 400-line/ordinary pre-PR diffs and can block retries. Port final gentle-ai v1.46.0 behavior via Pi-native contracts/runtime.

## Scope

### In Scope
- Route objectively trivial diffs to no lens, standard diffs to exactly one dominant-risk lens, and non-trivial hot paths or strictly `>400` lines to full 4R; 400 is standard and 401 is full. Pre-commit/pre-push never run full 4R.
- Make Pi review routing non-blocking while preserving unrelated dangerous-command confirmation; ambiguous executable/config changes route standard.
- Define precision, sweep, severity, persistence, and convergence contracts: one standard sweep, at most two per full lens, concrete user-impact findings only, terminal `refuted`, informational WARNING/SUGGESTION rows, Engram-to-inline fallback, and at most two severe-finding fix/scoped-re-review rounds using only ledger and fix diff.
- Run zero refuters without severe candidates; otherwise exactly one standard general refuter or exactly three full-4R refuters (correctness, impact/exploitability, reproducibility) over complete candidate lists. The standard refuter's single per-finding verdict is decisive: `refuted` marks that finding terminal; `stands` and malformed/missing/omitted verdicts preserve it. Full 4R uses independent two-of-three voting per finding. Judgment Day uses two blind judges and zero refuters.
- Install `review-refuter` with exactly `read`, `grep`, `find`, avoiding upstream Kimi exclusion and OpenCode deep-merge permission defects.
- Add full strict-TDD package/runtime tests covering routing, ledger parity, installation, effective permissions, forced refresh, and safety composition.

### Out of Scope
- Review receipts, hard workflow gates, user-override control, commits, pushes, tags, releases, publication triggers, publishing, or publication-only version bumps.

## Capabilities

### New Capabilities
- `review-routing`: Deterministic trivial/standard/full routing and non-blocking safety-preserving runtime behavior.
- `review-orchestration`: Precision-gated 4R/Judgment Day lifecycle, bounded refutation, persistence, convergence, permissions, and packaging.

### Modified Capabilities
None; canonical specs are empty.

## Approach

Follow exploration approach 1: contract-first TDD, package-owned Markdown assets, pure typed routing, orchestrator-owned merge/voting/persistence, and dynamic refutation outside the static 4R chain. Use independently testable units in one uncommitted working tree. Forecast: 900–1,200 changed lines against the accepted 800-line review budget; create no PR.

## Affected Areas

| Area | Impact |
|---|---|
| `lib/`, `extensions/` | Routing and non-blocking runtime |
| `assets/`, `skills/` | Review, ledger, refuter, Judgment Day contracts |
| `tests/`, package verification, `README.md` | Full behavioral and installed-runtime proof |

## Risks

Mitigate contract drift, permissive triviality, safety regressions, static-chain overreach, and reviewer load through parity/boundary/permission/harness/package tests.

## Rollback Plan

Revert this change’s uncommitted files; retain current v1 routing/assets. No migration or release rollback is required.

## Dependencies

- Pi subagent runtime and forced asset refresh.

## Success Criteria

- [ ] All listed final v1.46.0 contracts and boundaries are executable and tested.
- [ ] `pnpm test` and package-content verification pass without delivery or publication actions.
