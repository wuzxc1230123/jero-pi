import { join } from "node:path";
import { conservativeOwnerDeathProofV1, ReviewMutationLockV1, type ReviewLockOwnerV1, type ReviewLockPlatformAdapterV1 } from "../review-lock.ts";

// jero 评审存储之上的权威变更锁（设计 §5.1.2、§5.1.3）。
//
// 这是对移植而来的 `ReviewMutationLockV1` 的薄封装；锁类本身未被修改。
// 直接把 jero 存储根当作控制根传入，锁会落在
// `<store>/locks/authority.lock`（该类只对字面名为 “control” 的控制根做
// 特殊处理），获取意图则围栏在 `<store>/locks/authority.lock-intents/`。
//
// 状态上报使用紧凑词汇 `owned | ambiguous | released`：被证明已死亡的
// 所有者留下的锁目录读作 `released`，绝不得阻塞新的 START——在
// `acquire()` 成功之前仍必须先经过 `recover()`，因为底层锁绝不窃取
// 已存在的目录。

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

	/** 持有权威锁运行一个动作；锁总会被释放。 */
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
	 * 以紧凑词汇报告锁状态。`absent` 映射为 `released`（未持有任何
	 * 内容）；所有者被证明已死亡的 `owned` 目录属于 LOCK 残留情形，
	 * 同样读作 `released`。
	 */
	inspect(): JeroAuthorityLockStatusV1 {
		const inspection = this.#lock.inspect();
		if (inspection.status === "absent") return { status: "released" };
		if (inspection.status === "ambiguous") return { status: "ambiguous" };
		return { status: conservativeOwnerDeathProofV1(inspection.owner) ? "released" : "owned", owner: inspection.owner };
	}

	/** 隔离过期（所有者被证明已死）的锁；令牌围栏由被包装的类拥有。 */
	recover(expectedOwnerHash: string): void {
		this.#lock.recover(expectedOwnerHash);
	}

	/** 恢复一次不完整的获取（无 owner.json 的锁目录），由匹配的持久意图围栏。 */
	recoverIncomplete(expectedToken: string): void {
		this.#lock.recoverIncomplete(expectedToken);
	}
}
