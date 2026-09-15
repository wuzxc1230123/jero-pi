import { join } from "node:path";
import { conservativeOwnerDeathProofV1, ReviewMutationLockV1, type ReviewLockOwnerV1, type ReviewLockPlatformAdapterV1 } from "../review-lock.ts";

// Authority mutation lock over the jero review store (design §5.1.2, §5.1.3).
//
// This is a thin wrapper around the ported `ReviewMutationLockV1`; the lock
// class itself is NOT modified. Passing the jero store root directly as the
// control root lands the lock at `<store>/locks/authority.lock` (the class
// only special-cases control roots literally named "control"), with
// acquisition intents fenced at `<store>/locks/authority.lock-intents/`.
//
// Status reporting uses the compact vocabulary `owned | ambiguous |
// released`: a lock directory left behind by a provably dead owner reads as
// `released` and must never block a new START — it still has to go through
// `recover()` before `acquire()` can succeed, because the underlying lock
// never steals an existing directory.

export type JeroAuthorityLockStatus = "owned" | "ambiguous" | "released";

export interface JeroAuthorityLockStatusV1 {
	readonly status: JeroAuthorityLockStatus;
	readonly owner?: ReviewLockOwnerV1;
}

export class JeroAuthorityLocksV1 {
	readonly lockPath: string;
	readonly intentsPath: string;
	readonly #lock: ReviewMutationLockV1;

	constructor(storeRoot: string, repositoryId: string, authorityId: string, platform?: ReviewLockPlatformAdapterV1) {
		this.#lock = new ReviewMutationLockV1(storeRoot, repositoryId, authorityId, platform);
		this.lockPath = this.#lock.path;
		this.intentsPath = join(this.lockPath, "..", "authority.lock-intents");
	}

	acquire(): ReviewLockOwnerV1 {
		return this.#lock.acquire();
	}

	/** Runs an action while holding the authority lock; the lock is always released. */
	withLock<T>(action: (owner: ReviewLockOwnerV1) => T): T {
		const owner = this.#lock.acquire();
		try {
			return action(owner);
		} finally {
			this.#lock.release(owner);
		}
	}

	release(owner: ReviewLockOwnerV1): void {
		this.#lock.release(owner);
	}

	/**
	 * Reports lock status in the compact vocabulary. `absent` maps to
	 * `released` (nothing is held); an `owned` directory whose owner is
	 * provably dead is the LOCK-leftover case and also reads as `released`.
	 */
	inspect(): JeroAuthorityLockStatusV1 {
		const inspection = this.#lock.inspect();
		if (inspection.status === "absent") return { status: "released" };
		if (inspection.status === "ambiguous") return { status: "ambiguous" };
		return { status: conservativeOwnerDeathProofV1(inspection.owner) ? "released" : "owned", owner: inspection.owner };
	}

	/** Quarantines a stale (provably dead-owner) lock; the token fence is owned by the wrapped class. */
	recover(expectedOwnerHash: string): void {
		this.#lock.recover(expectedOwnerHash);
	}

	/** Recovers an incomplete acquisition (lock directory without owner.json) fenced by a matching durable intent. */
	recoverIncomplete(expectedToken: string): void {
		this.#lock.recoverIncomplete(expectedToken);
	}
}
