// 评审事务 reducer：冻结台账与状态构造、回执封套、scope claim、状态归约与图回放校验。
// 自 lib/review-transaction.ts 拆分（机械平移，语义零改动）。

import {
	execFileSync
} from "node:child_process";
import {
	isAbsolute,
	resolve
} from "node:path";
import {
	ReviewGraphObjectStoreV1
} from "./review-object-store.ts";
import {
	REVIEW_MODE
} from "./review-snapshot.ts";
import {
	classifyReviewRoute,
	REVIEW_ROUTE
} from "./review-triggers.ts";
import {
	applyOrdinaryFix,
	declineOrdinaryFix,
	type OrdinaryDiscoveryInput,
	type OrdinaryEvidenceInput,
	type OrdinaryFinalVerificationInput,
	type OrdinaryFixInput,
	type OrdinaryValidationInput,
	recordOrdinaryDiscovery,
	recordOrdinaryFinalVerification,
	recordOrdinaryValidation,
	resolveOrdinaryEvidence
} from "./review-policy-ordinary.ts";
import {
	applyJudgmentDayFix,
	type JudgmentDayDiscoveryInput,
	type JudgmentDayFinalVerificationInput,
	type JudgmentDayFixInput,
	type JudgmentDayRejudgmentInput,
	recordJudgmentDayDiscovery,
	recordJudgmentDayFinalVerification,
	recordJudgmentDayRejudgment
} from "./review-policy-judgment-day.ts";
import {
	assertBudget,
	assertCanonicalPaths,
	assertCounters,
	assertDigest,
	assertLineageId,
	assertObjectId,
	assertProjectionBinding,
	assertValidationEvidence,
	type CanonicalFrozenRowV1,
	canonicalHash,
	canonicalize,
	type ChildClaimV1,
	cloneCanonical,
	type CreateReviewStateInput,
	EVIDENCE_CLASS,
	FROZEN_SEVERITY,
	FROZEN_STATUS,
	type FrozenLedgerV1,
	JOURNAL_STATUS,
	type ReceiptBodyV1,
	type ReceiptEnvelopeV1,
	type ReducerOperationResultV1,
	REVIEW_OPERATION,
	REVIEW_PHASE,
	REVIEW_TRANSITION,
	type ReviewBudgetV1,
	ReviewIntegrityError,
	type ReviewOperation,
	type ReviewReducerInput,
	type ReviewStateV1,
	type ReviewTransition,
	zeroCounters
} from "./review-transaction-schema.ts";

export function createFrozenLedger(
	rows: readonly CanonicalFrozenRowV1[],
): FrozenLedgerV1 {
	const severityValues = new Set(Object.values(FROZEN_SEVERITY));
	const statusValues = new Set(Object.values(FROZEN_STATUS));
	const evidenceValues = new Set(Object.values(EVIDENCE_CLASS));
	const lensValues = new Set([
		"review-risk",
		"review-resilience",
		"review-readability",
		"review-reliability",
		"judgment-day",
	]);
	const normalizedRows = cloneCanonical(rows).map((row) => {
		if (typeof row.id !== "string" || row.id.trim().length === 0) {
			throw new ReviewIntegrityError("Frozen finding ID must be non-empty");
		}
		if (!lensValues.has(row.lens)) {
			throw new ReviewIntegrityError(`Unsupported frozen finding lens: ${row.lens}`);
		}
		if (!severityValues.has(row.severity)) {
			throw new ReviewIntegrityError(`Unsupported frozen finding severity: ${row.severity}`);
		}
		if (!statusValues.has(row.status_at_freeze)) {
			throw new ReviewIntegrityError(`Unsupported frozen finding status: ${row.status_at_freeze}`);
		}
		if (!evidenceValues.has(row.evidence_class)) {
			throw new ReviewIntegrityError(`Unsupported frozen evidence class: ${row.evidence_class}`);
		}
		if (typeof row.location !== "string" || row.location.trim().length === 0) {
			throw new ReviewIntegrityError(`Frozen finding ${row.id} requires an exact location`);
		}
		if (typeof row.evidence_claim !== "string" || row.evidence_claim.trim().length === 0) {
			throw new ReviewIntegrityError(`Frozen finding ${row.id} requires a concrete evidence claim`);
		}
		const severe =
			row.severity === FROZEN_SEVERITY.BLOCKER ||
			row.severity === FROZEN_SEVERITY.CRITICAL;
		return {
			...row,
			status_at_freeze: severe ? FROZEN_STATUS.OPEN : FROZEN_STATUS.INFO,
			evidence_class: severe
				? row.evidence_class === EVIDENCE_CLASS.INFO
					? EVIDENCE_CLASS.INFERENTIAL_SEVERE
					: row.evidence_class
				: EVIDENCE_CLASS.INFO,
		};
	});
	const canonicalRows = normalizedRows.toSorted((left, right) =>
		left.id.localeCompare(right.id),
	);
	for (let index = 1; index < canonicalRows.length; index += 1) {
		if (canonicalRows[index - 1]!.id === canonicalRows[index]!.id) {
			throw new ReviewIntegrityError(`Duplicate frozen finding ID: ${canonicalRows[index]!.id}`);
		}
	}
	return {
		schema: "gentle-ai.review-frozen-ledger/v1",
		rows: canonicalRows,
		frozen_ledger_hash: canonicalHash(canonicalRows),
	};
}

export function assertFrozenLedgerIntegrity(ledger: FrozenLedgerV1): void {
	if (ledger.schema !== "gentle-ai.review-frozen-ledger/v1") {
		throw new ReviewIntegrityError("Unknown frozen ledger schema");
	}
	const rebuilt = createFrozenLedger(ledger.rows);
	if (canonicalize(rebuilt.rows) !== canonicalize(ledger.rows)) {
		throw new ReviewIntegrityError("Frozen ledger rows are not in canonical ID order");
	}
	if (rebuilt.frozen_ledger_hash !== ledger.frozen_ledger_hash) {
		throw new ReviewIntegrityError("Frozen ledger hash mismatch");
	}
}

export function createReviewState(input: CreateReviewStateInput): ReviewStateV1 {
	if (input.snapshot.schema !== "gentle-ai.review-snapshot/v1") {
		throw new ReviewIntegrityError("Unknown review snapshot schema");
	}
	if (input.snapshot.mode !== input.mode) {
		throw new ReviewIntegrityError("Review snapshot mode does not match the requested transaction mode");
	}
	let route = input.snapshot.route;
	let lenses = [...input.snapshot.lenses];
	if (input.mode === REVIEW_MODE.ORDINARY) {
		const derived = classifyReviewRoute(input.snapshot.diff_evidence);
		if (
			derived.route !== input.snapshot.route ||
			canonicalHash(derived.lenses) !== canonicalHash(input.snapshot.lenses)
		) {
			throw new ReviewIntegrityError("Review route and lenses were not derived from the snapshot diff");
		}
		route = derived.route;
		lenses = [...derived.lenses];
	} else if (
		input.mode === REVIEW_MODE.JUDGMENT_DAY &&
		(input.snapshot.route !== REVIEW_ROUTE.TRIVIAL || input.snapshot.lenses.length !== 0)
	) {
		throw new ReviewIntegrityError("Judgment Day snapshot must not carry ordinary route classification");
	}
	const result: ReviewStateV1 = {
		schema: "gentle-ai.review-state/v1",
		lineage_id: input.lineageId,
		mode: input.mode,
		revision: 0,
		phase: REVIEW_PHASE.STARTED,
		base_tree: input.snapshot.base_tree,
		complete_snapshot_tree: input.snapshot.complete_snapshot_tree,
		review_projection: cloneCanonical(input.snapshot.review_projection),
		initial_review_tree: input.snapshot.initial_review_tree,
		...(input.snapshot.genesis_paths === undefined ? {} : { genesis_paths: cloneCanonical(input.snapshot.genesis_paths) }),
		snapshot_object_store: cloneCanonical(input.snapshot.object_store),
		current_candidate_tree: input.snapshot.initial_review_tree,
		route,
		lenses: Object.freeze(lenses),
		policy_hash: input.snapshot.policy_hash,
		evidence_hash: input.evidenceHash,
		budget: cloneCanonical(input.budget),
		counters: zeroCounters(),
		request_journal: [],
	};
	if (input.parentLineageId !== undefined) result.parent_lineage_id = input.parentLineageId;
	assertState(result);
	if (input.mode === REVIEW_MODE.ORDINARY && result.genesis_paths === undefined) {
		throw new ReviewIntegrityError("New ordinary lineages require immutable genesis paths");
	}
	return result;
}

export function assertState(state: ReviewStateV1, previous?: ReviewStateV1): void {
	if (state.schema !== "gentle-ai.review-state/v1") {
		throw new ReviewIntegrityError("Unknown review state schema");
	}
	assertLineageId(state.lineage_id);
	if (state.parent_lineage_id !== undefined) assertLineageId(state.parent_lineage_id);
	if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
		throw new ReviewIntegrityError("Invalid state revision");
	}
	for (const [label, value] of [
		["base tree", state.base_tree],
		["complete snapshot tree", state.complete_snapshot_tree],
		["initial review tree", state.initial_review_tree],
		["current candidate tree", state.current_candidate_tree],
	] as const) {
		assertObjectId(value, label);
	}
	if (state.final_candidate_tree !== undefined) {
		assertObjectId(state.final_candidate_tree, "final candidate tree");
	}
	assertDigest(state.policy_hash, "policy hash");
	assertDigest(state.evidence_hash, "evidence hash");
	assertProjectionBinding(
		state.review_projection,
		state.complete_snapshot_tree,
		state.initial_review_tree,
	);
	if (state.genesis_paths !== undefined) assertCanonicalPaths(state.genesis_paths, "Genesis paths");
	assertBudget(state.budget);
	assertCounters(state.counters, state.budget, previous?.counters);
	if (state.frozen_ledger) assertFrozenLedgerIntegrity(state.frozen_ledger);
	if (state.fix_record) {
		assertObjectId(state.fix_record.candidate_tree, "fix candidate tree");
		assertDigest(state.fix_record.fix_diff_hash, "fix diff hash");
		if (canonicalHash(state.fix_record.fix_diff) !== state.fix_record.fix_diff_hash) {
			throw new ReviewIntegrityError("Fix diff hash mismatch");
		}
	}
	if (state.validation_evidence) assertValidationEvidence(state.validation_evidence);
	if (state.active_finding_ids) {
		const unique = new Set(state.active_finding_ids);
		if (unique.size !== state.active_finding_ids.length) {
			throw new ReviewIntegrityError("Active finding IDs must be unique");
		}
		if (state.frozen_ledger) {
			const frozenIds = new Set(state.frozen_ledger.rows.map(({ id }) => id));
			if (state.active_finding_ids.some((id) => !frozenIds.has(id))) {
				throw new ReviewIntegrityError("Active finding ID is not frozen");
			}
		}
	}
	if (state.child_claims) {
		const targets = new Set<string>();
		for (const claim of state.child_claims) {
			if (claim.parent_lineage_id !== state.lineage_id) {
				throw new ReviewIntegrityError("Child claim parent does not match its authoritative lineage");
			}
			assertObjectId(claim.target_tree, "child claim target tree");
			assertBudget(claim.budget);
			if (
				claim.child_lineage_id !==
				canonicalHash({
					parent_lineage_id: claim.parent_lineage_id,
					target_tree: claim.target_tree,
				})
			) {
				throw new ReviewIntegrityError("Child claim identity mismatch");
			}
			if (targets.has(claim.target_tree)) {
				throw new ReviewIntegrityError("Child claim target must be unique per parent lineage");
			}
			targets.add(claim.target_tree);
		}
	}
	const journalKeys = new Set<string>();
	let pendingEntries = 0;
	for (const entry of state.request_journal) {
		if (journalKeys.has(entry.idempotency_key)) {
			throw new ReviewIntegrityError("Request journal idempotency keys must be unique");
		}
		journalKeys.add(entry.idempotency_key);
		assertDigest(entry.request_hash, "journal request hash");
		if (entry.status === JOURNAL_STATUS.PENDING) pendingEntries += 1;
		else if (entry.status !== JOURNAL_STATUS.COMPLETED) {
			throw new ReviewIntegrityError("Request journal has an unsupported status");
		}
	}
	if (pendingEntries > 1) {
		throw new ReviewIntegrityError("Only one pending operation may exist per lineage");
	}
	if (state.terminal_state !== undefined && state.phase !== REVIEW_PHASE.TERMINAL) {
		throw new ReviewIntegrityError("Terminal state requires terminal phase");
	}
	if (previous) assertImmutableState(previous, state);
}

function assertImmutableState(previous: ReviewStateV1, next: ReviewStateV1): void {
	const previousBinding = {
		schema: previous.schema,
		lineage_id: previous.lineage_id,
		parent_lineage_id: previous.parent_lineage_id,
		mode: previous.mode,
		base_tree: previous.base_tree,
		complete_snapshot_tree: previous.complete_snapshot_tree,
		review_projection: previous.review_projection,
		initial_review_tree: previous.initial_review_tree,
		genesis_paths: previous.genesis_paths,
		snapshot_object_store: previous.snapshot_object_store,
		route: previous.route,
		lenses: previous.lenses,
		policy_hash: previous.policy_hash,
		budget: previous.budget,
	};
	const nextBinding = {
		schema: next.schema,
		lineage_id: next.lineage_id,
		parent_lineage_id: next.parent_lineage_id,
		mode: next.mode,
		base_tree: next.base_tree,
		complete_snapshot_tree: next.complete_snapshot_tree,
		review_projection: next.review_projection,
		initial_review_tree: next.initial_review_tree,
		genesis_paths: next.genesis_paths,
		snapshot_object_store: next.snapshot_object_store,
		route: next.route,
		lenses: next.lenses,
		policy_hash: next.policy_hash,
		budget: next.budget,
	};
	if (canonicalize(previousBinding) !== canonicalize(nextBinding)) {
		throw new ReviewIntegrityError("Immutable review binding changed");
	}
	if (
		previous.frozen_ledger &&
		(!next.frozen_ledger ||
			canonicalHash(previous.frozen_ledger) !== canonicalHash(next.frozen_ledger))
	) {
		throw new ReviewIntegrityError("Frozen review ledger changed after publication");
	}
	if (previous.terminal_state !== undefined) {
		const previousTerminalAuthority = {
			phase: previous.phase,
			current_candidate_tree: previous.current_candidate_tree,
			final_candidate_tree: previous.final_candidate_tree,
			frozen_ledger: previous.frozen_ledger,
			evidence_hash: previous.evidence_hash,
			counters: previous.counters,
			resolutions: previous.resolutions,
			fix_record: previous.fix_record,
			active_finding_ids: previous.active_finding_ids,
			escalation_reasons: previous.escalation_reasons,
			terminal_state: previous.terminal_state,
		};
		const nextTerminalAuthority = {
			phase: next.phase,
			current_candidate_tree: next.current_candidate_tree,
			final_candidate_tree: next.final_candidate_tree,
			frozen_ledger: next.frozen_ledger,
			evidence_hash: next.evidence_hash,
			counters: next.counters,
			resolutions: next.resolutions,
			fix_record: next.fix_record,
			active_finding_ids: next.active_finding_ids,
			escalation_reasons: next.escalation_reasons,
			terminal_state: next.terminal_state,
		};
		if (canonicalize(previousTerminalAuthority) !== canonicalize(nextTerminalAuthority)) {
			throw new ReviewIntegrityError("Terminal review authority is closed and immutable");
		}
	}
}

export function createReceiptEnvelope(body: ReceiptBodyV1): ReceiptEnvelopeV1 {
	assertReceiptBody(body);
	const canonicalBody = cloneCanonical(body);
	return { body: canonicalBody, receipt_hash: canonicalHash(canonicalBody) };
}

function assertReceiptBody(body: ReceiptBodyV1): void {
	if (body.schema !== "gentle-ai.review-receipt-body/v1") {
		throw new ReviewIntegrityError("Unknown receipt body schema");
	}
	assertLineageId(body.lineage_id);
	for (const [label, value] of [
		["base tree", body.base_tree],
		["complete snapshot tree", body.complete_snapshot_tree],
		["initial review tree", body.initial_review_tree],
		["final candidate tree", body.final_candidate_tree],
	] as const) {
		assertObjectId(value, label);
	}
	assertProjectionBinding(
		body.review_projection,
		body.complete_snapshot_tree,
		body.initial_review_tree,
	);
	assertDigest(body.policy_hash, "policy hash");
	assertDigest(body.frozen_ledger_hash, "frozen ledger hash");
	assertDigest(body.evidence_hash, "evidence hash");
	assertBudget(body.budget);
	assertCounters(body.counters, body.budget);
}

export function assertReceiptIntegrity(envelope: ReceiptEnvelopeV1): void {
	assertReceiptBody(envelope.body);
	assertDigest(envelope.receipt_hash, "receipt hash");
	if (canonicalHash(envelope.body) !== envelope.receipt_hash) {
		throw new ReviewIntegrityError("Receipt hash mismatch");
	}
}

export function reviewStoreRootForRepository(cwd: string): string {
	const repositoryRoot = execFileSync(
		"git",
		["rev-parse", "--show-toplevel"],
		{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
	const gitPath = execFileSync(
		"git",
		["rev-parse", "--git-path", "gentle-ai/reviews"],
		{ cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
	return isAbsolute(gitPath) ? gitPath : resolve(repositoryRoot, gitPath);
}

export function repositoryRootForGate(cwd: string): string {
	return execFileSync("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

export function createScopeChildClaim(
	parentLineageId: string,
	targetTree: string,
	budget: ReviewBudgetV1,
): ChildClaimV1 {
	assertLineageId(parentLineageId);
	assertObjectId(targetTree, "scope target tree");
	assertBudget(budget);
	const identity = {
		parent_lineage_id: parentLineageId,
		target_tree: targetTree,
	};
	return {
		...identity,
		child_lineage_id: canonicalHash(identity),
		budget: cloneCanonical(budget),
	};
}

export function operationForTransition(transition: ReviewTransition): ReviewOperation {
	switch (transition) {
		case REVIEW_TRANSITION.ORDINARY_DISCOVERY:
		case REVIEW_TRANSITION.JUDGMENT_DAY_DISCOVERY:
			return REVIEW_OPERATION.FREEZE_LEDGER;
		case REVIEW_TRANSITION.ORDINARY_EVIDENCE:
		case REVIEW_TRANSITION.JUDGMENT_DAY_REJUDGMENT:
			return REVIEW_OPERATION.RESOLVE_EVIDENCE;
		case REVIEW_TRANSITION.ORDINARY_FIX:
		case REVIEW_TRANSITION.ORDINARY_NO_FIX:
		case REVIEW_TRANSITION.JUDGMENT_DAY_FIX:
			return REVIEW_OPERATION.AUTHORIZE_FIX;
		case REVIEW_TRANSITION.ORDINARY_VALIDATION:
			return REVIEW_OPERATION.VALIDATE_FIX;
		case REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION:
		case REVIEW_TRANSITION.JUDGMENT_DAY_FINAL_VERIFICATION:
			return REVIEW_OPERATION.VERIFY;
	}
	throw new ReviewIntegrityError(`Unsupported reducer transition: ${transition}`);
}

export function reduceReviewState(
	state: ReviewStateV1,
	transition: ReviewTransition,
	input: ReviewReducerInput,
): ReviewStateV1 {
	switch (transition) {
		case REVIEW_TRANSITION.ORDINARY_DISCOVERY:
			return recordOrdinaryDiscovery(state, input as OrdinaryDiscoveryInput);
		case REVIEW_TRANSITION.ORDINARY_EVIDENCE:
			return resolveOrdinaryEvidence(state, input as OrdinaryEvidenceInput);
		case REVIEW_TRANSITION.ORDINARY_FIX:
			return applyOrdinaryFix(state, input as OrdinaryFixInput);
		case REVIEW_TRANSITION.ORDINARY_NO_FIX:
			return declineOrdinaryFix(state, (input as { reason: string }).reason);
		case REVIEW_TRANSITION.ORDINARY_VALIDATION:
			return recordOrdinaryValidation(state, input as OrdinaryValidationInput);
		case REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION:
			return recordOrdinaryFinalVerification(
				state,
				input as OrdinaryFinalVerificationInput,
			);
		case REVIEW_TRANSITION.JUDGMENT_DAY_DISCOVERY:
			return recordJudgmentDayDiscovery(state, input as JudgmentDayDiscoveryInput);
		case REVIEW_TRANSITION.JUDGMENT_DAY_FIX:
			return applyJudgmentDayFix(state, input as JudgmentDayFixInput);
		case REVIEW_TRANSITION.JUDGMENT_DAY_REJUDGMENT:
			return recordJudgmentDayRejudgment(
				state,
				input as JudgmentDayRejudgmentInput,
			);
		case REVIEW_TRANSITION.JUDGMENT_DAY_FINAL_VERIFICATION:
			return recordJudgmentDayFinalVerification(
				state,
				input as JudgmentDayFinalVerificationInput,
			);
	}
	throw new ReviewIntegrityError(`Unsupported reducer transition: ${transition}`);
}

export function validateReviewGraphReplayV1(events: readonly ReturnType<ReviewGraphObjectStoreV1["readEvent"]>[]): ReviewStateV1 {
	if (events.length === 0) throw new ReviewIntegrityError("Graph replay requires a genesis event");
	let previous: ReviewStateV1 | undefined;
	for (const [index, event] of events.entries()) {
		const payload = event.body.payload as { state?: ReviewStateV1 };
		if (!payload?.state || canonicalHash(payload.state) !== event.body.reduced_state_hash) throw new ReviewIntegrityError("Graph event state reduction is invalid");
		if (event.body.reducer_transition === undefined || event.body.reducer_input === undefined) throw new ReviewIntegrityError("Graph event lacks canonical reducer transition/input");
		const state = payload.state;
		assertState(state, previous);
		if (index === 0) {
			if (event.body.reducer_transition !== "start" || canonicalHash(event.body.reducer_input) !== canonicalHash(state)) throw new ReviewIntegrityError("Graph genesis reducer input is invalid");
		} else if (event.body.reducer_transition === "operation-prepared") {
			const input = event.body.reducer_input as { transition?: unknown; request?: unknown };
			if (typeof input.transition !== "string" || !(Object.values(REVIEW_TRANSITION) as string[]).includes(input.transition)) throw new ReviewIntegrityError("Graph prepared operation transition is invalid");
			const expected = { ...previous!, revision: state.revision, request_journal: state.request_journal };
			if (canonicalHash(expected) !== canonicalHash(state)) throw new ReviewIntegrityError("Graph prepared operation replay does not match event state");
		} else if (event.body.reducer_transition === "gate") {
			if (event.body.kind !== "gate-evaluated" || !Array.isArray(state.request_journal) || state.request_journal.length !== previous!.request_journal.length + 1 || canonicalHash(state.request_journal.slice(0, -1)) !== canonicalHash(previous!.request_journal)) throw new ReviewIntegrityError("Graph gate replay journal is invalid");
			const journal = state.request_journal.at(-1);
			if (!journal || journal.operation !== REVIEW_OPERATION.GATE || journal.status !== JOURNAL_STATUS.COMPLETED || journal.request_hash !== canonicalHash(event.body.reducer_input)) throw new ReviewIntegrityError("Graph gate replay request is invalid");
			const priorClaims = previous!.child_claims ?? [];
			const nextClaims = state.child_claims ?? [];
			if (nextClaims.length < priorClaims.length || canonicalHash(nextClaims.slice(0, priorClaims.length)) !== canonicalHash(priorClaims) || nextClaims.length > priorClaims.length + 1) throw new ReviewIntegrityError("Graph gate replay claims are invalid");
			const expected = { ...previous!, revision: state.revision, request_journal: state.request_journal, ...(nextClaims.length === 0 ? {} : { child_claims: nextClaims }) };
			if (canonicalHash(expected) !== canonicalHash(state)) throw new ReviewIntegrityError("Graph gate replay does not match event state");
		} else if ((Object.values(REVIEW_TRANSITION) as string[]).includes(event.body.reducer_transition)) {
			// reducer_input 的形状由下方重放哈希比对兜底：不匹配即抛出完整性错误。
		const replayed = reduceReviewState(previous!, event.body.reducer_transition as ReviewTransition, event.body.reducer_input as ReviewReducerInput);
			const expected = { ...replayed, revision: state.revision, request_journal: state.request_journal };
			if (canonicalHash(expected) !== canonicalHash(state)) throw new ReviewIntegrityError("Graph adjacent reducer replay does not match event state");
		} else {
			throw new ReviewIntegrityError("Graph event reducer transition is unsupported");
		}
		previous = state;
	}
	return cloneCanonical(previous!);
}

export function reducerOperationResult(
	state: ReviewStateV1,
	revision: number,
): ReducerOperationResultV1 {
	const result: ReducerOperationResultV1 = {
		revision,
		phase: state.phase,
	};
	if (state.terminal_state !== undefined) result.terminal_state = state.terminal_state;
	return result;
}

