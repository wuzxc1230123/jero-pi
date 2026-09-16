import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import { jeroDomainHash } from "./canonical.ts";
import type { JeroFindingSeverity, JeroReviewTransactionStateV1 } from "./protocol.ts";
import { projectJeroReviewStateV1 } from "./transitions.ts";
import type { JeroRepositoryContextV1 } from "./repository-context.ts";
import type { JeroTransitionArgumentV1 } from "./collect-inputs.ts";

// Last-event closure (spec §E): a capture operation that is the lineage's
// LAST event closes the authority natively and prints a closure instead of
// an artifact. Canonical-internal operation naming is the uniform
// `review.capture-*` dot form; the conformance boundary maps to the
// fixture's NONUNIFORM names (discrepancy #2 — 2 slash, 2 dot).

export const JERO_LAST_EVENT_CLOSURE_SCHEMA = "jero.authority.last-event-closure/v1";

export const JERO_CAPTURE_CLOSURE_OPERATIONS = {
	CAPTURE_RESULT: "review.capture-result",
	CAPTURE_CORRECTION_PLAN: "review.capture-correction-plan",
	CAPTURE_REFUTER: "review.capture-refuter",
	CAPTURE_VALIDATION: "review.capture-validation",
} as const;
export type JeroCaptureClosureOperation = (typeof JERO_CAPTURE_CLOSURE_OPERATIONS)[keyof typeof JERO_CAPTURE_CLOSURE_OPERATIONS];

/** Discrepancy #2: fixture-vocabulary operation names (2 slash, 2 dot — decoder :2417-2422). */
export const JERO_CAPTURE_CLOSURE_OPERATION_CONFORMANCE_MAP: Readonly<Record<JeroCaptureClosureOperation, string>> = {
	[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT]: "review/capture-result",
	[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN]: "review.capture-correction-plan",
	[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_REFUTER]: "review.capture-refuter",
	[JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_VALIDATION]: "review/capture-validation",
};

export type JeroLastEventClosureState = "approved" | "correction_required" | "escalated";

export const JERO_LAST_EVENT_CLOSURE_STATES: readonly JeroLastEventClosureState[] = ["approved", "correction_required", "escalated"];

export const JERO_ADVISORY_FINDING_SEVERITIES: readonly JeroFindingSeverity[] = ["BLOCKER", "CRITICAL", "WARNING", "SUGGESTION"];
export const JERO_ADVISORY_FINDING_DISPOSITIONS = ["informational", "follow_up", "refuted"] as const;
export type JeroAdvisoryFindingDisposition = (typeof JERO_ADVISORY_FINDING_DISPOSITIONS)[number];

export const JERO_ADVISORY_FINDINGS_STATEMENT =
	"This review is approved and its receipt stands. Every finding listed here is non-blocking: none opened a correction, none reopens this review, and no correction transition is offered for this candidate. Treat them as separate later work, never as a reason to re-run review on this candidate.";

export const JERO_APPROVED_CLOSURE_ACTION = "the approved review completed on the last admitted event and burned; delivery follows ordinary repository policy";
export const JERO_CORRECTION_REQUIRED_CLOSURE_ACTION = "candidate-caused severe findings require one bounded correction";

export interface JeroAdvisoryFindingV1 {
	readonly id: string;
	readonly lens?: string;
	readonly location?: string;
	readonly severity: JeroFindingSeverity;
	readonly disposition: JeroAdvisoryFindingDisposition;
}

export interface JeroAdvisoryFindingsV1 {
	readonly statement: string;
	readonly findings: readonly JeroAdvisoryFindingV1[];
}

export interface JeroStatusContinuationV1 {
	readonly operation: "review.status";
	readonly arguments: readonly JeroTransitionArgumentV1[];
	readonly preconditions: readonly { readonly name: string; readonly value: string }[];
	readonly binding: {
		readonly lineage_id: string;
		readonly revision: string;
		readonly target_identity: string;
		readonly repository_context?: string;
	};
	readonly artifacts?: readonly unknown[];
	readonly command?: string;
}

export interface JeroClosureReviewerFindingV1 {
	readonly id: string;
	readonly lens: string;
	readonly location: string;
	readonly severity: JeroFindingSeverity;
	readonly claim: string;
	readonly proof_refs: readonly string[];
	readonly evidence_class?: string;
	readonly causal_disposition?: string;
}

export interface JeroClosureReviewerResultV1 {
	readonly lens: string;
	readonly findings: readonly JeroClosureReviewerFindingV1[];
	readonly evidence: readonly string[];
	readonly result_hash: string;
}

export interface JeroLastEventClosureV1 {
	readonly schema: typeof JERO_LAST_EVENT_CLOSURE_SCHEMA;
	readonly operation: JeroCaptureClosureOperation;
	readonly lineage_id: string;
	readonly state: JeroLastEventClosureState;
	readonly store_revision: string;
	readonly action?: string;
	readonly target_identity?: string;
	readonly request_hash?: string;
	readonly correction_lines?: number;
	readonly advisory_findings?: JeroAdvisoryFindingsV1;
	readonly reviewer_results?: readonly JeroClosureReviewerResultV1[];
	readonly status_continuation?: JeroStatusContinuationV1;
	readonly acknowledgement?: unknown;
	readonly acknowledgement_undecodable?: true;
}

function statusContinuationV1(record: JeroLineageStateFileV1, cwd: string, repositoryContext: JeroRepositoryContextV1 | undefined): JeroStatusContinuationV1 {
	const arguments_: JeroTransitionArgumentV1[] = [
		{ name: "cwd", value: cwd, token: `--cwd=${cwd}` },
		{ name: "contract", value: "jero.authority/v1", token: "--contract=jero.authority/v1" },
		{ name: "next-transition", value: "true", token: "--next-transition=true" },
		{ name: "lineage", value: record.lineage_id, token: `--lineage=${record.lineage_id}` },
		{ name: "agent", value: "pi", token: "--agent=pi" },
	];
	return {
		operation: "review.status",
		arguments: arguments_,
		preconditions: [{ name: "state", value: "correction_required" }],
		binding: {
			lineage_id: record.lineage_id,
			revision: record.revision,
			target_identity: record.state.snapshot.identity,
			...(repositoryContext === undefined ? {} : { repository_context: repositoryContext.handle }),
		},
	};
}

/**
 * Builds a capture closure per the §E per-operation rules:
 * correction-plan MUST carry target_identity/request_hash/correction_lines
 * (1..200) and MUST NOT carry action/advisory/continuation/reviewer_results,
 * with state correction_required; result/refuter closures in
 * correction_required REQUIRE a status_continuation, every other combination
 * forbids it; action/advisory_findings/reviewer_results/acknowledgement are
 * approved-only.
 */
export function buildJeroLastEventClosureV1(input: {
	readonly operation: JeroCaptureClosureOperation;
	readonly record: JeroLineageStateFileV1;
	readonly state: JeroLastEventClosureState;
	readonly cwd: string;
	readonly repositoryContext?: JeroRepositoryContextV1;
	readonly requestHash?: string;
	readonly correctionLines?: number;
	readonly advisoryFindings?: JeroAdvisoryFindingsV1;
	readonly reviewerResults?: readonly JeroClosureReviewerResultV1[];
	readonly acknowledgement?: unknown;
}): JeroLastEventClosureV1 {
	const base: Pick<JeroLastEventClosureV1, "schema" | "operation" | "lineage_id" | "state" | "store_revision"> = {
		schema: JERO_LAST_EVENT_CLOSURE_SCHEMA,
		operation: input.operation,
		lineage_id: input.record.lineage_id,
		state: input.state,
		store_revision: input.record.revision,
	};
	if (input.operation === JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN) {
		if (input.state !== "correction_required") throw new TypeError("correction-plan closure requires correction_required state");
		if (input.requestHash === undefined || !/^sha256:[0-9a-f]{64}$/.test(input.requestHash)) throw new TypeError("correction-plan closure requires a canonical request_hash");
		if (input.correctionLines === undefined || !Number.isSafeInteger(input.correctionLines) || input.correctionLines < 1 || input.correctionLines > 200) {
			throw new TypeError("correction-plan closure requires correction_lines in 1..200");
		}
		return {
			...base,
			target_identity: input.record.state.snapshot.identity,
			request_hash: input.requestHash,
			correction_lines: input.correctionLines,
		};
	}
	const requiresContinuation = input.state === "correction_required" && (
		input.operation === JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT || input.operation === JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_REFUTER
	);
	if (typeof input.cwd !== "string" || input.cwd.length === 0) throw new TypeError("closure construction requires the repository cwd for its status continuation binding");
	if (input.state !== "approved" && (input.advisoryFindings !== undefined || input.reviewerResults !== undefined || input.acknowledgement !== undefined)) {
		throw new TypeError("advisory_findings, reviewer_results, and acknowledgement are approved-only");
	}
	return {
		...base,
		...(input.state === "approved" || input.state === "correction_required" ? { action: input.state === "approved" ? JERO_APPROVED_CLOSURE_ACTION : JERO_CORRECTION_REQUIRED_CLOSURE_ACTION } : {}),
		...(input.state === "approved" && input.advisoryFindings !== undefined ? { advisory_findings: input.advisoryFindings } : {}),
		...(input.state === "approved" && input.reviewerResults !== undefined ? { reviewer_results: input.reviewerResults } : {}),
		...(requiresContinuation ? { status_continuation: statusContinuationV1(input.record, input.cwd, input.repositoryContext) } : {}),
		...(input.state === "approved" && input.acknowledgement !== undefined ? { acknowledgement: input.acknowledgement } : {}),
	};
}

/**
 * Assembles advisory findings from the resolved record (spec §E): a refuted
 * severe finding rides with disposition `refuted`; follow-up observations
 * map to `follow_up`; informational outcomes map to `informational`.
 * Approved-only — the caller enforces the state gate.
 */
export function jeroAdvisoryFindingsFromStateV1(state: JeroReviewTransactionStateV1): JeroAdvisoryFindingsV1 | undefined {
	const findings: JeroAdvisoryFindingV1[] = [];
	const byId = new Map(state.findings.map((finding) => [finding.id, finding]));
	for (const [id, outcome] of Object.entries(state.outcomes)) {
		const finding = byId.get(id);
		if (finding === undefined) continue;
		if (outcome === "refuted") {
			findings.push({
				id,
				...(finding.lens === undefined ? {} : { lens: finding.lens }),
				...(finding.location === undefined ? {} : { location: finding.location }),
				severity: finding.severity ?? "WARNING",
				disposition: "refuted",
			});
		} else if (outcome === "info" && finding.severity !== undefined && (finding.severity === "WARNING" || finding.severity === "SUGGESTION")) {
			findings.push({
				id,
				...(finding.lens === undefined ? {} : { lens: finding.lens }),
				...(finding.location === undefined ? {} : { location: finding.location }),
				severity: finding.severity,
				disposition: "informational",
			});
		}
	}
	for (const followUp of state.follow_ups) {
		// NIT (review): a stable derived id, not a prose-prefix truncation —
		// `jeroDomainHash("follow-up", observation)` is deterministic per
		// observation and cannot collide with finding ids or drift when the
		// observation text carries no ":" separator.
		findings.push({ id: `fup1_${jeroDomainHash("follow-up", followUp.observation)}`, severity: "SUGGESTION", disposition: "follow_up" });
	}
	if (findings.length === 0) return undefined;
	return { statement: JERO_ADVISORY_FINDINGS_STATEMENT, findings };
}

/**
 * Defensive acknowledgement decode (spec §E): an undecodable acknowledgement
 * degrades to the `acknowledgementUndecodable` flag, never a throw. The
 * jero acknowledgement shape is `jero.authority.review-acknowledged/v1`
 * with the exact `review/acknowledge-approved` operation.
 */
export function decodeJeroClosureAcknowledgementV1(value: unknown): { ok: true; acknowledgement: Record<string, unknown> } | { ok: false } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false };
	const parsed = value as Record<string, unknown>;
	if (parsed.schema !== "jero.authority.review-acknowledged/v1") return { ok: false };
	if (parsed.operation !== "review/acknowledge-approved") return { ok: false };
	if (parsed.action !== "acknowledged" || parsed.authority !== "burned") return { ok: false };
	for (const key of ["lineage_id", "target_identity", "consumed_revision"]) {
		if (typeof parsed[key] !== "string" || (parsed[key] as string).length === 0) return { ok: false };
	}
	return { ok: true, acknowledgement: parsed };
}

/**
 * Strict closure decode mirroring the §E decoder rules (conformance surface
 * + defensive acknowledgement): correction-plan field discipline,
 * continuation required/forbidden pairs, approved-only optional members,
 * continuation binding cross-checks against the enclosing closure.
 */
export function decodeJeroLastEventClosureV1(value: unknown, label = "last_event_closure"): JeroLastEventClosureV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label}: expected object`);
	const parsed = value as Record<string, unknown>;
	for (const key of Object.keys(parsed)) {
		if (!["schema", "operation", "lineage_id", "state", "store_revision", "target_identity", "request_hash", "correction_lines", "action", "advisory_findings", "reviewer_results", "status_continuation", "acknowledgement"].includes(key)) {
			throw new TypeError(`${label}: unknown key "${key}"`);
		}
	}
	if (parsed.schema !== JERO_LAST_EVENT_CLOSURE_SCHEMA) throw new TypeError(`${label}.schema must be ${JERO_LAST_EVENT_CLOSURE_SCHEMA}`);
	const operation = parsed.operation as JeroCaptureClosureOperation;
	if (!(Object.values(JERO_CAPTURE_CLOSURE_OPERATIONS) as readonly string[]).includes(operation)) throw new TypeError(`${label}.operation is unsupported`);
	const state = parsed.state as JeroLastEventClosureState;
	if (!(JERO_LAST_EVENT_CLOSURE_STATES as readonly string[]).includes(state)) throw new TypeError(`${label}.state is unsupported`);
	if (typeof parsed.lineage_id !== "string" || !/^review-[0-9a-f]{16}$/.test(parsed.lineage_id)) throw new TypeError(`${label}.lineage_id is malformed`);
	if (typeof parsed.store_revision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(parsed.store_revision)) throw new TypeError(`${label}.store_revision is malformed`);
	const shared: Pick<JeroLastEventClosureV1, "schema" | "operation" | "lineage_id" | "state" | "store_revision"> = { schema: JERO_LAST_EVENT_CLOSURE_SCHEMA, operation, lineage_id: parsed.lineage_id, state, store_revision: parsed.store_revision };
	if (operation === JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_CORRECTION_PLAN) {
		if (parsed.reviewer_results !== undefined) throw new TypeError(`${label}: reviewer_results requires approved state`);
		if (parsed.action !== undefined || parsed.advisory_findings !== undefined || parsed.status_continuation !== undefined) {
			throw new TypeError(`${label}: correction-plan cannot carry action, advisory_findings, or status_continuation`);
		}
		if (state !== "correction_required") throw new TypeError(`${label}: correction-plan requires correction_required state`);
		if (typeof parsed.request_hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(parsed.request_hash)) throw new TypeError(`${label}.request_hash is malformed`);
		if (typeof parsed.correction_lines !== "number" || !Number.isSafeInteger(parsed.correction_lines) || parsed.correction_lines < 1 || parsed.correction_lines > 200) {
			throw new TypeError(`${label}.correction_lines must be an integer in 1..200`);
		}
		return { ...shared, target_identity: parsed.target_identity as string, request_hash: parsed.request_hash, correction_lines: parsed.correction_lines };
	}
	if (parsed.target_identity !== undefined || parsed.request_hash !== undefined || parsed.correction_lines !== undefined) {
		throw new TypeError(`${label}: terminal capture cannot carry correction-plan fields`);
	}
	const requiresStatusContinuation = state === "correction_required" && (operation === JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT || operation === JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_REFUTER);
	if (requiresStatusContinuation && parsed.status_continuation === undefined) throw new TypeError(`${label}: status_continuation is required for correction-required result or refuter capture`);
	if (!requiresStatusContinuation && parsed.status_continuation !== undefined) throw new TypeError(`${label}: status_continuation is only valid for correction-required result or refuter capture`);
	let statusContinuation: JeroStatusContinuationV1 | undefined;
	if (parsed.status_continuation !== undefined) {
		const continuation = parsed.status_continuation as Record<string, unknown>;
		if (continuation.operation !== "review.status") throw new TypeError(`${label}.status_continuation.operation must be review.status`);
		const argumentsList = continuation.arguments as JeroTransitionArgumentV1[] | undefined;
		if (!Array.isArray(argumentsList) || argumentsList.some((argument) => typeof argument.token !== "string")) throw new TypeError(`${label}.status_continuation.arguments require exact tokens`);
		const lineageArguments = argumentsList.filter((argument) => argument.name === "lineage");
		if (lineageArguments.length !== 1 || lineageArguments[0]!.value !== shared.lineage_id || lineageArguments[0]!.token !== `--lineage=${shared.lineage_id}`) {
			throw new TypeError(`${label}.status_continuation lineage argument does not match its enclosing closure`);
		}
		const binding = continuation.binding as Record<string, unknown> | undefined;
		if (binding === undefined || binding.lineage_id !== shared.lineage_id) throw new TypeError(`${label}.status_continuation lineage does not match its enclosing closure`);
		if (binding.revision !== shared.store_revision) throw new TypeError(`${label}.status_continuation revision does not match its enclosing closure`);
		if (!Array.isArray(continuation.preconditions) || continuation.preconditions.length === 0) throw new TypeError(`${label}.status_continuation.preconditions requires at least one entry`);
		statusContinuation = continuation as unknown as JeroStatusContinuationV1;
	}
	let acknowledgement: unknown;
	let acknowledgementUndecodable = false;
	if (parsed.acknowledgement !== undefined) {
		const decoded = decodeJeroClosureAcknowledgementV1(parsed.acknowledgement);
		if (decoded.ok) acknowledgement = decoded.acknowledgement;
		else acknowledgementUndecodable = true;
	}
	if (acknowledgementUndecodable && state !== "approved") throw new TypeError(`${label}: acknowledgement requires approved state`);
	if (acknowledgement !== undefined && state !== "approved") throw new TypeError(`${label}: acknowledgement requires approved state`);
	if (parsed.advisory_findings !== undefined && state !== "approved") throw new TypeError(`${label}: advisory_findings requires approved state`);
	if (parsed.reviewer_results !== undefined && state !== "approved") throw new TypeError(`${label}: reviewer_results requires approved state`);
	return {
		...shared,
		...(parsed.action === undefined ? {} : { action: parsed.action as string }),
		...(parsed.advisory_findings === undefined ? {} : { advisory_findings: parsed.advisory_findings as JeroAdvisoryFindingsV1 }),
		...(parsed.reviewer_results === undefined ? {} : { reviewer_results: parsed.reviewer_results as JeroClosureReviewerResultV1[] }),
		...(statusContinuation === undefined ? {} : { status_continuation: statusContinuation }),
		...(acknowledgement === undefined ? {} : { acknowledgement }),
		...(acknowledgementUndecodable ? { acknowledgement_undecodable: true as const } : {}),
	};
}

/**
 * JP twin of assertReviewLastEventClosureBinding (§E): validates the closure
 * against the caller's held STATUS binding. Only non-approved wire states
 * appear in closures; `correction_required` is the persisted correction
 * phase projection (transitions.ts).
 */
export function assertJeroLastEventClosureBindingV1(closure: JeroLastEventClosureV1, binding: { lineageId: string; targetIdentity?: string; requestHash?: string }): void {
	if (closure.lineage_id !== binding.lineageId) throw new TypeError("last-event closure lineage does not match its provider binding");
	if (binding.targetIdentity !== undefined && closure.target_identity !== undefined && closure.target_identity !== binding.targetIdentity) {
		throw new TypeError("last-event closure target does not match its provider binding");
	}
	if (binding.targetIdentity !== undefined && closure.status_continuation !== undefined && closure.status_continuation.binding.target_identity !== binding.targetIdentity) {
		throw new TypeError("last-event closure status continuation target does not match its provider binding");
	}
	if (binding.requestHash !== undefined && closure.request_hash !== undefined && closure.request_hash !== binding.requestHash) {
		throw new TypeError("last-event closure request hash does not match its provider binding");
	}
}
