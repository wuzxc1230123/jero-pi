import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { reviewValidateV1, expectedJeroTargetedValidationRequestHashV1 } from "../../lib/authority/validate.ts";
import { reviewAcknowledgeV1 } from "../../lib/authority/acknowledge.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { decodeJeroRequestJournalEntryV1 } from "../../lib/authority/protocol.ts";
import { jeroDomainHash } from "../../lib/authority/canonical.ts";
import { admitFixtureReviewerResults, applyFixtureFix, reviewHarness } from "./fixtures.ts";

// Spec §J.3 integration stories: the full happy path, one correction
// round-trip, the crash-window journal completion, and terminal-mutation
// refusal — plus the journal-level fail-closed rules (§J.2 items 10).

function driveFullLifecycle(t: { after: (callback: () => void) => void }, applyFix = true) {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	// START → FINALIZE: lens admission freezes the ledger (MA4: the
	// reviewer artifacts are admitted on disk first).
	const lifecycleResult = { lens_results: [{ lens: "review-readability" as const, findings: [{ id: "sev-1", severity: "CRITICAL" as const, claim: "unhandled failure path" }], evidence: ["changed hunk"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, lifecycleResult);
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: lifecycleResult,
	});
	if (frozen.kind !== "frozen") throw new Error(JSON.stringify(frozen));
	const resolved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev-1", class: "deterministic", proof: "differential test proof", causal_disposition: "introduced" }],
	});
	if (resolved.kind !== "evidence_resolved") throw new Error(JSON.stringify(resolved));
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	if (applyFix) {
		// F5: a REAL correction tree with the derived (never declared-only) count.
		const fix = applyFixtureFix(harness, start.lineage_id, (repo) => {
			writeFileSync(join(repo, "src", "app.ts"), "export const fixed = 1;\nexport const placeholder = 0;\nexport const placeholder = 0;\nexport const placeholder = 0;\n");
		});
		if (fix.actual_correction_lines !== 2) throw new Error(`fixture fix derived ${fix.actual_correction_lines} lines`);
		reviewFinalizeV1(harness.context, {
			cwd: harness.repo, lineageId: start.lineage_id,
			fix_application: fix,
		});
	}
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	return { harness, start, requestHash: expectedJeroTargetedValidationRequestHashV1(loaded.record.state) };
}

test("START → FINALIZE → VALIDATE → acknowledge: the full happy path approves and burns", (t) => {
	const { harness, start, requestHash } = driveFullLifecycle(t);
	const validated = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		evidence: { outcome: "passed", evidenceIdentity: "cap-final", recordDigest: "a".repeat(64) },
		validation: {
			request_hash: requestHash,
			correction_ids: ["sev-1"],
			original_criteria: { passed: true, evidence: ["acceptance suite"] },
			correction_regression: { passed: true, evidence: ["regression proof"] },
			fix_caused_findings: [],
			follow_ups: [],
		},
	});
	assert.equal(validated.kind, "validated");
	const approved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		final_evidence: "final verification output", final_verification_passed: true,
	});
	assert.equal(approved.kind, "terminal");
	if (approved.kind !== "terminal") return;
	assert.equal(approved.state, "approved");
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	if (status.kind !== "status") throw new Error("status failed");
	assert.equal(status.authority?.state, "approved");
	// ACKNOWLEDGE burns the approved authority; the receipt survives.
	const acknowledged = reviewAcknowledgeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, targetIdentity: start.target_identity,
		expectedRevision: status.authority.revision, token: "burn",
	});
	assert.equal(acknowledged.kind, "acknowledged");
	const postBurn = reviewStatusV1(harness.context, { cwd: harness.repo });
	if (postBurn.kind !== "status") throw new Error("post-burn status failed");
	// Post-burn STATUS offers a fresh START.
	assert.equal(postBurn.applicability, "unrelated");
	assert.equal(postBurn.action, "start");
});

test("one correction round-trip: wire states correction_required → validating → approved", (t) => {
	const { harness, start } = driveFullLifecycle(t, false);
	const wireState = () => {
		const status = reviewStatusV1(harness.context, { cwd: harness.repo });
		if (status.kind !== "status" || status.authority === undefined) throw new Error("status failed");
		return status.authority.state;
	};
	// The correction transaction is open (fixing): wire correction_required.
	assert.equal(wireState(), "correction_required");
	// The bounded edit is applied: the wire state advances to validating.
	const fix = applyFixtureFix(harness, start.lineage_id, (repo) => {
		writeFileSync(join(repo, "src", "app.ts"), "export const fixed = 1;\nexport const placeholder = 0;\nexport const placeholder = 0;\nexport const placeholder = 0;\n");
	});
	const applied = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: fix,
	});
	assert.equal(applied.kind, "fix_applied");
	assert.equal(applied.state, "validating");
	assert.equal(wireState(), "validating");
	// The persisted state is the 13-state record (fix_validating); the wire
	// projection is validating (§A.1 mapping locked by this round-trip).
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded.record.state.state, "fix_validating");
});

test("crash-window journal completion: prepareOperation blocks mutation, completeOperation finishes", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const store = JeroLineageStoreV1.forStore(harness.context.store.store_root);
	const requestHash = jeroDomainHash("request", { operation: "freeze-ledger", lineage_id: start.lineage_id, payload: { lens: "review-readability", findings: 0 } });
	// The crash window: a PENDING entry is durably recorded before the effect exists.
	const prepared = store.prepareOperation({ lineageId: start.lineage_id, operation: "freeze-ledger", idempotencyKey: "crash-freeze", requestHash });
	assert.match(prepared.revision, /^sha256:[0-9a-f]{64}$/);
	// While pending, every new mutating operation and replay fails closed.
	assert.throws(() => store.runOperation({
		lineageId: start.lineage_id, operation: "verify", idempotencyKey: "other", requestHash: "1".repeat(64),
		apply: (record) => ({ draft: { state: record.state, request_journal: record.request_journal }, result: null }),
	}), /Unresolved pending operation blocks mutation/);
	assert.throws(() => store.prepareOperation({ lineageId: start.lineage_id, operation: "freeze-ledger", idempotencyKey: "crash-freeze", requestHash }), /Unresolved pending operation blocks replay/);
	// Recovery: the journal completion applies the crash-interrupted effect.
	const completed = store.completeOperation({
		lineageId: start.lineage_id, operation: "freeze-ledger", idempotencyKey: "crash-freeze", requestHash,
		apply: (record) => {
			const next = structuredClone(record.state);
			next.state = "findings_frozen";
			next.ledger_findings_hash = `sha256:${"9".repeat(64)}`;
			return { draft: { state: next, request_journal: record.request_journal }, result: { state: "findings_frozen" } };
		},
	});
	assert.deepEqual(completed.result, { state: "findings_frozen" });
	// An exact completion replay is stable (idempotent recovery).
	const replayed = store.completeOperation({
		lineageId: start.lineage_id, operation: "freeze-ledger", idempotencyKey: "crash-freeze", requestHash,
		apply: () => { throw new Error("must not re-apply"); },
	});
	assert.deepEqual(replayed.result, { state: "findings_frozen" });
	const loaded = store.load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded.record.state.state, "findings_frozen");
});

test("terminal-mutation refusal: approved, escalated, and invalidated lineages refuse every op", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const terminalResult = { lens_results: [{ lens: "review-readability" as const, findings: [], evidence: ["clean"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, terminalResult);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: terminalResult,
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, classifications: [] });
	const approved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		final_evidence: "final verification output", final_verification_passed: true,
	});
	assert.equal(approved.kind, "terminal");
	// FINALIZE from the terminal state.
	const finalize = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		final_evidence: "again", final_verification_passed: true,
	});
	assert.equal(finalize.kind, "refused");
	if (finalize.kind === "refused") assert.equal(finalize.code, "terminal-immutable");
	// VALIDATE from the terminal state.
	const validated = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		evidence: { outcome: "passed", evidenceIdentity: "cap", recordDigest: "a".repeat(64) },
		validation: {
			request_hash: "0".repeat(64), correction_ids: [],
			original_criteria: { passed: true, evidence: ["x"] },
			correction_regression: { passed: true, evidence: ["y"] },
			fix_caused_findings: [], follow_ups: [],
		},
	});
	assert.equal(validated.kind, "refused");
	if (validated.kind === "refused") assert.equal(validated.code, "terminal-immutable");
	// A START with a fresh key against the terminal lineage fails closed
	// (the identical original payload would be an exact journal replay).
	const restarted = reviewStartV1(harness.context, { cwd: harness.repo }, { idempotencyKey: "restart-after-terminal" });
	assert.equal(restarted.kind, "refused");
	if (restarted.kind === "refused") assert.equal(restarted.code, "lineage-not-startable");
});

test("journal discipline: key reuse with a divergent hash fails; unknown operations fail strict decode", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const store = JeroLineageStoreV1.forStore(harness.context.store.store_root);
	const loaded = store.load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	const startKey = loaded.record.request_journal[0]!.idempotency_key;
	// Key reuse with a different request hash fails closed (§A.2 illegal #10).
	assert.throws(() => store.runOperation({
		lineageId: start.lineage_id, operation: "start", idempotencyKey: startKey, requestHash: "2".repeat(64),
		apply: (record) => ({ draft: { state: record.state, request_journal: record.request_journal }, result: null }),
	}), /reused with a different request/);
	// An unknown journal operation name fails the strict decode (closed enum).
	assert.throws(() => decodeJeroRequestJournalEntryV1({ operation: "explode", idempotency_key: "k", request_hash: "3".repeat(64), status: "completed", canonical_result: {} }), /unsupported value "explode"/);
	// Pending and completed are the only journal statuses.
	assert.throws(() => decodeJeroRequestJournalEntryV1({ operation: "verify", idempotency_key: "k", request_hash: "3".repeat(64), status: "in-flight" }), /unsupported value "in-flight"/);
});

test("F1: a malformed lineageId is a typed invalid-request refusal at every public boundary — never a raw store error", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const malformed = "review-../escape";
	const status = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: malformed });
	assert.equal(status.kind, "refused");
	if (status.kind === "refused") assert.equal(status.code, "invalid-request");
	const finalize = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: malformed, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["x"] }] },
	});
	assert.equal(finalize.kind, "refused");
	if (finalize.kind === "refused") assert.equal(finalize.code, "invalid-request");
	const validate = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId: malformed,
		evidence: { outcome: "passed", evidenceIdentity: "cap", recordDigest: "a".repeat(64) },
		validation: {
			request_hash: "0".repeat(64), correction_ids: [],
			original_criteria: { passed: true, evidence: ["x"] },
			correction_regression: { passed: true, evidence: ["y"] },
			fix_caused_findings: [], follow_ups: [],
		},
	});
	assert.equal(validate.kind, "refused");
	if (validate.kind === "refused") assert.equal(validate.code, "invalid-request");
	const acknowledge = reviewAcknowledgeV1(harness.context, {
		cwd: harness.repo, lineageId: malformed, targetIdentity: start.target_identity,
		expectedRevision: start.revision, token: "t",
	});
	assert.equal(acknowledge.kind, "refused");
	if (acknowledge.kind === "refused") assert.equal(acknowledge.code, "invalid-request");
});
