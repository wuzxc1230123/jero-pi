import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalBytesV1, canonicalJsonV1, sha256Hex } from "../../lib/review-canonical.ts";
import { JERO_REVIEW_TRANSACTION_SCHEMA } from "../../lib/authority/canonical.ts";
import { JeroObjectCasError, JeroObjectCasV1 } from "../../lib/authority/object-cas.ts";
import { decodeJeroReviewTransactionStateV1 } from "../../lib/authority/protocol.ts";
import { tempRoot, testTransactionState } from "./fixtures.ts";

function freshStore(): { storeRoot: string; cas: JeroObjectCasV1 } {
	const storeRoot = tempRoot("jero-authority-cas-");
	return { storeRoot, cas: JeroObjectCasV1.forStore(storeRoot) };
}

test("put installs canonical bytes at objects/<sha256> and re-put is idempotent", () => {
	const { storeRoot, cas } = freshStore();
	try {
		const record = testTransactionState();
		const first = cas.put(record, { schema: JERO_REVIEW_TRANSACTION_SCHEMA });
		assert.equal(first.hash, sha256Hex(canonicalBytesV1(record)));
		assert.equal(first.idempotent, false);
		assert.equal(readFileSync(join(storeRoot, "objects", first.hash)).toString(), canonicalJsonV1(record));
		const second = cas.put(record, { schema: JERO_REVIEW_TRANSACTION_SCHEMA });
		assert.deepEqual(second, { hash: first.hash, idempotent: true });
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("put rejects a record whose schema field does not match the declared schema", () => {
	const { storeRoot, cas } = freshStore();
	try {
		const casFailure = (pattern: RegExp) => (error: unknown) => error instanceof JeroObjectCasError && pattern.test(error.message);
		assert.throws(() => cas.put({ schema: "jero.other/v1" }, { schema: JERO_REVIEW_TRANSACTION_SCHEMA }), casFailure(/schema mismatch/));
		assert.throws(() => cas.put({ no: "schema" }, { schema: JERO_REVIEW_TRANSACTION_SCHEMA }), casFailure(/missing schema field/));
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("put throws a conflict carrying both hashes when existing bytes differ", () => {
	const { storeRoot, cas } = freshStore();
	try {
		const record = testTransactionState();
		const hash = sha256Hex(canonicalBytesV1(record));
		mkdirSync(join(storeRoot, "objects"), { recursive: true });
		const conflicting = canonicalJsonV1({ schema: JERO_REVIEW_TRANSACTION_SCHEMA, different: true });
		writeFileSync(join(storeRoot, "objects", hash), conflicting);
		assert.throws(
			() => cas.put(record, { schema: JERO_REVIEW_TRANSACTION_SCHEMA }),
			(error) => error instanceof JeroObjectCasError &&
				error.message.includes(`stored content hashes to ${sha256Hex(conflicting)}`) &&
				error.message.includes(`requested ${hash}`),
		);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("get round-trips through canonical parse and the strict decoder", () => {
	const { storeRoot, cas } = freshStore();
	try {
		const record = testTransactionState();
		const { hash } = cas.put(record, { schema: JERO_REVIEW_TRANSACTION_SCHEMA });
		assert.deepEqual(cas.get(hash, decodeJeroReviewTransactionStateV1), record);
		assert.equal(cas.has(hash), true);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("get fails closed on missing, tampered, non-canonical, and undecodable objects", () => {
	const { storeRoot, cas } = freshStore();
	try {
		assert.throws(() => cas.get("f".repeat(64), decodeJeroReviewTransactionStateV1), (error) => error instanceof JeroObjectCasError && /missing/.test(error.message));
		const record = testTransactionState();
		const { hash } = cas.put(record, { schema: JERO_REVIEW_TRANSACTION_SCHEMA });
		// Tampered bytes: valid canonical JSON that no longer hashes to its id.
		const tampered = canonicalJsonV1({ ...record, evidence_hash: "9".repeat(64) });
		writeFileSync(join(storeRoot, "objects", hash), tampered);
		assert.throws(() => cas.get(hash, decodeJeroReviewTransactionStateV1), (error) => error instanceof JeroObjectCasError && /does not hash to its id/.test(error.message));
		// Hash-valid but schema-undecodable content.
		const bogus = canonicalJsonV1({ schema: JERO_REVIEW_TRANSACTION_SCHEMA });
		const bogusHash = sha256Hex(bogus);
		writeFileSync(join(storeRoot, "objects", bogusHash), bogus);
		assert.throws(() => cas.get(bogusHash, decodeJeroReviewTransactionStateV1), (error) => error instanceof Error && !(error instanceof JeroObjectCasError));
		// Non-canonical JSON cannot even be parsed.
		const sloppy = JSON.stringify({ schema: JERO_REVIEW_TRANSACTION_SCHEMA, b: 1, a: 2 });
		const sloppyHash = sha256Hex(sloppy);
		writeFileSync(join(storeRoot, "objects", sloppyHash), sloppy);
		assert.throws(() => cas.get(sloppyHash, decodeJeroReviewTransactionStateV1), (error) => error instanceof JeroObjectCasError && /not canonical JSON/.test(error.message));
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});
