## Exploration: Port gentle-ai v1.46.0 Review Framework to gentle-pi

### Current State
The exact upstream comparison was verified locally and against merged PR #1083. `v1.45.0` resolves to `946533c966d2dfd798f0e65f2175ad4ea60122f4`; the final annotated `v1.46.0` release resolves to merge commit `b22a7eb8730e0e255c7a6d142aedfc606cbb020e`. The release delta changes 74 files (2,506 additions, 611 deletions) and establishes these final behaviors:

- Deterministic routing: trivial diffs (only docs, comments, formatting, or string typo fixes; zero executable/config changes) run no lens; standard diffs run exactly one dominant-risk lens; hot-path or strictly `>400`-line diffs run full 4R. Pre-commit/pre-push never run full 4R. Post-design/post-apply routes to Judgment Day.
- Precision-gated review: one sweep for standard reviews and at most two per lens for full 4R; only concrete user-impacting defects are findings; `refuted` is a terminal ledger status.
- Bounded adversarial verification: standard review launches exactly one general refuter over the complete merged BLOCKER/CRITICAL list; full 4R launches exactly three complete-list refuters (correctness, exploitability/impact, reproducibility). Voting is independent per finding; at least two refutations kill that finding, while ties, malformed output, and missing verdicts preserve it.
- Severity and convergence budgets: WARNING/SUGGESTION are one-time `info` rows and never drive fixes; only surviving BLOCKER/CRITICAL rows enter at most two fix-and-scoped-re-review rounds. Re-review receives only the persisted ledger and fix diff.
- Judgment Day alignment: two blind judges provide adversarial verification themselves, so Judgment Day launches no `review-refuter`; warnings remain canonical `WARNING`/`info`, and unresolved severe findings after round two escalate.

gentle-pi currently carries the older v1 ledger contract. `lib/review-triggers.ts` uses `>=400`, has no trivial/standard/full route value, defaults pre-commit/pre-push to advisory readability, and returns no route for an ordinary pre-PR diff. `extensions/gentle-ai.ts` turns strong pre-PR matches into a real blocking `bash` hook, despite having no review-completion receipt, so retrying `gh pr create` can block forever. This differs from final upstream, whose trigger router is instruction text and explicitly never pauses or gates workflow.

Pi already has the right adaptation seams: package-owned Markdown agents, a lazy orchestrator/delegation split, a canonical review ledger document with parity tests, a forced global asset refresh on session start, and isolated installer tests. Installed `pi-subagents-j0k3r` v1.1.3 was also verified: it parses YAML tool arrays, removes `subagent_*` tools, and passes the remaining exact list directly to `createAgentSession`. Therefore a package-owned refuter with exactly `read`, `grep`, and `find` has an effective read-only runtime allowlist in an isolated installed agent home.

Two defects remain in the exact upstream release and must not be copied. Kimi's final YAML excludes obsolete `kimi_cli.tools.multiagent:Task`; OpenCode defines a plain refuter `tools` map while its JSON merger deep-merges maps unless `__replace__` is used, allowing unknown prior grants to survive. Pi needs neither adapter pattern: it can atomically install one complete Markdown definition with an exact non-empty tool list and verify the installed result.

The canonical `openspec/specs/` directory is currently empty. The repository has an unrelated pre-existing modification in `openspec/config.yaml`; this change must not overwrite or normalize it.

### Affected Areas
- `lib/review-triggers.ts` — introduce deterministic route classification, strict `>400` semantics, dominant-risk single-lens routing, and preserve `review-refuter` as non-trigger-bindable.
- `extensions/gentle-ai.ts` — adapt the actual Pi `bash` hook to upstream's non-blocking router semantics, conservatively treat uncertain triviality as standard, and keep command safety confirmation separate from review routing.
- `assets/orchestrator.md`, `assets/orchestrator-delegation.md`, `skills/gentle-ai/SKILL.md` — align always-on and lazy routing language, precision/refutation ownership, and Pi's dedicated-subagent execution mode without duplicating the full lazy contract into the core prompt.
- `skills/_shared/review-ledger-contract.md` — replace loop-until-dry with the complete v2 sweep, precision, refutation, severity, convergence, persistence, and scoped re-review contract while preserving Pi's explicit Engram-to-inline degradation.
- `assets/agents/review-{risk,readability,reliability,resilience}.md` — add the precision gate, sweep budget, v2 ledger lifecycle, and role-specific output requirements.
- `assets/agents/review-refuter.md` — add the batched refuter role with exact installed tools `read`, `grep`, `find`; no write, shell, or delegation capability.
- `assets/agents/jd-judge-{a,b}.md`, `assets/agents/jd-fix-agent.md`, `skills/judgment-day/SKILL.md`, `skills/judgment-day/references/prompts-and-formats.md` — align warning semantics, two-round convergence, judge/fix role boundaries, scoped re-judge, and the explicit zero-refuter exception.
- `assets/chains/4r-review.chain.md` — retain lens discovery/report generation as a static chain, but make orchestration own merge, batched refutation, per-finding voting, fixes, and scoped re-review because those dynamic decisions cannot be encoded safely as fixed sequential chain sections.
- `lib/sdd-preflight.ts`, `scripts/verify-package-files.mjs`, `package.json` packaging contract — rely on whole-file forced refresh, require the new asset in package verification, and avoid any release/version publication action.
- `tests/review-triggers.test.ts`, `tests/review-gate.test.ts` — cover trivial/standard/full routing, hot paths, dominant-risk fallback, 399/400/401 boundaries, pre-commit/pre-push prohibition, non-blocking runtime behavior, and fail-open inspection behavior.
- `tests/review-ledger-contract.test.ts` — enforce canonical v2 clauses by role, `refuted` lifecycle, fixed actor counts, full-list batching, per-finding voting, severity floor, convergence, and Judgment Day exception without positional clause slicing.
- `tests/package-manifest.test.ts`, `tests/sdd-agent-tools.test.ts`, `tests/runtime-harness.mjs`, `tests/orchestrator-budget.test.ts`, `tests/gentle-ai.test.ts` — prove package inclusion, forced installed refresh, exact effective refuter permissions, discoverability, lazy/core prompt parity, and concrete lens routing.
- `README.md` — document the released routing and runtime behavior after tests fix the contract; do not announce or publish a release.

### Approaches
1. **Pi-native full behavioral port with a non-blocking runtime router** — port the released contract and agents, while changing Pi's hook from a permanent blocker into notifications/instructions backed by deterministic pure classification. Let the orchestrator make semantic trivial/dominant-risk decisions; runtime uncertainty falls back to standard.
   - Pros: Matches final v1.46.0 semantics; avoids an unfinishable retry gate; preserves Pi's dedicated subagents and lazy prompt architecture; smallest safe runtime state model.
   - Cons: Requires coordinated contract, asset, runtime, package, and parity-test changes; the runtime alone cannot prove comment/formatting/string-only source edits.
   - Effort: High

2. **Keep a hard Pi pre-PR gate and add diff-bound completion receipts** — block standard/full routes until a registered review receipt matches the exact current diff.
   - Pros: Strong machine enforcement; can prove a requested review happened before PR creation.
   - Cons: Adds a new receipt protocol, tools, persistence, invalidation, and failure modes absent from final v1.46.0; substantially increases scope and risks bypass or permanent blocking.
   - Effort: Very High

3. **Prompt/assets-only port** — update contracts and agents but leave `lib/review-triggers.ts` and the runtime hook unchanged.
   - Pros: Lowest implementation cost.
   - Cons: Not a complete port: exactly 400 lines still routes incorrectly, standard/trivial pre-PR behavior remains absent, and the old permanent blocker contradicts released behavior.
   - Effort: Medium

### Recommendation
Use approach 1. Implement contract-first under strict TDD: freeze v2 role clauses and exact installed refuter permissions, add the package-owned refuter, propagate role-specific contracts, then update pure routing and the runtime hook. Use a const-object-derived TypeScript route type rather than a direct string union, keep interfaces flat, and do not use `any`.

The router must make 400 standard and 401 full by size. A hot path is full 4R unless the whole diff is objectively trivial. Triviality must never be guessed from an ambiguous source/config diff; uncertainty is standard. Standard routing selects exactly one highest-impact risk-table row (readability is only the default when no stronger signal is available). `review-refuter` remains orchestration-internal and must not be added to `KNOWN_AGENTS` or lifecycle bindings.

The review hook should continue the command after routing notification; unrelated dangerous-command confirmation remains authoritative. This is the clean Pi adaptation of upstream's explicit “renders text only; never pauses or gates” behavior and removes the current retry deadlock without inventing a receipt subsystem.

Refutation actor count must remain O(1): zero tasks when no severe candidates exist, one complete-list task for standard, and three complete-list tasks for full 4R regardless of finding count. Only those three full-4R refuters may run in parallel. Preserve Pi's orchestrator-owned merge/persistence, explicit Engram failure fallback, and Judgment Day's two judges/zero refuters.

Do not copy either upstream permission implementation. Install `review-refuter.md` as a complete package-owned file with the exact YAML list `read`, `grep`, `find`; test the source asset, forced temporary installation, parsed installed identity/tools, absence of write/bash/subagent tools, package verification, and session-start refresh path. No commit, push, tag, release, publication trigger, publish, or version-release action belongs to this change.

Expected implementation size is approximately 900–1,200 changed lines across roughly 20–26 files because the contract is intentionally replicated and parity-tested. This exceeds the authoritative 800-line review budget, so proposal/tasks must explicitly record the single-PR size risk and keep implementation organized as independently testable work units even though delivery remains one uncommitted working tree.

### Risks
- Contract drift across canonical, orchestrator, four review agents, Judgment Day assets, prompt templates, and tests; role-specific parity assertions are mandatory.
- A permissive trivial classifier could suppress review for executable/config changes; ambiguous changes must route standard.
- Retaining the current strong hook would preserve a permanent retry block; changing it without testing command-safety composition could accidentally weaken unrelated safety confirmation.
- Static `4r-review` chains cannot safely express dynamic candidate batching, voting, or bounded fix loops; presenting the chain as the whole workflow would be misleading.
- Installed agent names can be intentionally shadowed by project/user overrides; tests should prove the package-owned isolated installation, not claim control over explicit user overrides.
- The exact refuter list must use Pi tool names (`read`, `grep`, `find`), not upstream `Glob`, Kimi exclusions, or OpenCode boolean maps.
- The likely 900–1,200-line diff exceeds the 800-line budget under `single-pr-default`; reviewer load remains high even though no PR will be created in this session.
- `openspec/config.yaml` is already modified outside this phase and must remain untouched.

### Ready for Proposal
Yes. The upstream release, PR, target architecture, permission behavior, test seams, non-goals, and two defects to avoid are verified. The proposal should lock approach 1, strict `>400`, non-blocking runtime routing, exact installed refuter permissions, Judgment Day's zero-refuter exception, the 800-line size risk, and the no-delivery/no-publication constraint.
