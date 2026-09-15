# jero-pi P2 Milestone-2 — In-Process Review Authority State Machine: Field-Level Spec

Path legend (absolute roots; body citations use these prefixes):
- **GP** = `D:\jero-pi\gentle-pi-main` (pinned read-only upstream; jero-pi's ported lib files are byte-identical per `D:\jero-pi\_tools\p2-m1-storage-analysis.md:5`, so GP line numbers are valid in jero-pi unless flagged)
- **JP** = `D:\jero-pi\jero-pi` (greenfield rebuild; M1 landed at commit bfc465e)
- **FIX** = `D:\jero-pi\jero-pi\tests\fixtures\devbinary`

Everything below was read from the local trees (not the GitHub mirror). Where I infer rather than quote, I mark **[inferred]**. Where docs and code disagree, I flag **DISCREPANCY** — per the task rule, code + fixtures are truth, docs are proposals.

---

## 0. Scope and seams

M2 delivers, per `D:\jero-pi\JERO-PI-DESIGN.md:106-117` (§5.1.1 table):
- `authority.review.start(target, selection)` (ex-`review start`)
- `authority.review.status(target)` (ex-`review status` / target status)
- `authority.review.finalize / validate / acknowledge` (ex-`review acknowledge-approved` / FINALIZE / VALIDATE)
- `authority.risk.assess(diff)` (ex-`review assess`)
- `authority.mode.get/set` (ex-`review mode`)

Seams excluded but touched by this spec: capture-prompt rendering is M3 (`authority.capture.renderBinding(slot)`, design:112; the STATUS `collect` inputs and submission descriptors below are M3's input contract); SDD state is M4 (`authority.sdd.*`, design:118); maintenance (reclaim/recover/abandon/reconcile-authority, plus retry_final_verification-adjacent repair) is M5 (design:113-114). Delivery gates (`gate` journal op, NATIVE_GATE five gates) belong to publication-gate work — M2 persists the `gate` operation name only (JP\lib\authority\protocol.ts:432).

---

## A. State model

### A.1 The three state vocabularies and the mapping

1. **Persisted 13-state enum** — `JERO_REVIEW_STATES` (JP\lib\authority\protocol.ts:105), identical to the upstream persisted-record decoder enum (GP\lib\native-review-cli.ts:1401):
```
unreviewed, reviewing, judges_confirmed, findings_frozen, evidence_classified,
fix_required, fixing, fix_validating, ready_final_verification, final_verifying,
approved, escalated, invalidated
```
2. **Wire 15-state enum** — `REVIEW_START_STATE` (GP\lib\review-integration-v2.ts:58-75) = the 13 **plus** `correction_required` and `validating` (comment :56-57: "Widened by protocol v2 ... introduced by the negotiated correction lifecycle"); also start.schema.json state enum (GP\contracts\review-integration\v2\schemas\start.schema.json:39-45).
3. **Compact five-state story** — readme-reference: "Compact ordinary has five states: `reviewing`, `correction_required`, `validating`, `approved`, and `escalated`" (GP\docs\readme-reference.md:301); design doc §5.1.3 repeats it (D:\jero-pi\JERO-PI-DESIGN.md:138).

**Mapping (what M2 must implement as a pure projection function persisted→wire):**
- Identity: `unreviewed→unreviewed`, `reviewing→reviewing`, `judges_confirmed→judges_confirmed`, `findings_frozen→findings_frozen`, `evidence_classified→evidence_classified`, `approved→approved`, `escalated→escalated`, `invalidated→invalidated`.
- `fix_required`, `fixing` → wire `correction_required`.
- `fix_validating`, `ready_final_verification`, `final_verifying` → wire `validating`.

Evidence: (a) wire-only `correction_required` is tied by the published schema to the correction phase — `validation_request` presence requires `authority.state == "correction_required"` while the validator is the correction-phase actor (GP\contracts\review-integration\v1\schemas\status-v2.schema.json:287-295); (b) last-event closures emitted by the real binary carry `state: "correction_required"` while the correction is open (FIX\last-event-capture-correction-plan.captured.json:8, FIX\last-event-capture-result-correction-required.captured.json:5, FIX\last-event-capture-refuter-correction-required.captured.json:5); (c) the persisted decoder (:1401) has no `correction_required`/`validating` at all. The exact grouping inside the two aggregates is **[inferred]** — no upstream document states it; the Go binary is the only place the projection lives. Lock it with the conformance assertions in §J.

### A.2 Definitive transition table (13 persisted states)

Legend — Trigger: M2 operation; Journal op: member of `JERO_AUTHORITY_OPERATIONS` = `["start","freeze-ledger","resolve-evidence","authorize-fix","validate-fix","verify","gate"]` (JP\lib\authority\protocol.ts:432); Writes: fields of `JeroReviewTransactionStateV1` (protocol.ts:212-252) + journal + counters (`JeroAuthorityCountersV1` protocol.ts:190-203).

**Ordinary line** (mode `ordinary_4r` | `ordinary_bounded`, protocol.ts:102):

| # | From → To | Trigger | Required inputs | Writes | Journal op / counters |
|---|---|---|---|---|---|
| 1 | (none) → `reviewing` | `review.start` created | target+selection (§B) | full record creation: `mode`, `generation=1`, `state`, `snapshot{kind= current-changes\|base-diff\|commit-range\|fix-diff, base_tree, candidate_tree, paths_digest, intended_untracked, intended_untracked_proof, paths, identity, ledger_ids?}` (protocol.ts:132-142), `base_tree`, `paths_digest`, `initial_review_tree`, `final_candidate_tree` (=initial), `fix_delta_hash`(""), `policy_hash`, `ledger_hash`, `ledger_findings_hash`, `evidence_hash`, `counters` zeroed, `findings:[]`, `classifications:{}`, `outcomes:{}`, `fix_finding_ids:[]`, `pending_refuter_ids:[]`, `fix_caused_findings:[]`, `follow_ups:[]`, optional `genesis_paths`, `risk_level`, `selected_lenses`, `original_changed_lines`, `correction_budget` | `start`; `full_reviews:1`; optional `risk_executions`/… per-lens counters reserved for lens admission |
| 1b | (none) → `approved` | `review.start` created, zero-lens | risk low → `selected_lenses: []` | same freeze + terminal; receipt written at once | `start`; `full_reviews:1`; receipt (see §D.8). Fixture: FIX\start-v3-zero-lens-closed.captured.json:5-14 (`action:"closed"`, `state:"approved"`, budget still frozen = 1) |
| 2 | `reviewing` → `findings_frozen` | FINALIZE, lens-result admission | one `lens_results[]` entry per selected lens, each `{lens, findings[], evidence[], result_hash}` (protocol.ts:205-210; decoder GP\lib\native-review-cli.ts:1377-1383) | `findings` = canonical rows (native assigns missing IDs, deterministic canonicalization — GP\docs\readme-reference.md:285), `lens_results`, `ledger_findings_hash`, `evidence_hash`; per-lens counters | `freeze-ledger` |
| 3 | `findings_frozen` → `evidence_classified` | FINALIZE, classification/refutation | per-finding `{finding_id, class: deterministic\|inferential\|insufficient, proof, causal_disposition?}` (protocol.ts:161-166); inferential severe ⇒ exactly one refuter batch (readme:291) | `classifications`, `outcomes` (corroborated\|refuted\|inconclusive\|info, protocol.ts:126), `pending_refuter_ids` while awaiting refuter | `resolve-evidence`; `refuter_batches:+1` when a refuter batch runs |
| 4a | `evidence_classified` → `ready_final_verification` | FINALIZE, no severe candidate-caused finding | — | `follow_ups` gains pre-existing/base-only rows (readme:289) | — (state-only advance inside `resolve-evidence`/`verify` chain) |
| 4b | `evidence_classified` → `fix_required` | FINALIZE, severe candidate-caused findings exist | severe = BLOCKER\|CRITICAL ∧ causal_disposition ∈ {introduced, behavior-activated, worsened} ∧ valid proof (readme:289; wire row shape GP\lib\review-integration-v2.ts:475-485) | `fix_finding_ids` = admitted severe IDs | — |
| 4c | `evidence_classified` → `escalated` (terminal) | FINALIZE, severe but unknown/insufficient/malformed/inconclusive | — | `invalidation_reason`/escalation evidence; wire `escalation.cause` ∈ {unknown_causality, insufficient_evidence, missing_refuter_outcome, targeted_validator_rejected, correction_budget_exceeded, unresolved_severe_findings} (GP\lib\review-integration-v2.ts:599) | — |
| 5 | `fix_required` → `fixing` | correction-plan capture (M3 renders; M2 admits) | `request_hash` (64-hex), `correction_lines` forecast 1..200 (GP\lib\native-review-cli.ts:2451; FIX\last-event-capture-correction-plan.captured.json:6-7) | `proposed_correction_lines` | `authorize-fix`; `fix_rounds:+1` |
| 6 | `fixing` → `fix_validating` | bounded edit applied | actual correction lines derived from Git (readme:297) | `actual_correction_lines`, `fix_delta_hash`, `final_candidate_tree` update | — |
| 7a | `fix_validating` → `ready_final_verification` | VALIDATE passes | §E; `original_criteria.passed ∧ correction_regression.passed ∧ fix_caused_findings == []` | `original_criteria`, `correction_regression` (`{evidence_hash, fix_delta_hash, passed}` protocol.ts:173-177), `follow_ups` | `validate-fix`; `scoped_fix_validations:+1` |
| 7b | `fix_validating` → `escalated` (terminal) | VALIDATE fails / fix-caused findings / budget exceeded | — | escalation cause | `validate-fix` (terminal) — **never** back to `fix_required` (GP\openspec\specs\review-transaction\spec.md:104: "Failed targeted validation MUST escalate and MUST NOT return to correction_required") |
| 7c | `fix_validating` → `fixing` (reopen, not a new transaction) | capture-evidence outcome `verification_failed` | new evidence identity; prior record immutable and still resolvable (GP\lib\review-correction-lifecycle.ts:158-170) | nothing charged: attempt/budget/lines unchanged (GP\openspec\specs\review-correction-lifecycle\spec.md:39-43) | — |
| 7d | `fix_validating` → `escalated` | capture-evidence outcome `procedural_tooling_failed` | — | terminal escalation before any retry (spec.md:45-49) | — |
| 8 | `ready_final_verification` → `final_verifying` | FINALIZE with final evidence | `final_evidence` non-empty bytes + exactly one of `final_verification_passed` \| `final_verification_outcome` (GP\lib\review-compact-contract.ts:135-136); evidence hashed now, not at START (readme:299) | evidence hash into `evidence_hash` chain | `verify`; `final_verifications:+1` |
| 9 | `final_verifying` → `approved` \| `escalated` | outcome computed | `passed ∧ escalation_reasons empty` → approved (GP\lib\review-policy-judgment-day.ts:282-285 pattern; ordinary twin GP\lib\review-policy-ordinary.ts:510-515) | `final_candidate_tree` committed; receipt written (§D.8) | `verify` (terminal) |
| 10 | `approved` → (burned) | `review.acknowledge` | §F | authority consumed; receipt persists | see §F |
| 11 | any active → `invalidated` | maintenance/invalidation (M5 seam) | `invalidation_reason` (protocol.ts:238) | — | M5 |

**Judgment Day line** (mode `judgment_day`; explicit request only, replaces ordinary for that lineage — readme:311):

| From → To | Trigger / rule |
|---|---|
| `reviewing` → `judges_confirmed` | two blind judges admitted; zero refuters (readme:313; GP\skills\judgment-day\SKILL.md:20); `judge_proofs[] {judge_id, execution_hash, result_hash, blind:true, confirmed}` (protocol.ts:144-150); counters `judge_executions:+2` |
| `judges_confirmed` → `findings_frozen` | discovery ledger frozen; judge rows only, lens `"judgment-day"` (GP\lib\review-policy-judgment-day.ts:111-113) |
| → `fix_required` → `fixing` | scoped fix addressing **every** surviving finding in one batch (GP\lib\review-policy-judgment-day.ts:139-143); `fix_batches` budget 2 (rounds) |
| → re-judgment (scoped) | `scoped_rejudgments:+1`, `judge_executions:+2`; ≤2 rounds total (readme:315; SKILL.md:22); survivors after round 2 → **escalated**, no third round (readme:317; SKILL.md:24; GP\lib\review-policy-judgment-day.ts:254-258) |
| → `ready_final_verification` → `final_verifying` → `approved\|escalated` | same tail as ordinary; `validator_runs` budget 0 — no targeted validator on JD (GP\lib\review-policy-judgment-day.ts:73) |

**ILLEGAL transitions (fail-closed, each needs a unit test — see §J):**
1. Any mutation from `approved`, `escalated`, `invalidated` ("terminal mutation ... fail closed", readme:305; lineage-store refuses nothing by itself — M2's reducers must gate on state).
2. Lens admission from any state ≠ `reviewing` (lenses run exactly once, never rerun — readme:297; GP\openspec\specs\review-transaction\spec.md:94).
3. `resolve-evidence` before `freeze-ledger` (evidence resolution requires a frozen ledger — GP\lib\review-policy-ordinary.ts:220-223).
4. Second correction transaction (`fix_rounds > 1` / `fix_batches > 1` — GP\lib\review-policy-ordinary.ts:104; readme:297 "Ordinary permits one correction transaction").
5. Correction exceeding budget: `actual_correction_lines > correction_budget` → escalate (`correction_budget_exceeded` cause, GP\lib\review-integration-v2.ts:599); forecast out of 1..200 refused (GP\lib\native-review-cli.ts:2451).
6. Targeted validation before recorded evidence (GP\openspec\specs\review-correction-lifecycle\spec.md:9-11).
7. Validator adding findings/duplicating/omitting IDs or altering claims (GP\lib\review-policy-ordinary.ts:433-461).
8. Acknowledge on non-`approved` (precondition `state=approved` — GP\lib\review-integration-v2.ts:2498).
9. Cross-mode operations: JD op on ordinary lineage and vice versa, preserving counters (GP\openspec\specs\review-transaction\spec.md:82-90; GP\lib\review-policy-judgment-day.ts:60-63).
10. Journal key reuse with different `request_hash`; any pending entry blocking mutation; mutating a corrupted record (JP\lib\authority\lineage-store.ts:200, :255-265).
11. START under `foreign-authority-store` hits (JP\lib\authority\store-root.ts:293-294); START while a live lock is owned (released leftovers must NOT block — JP\lib\authority\locks.ts:59-64 preserving gentle-ai #184 behavior).
12. Refuter replacement: invalid/empty/malformed/missing/duplicate/unknown/inconclusive refuter output escalates without a second refuter (readme:293; GP\tests\review-policy-ordinary.test.ts:275).

---

## B. START semantics (`authority.review.start(target, selection)`)

### B.1 Request fields
Typed projection of `NativeStartRequest` (GP\lib\native-review-cli.ts:570-580) plus untracked selection (:553-568):
`cwd`; `baseRef?`; `committedOnly?`; `lineageId?`; `projection?` (`"workspace"|"staged"`, default `"workspace"` :2230); `targetIdentity?` (drift detection only — `^sha256:[0-9a-f]{64}$` :2226); untracked selection: `untrackedScope?` (`exclude|select`), `expectedUntrackedInventory?` (digest of untracked path **names** only, `git ls-files --others --exclude-standard` — readme:283), `intendedUntracked?` (unique repo-relative POSIX paths, no absolutes/backslashes/dot-segments :734-740), `intendedUntrackedSelection?` (provider-issued token submission, exactly one `{{value}}` :2343).
Pairing rules (fail-closed TypeErrors): `baseRef` requires `committedOnly === true`; `committedOnly` without `baseRef` refused (:2223-2225; identical for STATUS :2338-2340 and ASSESS :2575-2577). `untrackedScope=exclude` cannot carry paths; `select` requires ≥1 (:753-758).
**Do NOT port** `policyPath`/`focus` (:574-575): dead in the negotiated flow (argv comes entirely from the STATUS-rendered transition tokens, :2250-2255).

### B.2 Freeze computation
1. Resolve the store: `resolveJeroAuthorityStoreV1(cwd)` (JP\lib\authority\store-root.ts:290) — foreign hits refuse START (:293-294); failures return typed refusals, never throw raw.
2. Snapshot via the M1 snapshots seam (planned `lib/authority/snapshots.ts`, M1 analysis E.6; upstream `captureReviewSnapshot` GP\lib\review-snapshot.ts): `SnapshotV1` fields = `schema:"gentle-ai.review-snapshot/v1"`, `mode`, `repository_root`, `base_tree`, `complete_snapshot_tree`, `review_projection` (`complete` | `intended-commit`+tree), `initial_review_tree`, `genesis_paths?`, `intended_untracked[]`, `diff_evidence` (DiffEvidence, GP\lib\review-triggers.ts:53-64), `route`, `lenses[]`, `risk_tier`, `original_changed_lines`, `correction_budget`, `policy_hash`, `object_store{...}` (GP\lib\review-snapshot.ts:85-103). Snapshot identity = SHA-256 over the same fields minus `object_store` (:127-144) — content-isolated git object store, 0o700, survives `git gc` (GP\tests\review-snapshot.test.ts:254).
3. **target_identity / lineage_id**: in every capture, `target_identity == initial_snapshot_identity == current_snapshot_identity` and `lineage_id = "review-" + first 16 hex of target_identity` (FIX\start-v3-consent-granted.captured.json:7,35 — `review-377c60e10b852cfc` vs `sha256:377c60e10b852cfc…`; FIX\status-v5-repository-context.captured.json:8,23; zero-lens fixture :7). M1's `isJeroLineageId` enforces `^review-[0-9a-f]{16}$` (JP\lib\authority\store-root.ts:328-332). **Spec: `target_identity = sha256(snapshot identity body)` under the jero domain (`jeroDomainHash`), `lineage_id = "review-" + target_identity.slice(7, 23)`** — derivation is **[inferred]** from three fixtures + M1 analysis C:115; upstream never documents the formula. Must be locked by an internal-consistency conformance test, not byte-equality (upstream hashes are Go-domain and unreproducible).
4. **Per-lens subject_hash**: artifact-subject/v2 shape (wire GP\lib\review-integration-v2.ts:299-311): `{schema, subject_hash, lineage_id, authority_revision, target_identity, base_tree, candidate_tree, changed_path_manifest_sha256, lens, selected_order, correction_target_identity?}`; `selected_order` 0..3; lens enum `review-risk|review-resilience|review-readability|review-reliability`; git trees `^[0-9a-f]{40}([0-9a-f]{24})?$` (start.schema.json:78). All subjects of one START share `authority_revision`, `target_identity`, `base_tree`, `candidate_tree`, `changed_path_manifest_sha256` and differ only in `lens`/`selected_order`/`subject_hash` (fixture :29-78). **Spec: `subject_hash = "sha256:" + jeroDomainHash("artifact-subject", {target_identity, lens, selected_order, base_tree, candidate_tree, changed_path_manifest_sha256})`** — **[inferred]**, same caveat as target_identity.
5. `changed_path_manifest`: entries `{path, status A|D|M|T, old_mode, new_mode, deleted, type_changed, mode_only, intended_untracked}` all 8 fields required (start.schema.json:79-92; TS `ChangedPathEntry` GP\lib\review-integration-v2.ts:288-297); digest = `changed_path_manifest_sha256` via `digestChangedPathManifest` (GP\lib\review-candidate-view.ts, per M1 analysis B:97 — wrap, do not reimplement).
6. `intended_untracked_proof`: digest over untracked path names only; content hashed only for selected paths at freeze (readme:283).

### B.3 Risk tier → selected_lenses
Freeze-time classification (`classifyReviewRisk`, GP\lib\review-risk.ts:112-144):
- `high` iff authored lines > 400 (`LARGE_AUTHORED_CHANGE_LINES` :15) OR any high-risk path (token/phrase regexes :38-39) → lenses = full 4R in fixed order `[review-risk, review-resilience, review-readability, review-reliability]` (GP\lib\review-triggers.ts:41-46).
- `low` iff not high, no binary/mode-only candidate, no configuration path, every path documentation-like (:36, :107-110) → lenses = `[]` → START closes immediately (transition 1b).
- else `medium` → exactly 1 dominant lens, precedence risk > resilience > reliability > readability (:100-105).
- `original_changed_lines` counts additions+deletions, excluding `testdata/golden/**` (`GENERATED_GOLDEN_PATH` :34, exclusion at :76 — "testdata/golden stays in snapshot identity but not authored risk lines", GP\tests\review-snapshot.test.ts:211), binary and mode-only files; duplicate paths rejected (:66).
- `correction_budget = min(200, ceil(original_changed_lines/2))` (:82-90; `MAX_CORRECTION_CHANGED_LINES=200` :14; readme:281). Cross-check fixture: 12 lines → budget 6 (FIX\start-v3-consent-granted.captured.json:20-21); 2 lines → 1 (zero-lens fixture :13-14); 3 lines → 2 (FIX\status-v5-capture-result-submission.captured.json:20-22).
- Wire canonicality the result must satisfy: low→0 lenses, medium→1, high→all 4 unique (GP\lib\native-review-cli.ts:1436-1442); `lenses_required` false allowed only for low (decodeSelectedLenses :1082-1085; hasValidLensesRequired :1444-1449).
- `risk_reasons`: ≥1 unique row `{code, signal?, path?, old_mode?, new_mode?}`; codes closed 11-value set, signals 6-value set (start.schema.json:93-106; TS decoder GP\lib\review-integration-v2.ts:1199-1208). **DISCREPANCY**: the phrase map `REVIEW_RISK_SUBJECT_BY_SIGNAL` knows 8 signals incl. `data_exposure`, `data_loss` (GP\lib\native-review-cli.ts:807-816) while the wire decoder/schema allow 6 — emit only the 6.

### B.4 Action variants (when each)
`NativeStartAction` = `created|resumed|replayed|closed|blocked-scope-action` (GP\lib\native-review-cli.ts:721). v3 wire enum = `created|resumed|closed|blocked-scope-action` (GP\lib\review-integration-v2.ts:77); v4 swaps `resumed`→`replayed` (:354-356, :1293).
- `created`: new lineage, state `reviewing` (or `approved` if zero-lens closes), `lenses_required` true iff lenses selected; `artifact_subjects` 1:1 with `selected_lenses`; `repository_context` REQUIRED iff (created|resumed) ∧ state=reviewing, forbidden otherwise (start.schema.json:20-26; decoder :1178-1183).
- `resumed`/`replayed`: an existing `reviewing` lineage for the same target — idempotent continuation; result must name the same `lineage_id` (mismatch → identity-mismatch, GP\lib\native-review-cli.ts:2275).
- `closed`: zero-lens auto-approval (fixture). **DISCREPANCY**: published schema says `reuse-receipt` where decoder+fixtures say `closed` (start.schema.json:36 vs GP\lib\review-integration-v2.ts:77, FIX\start-v3-zero-lens-closed.captured.json:5) — implement `closed`.
- `blocked-scope-action`: scope resolution required before authority creation (e.g. intended-untracked inventory drift); the stop names its own continuation; a fresh inspect invalidates an older pre-lineage selection (readme:283).
Idempotency: exact `(idempotency_key, request_hash)` replay returns the stored canonical result; key reuse with a different request fails closed (JP\lib\authority\lineage-store.ts:274-302).

### B.5 Consent interaction
Medium/high-risk START under mode-on without a standing grant returns `consent_required` instead of creating authority: the binary "has frozen no authority yet" (GP\lib\native-review-cli.ts:1806-1820, `NativeReviewConsentRequiredError`, `mutationOutcome:"none"`). Envelope `consent/v3` (FIX\consent-v3.captured.json; decoder GP\lib\review-integration-v2.ts:2147+): `schema`, `contract`, `operation:"review.start"`, `action:"consent_required"`, `agent` (`claude-code|opencode|codex|pi` :678-684), `blocking:true`, `target_identity`, `projection`, `risk_level` (**medium|high only** :2113), `changed_files`, `changed_lines`, `headline`, `reason`, `value`, `risk_evidence[]`, exactly two `choices[]` `{answer granted|declined, label, effect, invocation}` where each invocation is the exact provider START vector ending `--consent <answer>` and binding `--target`/`--projection`/`--cwd` (fixture :24-30; binding guards GP\lib\native-review-cli.ts:1941-1956), `off_path{note, command:"gentle-ai review mode disable"}`.
- Granted → normal START result, identity-checked (GP\lib\native-review-cli.ts:2313-2316).
- Declined → typed declined result, no authority: `action:"declined"`, `consent:"declined_this_candidate"`, `lineage_id:""`, `state:""`, `lenses_required:false`, `selected_lenses:[]`, `lens_bindings:[]`, `correction_budget:0` (FIX\start-v3-consent-declined.captured.json; decoder GP\lib\native-review-cli.ts:1959-1977).
- Standing session grants, headless tolerated notices, and the fd3 child channel stay TS-side per design §5.1.5 (D:\jero-pi\JERO-PI-DESIGN.md:150) — M2 returns a discriminated union `{kind:"consent_required"|"started"|"declined"|...}` instead of throwing.
- Start/v4 continuation (reviewing START carries `next_transition.execute` = `review.status`) exists only for wire resumption (GP\lib\review-integration-v2.ts:1286-1306) — in-process M2 does not need it; keep v3 shapes.

---

## C. STATUS semantics (`authority.review.status(target)`)

### C.1 Applicability determination
Closed enum `current_target|unrelated|ambiguous|corrupted` (wire schema GP\contracts\review-integration\v1\schemas\status-v2.schema.json:24; `not_evaluated` exists only on failure envelopes, GP\lib\review-integration-v2.ts:16). Inputs that distinguish them:
- Live projection descriptor (recomputed from Git, never from provider files — readme:257): `{schema:"gentle-ai.review-integration.projection/v1", kind: current-changes|base-diff|base-workspace-overlay|exact-revision|fix-diff, projection, base_tree, initial_review_tree, current_candidate_tree, paths_digest, paths[], intended_untracked[], intended_untracked_proof, initial_snapshot_identity, current_snapshot_identity}` (GP\lib\review-integration-v2.ts:359-372; decoder :1314+).
- `current_target`: some persisted lineage's `snapshot.identity`/`target_identity` equals the live `current_snapshot_identity`; then `authority{version:"compact-v2" (jero: own marker), lineage_id, state, generation ≥1, revision}` is REQUIRED (schema :250-252; decoder :1959).
- `unrelated`: no lineage matches (fixture FIX\status-v5.captured.json:5-9 — empty candidate, `action:"start"`, receipt `not_applicable`); non-current statuses MUST NOT expose `authority`/`frozen`/`authority_target_identity` (schema :250-253; decoder :1960-1962).
- `ambiguous`: >1 candidate lineage for the target → `candidates[]` (unique lineage ids, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, decoder :2060) + `action:"select_lineage"`.
- `corrupted`: lineage record fails strict decode / revision-hash mismatch / identity mismatch (`load` → `{kind:"corrupted", detail}`, JP\lib\authority\lineage-store.ts:159-184) → `action:"repair_authority"`/`maintainer_action` (repair itself is M5).

### C.2 Receipt status
`expected_missing|present|publication_pending|not_applicable` (schema :37-45; decoder :1940-1947). `expected_missing` for an active compact-v2 lineage (fixture FIX\status-v5-repository-context.captured.json:13-15); `not_applicable` when unrelated (FIX\status-v5.captured.json:6-8); `present` once FINALIZE wrote `review-receipt.json` (identity = receipt hash); `publication_pending` is the post-approval publication gate (M5 seam). Compact-v2 status REQUIRES `frozen` (schema :254-266; decoder :1974).

### C.3 Action + replayability
Wire schema action vocabulary (v1 status-v2.schema.json:46): `start, finalize, validate, recover, retry_final_verification, maintainer_action, select_lineage, repair_authority, reconcile_finalize, stop`. The TS decoder's `STATUS_ACTIONS` is a different, narrower projection set `start, recover, maintainer_action, select_lineage, repair_authority, stop, collect, execute` (GP\lib\review-integration-v2.ts:85) — **DISCREPANCY**: two real captures carry `action:"finalize"` (FIX\status-v5-repository-context.captured.json:16, FIX\status-v5-capture-result-submission.captured.json:16) which the strict decoder would reject; those two fixtures are consumed raw by routing tests only (GP\tests\review-controller-native-routing.test.ts:2216, GP\tests\review-host-relay-routing.test.ts:74). **Spec for M2**: model action as the schema union (it is the provider's summary vocabulary); internally derive routing from `next_transition`. Additional schema conditionals to honor: `recover|retry_final_verification` ⇒ `action_disposition` required; `action_disposition` ∈ `scope_changed|invalidated|escalated|final_verification_retry` (schema :47, :244-248) — note the TS decoder knows only 3 dispositions (GP\lib\review-integration-v2.ts:88-92), another decoder lag to flag; `reconcile_finalize` ⇒ `reconciliation:{required:true}` + `current_target` + `status_required` (schema :232-242).
`next_transition` (the authority's routing output): `{kind: execute|collect|stop, reason_code, execute?{operation, arguments[{name,value,token}], selectorArguments?, preconditions, binding{targetIdentity, lineageId?, revision?, repositoryContext?}, command?, artifacts?}, collect?{inputs[]}, correctionRequest?, continuation?, unachievableLensSlots?}` (GP\lib\review-integration-v2.ts:586-597, :399-412). Observed reason codes: `empty_candidate_base_ref_required` (collect select_base_ref, FIX\status-v5.captured.json:52-86), `reviewer_results_required` (collect reviewer_result with submission descriptor + artifact_subject + inline manifest, FIX\status-v5-capture-result-submission.captured.json:65-174), `captured_results_ready` (execute `review.finalize` with preconditions `state=reviewing`, `captured_artifacts=complete`, FIX\status-v5-repository-context.captured.json:71-128). Pi-side supported execute operations (the closed gate): `review.start, review.recover, review.repair, review.acknowledge-approved` (GP\lib\native-review-cli.ts:1166) — **M2 must widen this to include `review.finalize` and `review.validate`** since M2 owns those operations now (flag: the upstream gate is a client-side relay list, not an authority rule).
`replayability`: `not_replayable|exact_replay_safe|status_required|manual_action_required` (GP\lib\review-integration-v2.ts:20-26). Default `not_replayable` for read-only status; `exact_replay_safe` only for a journaled op replayed with identical `(idempotency_key, request_hash)`; `status_required` after unknown mutation outcomes ("After an unknown or lost mutating result, Pi calls target status before any replay decision", readme:257); `manual_action_required` for ambiguous/corrupted.
`forecast` (`partial|terminal`, steps `{step:1, kind, reason_code, description}`) previews the transition head and requires `next_transition` (decoder :1996-1999).

### C.4 Frozen block
`{tier, original_changed_lines, correction_budget, changed_path_manifest_sha256?}` (GP\lib\review-integration-v2.ts:387-393; schema v1:49-57; budget bounded 0..200). `changed_path_manifest_sha256` binds manifest-less capture inputs (gentle-ai#3922, :391-392).

---

## D. FINALIZE

### D.1 Wrapper input validation (exact; GP\lib\review-compact-contract.ts)
Top-level exact key set: required `["cwd"]`, optional `["lineageId","correction_line_forecast","validation","final_evidence","final_verification_passed","final_verification_outcome","reviewer_run_acknowledged"]` (:133). Unknown key → `unknown-key` error. Rules:
- `reviewer_run_acknowledged?: boolean` (:134) — absent ⇒ forecast-only run, spends nothing (:63-70).
- Final-evidence pairing: `final_evidence` absent ⇒ both verification fields absent; present ⇒ EXACTLY ONE of `final_verification_passed|final_verification_outcome` (:135-136, code `field-pair`).
- `correction_line_forecast`: positive safe integer (:138-141, code `range`).
- `final_verification_passed?: boolean` (:142); `final_verification_outcome` ∈ `CORRECTION_OUTCOMES = ["passed","verification_failed","procedural_tooling_failed"]` (GP\lib\review-correction-lifecycle.ts:17; :143-148 code `enum`).
- `final_evidence`: non-empty bytes, preserved byte-for-byte (no trim rule; :149-156 code `empty`).
- `lineageId`: `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` (:17, :108-112 code `lineage`).
- `validation` exact keys `["request_hash","correction_ids","original_criteria","correction_regression","fix_caused_findings","follow_ups"]` (:115): `request_hash` 64-hex (:127-128 code `digest`); `correction_ids` unique strings (:104 code `duplicate`); each check `{passed:boolean, evidence:string[]}` with non-empty evidence (:162-163); `fix_caused_findings` MUST be `[]` (:121 code `scope`); `follow_ups[]` rows `{finding_id, location, summary, proof_refs[]}` with non-empty `proof_refs` (:165).
- Error taxonomy: `CompactReviewContractError {area, code}` — codes: `type, unknown-key, required, canonical-string, duplicate, lineage, digest, range, enum, field-pair, empty, scope` (from `fail()` call sites :79-165). Tests pin them (GP\tests\review-compact-contract.test.ts:16-55).
- Lens-results admission (upstream flows through native capture, not the wrapper — this module holds only the negotiated collection answers; header :1-12): M2's FINALIZE input for transitions 2-3 is the persisted `lens_results` shape (protocol.ts:205-210); each selected lens exactly once, `findings:[]` when clean, non-empty `evidence` (readme:263).

### D.2 Evidence classification
Every finding requires `evidence_class`, `causal_disposition`, and concrete changed-hunk / candidate-created-path / differential-test / before-after proof (readme:285). Missing IDs assigned natively; selected-lens results canonicalized deterministically (:285). Classification record: `{finding_id, class: deterministic|inferential|insufficient, proof, causal_disposition?: introduced|behavior-activated|worsened|pre-existing|base-only|unknown}` (protocol.ts:161-166; GP\lib\native-review-cli.ts:1384-1388). **DISCREPANCY (naming)**: graph-v1 policy calls the severe class `INFERENTIAL_SEVERE` (GP\lib\review-policy-ordinary.ts:229-231) while the compact persisted record says `inferential` — M2 uses the persisted trio. First-FINALIZE inferential flow: returns canonical rows + content-derived `request_hash` WITHOUT mutation; second FINALIZE replays identical lens input with that hash plus one complete refuter batch (readme:295). Refuter proof may be independent concrete reproduction; invalid/empty/malformed/missing/duplicate/unknown/inconclusive refuter output escalates without replacement (readme:293).

### D.3 Severe-only correction ID admission
Only severe (`BLOCKER|CRITICAL`) findings with causal_disposition ∈ `introduced|behavior-activated|worsened` AND valid proof enter `fix_finding_ids` (readme:289). `pre-existing`/`base-only` become `follow_ups[]` rows. `unknown`/`insufficient`/malformed/inconclusive severe claims → `escalated`. `WARNING`/`SUGGESTION` are informational (readme:289). Wire correction-plan finding row confirms the admitted shape: `{id, lens (bare name), location, severity BLOCKER|CRITICAL, claim, proofRefs, evidence, evidenceClass deterministic|inferential, causalDisposition introduced|behavior-activated|worsened}` (GP\lib\review-integration-v2.ts:475-485).

### D.4 Follow-up admission
Follow-ups are inert observations: persisted `{observation, proof_refs[]}` (protocol.ts:168-171); wrapper rows `{finding_id, location, summary, proof_refs}` map via `toNativeValidatorDocument` to `{observation: summary, proof_refs}` (GP\lib\review-compact-contract.ts:169-175); action-bearing fields rejected, IDs unique, sorted (GP\lib\review-policy-ordinary.ts:470-491).

### D.5 Malformed → escalated triggers
Malformed lens/refuter/validator rows, non-decodable envelopes, out-of-enum values, budget overrun, fix-caused findings, refuter inconclusiveness, JD round-2 survivors — all terminal `escalated` (causes enumerated GP\lib\review-integration-v2.ts:599; "Ordinary ends only as approved or escalated", readme:309).

### D.6 Correction budget enforcement
One correction transaction within the ORIGINAL frozen budget: positive forecast before editing; actual lines derived from Git; one targeted validator + final verification close it; initial lenses never rerun; frozen findings and genesis scope immutable (readme:297). Plan `correction_lines` bounded 1..200 (GP\lib\native-review-cli.ts:2451). Fix must address every corroborated severe finding in one batch and touch only genesis paths (GP\lib\review-policy-ordinary.ts:304-311).

### D.7 Outcome computation
`approved` iff final verification passed ∧ zero escalation reasons (accumulator pattern GP\lib\review-policy-ordinary.ts:504-515); else `escalated`. `correction_required` (wire) is the intermediate outcome while `fix_*` states run.

### D.8 Receipt creation
On reaching `approved|escalated`: `createJeroReceiptEnvelopeV1(body)` — refuses non-terminal state (JP\lib\authority\receipts.ts:34-41); body `JeroReceiptBodyV1` = `{schema:"jero.authority.receipt-body/v1", lineage_id, mode, state, base_tree, initial_review_tree, final_candidate_tree, paths_digest, fix_delta_hash, policy_hash, ledger_hash, ledger_findings_hash, evidence_hash, counters}` (JP\lib\authority\protocol.ts:466-481); `receipt_hash = "sha256:" + jeroDomainHash("receipt", body)` (receipts.ts:28-31); integrity re-assert on read (:44-52); persist to `lineages/<id>/review-receipt.json` (`jeroReceiptPathV1` :55-57) + CAS install of the body (M1 receipts.ts comment :10-12; upstream evidence `receipt_path .../review-transactions/v2/lineage-1/review-receipt.json`, M1 analysis A.1:14).

---

## E. VALIDATE (targeted validation)

- **Request binding** (provider-rendered, M2 reproduces from frozen state): `ReviewTargetedValidationRequestV1` = `{schema:"gentle-ai.review-targeted-validation-request/v1", request_hash, lineage_id, expected_revision, target_identity, fix_finding_ids, policy_content, fix_findings[], fix_classifications[], projection, correction_candidate_tree, correction_target_identity, correction_paths[], correction_paths_digest}` (GP\lib\review-integration-v2.ts:520-535; decoder :1530). `fix_findings` rows carry `evidenceClass deterministic|inferential` + `causalDisposition introduced|behavior-activated|worsened` only (:498-507); classifications `{findingId, severity?, class, causalDisposition, proof}` (:509-518). `status.validation_request` must byte-match the one collect input carrying it (decoder :1989-1995) and requires wire state `correction_required` (v1 schema :287-295).
- **Evidence-first ordering**: `review capture-evidence` outcome recorded BEFORE targeted validation is offered (GP\openspec\specs\review-correction-lifecycle\spec.md:9-11); closed outcome domain exactly `passed|verification_failed|procedural_tooling_failed` (:19-21); branches per §A.2 rows 7a-7d (spec.md:29-49; GP\lib\review-correction-lifecycle.ts:102-146; distinct immutable evidence directories enforced by `assertDistinctCorrectionEvidence` :158-170).
- **Answer document** (host side): `CompactTargetedValidationInput` (§D.1): `request_hash` bound to the request; `correction_ids` must pair 1:1 with frozen `fix_finding_ids`; `original_criteria`/`correction_regression` `{passed, evidence[]}`; **`fix_caused_findings` must be `[]`** — non-empty means the fix caused new findings → escalate (GP\lib\review-compact-contract.ts:121); `follow_ups` rows admitted per §D.4.
- **Recording rules**: original acceptance criteria must pass; one passing regression proof per frozen ID; validator cannot add findings, duplicate, omit, alter claims, or request fixes; regression ⇒ escalate (GP\lib\review-policy-ordinary.ts:415, :422-425, :433-461; readme:299, :303).

---

## F. ACKNOWLEDGE

- Preconditions: lineage `approved`, unacknowledged. The burn invocation is a closed 5-argument vector `cwd, lineage, target, expected-revision, token` rendered as `--<name>=<value>` tokens, with the single precondition `state=approved` (GP\lib\review-integration-v2.ts:2462-2499); values must equal the caller's current STATUS binding (:2512-2518).
- Result envelope `review-acknowledged/v1` (up to v2.5.0-rc.3 the burn is SILENT — `undefined` outcome; GP\lib\native-review-cli.ts:2426-2446, :457-458): `{schema:"gentle-ai.review-acknowledged/v1", operation:"review/acknowledge-approved", action:"acknowledged", lineage_id, target_identity, consumed_revision, authority:"burned"}` — FIX\review-acknowledged-v1.captured.json:2-8; decoder :2554-2574 with expectation checks: `consumed_revision` must equal the revision the caller held (:2572), `lineage_id`/`target_identity` must name the same burn (:2570-2571).
- **Burned semantics**: consumes the approved authority and its artifacts (comment :2427-2428); the caller reconciles through STATUS afterward and never infers the burn from prose (:2433-2435). Post-burn STATUS offers a fresh START.
- **Idempotency**: exact replay of the acknowledgement returns the stored result (journal semantics); a replay with drifted tokens fails closed as a binding mismatch. **[Design decision for M2]**: model the burn as a journaled operation writing a receipt-consumed marker and removing the live lineage authority while preserving the receipt (readme:259 "rollback MUST preserve every native store and receipt"); the persisted 13-state enum has no "burned" member, so the burn is authority-level, not state-level. This needs one addition to `JERO_AUTHORITY_OPERATIONS` (see §I.9).

---

## G. Judgment Day

Differences from the ordinary line (readme:311-317; GP\skills\judgment-day\SKILL.md:14-34, :46-53; GP\openspec\specs\review-transaction\spec.md:118-126):
- Starts ONLY on explicit request; replaces ordinary review for that lineage (readme:311). Mode value `judgment_day` (protocol.ts:102). Snapshot captures non-trivial scope WITHOUT ordinary classification (GP\tests\review-snapshot.test.ts:228).
- Persisted `judges_confirmed` state; `judge_proofs[] {judge_id, execution_hash, result_hash, blind:true, confirmed}`; `judge_proof_hash`, `judge_agreement_hash` (protocol.ts:144-150, :239-240); counters `judge_executions`, `scoped_rejudgments` (:197-198).
- Exactly two blind judges, ZERO refuters (readme:313); immutable budget: review_batches 1, review_actors 2, refuter_batches 0, fix_batches 2, validator_runs 0, final_verifications 1, judgment_rounds 2, judge_runs 6 (GP\lib\review-policy-judgment-day.ts:67-79) — i.e. 2 discovery + up to 2×2 re-judgment executions.
- Discovery and scoped re-judgment are separate modes; discovery runs once against `initial_review_tree`, candidate rows only, persists nothing (SKILL.md:26-32); sweep budget: one exhaustive read-only sweep per judge, ≤2 for full-4R-scale targets (hot auth/update/security/payments or >400 changed lines) (SKILL.md:30).
- Re-judgment receives only requested frozen IDs + exact hash-bound rows + fix diff (SKILL.md:34); request must preserve exact frozen rows and fix diff (GP\lib\review-policy-judgment-day.ts:232-234); judge results only `verified|corroborated|regression`, new/duplicated/omitted/invalid findings become escalation reasons (:194-221).
- ≤2 discovery/re-judgment rounds; round-2 survivors → **escalated**, no third round (readme:315-317; reducer :254-263); final verification tail identical to ordinary (:267-288).
- Reused machinery: snapshot/freeze, identity chain, journal/receipts, budget-monotonic counters, final verification. Bypassed: risk-tier lens selection, refuter batch, targeted validator, correction budget ledger.

---

## H. Ported modules: wrap vs reimplement

All are byte-identical ports (M1 analysis :5) and callable as-is:

| Module (GP\lib\...) | Exact exports | Disposition for M2 |
|---|---|---|
| `review-compact-contract.ts` | `CompactReviewContractError`, `CompactValidationCheckInput`, `CompactFollowUp`, `CompactTargetedValidationInput`, `CompactFinalizeContractInput`, `parseNativeCompactFinalizeInput` (:160), `toNativeValidatorDocument` (:169) | **WRAP** — FINALIZE input validation, unchanged |
| `review-correction-lifecycle.ts` | `CORRECTION_OUTCOMES` (:17), `CorrectionOutcome`, `CorrectionOutcomeError` (:20), `CorrectionEvidenceReplacedError` (:27), `CorrectionStatus` (:34), `CorrectionEvidence` (:42), `CorrectionStep` union (:95: run-targeted-validation / recapture-required / terminal-escalation), `resolveCorrectionStep` (:102), `DistinctEvidenceCheck` (:148), `assertDistinctCorrectionEvidence` (:158) | **WRAP** — pure decision machine for §E ordering |
| `review-policy-ordinary.ts` | `recordOrdinaryDiscovery` (:191), `resolveOrdinaryEvidence` (:215), `applyOrdinaryFix` (:293), `declineOrdinaryFix` (:327), `ordinaryValidatorRequest` (:344), `recordOrdinaryValidation` (:377), `recordOrdinaryFinalVerification` (:493) + input types | **REFERENCE-ONLY** — operates on graph-v1 `ReviewStateV1` (imports review-transaction.ts :1-17), not the compact 13-state record. Reimplement equivalent reductions over `JeroReviewTransactionStateV1`; keep this module as the semantic oracle in tests |
| `review-policy-judgment-day.ts` | `recordJudgmentDayDiscovery` (:103), `applyJudgmentDayFix` (:127), `judgmentDayRejudgmentRequest` (:157), `recordJudgmentDayRejudgment` (:224), `recordJudgmentDayFinalVerification` (:267) | **REFERENCE-ONLY** (same graph-v1 caveat); budget table (:67-79) and round logic (:254-263) are the normative JD rules |
| `review-risk.ts` | `REVIEW_RISK_TIER` (:5), `MAX_CORRECTION_CHANGED_LINES=200` (:14), `LARGE_AUTHORED_CHANGE_LINES=400` (:15), `isGeneratedGoldenPath` (:54), `countAuthoredChangedLines` (:59), `correctionBudget` (:82), `classifyReviewRisk` (:112) | **WRAP** — START freeze tier/lenses/budget |
| `review-risk-assessment.ts` | `REVIEW_ASSESSMENT_SCHEMA` (:18), `REVIEW_ASSESSMENT_RISK` passive/medium/high (:20-24), `decodeReviewAssessmentV1` (:85), `VERIFICATION_TIER` incl. `unassessable` (:109-115), `NATIVE_REVIEW_OUTCOME` (:138) | **WRAP the decode/tier tables; REIMPLEMENT the assessment computation** (upstream computes in Go; failures fail closed to high, :13-16) |
| `review-snapshot.ts` | `captureReviewSnapshot`, `captureLiveReviewCandidateBinding`, `cleanupReviewSnapshot`, `discoverReviewUntrackedPaths`, `deriveReviewSnapshotRisk`; `SnapshotV1` (:85-103); identity body (:127-144) | **WRAP via the M1 snapshots seam** — root redirect required: `snapshotsRoot` hardcodes `gentle-ai/reviews/snapshots` (:186-193); M1 analysis E.6 mandates a `jero-review/snapshots/` redirect parameter rather than editing the port |
| `review-triggers.ts` | `REVIEW_EVENT` (:1), `REVIEW_ROUTE` (:14), `REVIEW_LENS` (:22), `TRIVIALITY` (:31), `FULL_4R_LENSES` (:41), `buildDiffEvidence` (:102), `classifyReviewRoute` (:133) | **WRAP** — route/diff-evidence vocabulary recorded in SnapshotV1 |
| `review-integration-v2.ts` | wire decoders/types enumerated in §C | **Conformance/relay only** — internal M2 state must NOT depend on it (design D7, D:\jero-pi\JERO-PI-DESIGN.md:96) |

Gentle-ai schema strings these modules emit that M2 must tolerate until the P5 rename (design D8:98): `gentle-ai.review-snapshot/v1` (review-snapshot.ts:86), `gentle-ai.review-assessment/v1` (review-risk-assessment.ts:18), plus wire constants inside review-integration-v2.ts (`gentle-ai.review-integration/v2` :1 and the envelope schema strings). The jero-authority record family already uses its own strings (JP\lib\authority\canonical.ts:44-50) — never mix the two hash domains (canonical.ts:5-9, :31-34).

---

## I. Recommended M2 module decomposition under `D:\jero-pi\jero-pi\lib\authority\`

All modules: typed-union APIs in/out, zero env reads, zero `extensions/` imports, unknown-key strict decode, fail-closed (design §9 :321-324).

1. **`transitions.ts`** — the pure transition table (§A.2): `(state, mode, event) → {legal, next, writes}`; terminal/one-shot/cross-mode/budget guards; the persisted→wire state projection (§A.1) and action/reason-code derivation. No IO. Uses: protocol.ts types only.
2. **`start.ts`** — `reviewStart(store, target, selection)` → discriminated union `{kind:"created"|"resumed"|"closed"|"blocked-scope-action"|"consent_required"|"declined", ...}`. Uses: `resolveJeroAuthorityStoreV1` (store-root.ts:290), snapshots seam + `classifyReviewRisk` (freeze), `JeroLineageStoreV1.save` with `expectedRevision:null` + journal op `start` (lineage-store.ts:192, :274), `JeroAuthorityLocksV1.withLock` (locks.ts:41), `deriveChangedPathManifest`/`digestChangedPathManifest` (review-candidate-view, wrap).
3. **`status.ts`** — `reviewStatus(store, target)` → typed status (applicability/receipt/action/replayability/frozen/candidates/next_transition/forecast per §C). Uses: lineage-store `load`/`list`, projection derivation (candidate-view wrap), transitions.ts projection. Read-only.
4. **`finalize.ts`** — wraps `parseNativeCompactFinalizeInput`; lens admission (`freeze-ledger`), classification/refutation (`resolve-evidence`), final verification (`verify`); outcome computation (§D.7); receipt creation + persistence (receipts.ts:34, :55; object-cas `put`). Uses lineage-store `runOperation`.
5. **`validate.ts`** — evidence-first ordering via `resolveCorrectionStep`; targeted-validation admission (`validate-fix`); fix_caused_findings rule; regression checks (§E).
6. **`acknowledge.ts`** — burn per §F; journaled exactly-once.
7. **`risk-assess.ts`** — in-process `assess(diff)` producing the `ReviewAssessmentV1` shape (risk passive|medium|high, reasons, counts, candidate) + fail-closed-to-high; reuses review-risk.ts classification.
8. **`mode.ts`** — mode get/set, clone-scoped mutation only (upstream always `--scope clone` for mutations, GP\lib\native-review-cli.ts:1564-1566); typed result `{operation, scope, status:{global, cloneLocal, effective, source, revision?, reach?}}` mirroring `NativeReviewModeResult` (:245-258); only `/jero:review-mode` user-explicit set (design:115).
9. **Protocol edit (one)**: extend `JERO_AUTHORITY_OPERATIONS` (protocol.ts:432) with `"acknowledge"`. The enum is closed under strict decode (protocol.ts:447-458), so this is a reviewed one-line schema change, not a free-form addition.
10. **`snapshots.ts`** (if not already landed as M1 E.6): snapshot-root redirect seam over review-snapshot.ts.

---

## J. Test plan skeleton

### J.1 Fixture → conformance assertions (`tests/authority/conformance/`)
Assert field-level isomorphism and INTERNAL consistency, never upstream hash bytes (Go-domain hashes are unreproducible):
1. `start-v3-consent-granted.captured.json` — created/reviewing shape; 4 artifact_subjects sharing authority_revision/base/candidate/manifest digest; budget 6 = min(200,ceil(12/2)); repository_context present with event_id⇔outcome; risk_reasons code/signal/path.
2. `start-v3-consent-declined.captured.json` — declined creates zero authority (all the empty/zero fields of §B.5).
3. `start-v3-zero-lens-closed.captured.json` — low/zero-lens closes at START: action closed, state approved, budget 1, artifact_subjects [].
4. `consent-v3.captured.json` — two-choice envelope, invocation regex, off_path command.
5. `status-v5.captured.json` — unrelated + empty candidate + collect `empty_candidate_base_ref_required` + receipt not_applicable + repair block shape.
6. `status-v5-repository-context.captured.json` — current_target + authority{compact-v2, generation 1} + frozen + execute `review.finalize` with preconditions state=reviewing/captured_artifacts=complete + artifacts list + repository_context (NOTE: carries `action:"finalize"` — decode via the schema union, §C.3 discrepancy).
7. `status-v5-capture-result-submission.captured.json` — collect input with submission descriptor (`--input={{value}}`, substitution_location), artifact_subject, inline manifest (same `action:"finalize"` caveat).
8. `failure-v2-capture-evidence.captured.json` — failure envelope fields incl. `retry_safe`, `mutation_outcome`, `next_action:"review.status"`.
9. `last-event-capture-{result,refuter,validation,correction-plan}*.captured.json` (6 files) — closure operations (mind the nonuniform naming: `review/capture-result`, `review.capture-correction-plan`, `review.capture-refuter`, `review/capture-validation` — GP\lib\review-integration-v2.ts:2417-2422), terminal states {approved, correction_required}, status_continuation tokens/preconditions/binding, advisory_findings shape.
10. `result-artifact-v2.captured.json` + `result-artifact-v2-path.captured.json` — reference XOR path locator rule (decoder :2396), admission_decision "completed", selected_order 0..3.
11. `review-acknowledged-v1.captured.json` — burn envelope + consumed_revision binding.
12. `capabilities-v2.2.captured.json` — operation/feature vocabulary anchor (bootstrap command, optional features incl. `provider_targeted_validation_request`, `outcome_bound_verification_evidence`).

### J.2 Unit tests — illegal transitions (one per §A.2 illegal list)
terminal-mutation refusal (approved/escalated/invalidated × every op); lens admission off `reviewing`; resolve-evidence before freeze; second correction (`fix_rounds>1`); forecast 0/201/non-integer; budget overrun → escalated not reopen; validate-before-evidence; validator adds/duplicates/omits findings; fix touching non-genesis path; acknowledge on non-approved / drifted tokens; JD op on ordinary lineage preserving counters (and reverse); ordinary op on JD lineage; journal key-reuse-with-different-hash; pending-entry blocks mutation; corrupted record blocks mutation and reports `corrupted`; foreign-authority-store refuses START (probe names from store-root.ts:70-72); live-lock blocks START while `released` leftover does not; refuter inconclusive escalates without second batch; `fix_caused_findings` non-empty escalates; unknown journal operation fails strict decode.

### J.3 Existing suites to keep green / port
`review-compact-contract.test.ts`, `review-correction-lifecycle.test.ts`, `review-policy-ordinary.test.ts`, `review-policy-judgment-day.test.ts`, `review-risk.test.ts`, `review-triggers.test.ts`, `review-snapshot.test.ts`, `review-last-event-closure.test.ts` (all present under `D:\jero-pi\jero-pi\tests\`) plus new `tests/authority/` integration: START→FINALIZE→VALIDATE→acknowledge happy path, correction round-trip, JD two-round escalation, crash-window journal completion (`prepareOperation`/`completeOperation`, lineage-store.ts:309-356).

---

## Flagged discrepancies (docs vs code; code+fixtures are truth)

1. **Start action `reuse-receipt` vs `closed`**: start.schema.json:36 vs decoder GP\lib\review-integration-v2.ts:77 + fixtures → implement `closed`.
2. **STATUS action `finalize`**: emitted by real captures (2 fixtures) and in the v1 schema enum (status-v2.schema.json:46) but absent from the TS decoder's `STATUS_ACTIONS` (GP\lib\review-integration-v2.ts:85) — those fixtures are only consumed raw; M2's action union must include the schema vocabulary.
3. **action_disposition `final_verification_retry`**: schema :47/:309 vs decoder's 3-value enum (:88-92).
4. **State vocabularies 13 vs 15 vs 5** (§A.1) — persisted record has no `correction_required`/`validating`; the projection table is inferred and must be locked by tests.
5. **`inferential` vs `inferential-severe`** class naming (persisted record vs graph policy).
6. **Risk signal sets**: 6 (wire decoder/schema) vs 8 (evidence phrase map) — emit the 6.
7. **Two lens classifiers coexist**: `classifyReviewRoute` (triggers, hot-path regexes :76-79) and `classifyReviewRisk` (risk, token/phrase regexes :38-39) with slightly different dominant-lens rules; SnapshotV1 records route from triggers and tier/lenses/budget from risk — lock to `captureReviewSnapshot`'s actual output (GP\tests\review-snapshot.test.ts:192), and note readme:212 forbids deriving lens choices from the README table.
8. **`NativeStartRequest.policyPath`/`focus`** are dead in the negotiated flow — do not port.
9. **Pi's execute-operation gate** (GP\lib\native-review-cli.ts:1166) omits `review.finalize`/`review.validate` because upstream relayed them as provider tokens; M2 owns those operations and must widen the gate.

No files were modified (read-only task honored).