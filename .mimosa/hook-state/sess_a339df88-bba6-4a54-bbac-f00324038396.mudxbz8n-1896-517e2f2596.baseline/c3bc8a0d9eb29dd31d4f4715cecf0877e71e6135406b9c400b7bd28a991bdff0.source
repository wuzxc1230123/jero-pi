import assert from "node:assert/strict";
import test from "node:test";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import {
	jeroRepositoryContextHandleV1,
	jeroRepositoryContextEventIdV1,
	mintJeroRepositoryContextV1,
	decodeJeroRepositoryContextV1,
	JERO_REPOSITORY_CONTEXT_OUTCOMES,
} from "../../lib/authority/repository-context.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { jeroLineageDirectory } from "../../lib/authority/store-root.ts";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { admitFixtureReviewerResults, reviewHarness } from "./fixtures.ts";

// Spec §C/§J.2: rctx1_ minting, event_id⇔outcome pairing, and the four
// outcome derivations (applied / pending / blocked_conflict /
// durability_limited).

function loadedRecord(harness: { context: import("../../lib/authority/review.ts").JeroAuthorityContextV1 }, lineageId: string) {
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(lineageId);
	if (loaded.kind !== "ok") throw new Error("load failed");
	return loaded.record;
}

test("handle derivation is 1:1 with (target_identity, revision) and stable", () => {
	const identity = `sha256:${"a".repeat(64)}`;
	const revision = `sha256:${"b".repeat(64)}`;
	const handle = jeroRepositoryContextHandleV1(identity, revision);
	assert.match(handle, /^rctx1_[0-9a-f]{64}$/);
	assert.equal(jeroRepositoryContextHandleV1(identity, revision), handle);
	assert.notEqual(jeroRepositoryContextHandleV1(identity, `sha256:${"c".repeat(64)}`), handle);
	assert.notEqual(jeroRepositoryContextHandleV1(`sha256:${"d".repeat(64)}`, revision), handle);
	assert.throws(() => jeroRepositoryContextHandleV1("not-an-identity", revision), /canonical sha256 identity/);
});

test("event ids bind (lineage, revision, operation)", () => {
	const event = jeroRepositoryContextEventIdV1("review-0123456789abcdef", `sha256:${"b".repeat(64)}`, "start");
	assert.match(event, /^sha256:[0-9a-f]{64}$/);
	assert.notEqual(jeroRepositoryContextEventIdV1("review-0123456789abcdef", `sha256:${"b".repeat(64)}`, "status"), event);
	assert.notEqual(jeroRepositoryContextEventIdV1("review-ffffffffffffffff", `sha256:${"b".repeat(64)}`, "start"), event);
});

test("applied: a completed journal entry for the operation pairs event_id and outcome", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const record = loadedRecord(harness, start.lineage_id);
	const context = mintJeroRepositoryContextV1(harness.context, record, "start");
	assert.equal(context.outcome, "applied");
	assert.match(context.event_id!, /^sha256:[0-9a-f]{64}$/);
	// The handle is echoed 1:1 with the record's (identity, revision).
	assert.equal(context.handle, jeroRepositoryContextHandleV1(record.state.snapshot.identity, record.revision));
	assert.equal(context.revision, record.revision);
	assert.equal(context.target_identity, record.state.snapshot.identity);
	// An operation with no completed entry derives pending.
	const capture = mintJeroRepositoryContextV1(harness.context, record, "capture" as "freeze-ledger");
	assert.equal(capture.outcome, "pending");
});

test("pending: a pending journal entry is the crash window", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const store = JeroLineageStoreV1.forStore(harness.context.store.store_root);
	const loaded = store.load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	// Simulate the crash window: a prepared-but-not-completed entry.
	store.save(start.lineage_id, {
		state: loaded.record.state,
		request_journal: [...loaded.record.request_journal, { operation: "freeze-ledger", idempotency_key: "crash-window", request_hash: "f".repeat(64), status: "pending" }],
	}, { expectedRevision: loaded.record.revision });
	const record = loadedRecord(harness, start.lineage_id);
	const context = mintJeroRepositoryContextV1(harness.context, record, "start");
	assert.equal(context.outcome, "pending");
});

test("durability_limited: terminal without a receipt file", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const durabilityResult = { lens_results: [{ lens: "review-readability" as const, findings: [], evidence: ["clean"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, durabilityResult);
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: durabilityResult,
	});
	assert.equal(frozen.kind, "frozen");
	const resolved = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, classifications: [] });
	assert.equal(resolved.kind, "evidence_resolved");
	const approved = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, final_evidence: "evidence", final_verification_passed: true });
	assert.equal(approved.kind, "terminal");
	// Remove the receipt: the terminal lineage is durability-limited.
	const receiptPath = join(jeroLineageDirectory(harness.context.store.store_root, start.lineage_id), "review-receipt.json");
	rmSync(receiptPath, { force: true });
	const record = loadedRecord(harness, start.lineage_id);
	const context = mintJeroRepositoryContextV1(harness.context, record, "verify");
	assert.equal(context.outcome, "durability_limited");
});

test("blocked_conflict: an owned or ambiguous authority lock", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const owner = harness.context.locks.acquire();
	try {
		const record = loadedRecord(harness, start.lineage_id);
		const context = mintJeroRepositoryContextV1(harness.context, record, "start");
		assert.equal(context.outcome, "blocked_conflict");
	} finally {
		harness.context.locks.release(owner);
	}
});

test("decode is strict: unknown keys and unpaired event/outcome fail closed", () => {
	const valid = {
		capability: "review.opaque_repository_context",
		handle: `rctx1_${"a".repeat(64)}`,
		revision: `sha256:${"b".repeat(64)}`,
		target_identity: `sha256:${"c".repeat(64)}`,
		event_id: `sha256:${"d".repeat(64)}`,
		outcome: "applied",
	};
	assert.equal(decodeJeroRepositoryContextV1(valid).outcome, "applied");
	assert.throws(() => decodeJeroRepositoryContextV1({ ...valid, extra: true }), /unknown key "extra"/);
	assert.throws(() => decodeJeroRepositoryContextV1({ ...valid, outcome: undefined }), /paired/);
	assert.throws(() => decodeJeroRepositoryContextV1({ ...valid, event_id: undefined }), /paired/);
	assert.throws(() => decodeJeroRepositoryContextV1({ ...valid, outcome: "refused" }), /unsupported/);
	assert.throws(() => decodeJeroRepositoryContextV1({ ...valid, handle: "rctx3_" + "a".repeat(64) }), /handle/);
	assert.deepEqual([...JERO_REPOSITORY_CONTEXT_OUTCOMES], ["applied", "pending", "blocked_conflict", "durability_limited"]);
});
