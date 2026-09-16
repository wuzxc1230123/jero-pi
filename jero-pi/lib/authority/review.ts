import { JeroLineageStoreV1 } from "./lineage-store.ts";
import { JeroObjectCasV1 } from "./object-cas.ts";
import { JeroAuthorityLocksV1 } from "./locks.ts";
import { resolveJeroAuthorityStoreV1, type JeroAuthorityStoreV1 } from "./store-root.ts";
import { reviewStartV1, type JeroReviewStartResultV1, type JeroReviewStartSelectionV1, type JeroReviewStartTargetV1 } from "./start.ts";
import { reviewStatusV1, type JeroReviewStatusResultV1, type JeroReviewStatusTargetV1 } from "./status.ts";
import { reviewFinalizeV1, type JeroReviewFinalizeInputV1, type JeroReviewFinalizeResultV1 } from "./finalize.ts";
import { reviewValidateV1, type JeroReviewValidateInputV1, type JeroReviewValidateResultV1 } from "./validate.ts";
import { reviewAcknowledgeV1, type JeroReviewAcknowledgeInputV1, type JeroReviewAcknowledgeResultV1 } from "./acknowledge.ts";
import { renderJeroCaptureBindingV1, nextJeroCaptureSlotsV1, type JeroCaptureRenderResultV1, type JeroCaptureSlotV1 } from "./capture.ts";
import {
	admitJeroJudgmentDayJudgesV1,
	admitJeroJudgmentDayDiscoveryFreezeV1,
	admitJeroJudgmentDayFixV1,
	admitJeroJudgmentDayRejudgmentV1,
	admitJeroJudgmentDayFinalVerificationV1,
	renderJeroJudgmentDayJudgeVectorsV1,
	buildJeroJudgmentDayRejudgmentRequestV1,
	type JeroJudgmentDayResultV1,
} from "./judgment-day.ts";
import { assessJeroReviewRiskV1, type JeroRiskAssessRequestV1 } from "./risk-assess.ts";
import { getJeroReviewModeV1, setJeroReviewModeV1, type JeroReviewModeOutcomeV1 } from "./mode.ts";
import { jeroSddStatusV1, type JeroSddStatusResultV1 } from "./sdd-status.ts";
import { jeroSddContinueV1, type JeroSddContinueResultV1 } from "./sdd-continue.ts";
import { acquireJeroSddAttemptV1, jeroSddAttemptLedgerRevisionV1, settleJeroSddAttemptV1, type JeroSddAcquireInputV1, type JeroSddAttemptResultV1, type JeroSddSettleInputV1 } from "./sdd-attempt.ts";
import type { JeroReviewModeValue } from "./protocol.ts";
import type { ReviewAssessmentV1 } from "../review-risk-assessment.ts";

// The single extensions-facing facade over the resolved jero authority store
// (design §5.1.1 table): `authority.review.start/status/finalize/validate/
// acknowledge`, `authority.risk.assess`, `authority.mode.get/set`. This
// module wires the M1 substrate (lineage store, CAS, locks, store root) into
// one context object; every API is a typed function in, discriminated union
// out. It imports NO extensions/ code and reads no environment variables —
// the §9 module boundary dependency-cruiser will pin.

export interface JeroAuthorityContextV1 {
	/** The resolved (foreign-checked, identity-pinned) jero authority store. */
	readonly store: JeroAuthorityStoreV1;
	/** Lineage records under `<store>/lineages/`. */
	readonly lineages: JeroLineageStoreV1;
	/** Content-addressed objects under `<store>/objects/`. */
	readonly cas: JeroObjectCasV1;
	/** Authority mutation lock; backs the lineage store's mutating APIs and START's live-lock gate (released leftovers never block). */
	readonly locks: JeroAuthorityLocksV1;
}

export type JeroAuthorityContextResolutionV1 =
	| { readonly kind: "ok"; readonly context: JeroAuthorityContextV1 }
	| { readonly kind: "refused"; readonly code: "not-a-git-repository" | "git-unavailable" | "authority-unavailable" | "foreign-authority-store"; readonly detail?: string };

/** Resolves the jero authority store and derives every substrate handle. */
export function resolveJeroAuthorityContextV1(cwd: string): JeroAuthorityContextResolutionV1 {
	const store = resolveJeroAuthorityStoreV1(cwd);
	if (store.kind !== "ok") {
		return { kind: "refused", code: store.kind, ...("detail" in store ? { detail: store.detail } : { detail: (store as { hits: readonly string[] }).hits.join(", ") }) };
	}
	// The locks wrapper is constructed FIRST so every mutating lineage-store
	// API runs under the authority mutation lock (findings F2): START,
	// FINALIZE, VALIDATE, and ACKNOWLEDGE all persist through this handle.
	// Reads (load/list) stay lock-free. No operation nests: none of the
	// apply() callbacks call back into the store, so withAuthorityLock
	// never re-enters acquire() (the underlying lock is exclusive-mkdir,
	// not re-entrant).
	const locks = new JeroAuthorityLocksV1(store.store_root, store.repository_id, store.authority_id);
	const context: JeroAuthorityContextV1 = {
		store,
		lineages: JeroLineageStoreV1.forStore(store.store_root, { lock: locks }),
		cas: JeroObjectCasV1.forStore(store.store_root),
		locks,
	};
	return { kind: "ok", context };
}

export const authority = {
	review: {
		/** Spec §B — START: freeze, consent gate, created/resumed/replayed/closed variants. */
		start: (context: JeroAuthorityContextV1, target: JeroReviewStartTargetV1, selection?: JeroReviewStartSelectionV1): JeroReviewStartResultV1 =>
			reviewStartV1(context, target, selection ?? {}),
		/** Spec §C — STATUS: read-only applicability quadruple. */
		status: (context: JeroAuthorityContextV1, target: JeroReviewStatusTargetV1): JeroReviewStatusResultV1 =>
			reviewStatusV1(context, target),
		/** Spec §D — FINALIZE: lens admission, evidence resolution, correction, final verification. */
		finalize: (context: JeroAuthorityContextV1, input: JeroReviewFinalizeInputV1): JeroReviewFinalizeResultV1 =>
			reviewFinalizeV1(context, input),
		/** Spec §E — VALIDATE: evidence-first correction ordering + targeted validation. */
		validate: (context: JeroAuthorityContextV1, input: JeroReviewValidateInputV1): JeroReviewValidateResultV1 =>
			reviewValidateV1(context, input),
		/** Spec §F — ACKNOWLEDGE: the approved-authority burn, journaled exactly-once. */
		acknowledge: (context: JeroAuthorityContextV1, input: JeroReviewAcknowledgeInputV1): JeroReviewAcknowledgeResultV1 =>
			reviewAcknowledgeV1(context, input),
	},
	capture: {
		/** Spec §A/§I.1 — renderBinding: the four capture slots rendered in-process (store-pure, spawn-free). */
		renderBinding: (slot: JeroCaptureSlotV1): JeroCaptureRenderResultV1 => renderJeroCaptureBindingV1(slot),
		/** Spec §I.1 — the slots the lineage's current state offers. */
		nextSlots: (context: JeroAuthorityContextV1, lineageId: string) => nextJeroCaptureSlotsV1(context, lineageId),
	},
	judgmentDay: {
		/** Spec §F — the two blind judge prompt vectors for discovery. */
		renderJudgeVectors: (context: JeroAuthorityContextV1, lineageId: string) => renderJeroJudgmentDayJudgeVectorsV1(context, lineageId),
		/** Spec §F — confirm-judges: admit exactly two blind judges, zero refuters. */
		confirmJudges: (context: JeroAuthorityContextV1, input: Parameters<typeof admitJeroJudgmentDayJudgesV1>[1]): JeroJudgmentDayResultV1 => admitJeroJudgmentDayJudgesV1(context, input),
		/** Spec §F — freeze-judgment-ledger: freeze the merged judge rows; zero severe skips to final verification. */
		freezeDiscovery: (context: JeroAuthorityContextV1, input: { readonly lineageId: string }): JeroJudgmentDayResultV1 => admitJeroJudgmentDayDiscoveryFreezeV1(context, input),
		/** Spec §F — the one-batch fix covering every surviving finding. */
		applyFix: (context: JeroAuthorityContextV1, input: Parameters<typeof admitJeroJudgmentDayFixV1>[1]): JeroJudgmentDayResultV1 => admitJeroJudgmentDayFixV1(context, input),
		/** Spec §F — the expected scoped re-judgment request. */
		rejudgmentRequest: (context: JeroAuthorityContextV1, lineageId: string) => buildJeroJudgmentDayRejudgmentRequestV1(context, lineageId),
		/** Spec §F — scoped re-judgment: survivor = not verified by BOTH judges; round-2 survivors escalate. */
		rejudge: (context: JeroAuthorityContextV1, input: Parameters<typeof admitJeroJudgmentDayRejudgmentV1>[1]): JeroJudgmentDayResultV1 => admitJeroJudgmentDayRejudgmentV1(context, input),
		/** Spec §F — the final-verification tail (ordinary verify + round-2-survivor escalation). */
		finalVerification: (context: JeroAuthorityContextV1, input: Parameters<typeof admitJeroJudgmentDayFinalVerificationV1>[1]): JeroJudgmentDayResultV1 => admitJeroJudgmentDayFinalVerificationV1(context, input),
	},
	risk: {
		/** Spec §I.7 — read-only risk assessment; failures fail closed to high. */
		assess: (request: JeroRiskAssessRequestV1): ReviewAssessmentV1 => assessJeroReviewRiskV1(request),
	},
	mode: {
		/** Spec §I.8 — read-only mode status (global + clone + effective). */
		get: (cwd: string): JeroReviewModeOutcomeV1 => getJeroReviewModeV1(cwd),
		/** Spec §I.8 — clone-scoped mode mutation only. */
		set: (cwd: string, value: JeroReviewModeValue): JeroReviewModeOutcomeV1 => setJeroReviewModeV1(cwd, value),
	},
	sdd: {
		/** Spec §A.1 — the pure status projection over the openspec tree. */
		status: (context: JeroAuthorityContextV1, request: { changeName?: string; workspaceRoot: string }): JeroSddStatusResultV1 =>
			jeroSddStatusV1(context, request),
		/** Spec §A.4 — the mutating continuation with an exact selected change. */
		continue: (context: JeroAuthorityContextV1, request: { changeName: string; workspaceRoot: string }): JeroSddContinueResultV1 =>
			jeroSddContinueV1(context, request),
		attempt: {
			/** Spec §A.2 — acquire: single live attempt, durable before launch (R1), token admission (R2). */
			acquire: (context: JeroAuthorityContextV1, input: JeroSddAcquireInputV1): JeroSddAttemptResultV1 =>
				acquireJeroSddAttemptV1(context, input),
			/** Spec §A.3 — settle: single finalization (R3), verbatim untracked scope (R4), evidence pairing. */
			settle: (context: JeroAuthorityContextV1, input: JeroSddSettleInputV1): JeroSddAttemptResultV1 =>
				settleJeroSddAttemptV1(context, input),
			/** The ledger revision callers pin as expectedRevision. */
			revision: (context: JeroAuthorityContextV1, workspaceRoot: string, changeName: string): string | undefined =>
				jeroSddAttemptLedgerRevisionV1(context, workspaceRoot, changeName),
		},
	},
} as const;

export type Authority = typeof authority;
