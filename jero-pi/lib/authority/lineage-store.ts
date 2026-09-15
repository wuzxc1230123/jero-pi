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

// Lineage state persistence for the jero authority store:
// `lineages/<lineage-id>/review-state.json`.
//
// The persisted record is a `jero.authority.lineage-state/v1` envelope
// carrying the lineage state record plus the embedded request journal and a
// content-derived revision (`sha256:` + jeroDomainHash("revision", record
// minus revision)). Every save is an optimistic-concurrency transition: the
// caller must present the revision it observed, and any mismatch fails
// closed as a stale revision. Writes are atomic (O_EXCL 0o600 temp file,
// rename, temp unlinked in `finally`) mirroring the orchestrator-presence
// atomicWrite pattern; mutating APIs run under the authority mutation lock
// when one is provided (see locks.ts). Saves are replace-atomic, NOT
// fsync-durable: a crash may lose the newest revision (surfacing as a stale
// revision or corrupted-record refusal), never a torn one.
//
// Journal semantics mirror review-transaction.ts: exact
// (idempotency_key, request_hash) replay returns the stored
// canonical_result; key reuse with a different request fails closed; a
// pending entry blocks every new mutating operation and is crash-completable.

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
	/** Authority mutation lock; every mutating API runs inside it when provided. */
	lock?: JeroAuthorityLocksV1;
}

function cloneCanonical<T>(value: T): T {
	return JSON.parse(canonicalJsonV1(value)) as T;
}

/** Content-derived revision of a lineage draft: `sha256:<jeroDomainHash("revision", draft)>`. */
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
	/** Revision the caller observed; `null` only when creating the lineage. */
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
	/** Produces the next lineage draft and the operation result from the current record. */
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
	 * Loads the persisted lineage record. A missing record is `"missing"`;
	 * anything undecodable — non-canonical JSON, strict-decode failure,
	 * revision-hash mismatch, lineage identity mismatch — is `"corrupted"`
	 * and every mutating API refuses to touch it (fail-closed).
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
	 * Atomically persists a lineage draft at its observed revision. The
	 * revision is recomputed from the draft content, so every save advances
	 * it (the journal is append-only); a mismatched expectedRevision fails
	 * closed as a stale revision.
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
	 * Runs a journaled operation to completion under the authority lock:
	 * exact (idempotency_key, request_hash) replay returns the stored
	 * canonical_result without re-applying; key reuse with a different
	 * request, any pending entry, a missing lineage, or a corrupted record
	 * fails closed.
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
	 * Durably records a PENDING journal entry before the operation's effect
	 * exists (crash window). Reusing the key while pending fails closed;
	 * completion goes through `completeOperation`.
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

	/** Completes a prepared (pending) operation; exact completion replay is stable. */
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
	 * Journals only ever grow: the apply() draft must canonically extend the
	 * loaded journal (exact prefix, same length). For completion the entry at
	 * `mutatedIndex` is the one allowed in-place pending→completed transition.
	 * Mirrors the upstream append-only guard in review-transaction.ts.
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

	/** Lists lineage ids persisted under the store (sorted, validated). */
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
