import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeReviewStatusV3, decodeReviewAcknowledgedV1, type ReviewAcknowledgedExpectationV1 } from "../../../lib/review-integration-v2.ts";

// §J.1 coverage completion (M6): the five devbinary fixtures the M3 suite had
// not yet consumed — declined START (item 2), zero-lens close (item 3), plain
// unrelated STATUS (item 5), failure/v2 (item 8), acknowledgement burn
// (item 11). Field-level decode + internal consistency only; upstream hash
// bytes are never asserted (design §5.1.7).

const fixturesRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "fixtures", "devbinary");

function fixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixturesRoot, `${name}.captured.json`), "utf8")) as Record<string, unknown>;
}

// 2. start-v3-consent-declined
test("conformance 2: a declined START creates zero authority", () => {
	const declined = fixture("start-v3-consent-declined");
	// The wire record exists (operation fields), but every authority-bearing
	// field is the zero value: no lenses, no budget, empty lens bindings.
	assert.equal(declined.action, "declined");
	assert.equal(declined.state, "");
	assert.deepEqual(declined.selected_lenses, []);
	assert.equal(declined.correction_budget, 0);
	assert.deepEqual(declined.lens_bindings, []);
	// Isomorphism: jero's declined path likewise persists nothing — the
	// declined variant of START returns before any lineage write (asserted by
	// the M2 start suite); this fixture pins the wire shape that path mirrors.
});

// 3. start-v3-zero-lens-closed
test("conformance 3: a low zero-lens START closes at START", () => {
	const closed = fixture("start-v3-zero-lens-closed");
	assert.equal(closed.schema, "gentle-ai.review-integration.start/v3");
	assert.equal(closed.action, "closed");
	assert.equal(closed.state, "approved");
	assert.deepEqual(closed.selected_lenses, []);
	assert.deepEqual(closed.artifact_subjects, []);
	// The trivial-scope budget is 1, not 0 — the close still records the
	// frozen accounting line it would have spent.
	assert.equal(closed.correction_budget, 1);
	assert.ok(Array.isArray(closed.risk_reasons));
});

// 5. status-v5 (plain unrelated)
test("conformance 5: the plain unrelated STATUS asks for an empty-candidate base ref and reports the repair block", () => {
	const status = decodeReviewStatusV3(fixture("status-v5"));
	assert.equal(status.applicability, "unrelated");
	assert.equal(status.action, "start");
	assert.equal(status.receipt.status, "not_applicable");
	// The empty candidate cannot form a review target: the collect input asks
	// for a base ref, not reviewer results.
	assert.equal(status.nextTransition.kind, "collect");
	if (status.nextTransition.kind !== "collect") return;
	assert.equal(status.nextTransition.reasonCode, "empty_candidate_base_ref_required");
	assert.ok(status.nextTransition.collect.inputs.length >= 1);
	assert.equal(status.nextTransition.collect.inputs[0]!.name, "base_ref");
	// The repair assessment block rides every v5 status (M2's STATUS reports
	// it under action repair_authority only for corrupted records; here it is
	// the inventory shape itself).
	const raw = fixture("status-v5").repair as Record<string, unknown>;
	assert.equal(raw.schema, "gentle-ai.review-authority-repair-assessment/v1");
	assert.ok(typeof raw.status === "string");
	// counts are inventory numbers, not arrays.
	assert.equal(typeof (raw.counts as Record<string, unknown>).lineages, "number");
	assert.ok(Array.isArray(raw.supported_operations));
	assert.ok(typeof raw.authorization_schema === "string");
});

// 8. failure-v2-capture-evidence
test("conformance 8: the failure/v2 envelope keeps its exact taxonomy", () => {
	// The capture-evidence operation rides outside the v2 decoder's closed
	// operation enum (the M1 analysis's noted family), so the taxonomy is
	// asserted at the field level — which IS the spec this fixture pins.
	const raw = fixture("failure-v2-capture-evidence");
	assert.equal(raw.schema, "gentle-ai.review-integration.failure/v2");
	assert.equal(raw.phase, "preflight");
	assert.equal(raw.code, "verification_evidence_binding_mismatch");
	assert.equal(raw.mutation_outcome, "not_started");
	assert.equal(raw.retry_safe, true);
	// The one actionable next step after an unknown or lost mutating result.
	assert.equal(raw.next_action, "review.status");
	assert.deepEqual(raw.required_inputs, []);
});

// 11. review-acknowledged-v1
test("conformance 11b: the acknowledgement burns the authority against the consumed revision", () => {
	const raw = fixture("review-acknowledged-v1");
	const expected: ReviewAcknowledgedExpectationV1 = {
		lineageId: raw.lineage_id as string,
		targetIdentity: raw.target_identity as string,
	};
	const acknowledged = decodeReviewAcknowledgedV1(raw, expected);
	assert.equal(acknowledged.schema, "gentle-ai.review-acknowledged/v1");
	assert.equal(acknowledged.action, "acknowledged");
	assert.equal(acknowledged.authority, "burned");
	// consumed_revision is the binding: the caller held exactly this revision
	// when the burn happened (jero's acknowledge output mirrors this as the
	// burn envelope's consumed_revision — M2 suite).
	assert.match(acknowledged.consumedRevision ?? "", /^sha256:[0-9a-f]{64}$/);
});

// capabilities-v2.1.derived: the derived vocabulary anchor (supplement to 12).
test("conformance 12b: the derived capabilities fixture anchors the same operation vocabulary", () => {
	const raw = JSON.parse(readFileSync(join(fixturesRoot, "capabilities-v2.1.derived.json"), "utf8")) as Record<string, unknown>;
	// The derived (non-captured) capabilities record still pins the closed
	// operation/gate/projection vocabularies the authority may reference.
	const operations = raw.operations as unknown[];
	const gates = raw.gates as unknown[];
	assert.ok(Array.isArray(operations) && operations.length > 0);
	assert.ok(Array.isArray(gates) && gates.length > 0);
	for (const forbidden of ["telemetry", "dev-binary"]) {
		assert.equal(operations.some((operation) => String(operation).includes(forbidden)), false, `operation vocabulary must not carry ${forbidden}`);
	}
});
