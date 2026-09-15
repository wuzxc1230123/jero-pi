import type { JeroLensName, JeroReviewMode, JeroReviewStateName } from "./protocol.ts";

// Pure review-authority transition table (spec §A.2), the persisted→wire
// state projection (spec §A.1), and status action/reason-code derivation
// (spec §C.3). No IO, no environment reads, no store access — every function
// here is a total function over typed inputs so the illegal-transition
// battery can pin each fail-closed case without fixtures.

// ---------------------------------------------------------------------------
// §A.1 Persisted (13) → wire (15) state projection
// ---------------------------------------------------------------------------

export const JERO_WIRE_REVIEW_STATES = [
	"unreviewed", "reviewing", "judges_confirmed", "findings_frozen", "evidence_classified",
	"fix_required", "fixing", "fix_validating", "correction_required", "validating",
	"ready_final_verification", "final_verifying", "approved", "escalated", "invalidated",
] as const;
export type JeroWireReviewState = (typeof JERO_WIRE_REVIEW_STATES)[number];

const PERSISTED_TO_WIRE: Readonly<Record<JeroReviewStateName, JeroWireReviewState>> = {
	unreviewed: "unreviewed",
	reviewing: "reviewing",
	judges_confirmed: "judges_confirmed",
	findings_frozen: "findings_frozen",
	evidence_classified: "evidence_classified",
	// The persisted record has no wire `correction_required`; the open
	// correction phase (fix_required|fixing) projects onto it (spec §A.1).
	fix_required: "correction_required",
	fixing: "correction_required",
	// fix_validating | ready_final_verification | final_verifying project onto
	// the wire `validating` aggregate (spec §A.1).
	fix_validating: "validating",
	ready_final_verification: "validating",
	final_verifying: "validating",
	approved: "approved",
	escalated: "escalated",
	invalidated: "invalidated",
};

/** Persisted 13-state → wire 15-state projection (spec §A.1 mapping, locked by tests). */
export function projectJeroReviewStateV1(state: JeroReviewStateName): JeroWireReviewState {
	return PERSISTED_TO_WIRE[state];
}

export const JERO_TERMINAL_REVIEW_STATES = ["approved", "escalated", "invalidated"] as const;
export type JeroTerminalReviewState = (typeof JERO_TERMINAL_REVIEW_STATES)[number];

export function isJeroTerminalReviewStateV1(state: JeroReviewStateName): state is JeroTerminalReviewState {
	return (JERO_TERMINAL_REVIEW_STATES as readonly string[]).includes(state);
}

// ---------------------------------------------------------------------------
// §A.2 Transition table
// ---------------------------------------------------------------------------

export const JERO_REVIEW_EVENT_KINDS = [
	"freeze-ledger", "confirm-judges", "freeze-judgment-ledger", "resolve-evidence",
	"authorize-fix", "apply-fix", "validate-fix", "reopen-fix",
	"record-final-evidence", "finalize-outcome", "acknowledge", "escalate", "invalidate",
] as const;
export type JeroReviewEventKind = (typeof JERO_REVIEW_EVENT_KINDS)[number];

export interface JeroTransitionCheckV1 {
	readonly legal: boolean;
	readonly from: JeroReviewStateName;
	readonly event: JeroReviewEventKind;
	readonly next?: JeroReviewStateName;
	readonly reason?: string;
}

/** Guards that do not depend on record content beyond state/mode/counters. */
interface JeroTransitionGuardsV1 {
	/** Ordinary: at most one correction transaction (fix_rounds ≤ 1). */
	readonly fixRounds: number;
	/** JD: at most two fix batches. */
	readonly fixBatches: number;
}

const ORDINARY_MODES: readonly JeroReviewMode[] = ["ordinary_4r", "ordinary_bounded"];

export function isJeroOrdinaryModeV1(mode: JeroReviewMode): boolean {
	return ORDINARY_MODES.includes(mode);
}

/**
 * The definitive transition table over persisted states (spec §A.2). Every
 * entry not listed here is illegal; every mutation from a terminal state is
 * illegal regardless of mode; cross-mode events (a Judgment Day event on an
 * ordinary lineage and vice versa) are illegal while preserving counters.
 */
export function checkJeroReviewTransitionV1(
	state: JeroReviewStateName,
	mode: JeroReviewMode,
	event: JeroReviewEventKind,
	guards: JeroTransitionGuardsV1 = { fixRounds: 0, fixBatches: 0 },
): JeroTransitionCheckV1 {
	const base = { from: state, event };
	if (isJeroTerminalReviewStateV1(state) && event !== "escalate" && event !== "invalidate" && event !== "acknowledge") {
		// ILLEGAL #1: terminal mutation fails closed. `escalate` from escalated
		// and `invalidate` stay legal only as maintenance-surface no-ops that M5 owns;
		// `acknowledge` is the one approved-only burn (row 10, authority-level).
		return { ...base, legal: false, reason: `terminal-state-${state}-is-immutable` };
	}
	if (event === "invalidate") {
		return { ...base, legal: !isJeroTerminalReviewStateV1(state) || state === "invalidated", next: "invalidated" };
	}
	if (event === "escalate") {
		return state === "escalated"
			? { ...base, legal: true, next: "escalated" }
			: isJeroTerminalReviewStateV1(state)
				? { ...base, legal: false, reason: `terminal-state-${state}-is-immutable` }
				: { ...base, legal: true, next: "escalated" };
	}
	const ordinary = isJeroOrdinaryModeV1(mode);
	if (ordinary && (event === "confirm-judges" || event === "freeze-judgment-ledger")) {
		// ILLEGAL #9: JD op on ordinary lineage.
		return { ...base, legal: false, reason: "cross-mode-operation-refused" };
	}
	if (!ordinary && (event === "freeze-ledger")) {
		// The ordinary lens admission is not a JD event (JD freezes through its
		// own judges_confirmed state).
		return { ...base, legal: false, reason: "cross-mode-operation-refused" };
	}
	switch (event) {
		case "freeze-ledger":
			// ILLEGAL #2: lenses run exactly once, only from `reviewing`.
			return state === "reviewing"
				? { ...base, legal: true, next: "findings_frozen" }
				: { ...base, legal: false, reason: "lens-admission-requires-reviewing" };
		case "confirm-judges":
			return state === "reviewing"
				? { ...base, legal: true, next: "judges_confirmed" }
				: { ...base, legal: false, reason: "judge-admission-requires-reviewing" };
		case "freeze-judgment-ledger":
			return state === "judges_confirmed"
				? { ...base, legal: true, next: "findings_frozen" }
				: { ...base, legal: false, reason: "judgment-freeze-requires-judges-confirmed" };
		case "resolve-evidence":
			// ILLEGAL #3: evidence resolution requires a frozen ledger.
			return state === "findings_frozen"
				? { ...base, legal: true, next: "evidence_classified" }
				: { ...base, legal: false, reason: "resolve-evidence-requires-frozen-ledger" };
		case "authorize-fix": {
			if (state !== "fix_required" && !(mode === "judgment_day" && state === "judges_confirmed")) {
				return { ...base, legal: false, reason: "authorize-fix-requires-fix-required" };
			}
			// ILLEGAL #4: a second correction transaction fails closed.
			if (ordinary && guards.fixRounds >= 1) return { ...base, legal: false, reason: "second-correction-refused" };
			if (!ordinary && guards.fixBatches >= 2) return { ...base, legal: false, reason: "judgment-day-fix-budget-exhausted" };
			return { ...base, legal: true, next: "fixing" };
		}
		case "apply-fix":
			return state === "fixing"
				? { ...base, legal: true, next: "fix_validating" }
				: { ...base, legal: false, reason: "apply-fix-requires-fixing" };
		case "validate-fix":
			return state === "fix_validating"
				? { ...base, legal: true, next: "ready_final_verification" }
				: { ...base, legal: false, reason: "validate-fix-requires-fix-validating" };
		case "reopen-fix":
			// §A.2 row 7c: verification_failed reopens the correction (not a new
			// transaction); nothing is charged.
			return state === "fix_validating"
				? { ...base, legal: true, next: "fixing" }
				: { ...base, legal: false, reason: "reopen-fix-requires-fix-validating" };
		case "record-final-evidence":
			return state === "ready_final_verification"
				? { ...base, legal: true, next: "final_verifying" }
				: { ...base, legal: false, reason: "final-evidence-requires-ready-final-verification" };
		case "finalize-outcome":
			return state === "final_verifying"
				? { ...base, legal: true, next: "final_verifying" }
				: { ...base, legal: false, reason: "finalize-outcome-requires-final-verifying" };
		case "acknowledge":
			// ILLEGAL #8: acknowledge on non-approved fails closed.
			return state === "approved"
				? { ...base, legal: true, next: "approved" }
				: { ...base, legal: false, reason: "acknowledge-requires-approved" };
		default:
			return { ...base, legal: false, reason: "unknown-transition-event" };
	}
}

/** Mutable authority operations every terminal state refuses. The acknowledge burn is NOT in this list: it is authority-level (row 10), legal only from `approved`. */
export const JERO_TERMINAL_MUTATION_EVENTS: readonly JeroReviewEventKind[] = [
	"freeze-ledger", "confirm-judges", "freeze-judgment-ledger", "resolve-evidence",
	"authorize-fix", "apply-fix", "validate-fix", "reopen-fix",
	"record-final-evidence", "finalize-outcome",
];

// ---------------------------------------------------------------------------
// §C.3 Status action vocabulary and derivation
// ---------------------------------------------------------------------------

// The wire schema union (status-v2.schema.json action enum), NOT the narrower
// upstream TS decoder set — spec discrepancy #2 resolves to the schema union:
// real captures carry `action:"finalize"` and M2 owns that operation.
export const JERO_STATUS_ACTIONS = [
	"start", "finalize", "validate", "recover", "retry_final_verification",
	"maintainer_action", "select_lineage", "repair_authority", "reconcile_finalize", "stop",
] as const;
export type JeroStatusAction = (typeof JERO_STATUS_ACTIONS)[number];

export const JERO_REPLAYABILITY = ["not_replayable", "exact_replay_safe", "status_required", "manual_action_required"] as const;
export type JeroReplayability = (typeof JERO_REPLAYABILITY)[number];

export const JERO_ESCALATION_CAUSES = [
	"unknown_causality", "insufficient_evidence", "missing_refuter_outcome",
	"targeted_validator_rejected", "correction_budget_exceeded", "unresolved_severe_findings",
] as const;
export type JeroEscalationCause = (typeof JERO_ESCALATION_CAUSES)[number];

export interface JeroNextTransitionV1 {
	readonly kind: "execute" | "collect" | "stop";
	readonly reason_code: string;
	readonly operation?: string;
}

export interface JeroStatusDerivationInputV1 {
	readonly state: JeroReviewStateName;
	readonly mode: JeroReviewMode;
	readonly selectedLenses: readonly JeroLensName[];
	readonly admittedLenses: readonly JeroLensName[];
	readonly pendingRefuterIds: readonly string[];
	readonly fixFindingIds: readonly string[];
	readonly consumed: boolean;
}

/**
 * Derives the status action (schema-union vocabulary) and the authority's
 * routing `next_transition` from the persisted record (spec §C.3). Internal
 * routing derives from next_transition; the action is the summary vocabulary.
 */
export function deriveJeroStatusActionV1(input: JeroStatusDerivationInputV1): { action: JeroStatusAction; next: JeroNextTransitionV1 } {
	if (input.consumed) {
		return { action: "stop", next: { kind: "stop", reason_code: "authority_consumed" } };
	}
	switch (input.state) {
		case "unreviewed":
		case "reviewing": {
			const complete = input.selectedLenses.length > 0 &&
				input.selectedLenses.every((lens) => input.admittedLenses.includes(lens));
			if (input.selectedLenses.length === 0) {
				return { action: "finalize", next: { kind: "execute", reason_code: "captured_results_ready", operation: "review.finalize" } };
			}
			return complete
				? { action: "finalize", next: { kind: "execute", reason_code: "captured_results_ready", operation: "review.finalize" } }
				: { action: "start", next: { kind: "collect", reason_code: "reviewer_results_required" } };
		}
		case "judges_confirmed":
			return { action: "finalize", next: { kind: "execute", reason_code: "judgment_ledger_ready", operation: "review.finalize" } };
		case "findings_frozen":
			return input.pendingRefuterIds.length > 0
				? { action: "finalize", next: { kind: "collect", reason_code: "refuter_outcome_required", operation: "review.finalize" } }
				: { action: "finalize", next: { kind: "collect", reason_code: "evidence_classification_required", operation: "review.finalize" } };
		case "evidence_classified":
			return input.fixFindingIds.length > 0
				? { action: "finalize", next: { kind: "collect", reason_code: "correction_plan_required", operation: "review.finalize" } }
				: { action: "finalize", next: { kind: "execute", reason_code: "final_verification_ready", operation: "review.finalize" } };
		case "fix_required":
		case "fixing":
			return { action: "finalize", next: { kind: "collect", reason_code: "correction_plan_required", operation: "review.finalize" } };
		case "fix_validating":
			return { action: "validate", next: { kind: "execute", reason_code: "targeted_validation_ready", operation: "review.validate" } };
		case "ready_final_verification":
			return { action: "finalize", next: { kind: "collect", reason_code: "final_evidence_required", operation: "review.finalize" } };
		case "final_verifying":
			return { action: "finalize", next: { kind: "execute", reason_code: "final_outcome_required", operation: "review.finalize" } };
		case "approved":
			return { action: "stop", next: { kind: "execute", reason_code: "approved_awaiting_acknowledgement", operation: "review.acknowledge-approved" } };
		case "escalated":
			return { action: "maintainer_action", next: { kind: "stop", reason_code: "escalated_terminal" } };
		case "invalidated":
			return { action: "maintainer_action", next: { kind: "stop", reason_code: "invalidated_terminal" } };
		default:
			return { action: "stop", next: { kind: "stop", reason_code: "unknown_state" } };
	}
}
