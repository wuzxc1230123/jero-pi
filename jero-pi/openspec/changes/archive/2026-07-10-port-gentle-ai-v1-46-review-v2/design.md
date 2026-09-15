# Design: Port gentle-ai v1.46.0 Review v2

## Technical Approach

Replace the rule-set gate with a pure typed classifier, keep the Pi hook advisory, and express dynamic review behavior in the package-owned orchestrator contract. Markdown remains executable runtime configuration: one canonical v2 contract owns semantics, while role prompts replicate only their applicable clauses and parity tests prevent drift.

## Interfaces and Routing

`lib/review-triggers.ts` will define `REVIEW_ROUTE`, `REVIEW_LENS`, `TRIVIALITY`, and `EVENT_CEILING` const objects and derive their types. Flat `DiffEvidence`/`ReviewPlan` interfaces feed `classifyReviewRoute(evidence)`.

Classification order is deterministic:

1. Return `trivial`/zero lenses only when evidence is complete, every change is documentation, comment, formatting, or string-typo work, and no executable/configuration content changed. Runtime collection proves safe documentation-only cases; source/config ambiguity is `unproven`, therefore standard.
2. For non-trivial input, hot paths or `changedLines > 400` request full 4R. Tests freeze 399 and 400 as standard and 401 as full.
3. `pre-commit`/`pre-push` ceilings downgrade full to standard; `pre-pr`, CI, and schedule permit full. Post-SDD routing remains the separate Judgment Day path.
4. Standard selects one lens by fixed precedence: risk, resilience, reliability, then readability fallback. Full returns the four canonical lenses in stable order.

## Architecture Decisions

| Decision | Rejected alternative | Rationale |
|---|---|---|
| Conservative evidence classifier | Infer triviality from line count/path alone | False negatives cost one review; false positives suppress review. |
| Advice-only `applyReviewAdvice` | Completion receipts or strong blocking | Matches v1.46 and removes the retry deadlock without new state. |
| Canonical contract plus tested replicas | Runtime includes or independent prose | Pi agents consume standalone Markdown; named role parity arrays make replication auditable. |
| Dynamic parent orchestration | Encode voting/fix loops in `4r-review.chain.md` | Static sequential chain sections cannot branch on merged findings safely. |

## Runtime and Orchestration Flow

```text
bash → collect evidence → classify → notify → confirmCommand → execute/block by safety
lenses → parent merges ledger → severe list → 0/1/3 refuters → per-ID votes → fix/re-review ≤2
```

`extensions/gentle-ai.ts` will make every review route notify and return `undefined`; the tool hook will always continue to independent `confirmCommand`. Thus review never blocks, while dangerous push/destructive-command denial or confirmation remains authoritative even when advice was emitted.

The orchestrator filters the merged ledger to BLOCKER/CRITICAL. No candidates launches zero actors; standard launches one non-parallel general actor; full 4R launches exactly three parallel tasks—correctness, impact/exploitability, reproducibility—with the complete list sent to each. No per-finding or replacement tasks are allowed. Outputs are keyed by finding ID. In standard review, the single general verdict is decisive per finding: `refuted` terminally sets only that row; `stands`, unknown, duplicate, malformed, omitted, or missing verdicts preserve it. In full 4R, votes are independent per finding: at least two of three `refuted` verdicts terminally set only that row; fewer preserve it. WARNING/SUGGESTION become one-time `info` rows.

`4r-review.chain.md` remains lens discovery/report generation only. The parent owns merge, persistence with Engram-to-inline degradation, voting, fixes, and scoped re-review using only ledger plus fix diff. Judgment Day is explicit: exactly two blind parallel judges, zero refuters, then at most two severe-finding fix/re-judge rounds; round-two survivors escalate.

## Files and Tests

Create `assets/agents/review-refuter.md` with identity `review-refuter` and exactly `read`, `grep`, `find`. Modify routing/runtime files; `assets/{orchestrator.md,orchestrator-delegation.md,chains/4r-review.chain.md,agents/review-*.md,agents/jd-*.md}`; `skills/{_shared/review-ledger-contract.md,gentle-ai/SKILL.md,judgment-day/**}`; `README.md`; and `scripts/verify-package-files.mjs`. Keep `package.json` version unchanged.

Strict TDD work units, each retaining tests with behavior: (1) RED/GREEN/triangulate routing boundaries, ceilings, ambiguity, notifications, and safety composition in `tests/{review-triggers,review-gate}.test.ts` plus `tests/runtime-harness.mjs`; (2) canonical/role/orchestrator/refuter-count parity in `tests/review-ledger-contract.test.ts`; (3) source, package, forced-refresh, installed identity, effective active tools, forbidden capabilities, and untouched explicit override assertions in `tests/{package-manifest,sdd-agent-tools}.test.ts` and the harness; (4) Judgment Day, docs, and regression refactor. Run focused tests after each RED/GREEN cycle, then `pnpm test` and `node scripts/verify-package-files.mjs`.

The forecast exceeds 800 lines. Preserve these four independently reviewable diff slices in one uncommitted working tree; inspect each slice/stat separately, but do not stage or commit.

## Rollback and Delivery

No migration. Roll back by deleting the new asset and reverting this change’s uncommitted files. Do not commit, push, tag, release, pack/publish, trigger publication, or bump a publication-only version.
