import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { reviewValidateV1 } from "../../lib/authority/validate.ts";
import { renderJeroCaptureBindingV1 } from "../../lib/authority/capture.ts";
import {
	renderJeroJudgmentDayJudgeVectorsV1,
	admitJeroJudgmentDayJudgesV1,
	admitJeroJudgmentDayDiscoveryFreezeV1,
	admitJeroJudgmentDayFixV1,
	admitJeroJudgmentDayRejudgmentV1,
	admitJeroJudgmentDayFinalVerificationV1,
	buildJeroJudgmentDayRejudgmentRequestV1,
	JERO_JUDGMENT_DAY_BUDGET,
} from "../../lib/authority/judgment-day.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { reviewHarness, applyFixtureFix } from "./fixtures.ts";
import { canonicalHash, type CanonicalFrozenRowV1 } from "../../lib/review-transaction.ts";

// Spec §F/§J.3/§J.4: the Judgment Day driver — blind judge admission,
// discovery freeze, one-batch fix coverage, scoped re-judgment survivor
// rule, round-2 escalation with no third round, the immutable budget table,
// and cross-mode refusals in both directions.

function row(id: string, severity: "BLOCKER" | "CRITICAL" | "WARNING" = "CRITICAL"): CanonicalFrozenRowV1 {
	return { id, lens: "judgment-day", location: "src/app.ts:2", severity, status_at_freeze: "open", evidence_class: "deterministic", evidence_claim: "concrete user impact" };
}

// NIT (review): judge admission enforces canonical 64-hex execution/result
// digests, so the fixture mints real ones.
const hex64 = (seed: string): string => createHash("sha256").update(seed).digest("hex");

function judge(id: string, rows: readonly CanonicalFrozenRowV1[], resultSeed = "a") {
	return { judge_id: id, execution_hash: hex64(`exec-${resultSeed}-${id}`), result_hash: hex64(`result-${resultSeed}-${id}`), rows };
}

function judgmentLedgerPath(harness: { context: import("../../lib/authority/review.ts").JeroAuthorityContextV1 }, lineageId: string): string {
	return join(harness.context.store.store_root, "lineages", lineageId, "judgment-ledger.json");
}

function tamperJudgmentLedger(harness: { context: import("../../lib/authority/review.ts").JeroAuthorityContextV1 }, lineageId: string, mutate: (ledger: Record<string, unknown>) => void): void {
	const path = judgmentLedgerPath(harness, lineageId);
	const ledger = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	mutate(ledger);
	writeFileSync(path, `${JSON.stringify(ledger, null, 2)}
`);
}

function startedJudgmentDay(t: { after: (callback: () => void) => void }) {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo, requestMode: "judgment-day" }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	return { harness, start };
}

function counters(harness: { context: import("../../lib/authority/review.ts").JeroAuthorityContextV1 }, lineageId: string) {
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(lineageId);
	if (loaded.kind !== "ok") throw new Error("load failed");
	return loaded.record.state.counters;
}

function fixtureFix(harness: { repo: string }, lineageId: string, value: number) {
	return applyFixtureFix(harness as never, lineageId, (repo: string) => {
		const path = join(repo, "src", "app.ts");
		writeFileSync(path, readFileSync(path, "utf8").replace(`export const placeholder = ${value};`, `export const placeholder = ${value + 10};`));
	});
}

test("judge vectors render two blind prompts with A/B independence framing", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	const vectors = renderJeroJudgmentDayJudgeVectorsV1(harness.context, start.lineage_id);
	assert.equal(vectors.kind, "ok");
	if (vectors.kind !== "ok") return;
	assert.equal(vectors.vectors.length, 2);
	const [a, b] = vectors.vectors;
	assert.equal(a!.judge_id, "judge-a");
	assert.equal(b!.judge_id, "judge-b");
	const aPrompt = a!.promptBytes.toString("utf8");
	const bPrompt = b!.promptBytes.toString("utf8");
	assert.match(aPrompt, /judgment day judge a/i);
	assert.match(aPrompt, /JD-A-001/);
	assert.match(bPrompt, /judgment day judge b/i);
	assert.match(bPrompt, /different angle than judge a/i);
	assert.match(bPrompt, /JD-B-001/);
	// Shared graph-v1 discovery contract + sweep budget.
	assert.match(aPrompt, /"rows": \[/);
	assert.match(aPrompt, /exactly two blind judges and zero refuters/);
	assert.match(aPrompt, /at most two rounds/);
	assert.match(bPrompt, /Sweep budget/);
	// Binding header pins the frozen target.
	assert.match(aPrompt, /^JERO_JUDGMENT_DAY_BINDING \{/);
});

test("confirm-judges admits exactly two blind judges, zero refuters, and persists proofs", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	const refusedCount = admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")])] });
	assert.equal(refusedCount.kind, "refused");
	if (refusedCount.kind === "refused") assert.equal(refusedCount.code, "judge-count-refused");
	const confirmed = admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [row("JD-B-001")])] });
	assert.equal(confirmed.kind, "judges_confirmed");
	if (confirmed.kind !== "judges_confirmed") return;
	assert.equal(confirmed.judge_proofs.length, 2);
	assert.ok(confirmed.judge_proofs.every((proof) => proof.blind && proof.confirmed));
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded.record.state.state, "judges_confirmed");
	assert.equal(loaded.record.state.counters.judge_executions, 2);
	assert.equal(loaded.record.state.counters.refuter_batches, 0);
	assert.match(loaded.record.state.judge_proof_hash ?? "", /^[0-9a-f]{64}$/);
	assert.match(loaded.record.state.judge_agreement_hash ?? "", /^[0-9a-f]{64}$/);
});

test("zero-severe discovery skips straight to final verification and approves", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	assert.equal(admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", []), judge("judge-b", [])] }).kind, "judges_confirmed");
	const frozen = admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	assert.equal(frozen.kind, "discovery_frozen");
	if (frozen.kind !== "discovery_frozen") return;
	assert.equal(frozen.state, "ready_final_verification");
	assert.deepEqual(frozen.severe_finding_ids, []);
	const terminal = admitJeroJudgmentDayFinalVerificationV1(harness.context, { lineageId: start.lineage_id, cwd: harness.repo, final_evidence: "verification evidence", final_verification_passed: true });
	assert.equal(terminal.kind, "terminal");
	if (terminal.kind !== "terminal") return;
	assert.equal(terminal.state, "approved");
	const final = counters(harness, start.lineage_id);
	assert.equal(final.judge_executions, 2);
	assert.equal(final.scoped_rejudgments, 0);
	assert.equal(final.scoped_fix_validations, 0);
	assert.equal(final.final_verifications, 1);
});

test("J.3 two-round escalation: round-1 survivor reopens the fix; round-2 survivor escalates with the no-third-round reason", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [row("JD-B-001")])] });
	const frozen = admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	assert.equal(frozen.kind, "discovery_frozen");
	if (frozen.kind !== "discovery_frozen") return;
	assert.equal(frozen.state, "fix_required");
	assert.deepEqual(frozen.severe_finding_ids, ["JD-A-001", "JD-B-001"]);
	// Fix missing one ID: refused — the fix must cover every survivor in one batch.
	const incomplete = admitJeroJudgmentDayFixV1(harness.context, { lineageId: start.lineage_id, fixedIds: ["JD-A-001"], fix_application: fixtureFix(harness, start.lineage_id, 0) });
	assert.equal(incomplete.kind, "refused");
	if (incomplete.kind === "refused") assert.equal(incomplete.code, "fix-coverage-mismatch");
	// Round 1: cover both, apply.
	const fix1 = admitJeroJudgmentDayFixV1(harness.context, { lineageId: start.lineage_id, fixedIds: ["JD-A-001", "JD-B-001"], fix_application: fixtureFix(harness, start.lineage_id, 0) });
	assert.equal(fix1.kind, "fix_applied");
	if (fix1.kind === "fix_applied") assert.equal(fix1.round, 1);
	assert.equal(counters(harness, start.lineage_id).fix_batches, 1);
	// Round 1 re-judgment: judge B corroborates JD-B-001 (not verified) → survivor.
	const request1 = buildJeroJudgmentDayRejudgmentRequestV1(harness.context, start.lineage_id);
	assert.equal(request1.kind, "ok");
	if (request1.kind !== "ok") return;
	assert.equal(request1.request.round, 1);
	assert.deepEqual(request1.request.requested_ids, ["JD-A-001", "JD-B-001"]);
	const rejudge1 = admitJeroJudgmentDayRejudgmentV1(harness.context, {
		lineageId: start.lineage_id,
		request: request1.request,
		judgeAResults: [{ id: "JD-A-001", outcome: "verified" }, { id: "JD-B-001", outcome: "verified" }],
		judgeBResults: [{ id: "JD-A-001", outcome: "verified" }, { id: "JD-B-001", outcome: "corroborated" }],
	});
	assert.equal(rejudge1.kind, "rejudged");
	if (rejudge1.kind !== "rejudged") return;
	assert.deepEqual(rejudge1.survivors, ["JD-B-001"]);
	const loaded1 = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded1.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded1.record.state.state, "fixing", "round-1 survivors reopen the fix");
	// Round 2: fix the survivor, apply again.
	const fix2 = admitJeroJudgmentDayFixV1(harness.context, { lineageId: start.lineage_id, fixedIds: ["JD-B-001"], fix_application: fixtureFix(harness, start.lineage_id, 0) });
	assert.equal(fix2.kind, "fix_applied");
	if (fix2.kind === "fix_applied") assert.equal(fix2.round, 2);
	assert.equal(counters(harness, start.lineage_id).fix_batches, 2);
	const request2 = buildJeroJudgmentDayRejudgmentRequestV1(harness.context, start.lineage_id);
	assert.equal(request2.kind, "ok");
	if (request2.kind !== "ok") return;
	assert.equal(request2.request.round, 2);
	assert.deepEqual(request2.request.requested_ids, ["JD-B-001"]);
	const rejudge2 = admitJeroJudgmentDayRejudgmentV1(harness.context, {
		lineageId: start.lineage_id,
		request: request2.request,
		judgeAResults: [{ id: "JD-B-001", outcome: "verified" }],
		judgeBResults: [{ id: "JD-B-001", outcome: "regression" }],
	});
	assert.equal(rejudge2.kind, "rejudged");
	if (rejudge2.kind !== "rejudged") return;
	assert.deepEqual(rejudge2.survivors, ["JD-B-001"]);
	assert.ok(rejudge2.escalation_reasons.some((reason) => reason.includes("survived Judgment Day round two; no third round is allowed")), rejudge2.escalation_reasons.join("; "));
	const loaded2 = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded2.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded2.record.state.state, "ready_final_verification", "round-2 survivors force the final-verification tail");
	// A third round is refused.
	const third = admitJeroJudgmentDayRejudgmentV1(harness.context, { lineageId: start.lineage_id, request: request2.request, judgeAResults: [], judgeBResults: [] });
	assert.equal(third.kind, "refused");
	// The tail escalates even though the verification itself passed.
	const terminal = admitJeroJudgmentDayFinalVerificationV1(harness.context, { lineageId: start.lineage_id, cwd: harness.repo, final_evidence: "evidence", final_verification_passed: true });
	assert.equal(terminal.kind, "terminal");
	if (terminal.kind !== "terminal") return;
	assert.equal(terminal.state, "escalated");
	const final = counters(harness, start.lineage_id);
	assert.equal(final.judge_executions, 6, "2 discovery + 2×2 re-judgment");
	assert.equal(final.scoped_rejudgments, 2);
	assert.ok(final.judge_executions <= JERO_JUDGMENT_DAY_BUDGET.judge_runs);
	assert.ok(final.fix_batches <= JERO_JUDGMENT_DAY_BUDGET.fix_batches);
});

test("a tampered re-judgment request is refused (exact frozen rows and fix diff)", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [row("JD-B-001")])] });
	admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	admitJeroJudgmentDayFixV1(harness.context, { lineageId: start.lineage_id, fixedIds: ["JD-A-001", "JD-B-001"], fix_application: fixtureFix(harness, start.lineage_id, 0) });
	const request = buildJeroJudgmentDayRejudgmentRequestV1(harness.context, start.lineage_id);
	if (request.kind !== "ok") throw new Error("request failed");
	const tampered = admitJeroJudgmentDayRejudgmentV1(harness.context, {
		lineageId: start.lineage_id,
		request: { ...request.request, frozen_rows: [...request.request.frozen_rows.slice(0, 1)] },
		judgeAResults: [],
		judgeBResults: [],
	});
	assert.equal(tampered.kind, "refused");
	if (tampered.kind === "refused") assert.equal(tampered.code, "rejudgment-request-mismatch");
	// Judge result discipline: new/duplicated/omitted findings append reasons.
	const sloppy = admitJeroJudgmentDayRejudgmentV1(harness.context, {
		lineageId: start.lineage_id,
		request: request.request,
		judgeAResults: [{ id: "JD-A-001", outcome: "verified" }, { id: "GHOST-1", outcome: "verified" }],
		judgeBResults: [{ id: "JD-A-001", outcome: "verified" }, { id: "JD-A-001", outcome: "verified" }],
	});
	assert.equal(sloppy.kind, "rejudged");
	if (sloppy.kind === "rejudged") {
		assert.ok(sloppy.escalation_reasons.some((reason) => reason.includes("attempted to add new finding GHOST-1")));
		assert.ok(sloppy.escalation_reasons.some((reason) => reason.includes("omitted requested finding JD-B-001")));
		assert.deepEqual(sloppy.survivors, ["JD-B-001"]);
	}
});

test("J.4 cross-mode: ordinary ops on a JD lineage refuse, and JD ops on an ordinary lineage refuse", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	// Ordinary lens admission on JD.
	const ordinaryResult = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["x"] }] },
	});
	assert.equal(ordinaryResult.kind, "refused");
	if (ordinaryResult.kind === "refused") assert.equal(ordinaryResult.code, "cross-mode-operation-refused");
	// Ordinary reviewer capture render on JD.
	const render = renderJeroCaptureBindingV1({ kind: "refuter-vector", context: harness.context, lineageId: start.lineage_id });
	assert.equal(render.kind, "refused");
	if (render.kind === "refused") assert.equal(render.code, "cross-mode-operation-refused");
	// JD admissions advance; then ordinary validate/authorize refuse on the JD lineage.
	admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [])] });
	admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	const ordinaryPlan = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 1 });
	assert.equal(ordinaryPlan.kind, "refused");
	if (ordinaryPlan.kind === "refused") assert.equal(ordinaryPlan.code, "cross-mode-operation-refused");
	admitJeroJudgmentDayFixV1(harness.context, { lineageId: start.lineage_id, fixedIds: ["JD-A-001"], fix_application: fixtureFix(harness, start.lineage_id, 0) });
	const ordinaryValidate = reviewValidateV1(harness.context, {
		cwd: harness.repo,
		lineageId: start.lineage_id,
		evidence: { outcome: "passed", evidenceIdentity: "evidence-id-1", recordDigest: "digest-1" },
		validation: { request_hash: "0".repeat(64), correction_ids: ["JD-A-001"], original_criteria: { passed: true, evidence: ["e"] }, correction_regression: { passed: true, evidence: ["e"] }, fix_caused_findings: [], follow_ups: [] },
	});
	assert.equal(ordinaryValidate.kind, "refused");
	if (ordinaryValidate.kind === "refused") assert.equal(ordinaryValidate.code, "cross-mode-operation-refused");
	// And the reverse: JD ops on an ordinary lineage.
	const ordinary = reviewHarness(t, "medium", 4);
	const ordinaryStart = reviewStartV1(ordinary.context, { cwd: ordinary.repo }, { consent: "granted" });
	if (ordinaryStart.kind !== "created") throw new Error("ordinary start failed");
	const jdOnOrdinary = admitJeroJudgmentDayJudgesV1(ordinary.context, { lineageId: ordinaryStart.lineage_id, judges: [judge("judge-a", []), judge("judge-b", [])] });
	assert.equal(jdOnOrdinary.kind, "refused");
	if (jdOnOrdinary.kind === "refused") assert.equal(jdOnOrdinary.code, "cross-mode-operation-refused");
	// Counters preserved on every cross-mode refusal.
	assert.equal(counters(ordinary, ordinaryStart.lineage_id).judge_executions, 0);
});

test("judge admission enforces distinct judge ids and canonical hash formats (NIT)", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	const duplicatedId = admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", []), judge("judge-a", [])] });
	assert.equal(duplicatedId.kind, "refused");
	if (duplicatedId.kind === "refused") {
		assert.equal(duplicatedId.code, "invalid-request");
		assert.match(duplicatedId.detail ?? "", /judge-a was submitted twice/);
	}
	const malformed = admitJeroJudgmentDayJudgesV1(harness.context, {
		lineageId: start.lineage_id,
		judges: [{ ...judge("judge-a", []), execution_hash: "not-a-digest" }, judge("judge-b", [])],
	});
	assert.equal(malformed.kind, "refused");
	if (malformed.kind === "refused") {
		assert.equal(malformed.code, "invalid-request");
		assert.match(malformed.detail ?? "", /execution_hash/);
	}
	const badResultHash = admitJeroJudgmentDayJudgesV1(harness.context, {
		lineageId: start.lineage_id,
		judges: [judge("judge-a", []), { ...judge("judge-b", []), result_hash: "zz" }],
	});
	assert.equal(badResultHash.kind, "refused");
	if (badResultHash.kind === "refused") assert.equal(badResultHash.code, "invalid-request");
});

test("MA1: a tampered judgment-ledger sidecar refuses the discovery freeze with re-admit-the-judges", (t) => {
	// Rows edited after confirm-judges (frozen_ledger_hash left as-is): the
	// canonicalHash(rows) === frozen_ledger_hash probe fails.
	const rowTamper = (() => {
		const { harness, start } = startedJudgmentDay(t);
		admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [])] });
		tamperJudgmentLedger(harness, start.lineage_id, (ledger) => {
			(ledger.rows as Array<Record<string, unknown>>)[0]!.severity = "SUGGESTION";
		});
		return admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	})();
	assert.equal(rowTamper.kind, "refused");
	if (rowTamper.kind === "refused") {
		assert.equal(rowTamper.code, "invalid-state");
		assert.match(rowTamper.detail ?? "", /re-admit the judges/);
	}
	// Judge proofs edited after confirm-judges: the cross-check against the
	// record's persisted judge_proof_hash fails.
	const proofTamper = (() => {
		const { harness, start } = startedJudgmentDay(t);
		admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [])] });
		tamperJudgmentLedger(harness, start.lineage_id, (ledger) => {
			((ledger.judge_proofs as Array<Record<string, unknown>>)[0]!.result_hash as string) = hex64("forged-result");
		});
		return admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	})();
	assert.equal(proofTamper.kind, "refused");
	if (proofTamper.kind === "refused") {
		assert.equal(proofTamper.code, "invalid-state");
		assert.match(proofTamper.detail ?? "", /judge_proof_hash/);
	}
	// frozen_ledger_hash rewritten to a value the rows do not hash to.
	const hashTamper = (() => {
		const { harness, start } = startedJudgmentDay(t);
		admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [])] });
		tamperJudgmentLedger(harness, start.lineage_id, (ledger) => {
			ledger.frozen_ledger_hash = hex64("forged-ledger");
		});
		return admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	})();
	assert.equal(hashTamper.kind, "refused");
	if (hashTamper.kind === "refused") assert.equal(hashTamper.code, "invalid-state");
});

test("MA1: post-freeze tampering and stale rounds refuse the scoped re-judgment", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [row("JD-B-001")])] });
	admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	admitJeroJudgmentDayFixV1(harness.context, { lineageId: start.lineage_id, fixedIds: ["JD-A-001", "JD-B-001"], fix_application: fixtureFix(harness, start.lineage_id, 0) });
	// The untampered request builds.
	assert.equal(buildJeroJudgmentDayRejudgmentRequestV1(harness.context, start.lineage_id).kind, "ok");
	// Post-freeze row edit with the sidecar's own hash RECOMPUTED (so the
	// canonicalHash probe passes): the record's persisted ledger_hash no
	// longer derives from the forged frozen_ledger_hash.
	tamperJudgmentLedger(harness, start.lineage_id, (ledger) => {
		(ledger.rows as Array<Record<string, unknown>>)[1]!.severity = "SUGGESTION";
		ledger.frozen_ledger_hash = canonicalHash(ledger.rows);
	});
	const forged = buildJeroJudgmentDayRejudgmentRequestV1(harness.context, start.lineage_id);
	assert.equal(forged.kind, "refused");
	if (forged.kind === "refused") {
		assert.equal(forged.code, "invalid-state");
		assert.match(forged.detail ?? "", /persisted ledger_hash/);
	}
	// Staleness: a round appended to the sidecar that the record never
	// journaled (the crash-rollback shape) desyncs rounds vs counters.
	tamperJudgmentLedger(harness, start.lineage_id, (ledger) => {
		(ledger.rows as Array<Record<string, unknown>>)[1]!.severity = "CRITICAL";
		ledger.frozen_ledger_hash = canonicalHash(ledger.rows);
		(ledger.rounds as unknown[]).push({ round: 1, requested_ids: ["JD-A-001"], survivors: ["JD-A-001"] });
	});
	const stale = buildJeroJudgmentDayRejudgmentRequestV1(harness.context, start.lineage_id);
	assert.equal(stale.kind === "refused" && stale.code === "invalid-state", true);
	if (stale.kind === "refused") assert.match(stale.detail ?? "", /rounds/);
});

test("MA3: a byte-identical fix resubmitted after the round-1 reopen advances as round 2 (no replay wedge)", (t) => {
	const { harness, start } = startedJudgmentDay(t);
	admitJeroJudgmentDayJudgesV1(harness.context, { lineageId: start.lineage_id, judges: [judge("judge-a", [row("JD-A-001")]), judge("judge-b", [row("JD-B-001")])] });
	admitJeroJudgmentDayDiscoveryFreezeV1(harness.context, { lineageId: start.lineage_id });
	const fixApplication = fixtureFix(harness, start.lineage_id, 0);
	const fix1 = admitJeroJudgmentDayFixV1(harness.context, { lineageId: start.lineage_id, fixedIds: ["JD-A-001", "JD-B-001"], fix_application: fixApplication });
	assert.equal(fix1.kind, "fix_applied");
	if (fix1.kind !== "fix_applied") return;
	assert.equal(fix1.round, 1);
	// Round 1: BOTH judges corroborate everything — every id survives and the
	// fix loop reopens with the same required set.
	const request1 = buildJeroJudgmentDayRejudgmentRequestV1(harness.context, start.lineage_id);
	if (request1.kind !== "ok") throw new Error("request failed");
	const rejudge1 = admitJeroJudgmentDayRejudgmentV1(harness.context, {
		lineageId: start.lineage_id,
		request: request1.request,
		judgeAResults: [{ id: "JD-A-001", outcome: "corroborated" }, { id: "JD-B-001", outcome: "corroborated" }],
		judgeBResults: [{ id: "JD-A-001", outcome: "corroborated" }, { id: "JD-B-001", outcome: "corroborated" }],
	});
	assert.equal(rejudge1.kind, "rejudged");
	if (rejudge1.kind !== "rejudged") return;
	assert.deepEqual(rejudge1.survivors, ["JD-A-001", "JD-B-001"]);
	const reopened = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (reopened.kind !== "ok") throw new Error("load failed");
	assert.equal(reopened.record.state.state, "fixing");
	// The wedge probe: resubmit the BYTE-IDENTICAL fix (same fixedIds, same
	// fix_application object). It must journal as round 2 and advance to
	// fix_validating — not replay round 1's stored result and strand the
	// lineage in `fixing`.
	const replay = admitJeroJudgmentDayFixV1(harness.context, { lineageId: start.lineage_id, fixedIds: ["JD-A-001", "JD-B-001"], fix_application: fixApplication });
	assert.equal(replay.kind, "fix_applied");
	if (replay.kind !== "fix_applied") return;
	assert.equal(replay.round, 2, "identical bytes at a NEW authority moment are round 2, not a replay");
	assert.equal(counters(harness, start.lineage_id).fix_batches, 2);
	const after = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (after.kind !== "ok") throw new Error("load failed");
	assert.equal(after.record.state.state, "fix_validating");
});
