// 评审事务 schema：阶段/状态枚举、V1 接口、权威回执品牌、规范化 JSON 哈希与字段断言。
// 自 lib/review-transaction.ts 拆分（机械平移，语义零改动）。

import {
	createHash
} from "node:crypto";
import {
	join,
	resolve
} from "node:path";
import {
	type GateResult
} from "./review-publication-gate.ts";
import {
	REVIEW_PROJECTION,
	type ReviewMode,
	type ReviewProjectionV1,
	type ReviewSnapshotObjectStoreV1,
	type SnapshotV1
} from "./review-snapshot.ts";
import {
	type ReviewLens,
	type ReviewRoute
} from "./review-triggers.ts";
import {
	type OrdinaryDiscoveryInput,
	type OrdinaryEvidenceInput,
	type OrdinaryFinalVerificationInput,
	type OrdinaryFixInput,
	type OrdinaryValidationInput
} from "./review-policy-ordinary.ts";
import {
	type JudgmentDayDiscoveryInput,
	type JudgmentDayFinalVerificationInput,
	type JudgmentDayFixInput,
	type JudgmentDayRejudgmentInput
} from "./review-policy-judgment-day.ts";

export const REVIEW_PHASE = {
	STARTED: "started",
	DISCOVERY_COMPLETE: "discovery-complete",
	REFUTATION_COMPLETE: "refutation-complete",
	FIX_COMPLETE: "fix-complete",
	VALIDATION_COMPLETE: "validation-complete",
	FINAL_VERIFICATION: "final-verification",
	JUDGMENT_COMPLETE: "judgment-complete",
	TERMINAL: "terminal",
} as const;

export type ReviewPhase = (typeof REVIEW_PHASE)[keyof typeof REVIEW_PHASE];

export const TERMINAL_STATE = {
	APPROVED: "approved",
	ESCALATED: "escalated",
} as const;

export type TerminalState = (typeof TERMINAL_STATE)[keyof typeof TERMINAL_STATE];

export const JOURNAL_STATUS = {
	PENDING: "pending",
	COMPLETED: "completed",
} as const;

export type JournalStatus = (typeof JOURNAL_STATUS)[keyof typeof JOURNAL_STATUS];

export const FROZEN_SEVERITY = {
	BLOCKER: "BLOCKER",
	CRITICAL: "CRITICAL",
	WARNING: "WARNING",
	SUGGESTION: "SUGGESTION",
} as const;

export type FrozenSeverity =
	(typeof FROZEN_SEVERITY)[keyof typeof FROZEN_SEVERITY];

export const FROZEN_STATUS = {
	OPEN: "open",
	REFUTED: "refuted",
	INFO: "info",
} as const;

export type FrozenStatus = (typeof FROZEN_STATUS)[keyof typeof FROZEN_STATUS];

export const EVIDENCE_CLASS = {
	DETERMINISTIC: "deterministic",
	INFERENTIAL_SEVERE: "inferential-severe",
	INFO: "info",
} as const;

export type EvidenceClass =
	(typeof EVIDENCE_CLASS)[keyof typeof EVIDENCE_CLASS];

export const RESOLUTION_OUTCOME = {
	CORROBORATED: "corroborated",
	REFUTED: "refuted",
	INCONCLUSIVE: "inconclusive",
	VERIFIED: "verified",
	REGRESSION: "regression",
} as const;

export type ResolutionOutcome =
	(typeof RESOLUTION_OUTCOME)[keyof typeof RESOLUTION_OUTCOME];

export const RESOLUTION_SOURCE = {
	CONTROLLER: "controller",
	REFUTER: "refuter",
	VALIDATOR: "validator",
	JUDGE: "judge",
} as const;

export type ResolutionSource =
	(typeof RESOLUTION_SOURCE)[keyof typeof RESOLUTION_SOURCE];

export const STORE_FAULT_POINT = {
	BEFORE_HEAD_RENAME: "before-head-rename",
} as const;

export type StoreFaultPoint =
	(typeof STORE_FAULT_POINT)[keyof typeof STORE_FAULT_POINT];

export const REVIEW_OPERATION = {
	START: "start",
	FREEZE_LEDGER: "freeze-ledger",
	RESOLVE_EVIDENCE: "resolve-evidence",
	AUTHORIZE_FIX: "authorize-fix",
	VALIDATE_FIX: "validate-fix",
	VERIFY: "verify",
	GATE: "gate",
} as const;

export type ReviewOperation =
	(typeof REVIEW_OPERATION)[keyof typeof REVIEW_OPERATION];

export const REVIEW_TRANSITION = {
	ORDINARY_DISCOVERY: "ordinary-discovery",
	ORDINARY_EVIDENCE: "ordinary-evidence",
	ORDINARY_FIX: "ordinary-fix",
	ORDINARY_NO_FIX: "ordinary-no-fix",
	ORDINARY_VALIDATION: "ordinary-validation",
	ORDINARY_FINAL_VERIFICATION: "ordinary-final-verification",
	JUDGMENT_DAY_DISCOVERY: "judgment-day-discovery",
	JUDGMENT_DAY_FIX: "judgment-day-fix",
	JUDGMENT_DAY_REJUDGMENT: "judgment-day-rejudgment",
	JUDGMENT_DAY_FINAL_VERIFICATION: "judgment-day-final-verification",
} as const;

export type ReviewTransition =
	(typeof REVIEW_TRANSITION)[keyof typeof REVIEW_TRANSITION];

export interface ReviewBudgetV1 {
	review_batches: number;
	review_actors: number;
	refuter_batches: number;
	fix_batches: number;
	validator_runs: number;
	final_verifications: number;
	judgment_rounds: number;
	judge_runs: number;
}

export interface ReviewCountersV1 {
	review_batches: number;
	review_actors: number;
	refuter_batches: number;
	fix_batches: number;
	validator_runs: number;
	final_verifications: number;
	judgment_rounds: number;
	judge_runs: number;
}

export interface CanonicalFrozenRowV1 {
	id: string;
	lens: ReviewLens | "judgment-day";
	location: string;
	severity: FrozenSeverity;
	status_at_freeze: FrozenStatus;
	evidence_class: EvidenceClass;
	evidence_claim: string;
}

export interface FrozenLedgerV1 {
	schema: "gentle-ai.review-frozen-ledger/v1";
	rows: CanonicalFrozenRowV1[];
	frozen_ledger_hash: string;
}

export interface RequestJournalEntryV1 {
	operation: ReviewOperation;
	idempotency_key: string;
	request_hash: string;
	status: JournalStatus;
	authorization?: unknown;
	canonical_result?: unknown;
}

export interface GateResultV1 {
	status: GateResult;
	actor_count: 0;
	target_hash: string;
	receipt_hash: string;
	reason: string;
	child_claim?: ChildClaimV1;
}

export interface FindingResolutionV1 {
	id: string;
	outcome: ResolutionOutcome;
	source: ResolutionSource;
}

export interface ReviewFixRecordV1 {
	candidate_tree: string;
	fixed_ids: string[];
	fix_diff: string;
	fix_diff_hash: string;
	changed_paths?: string[];
}

export interface ValidationEvidenceV1 {
	original_acceptance_tests: { passed: boolean; evidence_hash: string };
	correction_regressions: Array<{ finding_id: string; evidence_hash: string; passed: boolean }>;
	original_criterion_regressions: string[];
	follow_ups: FollowUpObservationV1[];
}

export interface FollowUpObservationV1 {
	id: string;
	location: string;
	summary: string;
	evidence_hash: string;
}

export interface ReviewStateV1 {
	schema: "gentle-ai.review-state/v1";
	lineage_id: string;
	parent_lineage_id?: string;
	mode: ReviewMode;
	revision: number;
	phase: ReviewPhase;
	base_tree: string;
	complete_snapshot_tree: string;
	review_projection: ReviewProjectionV1;
	initial_review_tree: string;
	genesis_paths?: string[];
	snapshot_object_store?: ReviewSnapshotObjectStoreV1;
	current_candidate_tree: string;
	final_candidate_tree?: string;
	route: ReviewRoute;
	lenses: readonly ReviewLens[];
	policy_hash: string;
	frozen_ledger?: FrozenLedgerV1;
	evidence_hash: string;
	budget: ReviewBudgetV1;
	counters: ReviewCountersV1;
	resolutions?: FindingResolutionV1[];
	fix_record?: ReviewFixRecordV1;
	validation_evidence?: ValidationEvidenceV1;
	active_finding_ids?: string[];
	escalation_reasons?: string[];
	child_claims?: ChildClaimV1[];
	request_journal: RequestJournalEntryV1[];
	terminal_state?: TerminalState;
}

export interface CreateReviewStateInput {
	lineageId: string;
	parentLineageId?: string;
	mode: ReviewMode;
	snapshot: SnapshotV1;
	evidenceHash: string;
	budget: ReviewBudgetV1;
}

export interface ReceiptBodyV1 {
	schema: "gentle-ai.review-receipt-body/v1";
	lineage_id: string;
	mode: ReviewMode;
	base_tree: string;
	complete_snapshot_tree: string;
	review_projection: ReviewProjectionV1;
	initial_review_tree: string;
	final_candidate_tree: string;
	route: ReviewRoute;
	lenses: readonly ReviewLens[];
	policy_hash: string;
	frozen_ledger_hash: string;
	evidence_hash: string;
	budget: ReviewBudgetV1;
	counters: ReviewCountersV1;
	terminal_state: TerminalState;
}

export interface ReceiptEnvelopeV1 {
	body: ReceiptBodyV1;
	receipt_hash: string;
}

export interface ChildClaimV1 {
	parent_lineage_id: string;
	target_tree: string;
	child_lineage_id: string;
	budget: ReviewBudgetV1;
}

interface ChildClaimEnvelopeV1 {
	claim: ChildClaimV1;
	claim_hash: string;
}


export const authoritativeReceiptBrand: unique symbol = Symbol("gentle-ai.authoritative-receipt");

export interface AuthoritativeReceiptV1 {
	readonly [authoritativeReceiptBrand]: true;
	readonly envelope: ReceiptEnvelopeV1;
	readonly repository_id: string;
	readonly authority_id: string;
	readonly common_directory: string;
	readonly root_set_id: string;
	readonly head_event_id: string;
	readonly store_epoch?: string;
	readonly authority_incarnation_id?: string;
	readonly authority_receipt_hash: string;
}



export type ReviewReducerInput =
	| OrdinaryDiscoveryInput
	| OrdinaryEvidenceInput
	| OrdinaryFixInput
	| OrdinaryValidationInput
	| OrdinaryFinalVerificationInput
	| JudgmentDayDiscoveryInput
	| JudgmentDayFixInput
	| JudgmentDayRejudgmentInput
	| JudgmentDayFinalVerificationInput
	| { reason: string };

export interface ReducerOperationResultV1 {
	revision: number;
	phase: ReviewPhase;
	terminal_state?: TerminalState;
}

export interface StartOperationResultV1 {
	lineage_id: string;
	revision: 0;
	phase: typeof REVIEW_PHASE.STARTED;
}

export interface RunReducerOperationOptions {
	lineageId: string;
	transition: ReviewTransition;
	idempotencyKey: string;
	input: ReviewReducerInput;
}

export interface BeginReducerOperationOptions<TRequest> {
	lineageId: string;
	transition: ReviewTransition;
	idempotencyKey: string;
	request: TRequest;
	authorization?: unknown;
}

export interface CompleteReducerOperationOptions<TRequest>
	extends BeginReducerOperationOptions<TRequest> {
	input: ReviewReducerInput;
}


export class ReviewIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReviewIntegrityError";
	}
}

export const DIGEST = /^[0-9a-f]{64}$/;
export const OBJECT_ID = /^[0-9a-f]{40,64}$/;
const LINEAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const COUNTER_KEYS = Object.freeze([
	"review_batches",
	"review_actors",
	"refuter_batches",
	"fix_batches",
	"validator_runs",
	"final_verifications",
	"judgment_rounds",
	"judge_runs",
] satisfies Array<keyof ReviewCountersV1>);

export function canonicalize(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalize).join(",")}]`;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const entries = Object.keys(record)
			.filter((key) => record[key] !== undefined)
			.toSorted()
			.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
		return `{${entries.join(",")}}`;
	}
	throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}

export function canonicalHash(value: unknown): string {
	return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function cloneCanonical<T>(value: T): T {
	return JSON.parse(canonicalize(value)) as T;
}

export function assertDigest(value: string, label: string): void {
	if (!DIGEST.test(value)) throw new ReviewIntegrityError(`${label} is not a SHA-256 digest`);
}

export function assertObjectId(value: string, label: string): void {
	if (!OBJECT_ID.test(value)) throw new ReviewIntegrityError(`${label} is not a resolved object ID`);
}

export function assertLineageId(value: string): void {
	if (!LINEAGE_ID.test(value)) throw new ReviewIntegrityError("Invalid lineage ID");
}

export function zeroCounters(): ReviewCountersV1 {
	return {
		review_batches: 0,
		review_actors: 0,
		refuter_batches: 0,
		fix_batches: 0,
		validator_runs: 0,
		final_verifications: 0,
		judgment_rounds: 0,
		judge_runs: 0,
	};
}

export function assertBudget(budget: ReviewBudgetV1): void {
	for (const key of COUNTER_KEYS) {
		if (!Number.isSafeInteger(budget[key]) || budget[key] < 0) {
			throw new ReviewIntegrityError(`Invalid budget counter: ${key}`);
		}
	}
}

export function assertCounters(
	counters: ReviewCountersV1,
	budget: ReviewBudgetV1,
	previous?: ReviewCountersV1,
): void {
	for (const key of COUNTER_KEYS) {
		if (!Number.isSafeInteger(counters[key]) || counters[key] < 0) {
			throw new ReviewIntegrityError(`Invalid review counter: ${key}`);
		}
		if (counters[key] > budget[key]) {
			throw new ReviewIntegrityError(`Review budget exceeded: ${key}`);
		}
		if (previous && counters[key] < previous[key]) {
			throw new ReviewIntegrityError(`Review counter is not monotonic: ${key}`);
		}
	}
}

export function assertProjectionBinding(
	projection: ReviewProjectionV1,
	completeTree: string,
	initialTree: string,
): void {
	if (projection.kind === REVIEW_PROJECTION.COMPLETE) {
		if (initialTree !== completeTree) {
			throw new ReviewIntegrityError("Complete projection does not bind the initial review tree");
		}
		return;
	}
	if (projection.kind === REVIEW_PROJECTION.INTENDED_COMMIT) {
		assertObjectId(projection.tree, "intended commit tree");
		if (projection.tree !== initialTree) {
			throw new ReviewIntegrityError("Intended-commit projection does not bind the initial review tree");
		}
		return;
	}
	throw new ReviewIntegrityError("Unsupported review projection");
}

export function assertCanonicalPaths(paths: readonly string[], label: string): void {
	if (canonicalize(paths) !== canonicalize([...new Set(paths)].toSorted())) {
		throw new ReviewIntegrityError(`${label} must be unique and sorted`);
	}
	for (const path of paths) {
		if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
			throw new ReviewIntegrityError(`${label} must be canonical repository-relative paths`);
		}
	}
}

function assertFollowUp(value: FollowUpObservationV1): void {
	if (Object.keys(value as object).some((key) => !["id", "location", "summary", "evidence_hash"].includes(key))) {
		throw new ReviewIntegrityError("Follow-up cannot request lifecycle action or correction");
	}
	if (typeof value.id !== "string" || value.id.length === 0 || typeof value.location !== "string" || value.location.length === 0 || typeof value.summary !== "string" || value.summary.length === 0) {
		throw new ReviewIntegrityError("Follow-up requires identity, location, and summary");
	}
	assertDigest(value.evidence_hash, "Follow-up evidence hash");
}

export function assertValidationEvidence(value: ValidationEvidenceV1): void {
	if (typeof value.original_acceptance_tests?.passed !== "boolean") throw new ReviewIntegrityError("Original acceptance evidence is invalid");
	assertDigest(value.original_acceptance_tests.evidence_hash, "Original acceptance evidence hash");
	for (const regression of value.correction_regressions) {
		if (typeof regression.finding_id !== "string" || typeof regression.passed !== "boolean") throw new ReviewIntegrityError("Correction regression evidence is invalid");
		assertDigest(regression.evidence_hash, "Correction regression evidence hash");
	}
	if (!Array.isArray(value.original_criterion_regressions) || value.original_criterion_regressions.some((reason) => typeof reason !== "string" || reason.length === 0)) {
		throw new ReviewIntegrityError("Original criterion regression evidence is invalid");
	}
	if (!Array.isArray(value.follow_ups)) throw new ReviewIntegrityError("Follow-up evidence is invalid");
	for (const followUp of value.follow_ups) assertFollowUp(followUp);
	if (canonicalize(value.follow_ups) !== canonicalize([...value.follow_ups].toSorted((left, right) => left.id.localeCompare(right.id)))) {
		throw new ReviewIntegrityError("Follow-up evidence must be ID-sorted");
	}
}
