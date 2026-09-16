import assert from "node:assert/strict";
import test from "node:test";
import {
	JERO_CAPTURE_CLOSURE_OPERATIONS,
	JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP,
	buildJeroLastEventClosureV1,
	decodeJeroLastEventClosureV1,
	decodeJeroClosureAcknowledgementV1,
	jeroAdvisoryFindingsFromStateV1,
	assertJeroLastEventClosureBindingV1,
	JERO_APPROVED_CLOSURE_ACTION,
} from "../../lib/authority/closures.ts";
import type { JeroLineageStateFileV1 } from "../../lib/authority/lineage-store.ts";
import { JERO_LINEAGE_STATE_SCHEMA, jeroDomainHash } from "../../lib/authority/canonical.ts";
import { testTransactionState } from "./fixtures.ts";

// Spec §E/§J.2: last-event closure construction rules, the status
// continuation discipline, advisory findings assembly, defensive
// acknowledgement decode, and the conformance operation-name mapping.

function closureRecord(): JeroLineageStateFileV1 {
	const state = testTransactionState();
	return {
		schema: JERO_LINEAGE_STATE_SCHEMA,
		lineage_id: state.lineage_id,
		revision: `sha256:${"1".repeat(64)}`,
		state,
		request_journal: [],
	};
}

test("correction-plan closure: required fields, forbidden members, correction_required state", () => {
	const record = closureRecord();
	const closure = buildJeroLastEventClosureV1({
		operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN,
		record,
		state: "correction_required",
		cwd: "/repo",
		requestHash: `sha256:${"2".repeat(64)}`,
		correctionLines: 2,
	});
	assert.equal(closure.state, "correction_required");
	assert.equal(closure.target_identity, record.state.snapshot.identity);
	assert.equal(closure.correction_lines, 2);
	assert.equal(closure.action, undefined);
	assert.equal(closure.advisory_findings, undefined);
	assert.equal(closure.status_continuation, undefined);
	assert.equal(closure.reviewer_results, undefined);
	// Construction discipline: the wrong state or bounds throw.
	assert.throws(() => buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN, record, state: "approved", cwd: "/repo", requestHash: `sha256:${"2".repeat(64)}`, correctionLines: 2 }), /correction_required/);
	assert.throws(() => buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN, record, state: "correction_required", cwd: "/repo", requestHash: "nope", correctionLines: 2 }), /request_hash/);
	assert.throws(() => buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN, record, state: "correction_required", cwd: "/repo", requestHash: `sha256:${"2".repeat(64)}`, correctionLines: 0 }), /1\.\.200/);
	assert.throws(() => buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN, record, state: "correction_required", cwd: "/repo", requestHash: `sha256:${"2".repeat(64)}`, correctionLines: 201 }), /1\.\.200/);
});

test("result/refuter closures in correction_required REQUIRE the exact-token status continuation", () => {
	const record = closureRecord();
	for (const operation of [JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT, JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_REFUTER]) {
		const closure = buildJeroLastEventClosureV1({ operation, record, state: "correction_required", cwd: "/repo" });
		const continuation = closure.status_continuation!;
		assert.ok(continuation !== undefined, `${operation} requires a continuation`);
		assert.equal(continuation.operation, "review.status");
		assert.deepEqual(continuation.arguments.map(({ name, token }) => [name, token]), [
			["cwd", "--cwd=/repo"],
			["contract", "--contract=jero.authority/v1"],
			["next-transition", "--next-transition=true"],
			["lineage", `--lineage=${record.lineage_id}`],
			["agent", "--agent=pi"],
		]);
		assert.deepEqual(continuation.preconditions, [{ name: "state", value: "correction_required" }]);
		assert.equal(continuation.binding.lineage_id, closure.lineage_id);
		assert.equal(continuation.binding.revision, closure.store_revision);
		// Decoder cross-checks: binding lineage and revision must match the
		// enclosing closure, exactly one lineage argument with its exact token.
		assert.doesNotThrow(() => decodeJeroLastEventClosureV1(closure));
	}
	// Any other combination forbids the continuation.
	const approved = buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT, record, state: "approved", cwd: "/repo" });
	assert.equal(approved.status_continuation, undefined);
	assert.equal(approved.action, JERO_APPROVED_CLOSURE_ACTION);
	assert.throws(() => decodeJeroLastEventClosureV1({ ...approved, status_continuation: { operation: "review.status", arguments: [{ name: "lineage", value: record.lineage_id, token: `--lineage=${record.lineage_id}` }], preconditions: [{ name: "state", value: "approved" }], binding: { lineage_id: record.lineage_id, revision: record.revision, target_identity: record.state.snapshot.identity } } }), /only valid/);
});

test("approved-only optional members: advisory findings, reviewer results, acknowledgement", () => {
	const record = closureRecord();
	const advisory = { statement: "non-blocking", findings: [{ id: "R3-001", lens: "reliability", location: "src/value.js:2", severity: "BLOCKER" as const, disposition: "refuted" as const }] };
	const approved = buildJeroLastEventClosureV1({
		operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_REFUTER,
		record,
		state: "approved",
		cwd: "/repo",
		advisoryFindings: advisory,
		reviewerResults: [{ lens: "review-readability", findings: [], evidence: ["e"], result_hash: `sha256:${"3".repeat(64)}` }],
	});
	assert.deepEqual(approved.advisory_findings, advisory);
	assert.equal(approved.reviewer_results!.length, 1);
	// Construction refuses them on non-approved states.
	assert.throws(() => buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT, record, state: "correction_required", cwd: "/repo", advisoryFindings: advisory }), /approved-only/);
	// Decode refuses them on escalated.
	assert.throws(() => decodeJeroLastEventClosureV1({ ...approved, state: "escalated", advisory_findings: advisory }), /approved/);
});

test("advisory findings assembly: refuted severe rows ride with disposition refuted; follow-ups map to follow_up", () => {
	const state = testTransactionState();
	state.outcomes = { "finding-1": "refuted", "finding-2": "info" };
	state.findings = [
		{ id: "finding-1", lens: "risk", location: "src/a.ts:3", severity: "BLOCKER", claim: "refuted blocker", proof_refs: ["p"] },
		{ id: "finding-2", lens: "risk", location: "src/a.ts:4", severity: "WARNING", claim: "informational", proof_refs: ["p"] },
	];
	state.follow_ups = [{ observation: "pre-existing behavior noted", proof_refs: ["proof-2"] }];
	const advisory = jeroAdvisoryFindingsFromStateV1(state)!;
	assert.ok(advisory !== undefined);
	const refuted = advisory.findings.find(({ id }) => id === "finding-1")!;
	assert.equal(refuted.severity, "BLOCKER");
	assert.equal(refuted.disposition, "refuted");
	assert.equal(advisory.findings.some(({ disposition }) => disposition === "follow_up"), true);
	assert.equal(advisory.findings.some(({ disposition }) => disposition === "informational"), true);
	// NIT (review): the follow-up advisory id is the stable derived domain
	// hash, not a prose-prefix truncation of the observation.
	const followUp = advisory.findings.find(({ disposition }) => disposition === "follow_up")!;
	assert.match(followUp.id, /^fup1_[0-9a-f]{64}$/);
	assert.equal(followUp.id, `fup1_${jeroDomainHash("follow-up", "pre-existing behavior noted")}`);
});

test("defensive acknowledgement decode: undecodable degrades to a flag, never a throw", () => {
	const record = closureRecord();
	const good = {
		schema: "jero.authority.review-acknowledged/v1",
		operation: "review/acknowledge-approved",
		action: "acknowledged",
		lineage_id: record.lineage_id,
		target_identity: record.state.snapshot.identity,
		consumed_revision: record.revision,
		authority: "burned",
	};
	assert.equal(decodeJeroClosureAcknowledgementV1(good).ok, true);
	assert.equal(decodeJeroClosureAcknowledgementV1({ ...good, authority: "alive" }).ok, false);
	const closure = buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_VALIDATION, record, state: "approved", cwd: "/repo", acknowledgement: { schema: "bogus" } });
	assert.equal(closure.acknowledgement_undecodable, undefined, "construction stores what it was given");
	const decoded = decodeJeroLastEventClosureV1(closure);
	assert.equal(decoded.acknowledgement_undecodable, true);
	assert.equal(decoded.acknowledgement, undefined);
	// An undecodable acknowledgement on a non-approved closure throws.
	assert.throws(() => decodeJeroLastEventClosureV1({ ...closure, state: "correction_required" }), /approved/);
});

test("closure operation naming: canonical-internal dot form maps to the fixture vocabulary (discrepancy #2)", () => {
	assert.equal(JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT, "review.capture-result");
	assert.equal(JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT], "review/capture-result");
	assert.equal(JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN], "review.capture-correction-plan");
	assert.equal(JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_REFUTER], "review.capture-refuter");
	assert.equal(JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_VALIDATION], "review/capture-validation");
});

test("binding assertion validates lineage, target, and request hash against the caller's STATUS binding", () => {
	const record = closureRecord();
	const closure = buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN, record, state: "correction_required", cwd: "/repo", requestHash: `sha256:${"4".repeat(64)}`, correctionLines: 1 });
	assert.doesNotThrow(() => assertJeroLastEventClosureBindingV1(closure, { lineageId: record.lineage_id, targetIdentity: record.state.snapshot.identity, requestHash: closure.request_hash }));
	assert.throws(() => assertJeroLastEventClosureBindingV1(closure, { lineageId: "review-ffffffffffffffff" }), /lineage/);
	assert.throws(() => assertJeroLastEventClosureBindingV1(closure, { lineageId: record.lineage_id, targetIdentity: `sha256:${"9".repeat(64)}` }), /target/);
	assert.throws(() => assertJeroLastEventClosureBindingV1(closure, { lineageId: record.lineage_id, requestHash: `sha256:${"8".repeat(64)}` }), /request hash/);
	// Continuation target must match the binding too.
	const withContinuation = buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT, record, state: "correction_required", cwd: "/repo" });
	assert.throws(() => assertJeroLastEventClosureBindingV1(withContinuation, { lineageId: record.lineage_id, targetIdentity: `sha256:${"9".repeat(64)}` }), /continuation target/);
});

test("decode is strict: unknown keys and malformed identities fail closed", () => {
	const record = closureRecord();
	const closure = buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_VALIDATION, record, state: "approved", cwd: "/repo" });
	assert.throws(() => decodeJeroLastEventClosureV1({ ...closure, extra: 1 }), /unknown key/);
	assert.throws(() => decodeJeroLastEventClosureV1({ ...closure, store_revision: "not-a-revision" }), /store_revision/);
	assert.throws(() => decodeJeroLastEventClosureV1({ ...closure, lineage_id: "bad" }), /lineage_id/);
	assert.throws(() => decodeJeroLastEventClosureV1({ ...closure, operation: "review.capture-nonsense" }), /operation/);
});
