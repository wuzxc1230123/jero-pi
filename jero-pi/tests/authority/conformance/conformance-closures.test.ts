import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeReviewLastEventClosureV1, type ReviewLastEventClosureV1 } from "../../../lib/authority/wire-contract.ts";
import {
	JERO_CAPTURE_CLOSURE_OPERATIONS,
	JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP,
	JERO_APPROVED_CLOSURE_ACTION,
	buildJeroLastEventClosureV1,
	jeroAdvisoryFindingsFromStateV1,
	assertJeroLastEventClosureBindingV1,
} from "../../../lib/authority/closures.ts";
import { JERO_LINEAGE_STATE_SCHEMA } from "../../../lib/authority/canonical.ts";
import { testTransactionState } from "../fixtures.ts";
import type { JeroLineageStateFileV1 } from "../../../lib/authority/lineage-store.ts";

// §J.1 assertions 1-6: the six last-event-closure fixtures are field-level
// isomorphic to jero closure construction and internally consistent. Upstream
// hash BYTES are never asserted — identities keep their fixture values; only
// structure, vocabularies, and cross-field consistency are locked.

const fixturesRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "fixtures", "devbinary");

function fixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixturesRoot, `${name}.captured.json`), "utf8")) as Record<string, unknown>;
}

function closureFixture(name: string): ReviewLastEventClosureV1 {
	return decodeReviewLastEventClosureV1(fixture(name));
}

function closureRecord(lineageId: string): JeroLineageStateFileV1 {
	const state = testTransactionState(lineageId);
	return { schema: JERO_LINEAGE_STATE_SCHEMA, lineage_id: lineageId, revision: `sha256:${"1".repeat(64)}`, state, request_journal: [] };
}

// 1. last-event-capture-result-approved
test("conformance 1: approved capture-result closure — slash op, action prose, no continuation", () => {
	const closure = closureFixture("last-event-capture-result-approved");
	assert.equal(closure.operation, "review/capture-result");
	assert.equal(closure.state, "approved");
	assert.equal(closure.action, "the approved review completed on the last admitted event and burned; delivery follows ordinary repository policy");
	assert.equal(closure.statusContinuation, undefined);
	assert.equal(closure.advisoryFindings, undefined);
	// jero isomorphism: the canonical dot form maps to the fixture op name and
	// the approved action prose is the identical contract.
	assert.equal(JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT], closure.operation);
	const jero = buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT, record: closureRecord(closure.lineageId), state: "approved", cwd: "/repo" });
	assert.equal(jero.action, JERO_APPROVED_CLOSURE_ACTION);
	assert.equal(jero.action, closure.action);
	assert.equal(jero.status_continuation, undefined);
});

// 2. last-event-capture-result-correction-required
test("conformance 2: correction-required capture-result closure — exact-token status continuation", () => {
	const closure = closureFixture("last-event-capture-result-correction-required");
	assert.equal(closure.state, "correction_required");
	const continuation = closure.statusContinuation!;
	assert.ok(continuation !== undefined, "correction-required result capture REQUIRES a continuation");
	assert.equal(continuation.operation, "review.status");
	assert.deepEqual(continuation.arguments.map(({ name }) => name), ["cwd", "contract", "next-transition", "lineage", "agent"]);
	for (const argument of continuation.arguments) {
		assert.equal(argument.token, `--${argument.name}=${argument.value}`, "exact --name=value tokens");
	}
	assert.equal(continuation.arguments[3]!.value, closure.lineageId);
	assert.deepEqual(continuation.preconditions, [{ name: "state", value: "correction_required" }]);
	assert.equal(continuation.binding.lineageId, closure.lineageId);
	assert.equal(continuation.binding.revision, closure.storeRevision);
	// jero isomorphism: our builder emits the same argument-name sequence,
	// token discipline, precondition, and binding cross-checks.
	const jero = buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT, record: closureRecord(closure.lineageId), state: "correction_required", cwd: "/repo" });
	const jeroContinuation = jero.status_continuation!;
	assert.deepEqual(jeroContinuation.arguments.map(({ name }) => name), continuation.arguments.map(({ name }) => name));
	assert.deepEqual(jeroContinuation.preconditions, continuation.preconditions.map(({ name, value }) => ({ name, value })));
	assert.equal(jeroContinuation.binding.lineage_id, jero.lineage_id);
	assert.equal(jeroContinuation.binding.revision, jero.store_revision);
});

// 3. last-event-capture-correction-plan
test("conformance 3: correction-plan closure — target/request/lines, no action or continuation", () => {
	const closure = closureFixture("last-event-capture-correction-plan");
	assert.equal(closure.operation, "review.capture-correction-plan");
	assert.equal(closure.state, "correction_required");
	assert.match(closure.targetIdentity!, /^sha256:[0-9a-f]{64}$/);
	assert.match(closure.requestHash!, /^sha256:[0-9a-f]{64}$/);
	assert.ok(closure.correctionLines! >= 1 && closure.correctionLines! <= 200);
	assert.equal(closure.action, undefined);
	assert.equal(closure.advisoryFindings, undefined);
	assert.equal(closure.statusContinuation, undefined);
	assert.equal(closure.reviewerResults, undefined);
	assert.equal(JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN], closure.operation);
	const jero = buildJeroLastEventClosureV1({ operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN, record: closureRecord(closure.lineageId), state: "correction_required", cwd: "/repo", requestHash: closure.requestHash, correctionLines: closure.correctionLines });
	assert.equal(jero.correction_lines, closure.correctionLines);
	assert.equal(jero.target_identity !== undefined, true);
});

// 4. last-event-capture-refuter-approved
test("conformance 4: approved refuter closure — advisory findings carry the refuted BLOCKER", () => {
	const closure = closureFixture("last-event-capture-refuter-approved");
	assert.equal(closure.operation, "review.capture-refuter");
	assert.equal(closure.state, "approved");
	const advisory = closure.advisoryFindings!;
	assert.ok(advisory !== undefined);
	assert.match(advisory.statement, /non-blocking/i);
	assert.match(advisory.statement, /none reopens this review/i);
	const refuted = advisory.findings.find(({ disposition }) => disposition === "refuted")!;
	assert.equal(refuted.severity, "BLOCKER");
	assert.equal(refuted.id, "R3-001");
	// jero isomorphism: our assembly maps a refuted severe outcome to the
	// same disposition vocabulary from the resolved record.
	const state = testTransactionState();
	state.findings = [{ id: "R3-001", lens: "reliability", location: "src/value.js:2", severity: "BLOCKER", claim: "claim", proof_refs: ["p"] }];
	state.outcomes = { "R3-001": "refuted" };
	const jeroAdvisory = jeroAdvisoryFindingsFromStateV1(state)!;
	assert.equal(jeroAdvisory.findings[0]!.disposition, "refuted");
	assert.equal(jeroAdvisory.findings[0]!.severity, "BLOCKER");
});

// 5. last-event-capture-refuter-correction-required
test("conformance 5: correction-required refuter closure — the same continuation discipline as (2)", () => {
	const closure = closureFixture("last-event-capture-refuter-correction-required");
	assert.equal(closure.state, "correction_required");
	const continuation = closure.statusContinuation!;
	assert.ok(continuation !== undefined);
	assert.deepEqual(continuation.arguments.map(({ name }) => name), ["cwd", "contract", "next-transition", "lineage", "agent"]);
	assert.deepEqual(continuation.preconditions, [{ name: "state", value: "correction_required" }]);
	assert.equal(continuation.binding.lineageId, closure.lineageId);
	assert.equal(continuation.binding.revision, closure.storeRevision);
});

// 6. last-event-capture-validation-approved
test("conformance 6: approved capture-validation closure — slash form op", () => {
	const closure = closureFixture("last-event-capture-validation-approved");
	assert.equal(closure.operation, "review/capture-validation");
	assert.equal(closure.state, "approved");
	assert.equal(closure.action, JERO_APPROVED_CLOSURE_ACTION);
	assert.equal(closure.statusContinuation, undefined);
	assert.equal(JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_VALIDATION], closure.operation);
});

// Cross-cutting: the binding assertion accepts each closure against its own
// fixture facts (the caller-held STATUS binding discipline).
test("conformance 1-6: closures bind against their own lineage facts", () => {
	for (const name of [
		"last-event-capture-result-approved",
		"last-event-capture-result-correction-required",
		"last-event-capture-correction-plan",
		"last-event-capture-refuter-approved",
		"last-event-capture-refuter-correction-required",
		"last-event-capture-validation-approved",
	]) {
		const closure = closureFixture(name);
		assert.doesNotThrow(() => assertJeroLastEventClosureBindingV1(
			{
				schema: "jero.authority.last-event-closure/v1",
				operation: JERO_CAPTURE_CLOSURE_OPERATIONS[Object.entries(JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP).find(([, upstream]) => upstream === closure.operation)![0] as keyof typeof JERO_CAPTURE_CLOSURE_OPERATIONS],
				lineage_id: closure.lineageId,
				state: closure.state,
				store_revision: closure.storeRevision,
				...(closure.targetIdentity === undefined ? {} : { target_identity: closure.targetIdentity }),
				...(closure.requestHash === undefined ? {} : { request_hash: closure.requestHash }),
			},
			{ lineageId: closure.lineageId, ...(closure.targetIdentity === undefined ? {} : { targetIdentity: closure.targetIdentity }), ...(closure.requestHash === undefined ? {} : { requestHash: closure.requestHash }) },
		), name);
	}
});
