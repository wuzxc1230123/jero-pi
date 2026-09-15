import assert from "node:assert/strict";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { JeroLineageStoreError, JeroLineageStoreV1, type JeroLineageStateFileV1 } from "../../lib/authority/lineage-store.ts";
import { initialDraft, LINEAGE_ID, tempRoot, testTransactionState } from "./fixtures.ts";
import type { JeroReviewStateName } from "../../lib/authority/protocol.ts";

function freshStore(): { storeRoot: string; store: JeroLineageStoreV1 } {
	const storeRoot = tempRoot("jero-authority-lineage-");
	return { storeRoot, store: JeroLineageStoreV1.forStore(storeRoot) };
}

function statePath(storeRoot: string, lineageId = LINEAGE_ID): string {
	return join(storeRoot, "lineages", lineageId, "review-state.json");
}

function advance(draft: ReturnType<typeof initialDraft>): ReturnType<typeof initialDraft> {
	return {
		state: { ...draft.state, state: "findings_frozen", generation: draft.state.generation + 1 },
		request_journal: [...draft.request_journal],
	};
}

test("lineage state save/load round-trips under the lineage directory", () => {
	const { storeRoot, store } = freshStore();
	try {
		const draft = initialDraft();
		const saved = store.save(LINEAGE_ID, draft, { expectedRevision: null });
		assert.match(saved.revision, /^sha256:[0-9a-f]{64}$/);
		const loaded = store.load(LINEAGE_ID);
		assert.equal(loaded.kind, "ok");
		if (loaded.kind !== "ok") return;
		assert.equal(loaded.record.revision, saved.revision);
		assert.equal(loaded.record.lineage_id, LINEAGE_ID);
		assert.deepEqual(loaded.record.state, draft.state);
		assert.deepEqual(loaded.record.request_journal, draft.request_journal);
		// Atomic write leaves exactly the state file behind, no temp files.
		assert.deepEqual(readdirSync(join(storeRoot, "lineages", LINEAGE_ID)), ["review-state.json"]);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("every save advances the revision and stale expected revisions fail closed", () => {
	const { storeRoot, store } = freshStore();
	try {
		const draft = initialDraft();
		const first = store.save(LINEAGE_ID, draft, { expectedRevision: null });
		const second = store.save(LINEAGE_ID, advance(draft), { expectedRevision: first.revision });
		assert.notEqual(second.revision, first.revision);
		assert.throws(
			() => store.save(LINEAGE_ID, advance(draft), { expectedRevision: first.revision }),
			(error) => error instanceof JeroLineageStoreError && /Stale lineage revision/.test(error.message),
		);
		assert.throws(
			() => store.save(LINEAGE_ID, advance(draft), { expectedRevision: null }),
			(error) => error instanceof JeroLineageStoreError && /Stale lineage revision/.test(error.message),
		);
		const fresh = freshStore();
		try {
			assert.throws(
				() => fresh.store.save(LINEAGE_ID, initialDraft(), { expectedRevision: second.revision }),
				(error) => error instanceof JeroLineageStoreError && /lineage does not exist/i.test(error.message),
			);
		} finally {
			rmSync(fresh.storeRoot, { recursive: true, force: true });
		}
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("corrupted lineage state files are reported and refuse mutation", () => {
	const { storeRoot, store } = freshStore();
	try {
		store.save(LINEAGE_ID, initialDraft(), { expectedRevision: null });
		writeFileSync(statePath(storeRoot), "{not json");
		let loaded = store.load(LINEAGE_ID);
		assert.equal(loaded.kind, "corrupted");
		assert.throws(() => store.runOperation({
			lineageId: LINEAGE_ID,
			operation: "verify",
			idempotencyKey: "k",
			requestHash: "a".repeat(64),
			apply: (record) => ({ draft: { state: record.state, request_journal: record.request_journal }, result: 1 }),
		}), (error) => error instanceof JeroLineageStoreError && /corrupted/i.test(error.message));
		// Tampered content: valid JSON, but the revision no longer matches the content hash.
		writeFileSync(statePath(storeRoot), '{"schema":"jero.authority.lineage-state/v1"}');
		loaded = store.load(LINEAGE_ID);
		assert.equal(loaded.kind, "corrupted");
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("exact (idempotency_key, request_hash) replay returns the stored result", () => {
	const { storeRoot, store } = freshStore();
	try {
		const created = store.save(LINEAGE_ID, initialDraft(), { expectedRevision: null });
		const options = {
			lineageId: LINEAGE_ID,
			operation: "freeze-ledger" as const,
			idempotencyKey: "freeze-1",
			requestHash: "c".repeat(64),
			apply: (record: JeroLineageStateFileV1) => ({
				draft: { state: { ...record.state, state: "findings_frozen" as JeroReviewStateName }, request_journal: record.request_journal },
				result: { lineage_id: LINEAGE_ID, frozen: true },
			}),
		};
		const first = store.runOperation(options);
		assert.deepEqual(first.result, { lineage_id: LINEAGE_ID, frozen: true });
		const replay = store.runOperation(options);
		assert.deepEqual(replay, first);
		const loaded = store.load(LINEAGE_ID);
		if (loaded.kind !== "ok") throw new Error("expected ok load");
		assert.equal(loaded.record.revision, first.revision);
		assert.equal(loaded.record.request_journal.length, 2);
		assert.equal(loaded.record.request_journal[1]!.status, "completed");
		assert.notEqual(loaded.record.revision, created.revision);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("idempotency key reuse with a divergent request hash fails closed", () => {
	const { storeRoot, store } = freshStore();
	try {
		store.save(LINEAGE_ID, initialDraft(), { expectedRevision: null });
		const base = {
			lineageId: LINEAGE_ID,
			operation: "freeze-ledger" as const,
			idempotencyKey: "freeze-1",
			apply: (record: JeroLineageStateFileV1) => ({
				draft: { state: record.state, request_journal: record.request_journal },
				result: 1,
			}),
		};
		store.runOperation({ ...base, requestHash: "c".repeat(64) });
		assert.throws(
			() => store.runOperation({ ...base, requestHash: "d".repeat(64) }),
			(error) => error instanceof JeroLineageStoreError && /reused with a different request/.test(error.message),
		);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("a pending journal entry blocks new mutating operations until completed", () => {
	const { storeRoot, store } = freshStore();
	try {
		store.save(LINEAGE_ID, initialDraft(), { expectedRevision: null });
		store.prepareOperation({ lineageId: LINEAGE_ID, operation: "resolve-evidence", idempotencyKey: "evidence-1", requestHash: "e".repeat(64), authorization: { actor: "review-risk" } });
		const pending = store.load(LINEAGE_ID);
		if (pending.kind !== "ok") throw new Error("expected ok load");
		assert.equal(pending.record.request_journal[1]!.status, "pending");
		assert.throws(
			() => store.runOperation({
				lineageId: LINEAGE_ID,
				operation: "verify",
				idempotencyKey: "verify-1",
				requestHash: "f".repeat(64),
				apply: (record) => ({ draft: { state: record.state, request_journal: record.request_journal }, result: 1 }),
			}),
			(error) => error instanceof JeroLineageStoreError && /Unresolved pending operation blocks mutation/.test(error.message),
		);
		assert.throws(
			() => store.runOperation({
				lineageId: LINEAGE_ID,
				operation: "resolve-evidence",
				idempotencyKey: "evidence-1",
				requestHash: "e".repeat(64),
				apply: (record) => ({ draft: { state: record.state, request_journal: record.request_journal }, result: 1 }),
			}),
			(error) => error instanceof JeroLineageStoreError && /Unresolved pending operation blocks replay/.test(error.message),
		);
		const completed = store.completeOperation({
			lineageId: LINEAGE_ID,
			operation: "resolve-evidence",
			idempotencyKey: "evidence-1",
			requestHash: "e".repeat(64),
			apply: (record) => ({
				draft: { state: { ...record.state, state: "evidence_classified" as JeroReviewStateName }, request_journal: record.request_journal },
				result: { classified: 1 },
			}),
		});
		assert.deepEqual(completed.result, { classified: 1 });
		const after = store.load(LINEAGE_ID);
		if (after.kind !== "ok") throw new Error("expected ok load");
		assert.equal(after.record.request_journal[1]!.status, "completed");
		// Exact completion replay is stable and does not advance the revision.
		const replayed = store.completeOperation({
			lineageId: LINEAGE_ID,
			operation: "resolve-evidence",
			idempotencyKey: "evidence-1",
			requestHash: "e".repeat(64),
			apply: () => { throw new Error("must not re-apply"); },
		});
		assert.deepEqual(replayed, completed);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("lineage ids outside the review-<16hex> format are rejected", () => {
	const { storeRoot, store } = freshStore();
	try {
		assert.throws(() => store.load("not-a-lineage"), JeroLineageStoreError);
		assert.throws(() => store.save("review-short", initialDraft("review-short"), { expectedRevision: null }), JeroLineageStoreError);
		assert.throws(() => store.load("review-../escape"), JeroLineageStoreError);
		assert.deepEqual(store.list(), []);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("apply() that drops journal entries fails closed instead of silently losing audit history", () => {
	const { storeRoot, store } = freshStore();
	try {
		store.save(LINEAGE_ID, initialDraft(), { expectedRevision: null });
		assert.throws(
			() => store.runOperation({
				lineageId: LINEAGE_ID,
				operation: "freeze-ledger",
				idempotencyKey: "freeze-drop",
				requestHash: "c".repeat(64),
				apply: (record: JeroLineageStateFileV1) => ({
					draft: { state: record.state, request_journal: [] },
					result: { dropped: true },
				}),
			}),
			(error) => error instanceof JeroLineageStoreError && /must preserve journal length/.test(error.message),
		);
		const loaded = store.load(LINEAGE_ID);
		if (loaded.kind !== "ok") throw new Error("expected ok load");
		assert.equal(loaded.record.request_journal.length, 1, "the dropped journal write must not persist");
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("apply() that mutates a foreign journal entry during completion fails closed", () => {
	const { storeRoot, store } = freshStore();
	try {
		store.save(LINEAGE_ID, initialDraft(), { expectedRevision: null });
		store.prepareOperation({ lineageId: LINEAGE_ID, operation: "resolve-evidence", idempotencyKey: "evidence-1", requestHash: "e".repeat(64) });
		assert.throws(
			() => store.completeOperation({
				lineageId: LINEAGE_ID,
				operation: "resolve-evidence",
				idempotencyKey: "evidence-1",
				requestHash: "e".repeat(64),
				apply: (record: JeroLineageStateFileV1) => ({
					draft: {
						state: record.state,
						request_journal: record.request_journal.map((entry, index) => index === 0 ? { ...entry, request_hash: "0".repeat(64) } : entry),
					},
					result: { resolved: true },
				}),
			}),
			(error) => error instanceof JeroLineageStoreError && /mutated journal entry 0/.test(error.message),
		);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("completing an operation that was never prepared fails closed", () => {
	const { storeRoot, store } = freshStore();
	try {
		store.save(LINEAGE_ID, initialDraft(), { expectedRevision: null });
		assert.throws(
			() => store.completeOperation({
				lineageId: LINEAGE_ID,
				operation: "resolve-evidence",
				idempotencyKey: "evidence-unknown",
				requestHash: "e".repeat(64),
				apply: (record: JeroLineageStateFileV1) => ({ draft: { state: record.state, request_journal: record.request_journal }, result: {} }),
			}),
			(error) => error instanceof JeroLineageStoreError && /was not found/.test(error.message),
		);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});
