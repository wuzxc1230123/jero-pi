// 评审事务存储：ReviewTransactionStore——图对象存储、变更锁、操作日志与权威回执铸造。
// 自 lib/review-transaction.ts 拆分（机械平移，语义零改动）。

import {
	existsSync
} from "node:fs";
import {
	join,
	resolve
} from "node:path";
import {
	type ReviewLockPlatformAdapterV1,
	ReviewMutationLockV1
} from "./review-lock.ts";
import {
	ReviewGraphObjectStoreV1
} from "./review-object-store.ts";
import {
	createReviewEventV1
} from "./review-graph-schema.ts";
import {
	type RepositoryAuthorityV1,
	resolveRepositoryAuthorityV1
} from "./review-repository.ts";
import {
	GATE_RESULT
} from "./review-publication-gate.ts";
import {
	assertLineageId,
	authoritativeReceiptBrand,
	type AuthoritativeReceiptV1,
	type BeginReducerOperationOptions,
	canonicalHash,
	cloneCanonical,
	type CompleteReducerOperationOptions,
	type GateResultV1,
	JOURNAL_STATUS,
	type ReducerOperationResultV1,
	type RequestJournalEntryV1,
	REVIEW_OPERATION,
	REVIEW_PHASE,
	ReviewIntegrityError,
	type ReviewOperation,
	type ReviewStateV1,
	type RunReducerOperationOptions,
	type StartOperationResultV1,
	STORE_FAULT_POINT,
	type StoreFaultPoint
} from "./review-transaction-schema.ts";
import {
	assertReceiptIntegrity,
	assertState,
	createScopeChildClaim,
	operationForTransition,
	reduceReviewState,
	reducerOperationResult,
	repositoryRootForGate,
	validateReviewGraphReplayV1
} from "./review-transaction-reducer.ts";
import {
	assertReceiptMatchesState,
	createReceiptForState,
	deniedGateResult,
	evaluateGateTarget,
	inspectGateTarget,
	type ValidateReviewGateOptions
} from "./review-transaction-gate.ts";

interface ReviewTransactionStoreOptions {
	faultInjector?: (point: StoreFaultPoint) => void;
	mutationLockPlatform?: ReviewLockPlatformAdapterV1;
}

let mutationLockPlatformForTesting: ReviewLockPlatformAdapterV1 | undefined;

/** @internal 仅供测试注入，用于在没有原生平台适配器的情况下演练图权威。 */
export function setReviewMutationLockPlatformForTesting(
	platform: ReviewLockPlatformAdapterV1 | undefined,
): void {
	mutationLockPlatformForTesting = platform;
}

interface RunOperationResult<TResult> {
	state: ReviewStateV1;
	result: TResult;
}

interface RunOperationOptions<TRequest, TResult> {
	lineageId: string;
	operation: ReviewOperation;
	idempotencyKey: string;
	request: TRequest;
	beforeReplay?: () => void;
	apply: (state: ReviewStateV1) => RunOperationResult<TResult>;
}

export class ReviewTransactionStore {
	readonly root: string;
	readonly faultInjector?: (point: StoreFaultPoint) => void;
	readonly #authority: RepositoryAuthorityV1;
	readonly #authorityCwd: string;
	readonly #graphStore: ReviewGraphObjectStoreV1;
	readonly #mutationLock: ReviewMutationLockV1;

	private constructor(options: ReviewTransactionStoreOptions, authority: RepositoryAuthorityV1, authorityCwd: string) {
		this.root = join(authority.store_root, "graph-v1");
		this.faultInjector = options.faultInjector;
		this.#authority = authority;
		this.#authorityCwd = authorityCwd;
		this.#graphStore = new ReviewGraphObjectStoreV1(this.root, authority.repository_id, authority.authority_id, {
			faultInjector: (point) => {
				if (point === "before-current-slot-1-replace") this.faultInjector?.(STORE_FAULT_POINT.BEFORE_HEAD_RENAME);
			},
		});
		this.#mutationLock = new ReviewMutationLockV1(join(authority.store_root, "control"), authority.repository_id, authority.authority_id, options.mutationLockPlatform);
	}

	static forRepository(
		cwd: string,
		options: Pick<ReviewTransactionStoreOptions, "faultInjector" | "mutationLockPlatform"> = {},
	): ReviewTransactionStore {
		const authority = resolveRepositoryAuthorityV1(cwd);
		// jero-pi：上游的旧存储检测已随二进制一起删除。
		// 外部权威存储拒绝（design §5.1.6）将在
		// P2 落到 lib/authority 存储中。
		return new ReviewTransactionStore({ faultInjector: options.faultInjector, mutationLockPlatform: options.mutationLockPlatform ?? mutationLockPlatformForTesting }, authority, cwd);
	}

	readCurrentAuthority(): ReturnType<ReviewGraphObjectStoreV1["readCurrent"]> {
		return this.#graphStore.readCurrent();
	}

	repairCurrentAuthority(): void {
		this.withLock("authority-repair", () => this.#graphStore.repairCurrentPointers());
	}

	create(
		initialState: ReviewStateV1,
		idempotencyKey: string,
	): StartOperationResultV1 {
		assertState(initialState);
		if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
			throw new ReviewIntegrityError("Lineage start requires an idempotency key");
		}
		if (
			initialState.revision !== 0 ||
			initialState.request_journal.length !== 0 ||
			initialState.phase !== REVIEW_PHASE.STARTED ||
			initialState.terminal_state !== undefined ||
			initialState.frozen_ledger !== undefined
		) {
			throw new ReviewIntegrityError("A new lineage must start only through a clean started state");
		}
		const requestHash = canonicalHash(initialState);
		const result: StartOperationResultV1 = {
			lineage_id: initialState.lineage_id,
			revision: 0,
			phase: REVIEW_PHASE.STARTED,
		};
		return this.withLock(initialState.lineage_id, () => {
			const started: ReviewStateV1 = {
				...cloneCanonical(initialState),
				request_journal: [
					{
						operation: REVIEW_OPERATION.START,
						idempotency_key: idempotencyKey,
						request_hash: requestHash,
						status: JOURNAL_STATUS.COMPLETED,
						canonical_result: result,
					},
				],
			};
			assertState(started);
			this.writeRevision(started, undefined, { transition: "start", input: started });
			return cloneCanonical(result);
		});
	}

	read(lineageId: string): ReviewStateV1 {
		assertLineageId(lineageId);
		return this.readUnlocked(lineageId);
	}

	runReducerOperation(
		options: RunReducerOperationOptions,
	): ReducerOperationResultV1 {
		const operation = operationForTransition(options.transition);
		return this.#runCompletedOperation({
			lineageId: options.lineageId,
			operation,
			idempotencyKey: options.idempotencyKey,
			request: { transition: options.transition, input: options.input },
			apply(current) {
				const reduced = reduceReviewState(current, options.transition, options.input);
				return {
					state: reduced,
					result: reducerOperationResult(reduced, current.revision + 1),
				};
			},
		});
	}

	beginReducerOperation<TRequest>(
		options: BeginReducerOperationOptions<TRequest>,
	): void {
		const operation = operationForTransition(options.transition);
		this.withLock(options.lineageId, () => {
			const current = this.readUnlocked(options.lineageId);
			const requestHash = canonicalHash({
				transition: options.transition,
				request: options.request,
			});
			const existing = current.request_journal.find(
				(entry) => entry.idempotency_key === options.idempotencyKey,
			);
			if (existing) {
				if (existing.operation !== operation || existing.request_hash !== requestHash) {
					throw new ReviewIntegrityError("Idempotency key was reused with a different request");
				}
				throw new ReviewIntegrityError(
					existing.status === JOURNAL_STATUS.PENDING
						? "Unresolved pending operation blocks replay"
						: "Completed operation cannot be reopened",
				);
			}
			this.assertNoPendingOperation(current);
			const entry: RequestJournalEntryV1 = {
				operation,
				idempotency_key: options.idempotencyKey,
				request_hash: requestHash,
				status: JOURNAL_STATUS.PENDING,
			};
			if (options.authorization !== undefined) {
				entry.authorization = cloneCanonical(options.authorization);
			}
			const next: ReviewStateV1 = {
				...current,
				revision: current.revision + 1,
				request_journal: [...current.request_journal, entry],
			};
			assertState(next, current);
			this.writeRevision(next, current, { transition: "operation-prepared", input: { transition: options.transition, request: options.request } });
		});
	}

	completeReducerOperation<TRequest>(
		options: CompleteReducerOperationOptions<TRequest>,
	): ReducerOperationResultV1 {
		const operation = operationForTransition(options.transition);
		return this.withLock(options.lineageId, () => {
			const current = this.readUnlocked(options.lineageId);
			const requestHash = canonicalHash({
				transition: options.transition,
				request: options.request,
			});
			const index = current.request_journal.findIndex(
				(entry) => entry.idempotency_key === options.idempotencyKey,
			);
			if (index < 0) throw new ReviewIntegrityError("Pending reducer operation was not found");
			const existing = current.request_journal[index]!;
			if (existing.operation !== operation || existing.request_hash !== requestHash) {
				throw new ReviewIntegrityError("Idempotency key was reused with a different request");
			}
			if (existing.status === JOURNAL_STATUS.COMPLETED) {
				return cloneCanonical(existing.canonical_result) as ReducerOperationResultV1;
			}
			const reduced = reduceReviewState(current, options.transition, options.input);
			const result = reducerOperationResult(reduced, current.revision + 1);
			const completed: RequestJournalEntryV1 = {
				...existing,
				status: JOURNAL_STATUS.COMPLETED,
				canonical_result: cloneCanonical(result),
			};
			const journal = [...current.request_journal];
			journal[index] = completed;
			const next: ReviewStateV1 = {
				...cloneCanonical(reduced),
				revision: current.revision + 1,
				request_journal: journal,
			};
			assertState(next, current);
			this.writeRevision(next, current, { transition: options.transition, input: options.input });
			return cloneCanonical(result);
		});
	}

	#validateGate(
		options: Omit<ValidateReviewGateOptions, "store">,
		beforeReplay?: () => void,
	): GateResultV1 {
		const targetHash = canonicalHash(options.target);
		const repositoryRoot = repositoryRootForGate(options.repositoryCwd);
		return this.#runCompletedOperation({
			lineageId: options.receipt.body.lineage_id,
			operation: REVIEW_OPERATION.GATE,
			idempotencyKey: options.idempotencyKey,
			request: {
				receipt_hash: options.receipt.receipt_hash,
				target_hash: targetHash,
				repository_root: repositoryRoot,
				actual_intended_commit_tree: options.actualIntendedCommitTree ?? null,
			},
			beforeReplay,
			apply(state) {
				assertReceiptIntegrity(options.receipt);
				assertReceiptMatchesState(options.receipt, state);
				const evaluated = evaluateGateTarget(
					options.receipt,
					options.target,
					repositoryRoot,
					options.actualIntendedCommitTree,
				);
				if (evaluated.status !== GATE_RESULT.SCOPE_CHANGED) {
					return { state, result: evaluated };
				}
				const inspection = inspectGateTarget(
					options.target,
					options.receipt,
					repositoryRoot,
					options.actualIntendedCommitTree,
				);
				if (!inspection.targetTree) {
					return {
						state,
						result: deniedGateResult(
							options.receipt.receipt_hash,
							targetHash,
							"Changed scope does not resolve to one target tree.",
						),
					};
				}
				const existingClaim = state.child_claims?.find(
					(claim) => claim.target_tree === inspection.targetTree,
				);
				const childClaim = existingClaim ?? createScopeChildClaim(
					state.lineage_id,
					inspection.targetTree,
					options.scopeBudget,
				);
				const next = existingClaim
					? state
					: {
						...state,
						child_claims: [...(state.child_claims ?? []), childClaim],
					};
				return {
					state: next,
					result: { ...evaluated, child_claim: childClaim },
				};
			},
		});
	}

	#runCompletedOperation<TRequest, TResult>(
		options: RunOperationOptions<TRequest, TResult>,
	): TResult {
		return this.withLock(options.lineageId, () => {
			const current = this.readUnlocked(options.lineageId);
			const requestHash = canonicalHash(options.request);
			const existing = current.request_journal.find(
				(entry) => entry.idempotency_key === options.idempotencyKey,
			);
			if (existing) {
				if (existing.operation !== options.operation || existing.request_hash !== requestHash) {
					throw new ReviewIntegrityError("Idempotency key was reused with a different request");
				}
				if (existing.status === JOURNAL_STATUS.PENDING) {
					throw new ReviewIntegrityError("Unresolved pending operation blocks replay");
				}
				return cloneCanonical(existing.canonical_result) as TResult;
			}
			options.beforeReplay?.();
			this.assertNoPendingOperation(current);
			const applied = options.apply(cloneCanonical(current));
			const result = cloneCanonical(applied.result);
			const journalEntry: RequestJournalEntryV1 = {
				operation: options.operation,
				idempotency_key: options.idempotencyKey,
				request_hash: requestHash,
				status: JOURNAL_STATUS.COMPLETED,
				canonical_result: result,
			};
			const next: ReviewStateV1 = {
				...cloneCanonical(applied.state),
				revision: current.revision + 1,
				request_journal: [...current.request_journal, journalEntry],
			};
			assertState(next, current);
			const request = options.request as { transition?: unknown; input?: unknown };
			this.writeRevision(next, current, { transition: typeof request.transition === "string" ? request.transition : options.operation, input: "input" in request ? request.input : options.request });
			return result;
		});
	}

	private readUnlocked(lineageId: string): ReviewStateV1 {
		return this.readGraphState(lineageId);
	}

	private assertNoPendingOperation(state: ReviewStateV1): void {
		if (state.request_journal.some((entry) => entry.status === JOURNAL_STATUS.PENDING)) {
			throw new ReviewIntegrityError("Unresolved pending operation blocks mutation");
		}
	}

	private withLock<T>(lockId: string, action: () => T): T {
		assertLineageId(lockId);
		this.assertCurrentRepositoryAuthority();
		const owner = this.#mutationLock.acquire();
		try {
			return action();
		} finally {
			this.#mutationLock.release(owner);
		}
	}

	private assertCurrentRepositoryAuthority(): void {
		const current = resolveRepositoryAuthorityV1(this.#authorityCwd);
		if (
			current.common_directory !== this.#authority.common_directory ||
			current.repository_id !== this.#authority.repository_id ||
			current.authority_id !== this.#authority.authority_id
		) {
			throw new ReviewIntegrityError("Repository authority changed before graph mutation");
		}
	}

	private writeRevision(next: ReviewStateV1, previous?: ReviewStateV1, eventContext?: { transition: string; input: unknown }): void {
		this.writeGraphState(next, previous, eventContext);
	}

	private readGraphState(lineageId: string): ReviewStateV1 {
		const root = this.#graphStore.readCurrent();
		const descriptor = existsSync(join(this.#graphStore.root, "STORE")) ? this.#graphStore.readStoreDescriptor() : undefined;
		if (descriptor && (root.body.store_epoch !== descriptor.store_epoch || root.body.authority_incarnation_id !== descriptor.authority_incarnation_id || root.body.initialized_by_reset_id !== descriptor.initialized_by_reset_id)) throw new ReviewIntegrityError("Graph root does not match the live authority incarnation");
		const entry = (root.body.lineages as Array<Record<string, unknown>>).find((value) => value.lineage_id === lineageId && value.mode === "graph");
		if (!entry || typeof entry.head_event_id !== "string" || typeof entry.sequence !== "number" || typeof entry.reduced_state_hash !== "string") throw new ReviewIntegrityError("Graph lineage is missing from authoritative root set");
		let eventId: string | null = entry.head_event_id;
		let expectedSequence = entry.sequence;
		const reversed: Array<{ event: ReturnType<ReviewGraphObjectStoreV1["readEvent"]>; state: ReviewStateV1 }> = [];
		const seen = new Set<string>();
		while (eventId !== null) {
			if (seen.has(eventId)) throw new ReviewIntegrityError("Graph predecessor closure contains a cycle");
			seen.add(eventId);
			const event = this.#graphStore.readEvent(eventId);
			if (descriptor && (event.body.store_epoch !== descriptor.store_epoch || event.body.authority_incarnation_id !== descriptor.authority_incarnation_id || event.body.initialized_by_reset_id !== descriptor.initialized_by_reset_id)) throw new ReviewIntegrityError("Graph event does not match the live authority incarnation");
			if (event.body.lineage_id !== lineageId || event.body.sequence !== expectedSequence) throw new ReviewIntegrityError("Graph predecessor closure is discontinuous");
			const payload = event.body.payload as { state?: ReviewStateV1 };
			if (!payload || !payload.state || canonicalHash(payload.state) !== event.body.reduced_state_hash) throw new ReviewIntegrityError("Graph event state reduction is invalid");
			if (payload.state.lineage_id !== lineageId || payload.state.revision !== event.body.sequence) throw new ReviewIntegrityError("Graph event does not match lineage state");
			reversed.push({ event, state: payload.state });
			if (event.body.sequence === 0) {
				if (event.body.predecessor_event_id !== null || event.body.kind !== "lineage-created") throw new ReviewIntegrityError("Graph genesis is invalid");
				break;
			}
			eventId = event.body.predecessor_event_id;
			expectedSequence -= 1;
		}
		const ordered = reversed.reverse();
		let headState: ReviewStateV1;
		try { headState = validateReviewGraphReplayV1(ordered.map(({ event }) => event)); }
		catch (error) { throw new ReviewIntegrityError(`Authoritative graph semantic replay failed: ${error instanceof Error ? error.message : String(error)}`); }
		if (expectedSequence !== 0 || canonicalHash(headState) !== entry.reduced_state_hash) throw new ReviewIntegrityError("Graph root entry does not bind a complete reduced state");
		return cloneCanonical(headState);
	}

	private writeGraphState(next: ReviewStateV1, previous?: ReviewStateV1, eventContext?: { transition: string; input: unknown }): void {
		const graph = this.#graphStore;
		let current: ReturnType<ReviewGraphObjectStoreV1["readCurrent"]> | undefined;
		try { current = graph.readCurrent(); } catch {}
		const existing = current ? (current.body.lineages as Array<Record<string, unknown>>).find((value) => value.lineage_id === next.lineage_id && value.mode === "graph") : undefined;
		if (previous && !existing) throw new ReviewIntegrityError("Graph predecessor is missing");
		if (!previous && existing) throw new ReviewIntegrityError("Graph lineage already exists");
		const rawPredecessor = existing?.head_event_id;
		if (rawPredecessor !== undefined && typeof rawPredecessor !== "string") throw new ReviewIntegrityError("Graph head is invalid");
		const predecessor = rawPredecessor as string | undefined;
		const last = next.request_journal.at(-1);
		const descriptor = (() => { try { return graph.readStoreDescriptor(); } catch { return undefined; } })();
		const reducerTransition = eventContext?.transition ?? (predecessor === undefined ? "start" : last?.operation ?? "state-update");
		const reducerInput = eventContext === undefined ? (predecessor === undefined ? cloneCanonical(next) : { request_hash: last?.request_hash }) : cloneCanonical(eventContext.input);
		const event = createReviewEventV1({ ...(descriptor === undefined ? {} : { store_epoch: descriptor.store_epoch, authority_incarnation_id: descriptor.authority_incarnation_id, initialized_by_reset_id: descriptor.initialized_by_reset_id }), lineage_id: next.lineage_id, sequence: next.revision, predecessor_event_id: predecessor ?? null, kind: predecessor === undefined ? "lineage-created" : last?.status === JOURNAL_STATUS.PENDING ? "operation-prepared" : last?.operation === REVIEW_OPERATION.GATE ? "gate-evaluated" : "operation-completed", reducer_transition: reducerTransition, reducer_input: reducerInput, payload: { state: cloneCanonical(next) }, reduced_state_hash: canonicalHash(next) });
		graph.installEvent(event);
		const lineages = [...(current?.body.lineages as Array<Record<string, unknown>> ?? []).filter((value) => value.lineage_id !== next.lineage_id), { lineage_id: next.lineage_id, mode: "graph", head_event_id: event.event_id, sequence: next.revision, reduced_state_hash: event.body.reduced_state_hash }].toSorted((a, b) => String(a.lineage_id).localeCompare(String(b.lineage_id)));
		const root = graph.installRootSet({ schema: "gentle-ai.review-root-set/v1", repository_id: this.#authority.repository_id, authority_id: this.#authority.authority_id, ...(descriptor === undefined ? {} : { store_epoch: descriptor.store_epoch, authority_incarnation_id: descriptor.authority_incarnation_id, initialized_by_reset_id: descriptor.initialized_by_reset_id }), generation: current ? current.body.generation + 1 : 0, predecessor_root_set_id: current ? current.root_set_id : null, lineages });
		graph.publishRootSet(root);
	}

	createAuthoritativeReceipt(lineageId: string): AuthoritativeReceiptV1 {
		const state = this.read(lineageId);
		const envelope = createReceiptForState(state);
		const root = this.#graphStore.readCurrent();
		const entry = (root.body.lineages as Array<Record<string, unknown>>).find((value) => value.lineage_id === lineageId && value.mode === "graph");
		if (!entry || typeof entry.head_event_id !== "string") throw new ReviewIntegrityError("Authoritative graph head is missing");
		const descriptor = (() => { try { return this.#graphStore.readStoreDescriptor(); } catch { return undefined; } })();
		const body = { receipt_hash: envelope.receipt_hash, repository_id: this.#authority.repository_id, authority_id: this.#authority.authority_id, common_directory: this.#authority.common_directory, root_set_id: root.root_set_id, head_event_id: entry.head_event_id, ...(descriptor === undefined ? {} : { store_epoch: descriptor.store_epoch, authority_incarnation_id: descriptor.authority_incarnation_id }) };
		return Object.freeze({ [authoritativeReceiptBrand]: true as const, envelope, repository_id: this.#authority.repository_id, authority_id: this.#authority.authority_id, common_directory: this.#authority.common_directory, root_set_id: root.root_set_id, head_event_id: entry.head_event_id, ...(descriptor === undefined ? {} : { store_epoch: descriptor.store_epoch, authority_incarnation_id: descriptor.authority_incarnation_id }), authority_receipt_hash: canonicalHash(body) });
	}

	validateAuthoritativeGate(options: Omit<ValidateReviewGateOptions, "store" | "receipt"> & { receipt: AuthoritativeReceiptV1 }): GateResultV1 {
		if (options.receipt[authoritativeReceiptBrand] !== true) throw new ReviewIntegrityError("Lifecycle gates require a branded authoritative receipt");
		const gateAuthority = resolveRepositoryAuthorityV1(options.repositoryCwd);
		if (gateAuthority.common_directory !== this.#authority.common_directory || gateAuthority.repository_id !== options.receipt.repository_id || gateAuthority.authority_id !== options.receipt.authority_id) throw new ReviewIntegrityError("Gate repository authority does not match receipt authority");
		return this.#validateGate({ ...options, receipt: options.receipt.envelope }, () => {
			const descriptor = (() => { try { return this.#graphStore.readStoreDescriptor(); } catch { return undefined; } })();
			if ((options.receipt.store_epoch !== undefined || options.receipt.authority_incarnation_id !== undefined) && (!descriptor || options.receipt.store_epoch !== descriptor.store_epoch || options.receipt.authority_incarnation_id !== descriptor.authority_incarnation_id)) throw new ReviewIntegrityError("REVIEW_RECEIPT_EPOCH_MISMATCH");
			const currentRoot = this.#graphStore.readCurrent();
			const currentEntry = (currentRoot.body.lineages as Array<Record<string, unknown>>).find((value) => value.lineage_id === options.receipt.envelope.body.lineage_id && value.mode === "graph");
			if (!currentEntry || currentRoot.root_set_id !== options.receipt.root_set_id || currentEntry.head_event_id !== options.receipt.head_event_id) throw new ReviewIntegrityError("Authoritative receipt is stale or unbound from the current graph head");
		});
	}

}

