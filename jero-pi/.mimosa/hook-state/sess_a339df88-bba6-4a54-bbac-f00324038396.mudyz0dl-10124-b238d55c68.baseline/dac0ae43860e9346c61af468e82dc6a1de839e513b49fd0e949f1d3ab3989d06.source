import assert from "node:assert/strict";
import test from "node:test";
import { JERO_RECEIPT_BODY_SCHEMA, jeroDomainHash } from "../../lib/authority/canonical.ts";
import {
	assertJeroReceiptIntegrityV1,
	createJeroReceiptEnvelopeV1,
	jeroReceiptHashV1,
	JeroReceiptError,
} from "../../lib/authority/receipts.ts";
import {
	decodeJeroRequestJournalEntryV1,
	decodeJeroReviewTransactionStateV1,
	decodeJeroVerifyResultV1,
	JeroAuthorityProtocolError,
	type JeroReceiptBodyV1,
	type JeroVerifyResultV1,
} from "../../lib/authority/protocol.ts";
import { testTransactionState } from "./fixtures.ts";

function mutated<T extends object>(value: T, mutate: (draft: T) => void): T {
	const draft = structuredClone(value);
	mutate(draft);
	return draft;
}

function asRecord<T extends object>(value: T): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

function protocolFailure(pattern: RegExp): (error: unknown) => boolean {
	return (error) => error instanceof JeroAuthorityProtocolError && pattern.test(error.message);
}

function receiptFailure(pattern: RegExp): (error: unknown) => boolean {
	return (error) => error instanceof JeroReceiptError && pattern.test(error.message);
}

test("the full valid lineage state record decodes to an equal record", () => {
	const state = testTransactionState();
	assert.deepEqual(decodeJeroReviewTransactionStateV1(state), state);
});

test("strict decode rejects an unknown key by naming it", () => {
	const state = mutated(testTransactionState(), (draft) => {
		asRecord(draft).surprise = 1;
	});
	assert.throws(() => decodeJeroReviewTransactionStateV1(state), /unknown key "surprise"/);
});

test("strict decode rejects a missing required key by naming it", () => {
	const state = mutated(testTransactionState(), (draft) => {
		delete asRecord(draft).paths_digest;
	});
	assert.throws(() => decodeJeroReviewTransactionStateV1(state), /missing key "paths_digest"/);
});

test("strict decode rejects out-of-enum and wrong-typed values", () => {
	assert.throws(() => decodeJeroReviewTransactionStateV1(mutated(testTransactionState(), (draft) => { asRecord(draft).state = "happening"; })), /state: unsupported value "happening"/);
	assert.throws(() => decodeJeroReviewTransactionStateV1(mutated(testTransactionState(), (draft) => { asRecord(draft).generation = "3"; })), /generation: expected safe non-negative integer/);
	assert.throws(() => decodeJeroReviewTransactionStateV1(mutated(testTransactionState(), (draft) => { asRecord(draft).mode = "ordinary"; })), /mode: unsupported value "ordinary"/);
	assert.throws(
		() => decodeJeroReviewTransactionStateV1(mutated(testTransactionState(), (draft) => { draft.counters.full_reviews = -1; })),
		/counters\.full_reviews: expected safe non-negative integer/,
	);
	assert.throws(
		() => decodeJeroReviewTransactionStateV1(mutated(testTransactionState(), (draft) => { asRecord(draft.snapshot).kind = "whole-tree"; })),
		/snapshot\.kind: unsupported value "whole-tree"/,
	);
	assert.throws(
		() => decodeJeroReviewTransactionStateV1(mutated(testTransactionState(), (draft) => { asRecord(draft.findings[0]!).severity = "MEDIUM"; })),
		/severity: unsupported value "MEDIUM"/,
	);
});

test("strict decode rejects an unknown nested key inside counters", () => {
	const state = mutated(testTransactionState(), (draft) => {
		asRecord(draft.counters).extra_runs = 1;
	});
	assert.throws(() => decodeJeroReviewTransactionStateV1(state), protocolFailure(/unknown key "extra_runs"/));
});

test("request journal entries decode strictly", () => {
	const entry = { operation: "verify", idempotency_key: "key-1", request_hash: "a".repeat(64), status: "completed", canonical_result: { ok: true } };
	assert.deepEqual(decodeJeroRequestJournalEntryV1(entry), entry);
	const pending = { operation: "gate", idempotency_key: "key-2", request_hash: "b".repeat(64), status: "pending", authorization: { actor: "review-risk" } };
	assert.deepEqual(decodeJeroRequestJournalEntryV1(pending), pending);
	assert.throws(() => decodeJeroRequestJournalEntryV1({ ...entry, operation: "teleport" }), /operation: unsupported value "teleport"/);
	assert.throws(() => decodeJeroRequestJournalEntryV1({ ...entry, request_hash: "short" }), /request_hash: expected lowercase SHA-256 digest/);
	assert.throws(() => decodeJeroRequestJournalEntryV1({ ...entry, canonical_result: undefined }), /requires canonical_result/);
	assert.throws(() => decodeJeroRequestJournalEntryV1({ ...entry, extra: 1 }), /unknown key "extra"/);
});

test("receipt envelope round-trips and its integrity assertion holds", () => {
	const body: JeroReceiptBodyV1 = {
		schema: JERO_RECEIPT_BODY_SCHEMA,
		lineage_id: "review-0123456789abcdef",
		mode: "ordinary_4r",
		state: "approved",
		base_tree: "b".repeat(40),
		initial_review_tree: "2".repeat(40),
		final_candidate_tree: "3".repeat(40),
		paths_digest: "d".repeat(64),
		fix_delta_hash: "4".repeat(64),
		policy_hash: "5".repeat(64),
		ledger_hash: "6".repeat(64),
		ledger_findings_hash: "7".repeat(64),
		evidence_hash: "8".repeat(64),
		counters: { full_reviews: 1, refuter_batches: 2, fix_batches: 1, scoped_fix_validations: 1, final_verifications: 1, fix_rounds: 1, scoped_rejudgments: 0, judge_executions: 0 },
	};
	const envelope = createJeroReceiptEnvelopeV1(body);
	assert.match(envelope.receipt_hash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(envelope.receipt_hash, jeroReceiptHashV1(body));
	assert.deepEqual(envelope.body, body);
	assertJeroReceiptIntegrityV1(envelope);
	assert.throws(() => assertJeroReceiptIntegrityV1({ body: mutated(body, (draft) => { draft.evidence_hash = "9".repeat(64); }), receipt_hash: envelope.receipt_hash }), receiptFailure(/Receipt hash mismatch/));
	assert.throws(() => assertJeroReceiptIntegrityV1({ body, receipt_hash: "sha256:" + "0".repeat(64) }), receiptFailure(/Receipt hash mismatch/));
	assert.throws(() => createJeroReceiptEnvelopeV1(mutated(body, (draft) => { draft.state = "reviewing"; })), /terminal lineage state/);
	assert.throws(() => createJeroReceiptEnvelopeV1(mutated(body, (draft) => { asRecord(draft).tip = 1; })), /unknown key "tip"/);
});

test("the jero verify-result envelope decodes strictly", () => {
	const record: JeroVerifyResultV1 = {
		schema: "jero.verify-result/v1",
		evidence_revision: `sha256:${"a".repeat(64)}`,
		verdict: "pass",
		blockers: 0,
		critical_findings: 0,
		requirements: "12/12",
		scenarios: "4/4",
		test_command: "pnpm test",
		test_exit_code: 0,
		test_output_hash: `sha256:${"b".repeat(64)}`,
		build_command: "pnpm typecheck",
		build_exit_code: 0,
		build_output_hash: `sha256:${"c".repeat(64)}`,
	};
	assert.deepEqual(decodeJeroVerifyResultV1(record), record);
	assert.throws(() => decodeJeroVerifyResultV1(mutated(record, (draft) => { asRecord(draft).verdict = "maybe"; })), /verdict: unsupported value "maybe"/);
	assert.throws(() => decodeJeroVerifyResultV1(mutated(record, (draft) => { asRecord(draft).requirements = "all"; })), /requirements: expected/);
	assert.throws(() => decodeJeroVerifyResultV1(mutated(record, (draft) => { asRecord(draft).evidence_revision = "abc"; })), /expected canonical SHA-256 identity/);
	assert.throws(() => decodeJeroVerifyResultV1(mutated(record, (draft) => { asRecord(draft).note = "hi"; })), /unknown key "note"/);
});

test("jero identity domains never collide with upstream gentle-ai domains", async () => {
	const { domainHashV1 } = await import("../../lib/review-canonical.ts");
	const sample = { lineage_id: "review-0123456789abcdef", generation: 1 };
	for (const domain of ["repository", "authority", "revision", "receipt", "lock-owner"]) {
		assert.notEqual(
			jeroDomainHash(domain, sample),
			domainHashV1(domain, sample),
			`domain "${domain}" must not be interchangeable with the upstream namespace`,
		);
	}
});
