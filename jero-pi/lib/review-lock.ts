import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { canonicalJsonV1, domainHashV1 } from "./review-canonical.ts";

export class ReviewLockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReviewLockError";
	}
}

export interface ReviewLockOwnerV1 {
	token: string;
	owner_hash: string;
	pid: number;
	repository_id: string;
	authority_id: string;
}

/**
 * 运行时必须提供一个其“不替换”结果具有权威性的原语。
 * Node 的普通 rename API 刻意不被改造使用：它可能替换目标。
 */
export interface ReviewLockPlatformAdapterV1 {
	name: string;
	assertQualified(): void;
	proveOwnerDead(owner: ReviewLockOwnerV1): boolean;
	moveNoReplace(source: string, destination: string): void;
}

export function conservativeOwnerDeathProofV1(owner: ReviewLockOwnerV1): boolean {
	if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid === process.pid) return false;
	try {
		process.kill(owner.pid, 0);
		return false;
	} catch (error) {
		return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ESRCH";
	}
}

const UNQUALIFIED_PLATFORM: ReviewLockPlatformAdapterV1 = {
	name: "portable-atomic-mkdir",
	assertQualified() {},
	proveOwnerDead(owner) { return conservativeOwnerDeathProofV1(owner); },
	moveNoReplace() { throw new ReviewLockError("Review lock recovery is unsupported without a qualified no-replace move primitive"); },
};

/**
 * 达标的默认生产平台：纯 Node、零依赖的原子不替换移动。
 *
 * 锁的被移动路径（`this.path`、隔离/释放目标）是目录，而 POSIX 上
 * 目录无法硬链接。`fs.mkdirSync` 本身对任意路径已是原子的不替换
 * 原语——无论目标被文件还是目录占用、是否为空，它都抛 EEXIST——
 * 因此它独占地保留目标名；随后的 rename 再安全地把源目录的内容
 * 并入那个独占持有、仍为空的目标（把目录重命名到自己刚创建的
 * 空目录之上是普通且安全的 POSIX 替换）。对于普通文件源，则改用
 * 经典的 `linkSync`（不替换时 EEXIST）+ `unlinkSync` 序列。
 *
 * 若底层原语在本平台或文件系统上不受支持，这里会携带描述性的
 * `ReviewLockError` 保守失败，而不是静默替换目标。
 */
export function qualifiedNodeFsLockPlatformV1(): ReviewLockPlatformAdapterV1 {
	return {
		name: "node-fs-atomic-no-replace",
		assertQualified() {},
		proveOwnerDead(owner) { return conservativeOwnerDeathProofV1(owner); },
		moveNoReplace(source, destination) {
			let isDirectory: boolean;
			try {
				isDirectory = lstatSync(source).isDirectory();
			} catch (error) {
				throw new ReviewLockError(`Review lock atomic no-replace move source is unavailable: ${error instanceof Error ? error.message : String(error)}`);
			}
			if (!isDirectory) {
				// NTFS 同样支持硬链接：目标已存在时 CreateHardLinkW 会失败，
				// 因此相同的 EEXIST 不替换保证在每个受支持平台上都成立。
				try {
					linkSync(source, destination);
					unlinkSync(source);
				} catch (error) {
					throw new ReviewLockError(`Review lock atomic no-replace move is unsupported on this platform or filesystem: ${error instanceof Error ? error.message : String(error)}`);
				}
				return;
			}
			if (process.platform === "win32") {
				// 目录无法硬链接；Windows 上重命名到已存在的目标目录会
				// 失败，从而保持不替换语义。
				try {
					renameSync(source, destination);
				} catch (error) {
					throw new ReviewLockError(`Review lock atomic no-replace move is unsupported on this platform or filesystem: ${error instanceof Error ? error.message : String(error)}`);
				}
				return;
			}
			try {
				mkdirSync(destination, { mode: 0o700 });
			} catch (error) {
				throw new ReviewLockError(`Review lock atomic no-replace move is unsupported on this platform or filesystem: ${error instanceof Error ? error.message : String(error)}`);
			}
			try {
				renameSync(source, destination);
			} catch (error) {
				try { rmSync(destination, { recursive: true, force: true }); } catch {}
				throw new ReviewLockError(`Review lock atomic no-replace move failed after reserving the destination: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
	};
}

const DEFAULT_PLATFORM: ReviewLockPlatformAdapterV1 = qualifiedNodeFsLockPlatformV1();

export interface ReviewLockInspectionV1 {
	status: "absent" | "owned" | "ambiguous";
	owner?: ReviewLockOwnerV1;
}

export class ReviewMutationLockV1 {
	readonly path: string;
	readonly #repositoryId: string;
	readonly #authorityId: string;
	readonly #platform: ReviewLockPlatformAdapterV1;

	constructor(controlRoot: string, repositoryId: string, authorityId: string, platform: ReviewLockPlatformAdapterV1 = DEFAULT_PLATFORM) {
		const control = basename(controlRoot) === "control" ? controlRoot : join(controlRoot, "locks");
		this.path = join(control, "authority.lock");
		this.#repositoryId = repositoryId;
		this.#authorityId = authorityId;
		this.#platform = platform;
	}

	acquire(): ReviewLockOwnerV1 {
		const unsigned = { token: randomBytes(32).toString("hex"), pid: process.pid, repository_id: this.#repositoryId, authority_id: this.#authorityId };
		const owner: ReviewLockOwnerV1 = { ...unsigned, owner_hash: domainHashV1("lock-owner", unsigned) };
		const intentRoot = join(this.path, "..", "authority.lock-intents");
		mkdirSync(intentRoot, { recursive: true, mode: 0o700 });
		const intentPath = join(intentRoot, `${owner.token}.json`);
		writeFileSync(intentPath, canonicalJsonV1(owner), { mode: 0o600, flag: "wx" }); this.fsyncFile(intentPath); this.fsyncDirectory(intentRoot);
		mkdirSync(join(this.path, ".."), { recursive: true, mode: 0o700 });
		try { mkdirSync(this.path, { mode: 0o700 }); } catch (error) {
			// 争用：他人持有活动锁；我们没有改动任何东西，因此我们的意图
			// 记录是垃圾而非证据——把它带走，而不是每次失败的获取都
			// 累积一个 JSON。
			try { unlinkSync(intentPath); this.fsyncDirectory(intentRoot); } catch { /* 残留的意图文件是无害的 */ }
			throw new ReviewLockError(`Review authority lock is active or ambiguous: ${error instanceof Error ? error.message : String(error)}`);
		}
		try {
			writeFileSync(join(this.path, "owner.json"), canonicalJsonV1(owner), { mode: 0o600, flag: "wx" });
			this.fsyncFile(join(this.path, "owner.json"));
			this.fsyncDirectory(this.path);
			this.fsyncDirectory(join(this.path, ".."));
			unlinkSync(intentPath);
			this.fsyncDirectory(intentRoot);
		} catch (error) {
			// 不完整的目录被刻意保留：窃取它是歧义的。意图文件也特意
			// 随之保留——它点名了那次失败尝试造成歧义的所有者。
			throw new ReviewLockError(`Review authority lock owner is ambiguous: ${error instanceof Error ? error.message : String(error)}`);
		}
		return Object.freeze(owner);
	}

	release(owner: ReviewLockOwnerV1): void {
		const observed = this.readOwner();
		if (observed.token !== owner.token || observed.owner_hash !== owner.owner_hash || observed.pid !== process.pid || observed.repository_id !== this.#repositoryId || observed.authority_id !== this.#authorityId) {
			throw new ReviewLockError("Review authority lock owner token does not match");
		}
		try {
			if (this.#platform === UNQUALIFIED_PLATFORM) {
				rmSync(this.path, { recursive: true, force: false });
			} else {
				const released = join(this.path, "..", `released-${owner.owner_hash}-${owner.token}`);
				this.#platform.moveNoReplace(this.path, released);
				this.fsyncDirectory(join(this.path, ".."));
				rmSync(released, { recursive: true, force: false });
			}
			this.fsyncDirectory(join(this.path, ".."));
		} catch (error) {
			throw new ReviewLockError(`Review authority lock release failed closed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	inspect(): ReviewLockInspectionV1 {
		if (!existsSync(this.path)) return { status: "absent" };
		try { return { status: "owned", owner: this.readOwner() }; } catch { return { status: "ambiguous" }; }
	}

	recover(expectedOwnerHash: string): void {
		this.#platform.assertQualified();
		const observed = this.readOwner();
		if (observed.owner_hash !== expectedOwnerHash) throw new ReviewLockError("Review authority lock owner hash does not match");
		if (!this.#platform.proveOwnerDead(observed)) throw new ReviewLockError("Review authority lock ownership is active or ambiguous");
		const quarantineRoot = join(this.path, "..", "quarantine");
		const destination = join(quarantineRoot, `stale-${observed.owner_hash}-${observed.token}`);
		mkdirSync(quarantineRoot, { recursive: true, mode: 0o700 });
		try {
			this.#platform.moveNoReplace(this.path, destination);
			this.fsyncDirectory(join(this.path, ".."));
		} catch (error) {
			throw new ReviewLockError(`Review authority lock recovery race; re-observe: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	recoverIncomplete(expectedToken: string): void {
		this.#platform.assertQualified();
		if (!/^[0-9a-f]{64}$/.test(expectedToken)) throw new ReviewLockError("Review authority lock intent token is invalid");
		if (existsSync(join(this.path, "owner.json"))) throw new ReviewLockError("Review authority lock is not incomplete");
		const intentPath = join(this.path, "..", "authority.lock-intents", `${expectedToken}.json`);
		let owner: ReviewLockOwnerV1;
		try { owner = JSON.parse(readFileSync(intentPath, "utf8")) as ReviewLockOwnerV1; } catch { throw new ReviewLockError("Review authority lock acquisition intent is ambiguous"); }
		if (owner.token !== expectedToken || owner.repository_id !== this.#repositoryId || owner.authority_id !== this.#authorityId || owner.owner_hash !== domainHashV1("lock-owner", { token: owner.token, pid: owner.pid, repository_id: owner.repository_id, authority_id: owner.authority_id }) || !this.#platform.proveOwnerDead(owner)) throw new ReviewLockError("Review authority lock acquisition intent is active or ambiguous");
		const destination = join(this.path, "..", "quarantine", `incomplete-${owner.owner_hash}-${owner.token}`);
		mkdirSync(join(this.path, "..", "quarantine"), { recursive: true, mode: 0o700 });
		try { this.#platform.moveNoReplace(this.path, destination); this.fsyncDirectory(join(this.path, "..")); } catch (error) { throw new ReviewLockError(`Review authority lock recovery race; re-observe: ${error instanceof Error ? error.message : String(error)}`); }
	}

	private readOwner(): ReviewLockOwnerV1 {
		if (!existsSync(this.path)) throw new ReviewLockError("Review authority lock is absent");
		try {
			const owner = JSON.parse(readFileSync(join(this.path, "owner.json"), "utf8")) as ReviewLockOwnerV1;
			const { owner_hash, ...unsigned } = owner;
			if (typeof owner.token !== "string" || !/^[0-9a-f]{64}$/.test(owner.token) || typeof owner_hash !== "string" || !Number.isSafeInteger(owner.pid) || owner.repository_id !== this.#repositoryId || owner.authority_id !== this.#authorityId || owner_hash !== domainHashV1("lock-owner", unsigned)) throw new Error("invalid owner metadata");
			return owner;
		} catch (error) {
			throw new ReviewLockError(`Review authority lock ownership is ambiguous: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private fsyncFile(path: string): void {
		const descriptor = openSync(path, "r+");
		try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
	}

	private fsyncDirectory(path: string): void {
		if (!statSync(path).isDirectory()) throw new ReviewLockError("Review lock path is not a directory");
		if (process.platform === "win32") return;
		const descriptor = openSync(path, "r");
		try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
	}
}
