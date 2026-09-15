import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonV1, domainHashV1 } from "../../lib/review-canonical.ts";
import { ReviewLockError } from "../../lib/review-lock.ts";
import { JeroAuthorityLocksV1 } from "../../lib/authority/locks.ts";
import { tempRoot } from "./fixtures.ts";

const REPOSITORY_ID = "1".repeat(64);
const AUTHORITY_ID = "2".repeat(64);

function freshLocks(): { storeRoot: string; locks: JeroAuthorityLocksV1 } {
	const storeRoot = tempRoot("jero-authority-locks-");
	return { storeRoot, locks: new JeroAuthorityLocksV1(storeRoot, REPOSITORY_ID, AUTHORITY_ID) };
}

test("the authority lock lands at <store>/locks/authority.lock with fenced intents", () => {
	const { storeRoot, locks } = freshLocks();
	try {
		assert.equal(locks.lockPath, join(storeRoot, "locks", "authority.lock"));
		assert.equal(locks.intentsPath, join(storeRoot, "locks", "authority.lock-intents"));
		let captured: ReturnType<JeroAuthorityLocksV1["acquire"]> | undefined;
		assert.equal(locks.withLock((owner) => { captured = owner; return "held"; }), "held");
		assert.match(captured!.token, /^[0-9a-f]{64}$/);
		assert.equal(existsSync(join(storeRoot, "locks", "authority.lock-intents", `${captured!.token}.json`)), false);
		assert.equal(existsSync(locks.lockPath), false);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("acquire, inspect, release cycle maps to the compact status vocabulary", () => {
	const { storeRoot, locks } = freshLocks();
	try {
		assert.equal(locks.inspect().status, "released");
		const owner = locks.acquire();
		assert.equal(locks.inspect().status, "owned");
		assert.throws(() => locks.acquire(), ReviewLockError);
		locks.release(owner);
		assert.equal(locks.inspect().status, "released");
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("withLock always releases, including when the action throws", () => {
	const { storeRoot, locks } = freshLocks();
	try {
		assert.throws(() => locks.withLock(() => { throw new Error("action failed"); }), /action failed/);
		assert.equal(existsSync(locks.lockPath), false);
		locks.acquire();
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});

test("a dead-owner leftover reads as released and re-acquisition works after recover", () => {
	const { storeRoot, locks } = freshLocks();
	try {
		// Fabricate a LOCK leftover whose owner is a provably dead process.
		const token = "a".repeat(64);
		const pid = 4_000_000;
		const ownerHash = domainHashV1("lock-owner", { token, pid, repository_id: REPOSITORY_ID, authority_id: AUTHORITY_ID });
		mkdirSync(locks.lockPath, { recursive: true, mode: 0o700 });
		writeFileSync(join(locks.lockPath, "owner.json"), canonicalJsonV1({ token, owner_hash: ownerHash, pid, repository_id: REPOSITORY_ID, authority_id: AUTHORITY_ID }), { mode: 0o600, flag: "wx" });
		const inspection = locks.inspect();
		assert.equal(inspection.status, "released");
		// The underlying lock never steals an existing directory: acquire still fails...
		assert.throws(() => locks.acquire(), ReviewLockError);
		// ...but status said released, so maintenance recover unblocks a new START.
		locks.recover(ownerHash);
		assert.equal(existsSync(join(storeRoot, "locks", "quarantine", `stale-${ownerHash}-${token}`)), true);
		const owner = locks.acquire();
		assert.equal(locks.inspect().status, "owned");
		locks.release(owner);
	} finally {
		rmSync(storeRoot, { recursive: true, force: true });
	}
});
