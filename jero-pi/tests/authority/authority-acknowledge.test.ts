import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { reviewAcknowledgeV1 } from "../../lib/authority/acknowledge.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { jeroReceiptPathV1 } from "../../lib/authority/receipts.ts";
import { reviewHarness } from "./fixtures.ts";

// Spec §F: ACKNOWLEDGE — the approved-authority burn, journaled exactly-once
// with consumed_revision binding, replay idempotency, and non-approved refusal.

interface ApprovedFixture {
	harness: ReturnType<typeof reviewHarness>;
	lineageId: string;
	targetIdentity: string;
	revision: string;
}

function driveToApproved(t: { after: (callback: () => void) => void }): ApprovedFixture {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["clean"] }] },
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, classifications: [] });
	const approved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		final_evidence: "final verification output", final_verification_passed: true,
	});
	if (approved.kind !== "terminal") throw new Error(JSON.stringify(approved));
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	if (status.kind !== "status" || status.authority === undefined) throw new Error("status failed");
	return { harness, lineageId: start.lineage_id, targetIdentity: start.target_identity, revision: status.authority.revision };
}

test("burn: acknowledge consumes the approved authority with the caller's binding", (t) => {
	const { harness, lineageId, targetIdentity, revision } = driveToApproved(t);
	const acknowledged = reviewAcknowledgeV1(harness.context, {
		cwd: harness.repo, lineageId, targetIdentity, expectedRevision: revision, token: "burn-token",
		idempotencyKey: "burn-1",
	});
	assert.equal(acknowledged.kind, "acknowledged");
	if (acknowledged.kind !== "acknowledged") return;
	assert.equal(acknowledged.replayed, false);
	assert.equal(acknowledged.result.schema, "jero.authority.review-acknowledged/v1");
	assert.equal(acknowledged.result.operation, "review/acknowledge-approved");
	assert.equal(acknowledged.result.action, "acknowledged");
	assert.equal(acknowledged.result.lineage_id, lineageId);
	assert.equal(acknowledged.result.target_identity, targetIdentity);
	// consumed_revision must equal the revision the caller held (§F).
	assert.equal(acknowledged.result.consumed_revision, revision);
	assert.equal(acknowledged.result.authority, "burned");
	// The journal records the burn exactly once under the acknowledge operation.
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	if (status.kind !== "status") throw new Error("status failed");
	assert.equal(status.applicability, "unrelated");
	// The receipt survives the burn (rollback MUST preserve every receipt).
	assert.equal(existsSync(jeroReceiptPathV1(harness.context.store.store_root, lineageId)), true);
	// An explicit status of the burned lineage still resolves with consumed set.
	const explicit = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId });
	if (explicit.kind !== "status") throw new Error("explicit status failed");
	assert.equal(explicit.authority?.consumed, true);
	assert.equal(explicit.action, "stop");
});

test("replay: an exact (key, request) replay returns the stored envelope; drift fails closed", (t) => {
	const { harness, lineageId, targetIdentity, revision } = driveToApproved(t);
	const input = { cwd: harness.repo, lineageId, targetIdentity, expectedRevision: revision, token: "burn-token", idempotencyKey: "burn-replay" };
	const first = reviewAcknowledgeV1(harness.context, input);
	assert.equal(first.kind, "acknowledged");
	const replay = reviewAcknowledgeV1(harness.context, input);
	assert.equal(replay.kind, "acknowledged");
	if (replay.kind === "acknowledged" && first.kind === "acknowledged") {
		assert.equal(replay.replayed, true);
		assert.deepEqual(replay.result, first.result);
	}
	// A drifted token under the same key fails closed as a binding mismatch.
	const drifted = reviewAcknowledgeV1(harness.context, { ...input, token: "different-token" });
	assert.equal(drifted.kind, "refused");
	if (drifted.kind === "refused") assert.equal(drifted.code, "binding-mismatch");
	// A fresh key on the burned authority refuses as already consumed.
	const consumed = reviewAcknowledgeV1(harness.context, { ...input, token: "burn-token", idempotencyKey: "burn-second" });
	assert.equal(consumed.kind, "refused");
	if (consumed.kind === "refused") assert.equal(consumed.code, "already-consumed");
});

test("acknowledge on a non-approved lineage fails closed", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const refused = reviewAcknowledgeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, targetIdentity: start.target_identity,
		expectedRevision: start.revision, token: "token",
	});
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.code, "acknowledge-requires-approved");
	// An escalated lineage refuses the same way.
	const harness2 = reviewHarness(t, "medium", 4);
	const start2 = reviewStartV1(harness2.context, { cwd: harness2.repo }, { consent: "granted" });
	if (start2.kind !== "created") throw new Error("start failed");
	reviewFinalizeV1(harness2.context, {
		cwd: harness2.repo, lineageId: start2.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [{ id: "s", severity: "BLOCKER" }], evidence: ["hunk"] }] },
	});
	reviewFinalizeV1(harness2.context, {
		cwd: harness2.repo, lineageId: start2.lineage_id,
		classifications: [{ finding_id: "s", class: "deterministic", proof: "p", causal_disposition: "unknown" }],
	});
	const escalated = reviewAcknowledgeV1(harness2.context, {
		cwd: harness2.repo, lineageId: start2.lineage_id, targetIdentity: start2.target_identity,
		expectedRevision: start2.revision, token: "token",
	});
	assert.equal(escalated.kind, "refused");
	if (escalated.kind === "refused") assert.equal(escalated.code, "acknowledge-requires-approved");
});

test("drifted bindings fail closed: wrong target identity and wrong revision", (t) => {
	const { harness, lineageId, targetIdentity, revision } = driveToApproved(t);
	const wrongTarget = reviewAcknowledgeV1(harness.context, {
		cwd: harness.repo, lineageId, targetIdentity: `sha256:${"9".repeat(64)}`, expectedRevision: revision, token: "t",
	});
	assert.equal(wrongTarget.kind, "refused");
	if (wrongTarget.kind === "refused") assert.equal(wrongTarget.code, "binding-mismatch");
	const wrongRevision = reviewAcknowledgeV1(harness.context, {
		cwd: harness.repo, lineageId, targetIdentity, expectedRevision: `sha256:${"8".repeat(64)}`, token: "t",
	});
	assert.equal(wrongRevision.kind, "refused");
	if (wrongRevision.kind === "refused") assert.equal(wrongRevision.code, "binding-mismatch");
});

test("malformed acknowledge inputs fail closed as invalid-request", (t) => {
	const { harness, lineageId, targetIdentity, revision } = driveToApproved(t);
	const cases = [
		{ cwd: harness.repo, lineageId: "", targetIdentity, expectedRevision: revision, token: "t" },
		{ cwd: harness.repo, lineageId, targetIdentity: "not-an-identity", expectedRevision: revision, token: "t" },
		{ cwd: harness.repo, lineageId, targetIdentity, expectedRevision: "zz", token: "t" },
		{ cwd: harness.repo, lineageId, targetIdentity, expectedRevision: revision, token: "  " },
	];
	for (const input of cases) {
		const refused = reviewAcknowledgeV1(harness.context, input);
		assert.equal(refused.kind, "refused");
		if (refused.kind === "refused") assert.equal(refused.code, "invalid-request");
	}
	// A missing lineage is its own refusal.
	const missing = reviewAcknowledgeV1(harness.context, {
		cwd: harness.repo, lineageId: "review-0123456789abcdef", targetIdentity, expectedRevision: revision, token: "t",
	});
	assert.equal(missing.kind, "refused");
	if (missing.kind === "refused") assert.equal(missing.code, "lineage-missing");
});
