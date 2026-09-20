import { randomUUID } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonV1, parseCanonicalJsonV1 } from "../review-canonical.ts";
import { JERO_LINEAGE_STATE_SCHEMA, jeroDomainHash } from "./canonical.ts";
import {
	decodeJeroRequestJournalEntryV1,
	decodeJeroReviewTransactionStateV1,
	type JeroAuthorityOperation,
	type JeroRequestJournalEntryV1,
	type JeroReviewTransactionStateV1,
} from "./protocol.ts";
import { isJeroLineageId } from "./store-root.ts";
import type { JeroAuthorityLocksV1 } from "./locks.ts";

// jero 权威存储的血脉状态持久化：
// `lineages/<lineage-id>/review-state.json`。
//
// 持久化记录是一个 `jero.authority.lineage-state/v1` 封套，携带血脉
// 状态记录、内嵌的请求日志以及内容派生的修订号（`sha256:` +
// jeroDomainHash("revision", 去掉 revision 的记录)）。每次保存都是一次
// 乐观并发转移：调用方必须出示它观察到的修订号，任何不匹配都以过期
// 修订号保守失败。写入是原子的（O_EXCL 0o600 临时文件、重命名、
// `finally` 中删除临时文件），镜像 orchestrator-presence 的 atomicWrite
// 模式；提供权威变更锁时，变更类 API 都在其内运行（见 locks.ts）。
// 保存是替换原子而非 fsync 持久：崩溃可能丢失最新修订号（表现为过期
// 修订号或记录损坏拒绝），绝不会出现撕裂的记录。
//
// 日志语义镜像 review-transaction.ts：精确的
// (idempotency_key, request_hash) 重放返回存储的 canonical_result；
// 键被不同请求复用则保守失败；pending 条目阻塞所有新的变更操作，
// 且可从崩溃中补完成。

export class JeroLineageStoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JeroLineageStoreError";
	}
}

export const JERO_LINEAGE_STATE_FILENAME = "review-state.json";
const WRITE_EXCLUSIVE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
const REQUEST_HASH_PATTERN = /^[0-9a-f]{64}$/;
const REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface JeroLineageStateFileV1 {
	schema: typeof JERO_LINEAGE_STATE_SCHEMA;
	lineage_id: string;
	revision: string;
	state: JeroReviewTransactionStateV1;
	request_journal: JeroRequestJournalEntryV1[];
}

export interface JeroLineageDraftV1 {
	state: JeroReviewTransactionStateV1;
	request_journal: JeroRequestJournalEntryV1[];
}

export type JeroLineageLoadResultV1 =
	| { readonly kind: "ok"; readonly record: JeroLineageStateFileV1 }
	| { readonly kind: "missing" }
	| { readonly kind: "corrupted"; readonly detail: string };

export interface JeroLineageStoreOptionsV1 {
	/** 权威变更锁；提供时每个变更类 API 都在其内运行。 */
	lock?: JeroAuthorityLocksV1;
}

function cloneCanonical<T>(value: T): T {
	return JSON.parse(canonicalJsonV1(value)) as T;
}

/** 血脉草稿的内容派生修订号：`sha256:<jeroDomainHash("revision", draft)>`。 */
export function computeJeroLineageRevisionV1(draft: JeroLineageDraftV1): string {
	return `sha256:${jeroDomainHash("revision", { state: draft.state, request_journal: draft.request_journal })}`;
}

function assertLineageId(lineageId: string): void {
	if (!isJeroLineageId(lineageId)) throw new JeroLineageStoreError("Lineage ID is invalid");
}

function assertIdempotencyKey(key: string): void {
	if (typeof key !== "string" || key.trim().length === 0) throw new JeroLineageStoreError("An idempotency key is required");
}

function assertRequestHash(requestHash: string): void {
	if (!REQUEST_HASH_PATTERN.test(requestHash)) throw new JeroLineageStoreError("Request hash is not a SHA-256 digest");
}

function validateDraft(lineageId: string, draft: JeroLineageDraftV1): void {
	const state = decodeJeroReviewTransactionStateV1(draft.state);
	if (state.lineage_id !== lineageId) throw new JeroLineageStoreError("Lineage state record does not match the lineage ID");
	const keys = new Set<string>();
	let pending = 0;
	for (const entry of draft.request_journal) {
		const decoded = decodeJeroRequestJournalEntryV1(entry);
		if (keys.has(decoded.idempotency_key)) throw new JeroLineageStoreError("Request journal idempotency keys must be unique");
		keys.add(decoded.idempotency_key);
		if (decoded.status === "pending") pending += 1;
	}
	if (pending > 1) throw new JeroLineageStoreError("Only one pending operation may exist per lineage");
}

export interface JeroLineageSaveOptionsV1 {
	/** 调用方观察到的修订号；仅在创建血脉时为 `null`。 */
	expectedRevision: string | null;
}

export interface JeroLineageSaveResultV1 {
	revision: string;
}

export interface JeroJournaledOperationOptionsV1<TResult> {
	lineageId: string;
	operation: JeroAuthorityOperation;
	idempotencyKey: string;
	requestHash: string;
	authorization?: unknown;
	/** 从当前记录生成下一个血脉草稿与操作结果。 */
	apply: (record: JeroLineageStateFileV1) => { draft: JeroLineageDraftV1; result: TResult };
}

export class JeroLineageStoreV1 {
	readonly root: string;
	readonly #lock: JeroAuthorityLocksV1 | undefined;

	constructor(lineagesRoot: string, options: JeroLineageStoreOptionsV1 = {}) {
		this.root = lineagesRoot;
		this.#lock = options.lock;
	}

	static forStore(storeRoot: string, options: JeroLineageStoreOptionsV1 = {}): JeroLineageStoreV1 {
		return new JeroLineageStoreV1(join(storeRoot, "lineages"), options);
	}

	private statePath(lineageId: string): string {
		assertLineageId(lineageId);
		return join(this.root, lineageId, JERO_LINEAGE_STATE_FILENAME);
	}

	private withAuthorityLock<T>(action: () => T): T {
		if (!this.#lock) return action();
		const owner = this.#lock.acquire();
		try {
			return action();
		} finally {
			this.#lock.release(owner);
		}
	}

	/**
	 * 加载持久化的血脉记录。记录缺失为 `"missing"`；任何无法解码的内容
	 * ——非权威 JSON、严格解码失败、修订号哈希不匹配、血脉身份不匹配
	 * ——都是 `"corrupted"`，且每个变更类 API 都拒绝触碰它（保守失败）。
	 */
	load(lineageId: string): JeroLineageLoadResultV1 {
		assertLineageId(lineageId);
		let bytes: Buffer;
		try {
			bytes = readFileSync(this.statePath(lineageId));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
			return { kind: "corrupted", detail: "Lineage state file is unreadable" };
		}
		try {
			const parsed = parseCanonicalJsonV1(bytes) as Record<string, unknown>;
			if (parsed.schema !== JERO_LINEAGE_STATE_SCHEMA) throw new Error(`unsupported schema ${JSON.stringify(parsed.schema)}`);
			if (parsed.lineage_id !== lineageId) throw new Error("lineage identity mismatch");
			const state = decodeJeroReviewTransactionStateV1(parsed.state);
			if (!Array.isArray(parsed.request_journal)) throw new Error("request_journal is not an array");
			const request_journal = parsed.request_journal.map((entry) => decodeJeroRequestJournalEntryV1(entry));
			const draft: JeroLineageDraftV1 = { state, request_journal };
			validateDraft(lineageId, draft);
			const revision = parsed.revision;
			if (typeof revision !== "string" || !REVISION_PATTERN.test(revision)) throw new Error("revision is not a canonical revision identity");
			if (computeJeroLineageRevisionV1(draft) !== revision) throw new Error("revision does not match the record content");
			return { kind: "ok", record: { schema: JERO_LINEAGE_STATE_SCHEMA, lineage_id: lineageId, revision, ...draft } };
		} catch (error) {
			return { kind: "corrupted", detail: error instanceof Error ? error.message : String(error) };
		}
	}

	/**
	 * 以观察到的修订号原子持久化血脉草稿。修订号从草稿内容重新计算，
	 * 因此每次保存都会推进它（日志只追加）；不匹配的 expectedRevision
	 * 以过期修订号保守失败。
	 */
	save(lineageId: string, draft: JeroLineageDraftV1, options: JeroLineageSaveOptionsV1): JeroLineageSaveResultV1 {
		return this.withAuthorityLock(() => this.saveUnlocked(lineageId, draft, options));
	}

	private saveUnlocked(lineageId: string, draft: JeroLineageDraftV1, options: JeroLineageSaveOptionsV1): JeroLineageSaveResultV1 {
		assertLineageId(lineageId);
		validateDraft(lineageId, draft);
		const loaded = this.load(lineageId);
		if (loaded.kind === "corrupted") throw new JeroLineageStoreError(`Lineage state is corrupted: ${loaded.detail}`);
		if (loaded.kind === "ok") {
			if (options.expectedRevision === null || options.expectedRevision !== loaded.record.revision) {
				throw new JeroLineageStoreError(`Stale lineage revision: expected ${options.expectedRevision ?? "<creation>"}, authority holds ${loaded.record.revision}`);
			}
		} else if (options.expectedRevision !== null) {
			throw new JeroLineageStoreError(`Stale lineage revision: expected ${options.expectedRevision}, lineage does not exist`);
		}
		const record: JeroLineageStateFileV1 = {
			schema: JERO_LINEAGE_STATE_SCHEMA,
			lineage_id: lineageId,
			revision: computeJeroLineageRevisionV1(draft),
			state: cloneCanonical(draft.state),
			request_journal: cloneCanonical(draft.request_journal),
		};
		const directory = join(this.root, lineageId);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const destination = join(directory, JERO_LINEAGE_STATE_FILENAME);
		try {
			const observed = lstatSync(destination);
			if (!observed.isFile()) throw new Error("not a regular file");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new JeroLineageStoreError(`Lineage state path cannot be safely replaced: ${error instanceof Error ? error.message : String(error)}`);
		}
		const temporary = join(directory, `.${JERO_LINEAGE_STATE_FILENAME}.${randomUUID()}.tmp`);
		const descriptor = openSync(temporary, WRITE_EXCLUSIVE, 0o600);
		try {
			try {
				writeFileSync(descriptor, canonicalJsonV1(record));
			} finally {
				closeSync(descriptor);
			}
			renameSync(temporary, destination);
		} finally {
			try {
				unlinkSync(temporary);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new JeroLineageStoreError("Lineage state temporary file could not be removed");
			}
		}
		return { revision: record.revision };
	}

	private mustLoad(lineageId: string): JeroLineageStateFileV1 {
		const loaded = this.load(lineageId);
		if (loaded.kind === "missing") throw new JeroLineageStoreError("Lineage does not exist");
		if (loaded.kind === "corrupted") throw new JeroLineageStoreError(`Lineage state is corrupted: ${loaded.detail}`);
		return loaded.record;
	}

	private findEntry(record: JeroLineageStateFileV1, idempotencyKey: string): { entry: JeroRequestJournalEntryV1; index: number } | undefined {
		const index = record.request_journal.findIndex((entry) => entry.idempotency_key === idempotencyKey);
		return index < 0 ? undefined : { entry: record.request_journal[index]!, index };
	}

	private assertReplayable(entry: JeroRequestJournalEntryV1, operation: JeroAuthorityOperation, requestHash: string): void {
		if (entry.operation !== operation || entry.request_hash !== requestHash) {
			throw new JeroLineageStoreError("Idempotency key was reused with a different request");
		}
	}

	private assertNoPendingOperation(record: JeroLineageStateFileV1): void {
		if (record.request_journal.some((entry) => entry.status === "pending")) {
			throw new JeroLineageStoreError("Unresolved pending operation blocks mutation");
		}
	}

	/**
	 * 在权威锁内把一个记日志操作运行到完成：精确的
	 * (idempotency_key, request_hash) 重放不经重新应用即返回存储的
	 * canonical_result；键被不同请求复用、任何 pending 条目、血脉缺失
	 * 或记录损坏都以保守失败收场。
	 */
	runOperation<TResult>(options: JeroJournaledOperationOptionsV1<TResult>): { result: TResult; revision: string } {
		assertIdempotencyKey(options.idempotencyKey);
		assertRequestHash(options.requestHash);
		return this.withAuthorityLock(() => {
			const current = this.mustLoad(options.lineageId);
			const existing = this.findEntry(current, options.idempotencyKey);
			if (existing) {
				this.assertReplayable(existing.entry, options.operation, options.requestHash);
				if (existing.entry.status === "pending") throw new JeroLineageStoreError("Unresolved pending operation blocks replay");
				return { result: cloneCanonical(existing.entry.canonical_result) as TResult, revision: current.revision };
			}
			this.assertNoPendingOperation(current);
			const applied = options.apply(cloneCanonical(current));
			this.assertJournalExtends(options.lineageId, current.request_journal, applied.draft.request_journal);
			const result = cloneCanonical(applied.result);
			const draft: JeroLineageDraftV1 = {
				state: applied.draft.state,
				request_journal: [...applied.draft.request_journal, {
					operation: options.operation,
					idempotency_key: options.idempotencyKey,
					request_hash: options.requestHash,
					status: "completed",
					canonical_result: result,
				}],
			};
			const saved = this.saveUnlocked(options.lineageId, draft, { expectedRevision: current.revision });
			return { result, revision: saved.revision };
		});
	}

	/**
	 * 在操作效果存在之前（崩溃窗口）持久记录一个 PENDING 日志条目。
	 * pending 期间复用该键保守失败；完成经由 `completeOperation`。
	 */
	prepareOperation(options: Omit<JeroJournaledOperationOptionsV1<unknown>, "apply">): { revision: string } {
		assertIdempotencyKey(options.idempotencyKey);
		assertRequestHash(options.requestHash);
		return this.withAuthorityLock(() => {
			const current = this.mustLoad(options.lineageId);
			const existing = this.findEntry(current, options.idempotencyKey);
			if (existing) {
				this.assertReplayable(existing.entry, options.operation, options.requestHash);
				throw new JeroLineageStoreError(existing.entry.status === "pending" ? "Unresolved pending operation blocks replay" : "Completed operation cannot be reopened");
			}
			this.assertNoPendingOperation(current);
			const entry: JeroRequestJournalEntryV1 = {
				operation: options.operation,
				idempotency_key: options.idempotencyKey,
				request_hash: options.requestHash,
				status: "pending",
				...(options.authorization === undefined ? {} : { authorization: cloneCanonical(options.authorization) }),
			};
			const saved = this.saveUnlocked(options.lineageId, { state: current.state, request_journal: [...current.request_journal, entry] }, { expectedRevision: current.revision });
			return { revision: saved.revision };
		});
	}

	/** 完成一个已准备（pending）的操作；精确的完成重放是稳定的。 */
	completeOperation<TResult>(options: JeroJournaledOperationOptionsV1<TResult>): { result: TResult; revision: string } {
		assertIdempotencyKey(options.idempotencyKey);
		assertRequestHash(options.requestHash);
		return this.withAuthorityLock(() => {
			const current = this.mustLoad(options.lineageId);
			const existing = this.findEntry(current, options.idempotencyKey);
			if (!existing) throw new JeroLineageStoreError("Pending operation was not found");
			this.assertReplayable(existing.entry, options.operation, options.requestHash);
			if (existing.entry.status === "completed") {
				return { result: cloneCanonical(existing.entry.canonical_result) as TResult, revision: current.revision };
			}
			const applied = options.apply(cloneCanonical(current));
			this.assertJournalExtends(options.lineageId, current.request_journal, applied.draft.request_journal, existing.index);
			const result = cloneCanonical(applied.result);
			const request_journal = [...current.request_journal];
			request_journal[existing.index] = {
				...existing.entry,
				status: "completed",
				canonical_result: result,
			};
			const saved = this.saveUnlocked(options.lineageId, { state: applied.draft.state, request_journal }, { expectedRevision: current.revision });
			return { result, revision: saved.revision };
		});
	}

	/**
	 * 日志只增不减：apply() 草稿必须在权威意义上扩展已加载的日志
	 * （精确前缀、相同长度）。完成操作时，位于 `mutatedIndex` 的条目是
	 * 唯一允许的就地 pending→completed 转移。镜像
	 * review-transaction.ts 中上游的只追加守卫。
	 */
	private assertJournalExtends(lineageId: string, previous: readonly JeroRequestJournalEntryV1[], applied: readonly JeroRequestJournalEntryV1[], mutatedIndex = -1): void {
		if (applied.length !== previous.length) throw new JeroLineageStoreError(`apply() must preserve journal length for ${lineageId} (got ${applied.length}, expected ${previous.length})`);
		for (let index = 0; index < previous.length; index += 1) {
			if (index === mutatedIndex) continue;
			if (canonicalJsonV1(applied[index]) !== canonicalJsonV1(previous[index])) {
				throw new JeroLineageStoreError(`apply() mutated journal entry ${index} for ${lineageId}`);
			}
		}
	}

/** 列出存储下持久化的血脉 id（已排序、已校验）。 */
	list(): string[] {
		let entries: string[];
		try {
			entries = readdirSync(this.root);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw new JeroLineageStoreError("Lineage store root is unreadable");
		}
		return entries.filter(isJeroLineageId).toSorted();
	}
}
