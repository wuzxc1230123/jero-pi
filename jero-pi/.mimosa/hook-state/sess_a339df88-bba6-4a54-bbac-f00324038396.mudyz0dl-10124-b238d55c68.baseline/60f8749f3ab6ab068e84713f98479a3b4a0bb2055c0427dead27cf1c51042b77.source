import assert from "node:assert/strict";
import test from "node:test";
import {
	decodeJeroRequestJournalEntryV1,
	decodeJeroReviewModeRecordV1,
	decodeJeroReviewTransactionStateV1,
	decodeJeroSddAttemptLedgerV1,
	decodeJeroVerifyResultV1,
} from "../../../lib/authority/protocol.ts";
import { testTransactionState } from "../fixtures.ts";

// Design §5.1.7: "unknown-key 拒绝解码的纪律保留为内部不变量测试" — the
// authority cannot grow a persisted field by accident: every strict decoder
// rejects an unknown key BY NAME. This family walks each exported decoder
// with a valid record, injects one unknown key, and asserts the named
// rejection — so adding a field without schema review breaks this suite
// first, not a production read path.

const EVIDENCE = `sha256:${"a".repeat(64)}`;

function validJournalEntry(): Record<string, unknown> {
	return { operation: "start", idempotency_key: "k1", request_hash: "b".repeat(64), status: "completed", canonical_result: { ok: true } };
}

function validVerifyResult(): Record<string, unknown> {
	return {
		schema: "jero.verify-result/v1", evidence_revision: EVIDENCE, verdict: "pass", blockers: 0, critical_findings: 0,
		requirements: "1/1", scenarios: "1/1", test_command: "pnpm test", test_exit_code: 0, test_output_hash: EVIDENCE,
		build_command: "pnpm build", build_exit_code: 0, build_output_hash: EVIDENCE,
	};
}

function validAttemptLedger(): Record<string, unknown> {
	return {
		schema: "jero.authority.sdd-attempt-ledger/v1",
		workspace_root: "D:/repo",
		change_name: "add-login",
		attempts: [{
			request_id: "r1", acquired_at_revision: EVIDENCE, token_hash: "c".repeat(64), work_unit: "w", evidence_goal: "g",
			max_attempts: 3, max_changed_lines: 100, expected_revision: "", untracked_scope: "exclude", intended_untracked: [],
		}],
	};
}

function validModeRecord(): Record<string, unknown> {
	return { schema: "jero.authority.review-mode/v1", value: "on" };
}

const CASES = [
	["review-transaction state", decodeJeroReviewTransactionStateV1, () => testTransactionState() as unknown as Record<string, unknown>],
	["request-journal entry", decodeJeroRequestJournalEntryV1, validJournalEntry],
	["verify-result envelope", decodeJeroVerifyResultV1, validVerifyResult],
	["sdd attempt ledger", decodeJeroSddAttemptLedgerV1, validAttemptLedger],
	["review-mode record", decodeJeroReviewModeRecordV1, validModeRecord],
] as const;

for (const [label, decode, build] of CASES) {
	test(`unknown-key invariant: ${label} rejects an injected key by name`, () => {
		const valid = build();
		decode(valid);
		const poisoned = { ...valid, __injected_unknown_key: 1 };
		assert.throws(
			() => decode(poisoned),
			(error) => error instanceof Error && /unknown key .__injected_unknown_key/.test(error.message),
			"the decoder must name the injected key",
		);
	});
	test(`missing-key invariant: ${label} rejects a removed required key`, () => {
		const valid = build();
		const [removed] = Object.keys(valid);
		const starved = { ...valid };
		delete starved[removed!];
		assert.throws(() => decode(starved), /missing key|requires|expected/);
	});
}
