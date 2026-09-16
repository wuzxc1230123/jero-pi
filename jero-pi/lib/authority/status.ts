import { readFileSync } from "node:fs";
import { parseCanonicalJsonV1 } from "../review-canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroLensName } from "./protocol.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import { isJeroLineageConsumedV1 } from "./start.ts";
import { isJeroLineageId } from "./store-root.ts";
import { deriveJeroReviewSnapshotV1, jeroReviewPolicyHashV1 } from "./snapshots.ts";
import { deriveJeroStatusActionV1, projectJeroReviewStateV1, type JeroNextTransitionV1, type JeroReplayability, type JeroStatusAction, type JeroWireReviewState } from "./transitions.ts";
import { assertJeroReceiptIntegrityV1, jeroReceiptPathV1 } from "./receipts.ts";
import type { JeroReceiptEnvelopeV1 } from "./protocol.ts";
import { mintJeroRepositoryContextV1, type JeroRepositoryContextV1 } from "./repository-context.ts";
import {
	buildJeroCorrectionPlanCollectInputV1,
	buildJeroFinalizeExecuteTransitionV1,
	buildJeroRefuterCollectInputV1,
	buildJeroReviewerResultCollectInputsV1,
	buildJeroValidationCollectInputV1,
} from "./collect-inputs.ts";
import { capturedJeroArtifactsCompleteV1, jeroResultArtifactSummariesV1 } from "./result-artifacts.ts";

// `authority.review.status` (spec §C): read-only applicability determination
// (`current_target | unrelated | ambiguous | corrupted`) recomputed from Git
// — never from provider files — plus receipt status, action/replayability,
// the frozen block, and candidate lineage listing.
//
// M3 additions (spec §G/§I.2): lineage-bound matching for correction-phase
// states (an explicit lineageId, or the auto-match pass, never re-derives
// identity from the mutable workspace mid-correction); the frozen block
// ALWAYS comes from the record; STATUS current_target emits the full
// repository_context block; collect transitions carry their capture inputs
// and the finalize execute carries preconditions, admitted artifacts, and
// the repository-context binding.

export type JeroReviewApplicabilityV1 = "current_target" | "unrelated" | "ambiguous" | "corrupted";
export type JeroReceiptStatusV1 = "expected_missing" | "present" | "publication_pending" | "not_applicable";

export interface JeroReviewStatusTargetV1 {
	readonly cwd: string;
	readonly lineageId?: string;
	/** Requires `committedOnly: true`, exactly like START. */
	readonly baseRef?: string;
	readonly committedOnly?: boolean;
	/** M3 (§G): staged computes the live candidate from the Git INDEX via a temporary index. */
	readonly projection?: "workspace" | "staged";
}

export interface JeroAuthorityBlockV1 {
	readonly version: "jero-authority/v1";
	readonly lineage_id: string;
	readonly state: JeroWireReviewState;
	readonly generation: number;
	readonly revision: string;
	readonly consumed?: boolean;
}

export interface JeroFrozenBlockV1 {
	readonly tier: string;
	readonly original_changed_lines: number;
	readonly correction_budget: number;
	/** From the RECORD (M3 discrepancy #4): schema-optional — lineage-bound statuses omit it when the record predates the field. */
	readonly changed_path_manifest_sha256?: string;
}

export interface JeroStatusForecastV1 {
	readonly horizon: "partial";
	readonly steps: readonly { readonly step: 1; readonly kind: "execute" | "collect" | "stop"; readonly reason_code: string; readonly description: string }[];
}

export type JeroReviewStatusResultV1 =
	| { readonly kind: "refused"; readonly code: "not-a-git-repository" | "git-unavailable" | "authority-unavailable" | "foreign-authority-store" | "invalid-request" | "lineage-missing" | "snapshot-failed"; readonly detail?: string }
	| {
		readonly kind: "status";
		readonly applicability: JeroReviewApplicabilityV1;
		readonly target_identity: string;
		readonly projection: "workspace" | "staged";
		readonly receipt: { readonly status: JeroReceiptStatusV1 };
		readonly action: JeroStatusAction;
		readonly replayability: JeroReplayability;
		readonly authority?: JeroAuthorityBlockV1;
		readonly frozen?: JeroFrozenBlockV1;
		readonly candidates?: readonly string[];
		readonly next_transition: JeroNextTransitionV1;
		readonly forecast?: JeroStatusForecastV1;
		readonly repository_context?: JeroRepositoryContextV1;
		readonly corrupted_detail?: string;
	};

// The persisted states whose wire projection is the correction/validation
// aggregate: identity MUST NOT be re-derived from the mutable workspace
// (spec §G lineage-bound projection — the M2 workspace-drift note).
const CORRECTION_PHASE_STATES: ReadonlySet<string> = new Set(["fix_required", "fixing", "fix_validating", "ready_final_verification", "final_verifying"]);

function readReceiptV1(context: JeroAuthorityContextV1, lineageId: string): JeroReceiptEnvelopeV1 | undefined {
	try {
		const envelope = parseCanonicalJsonV1(readFileSync(jeroReceiptPathV1(context.store.store_root, lineageId))) as JeroReceiptEnvelopeV1;
		assertJeroReceiptIntegrityV1(envelope);
		return envelope;
	} catch {
		return undefined;
	}
}

function describeTransitionV1(next: JeroNextTransitionV1): JeroStatusForecastV1 {
	const descriptions: Readonly<Record<string, string>> = {
		reviewer_results_required: "reviewer results for every selected lens are required before finalization",
		captured_results_ready: "captured reviewer results are complete and ready for finalization",
		evidence_classification_required: "every finding requires an evidence classification",
		refuter_outcome_required: "inferential severe findings require exactly one complete refuter batch",
		correction_plan_required: "candidate-caused severe findings require one bounded correction",
		targeted_validation_ready: "correction evidence passed; targeted validation may run",
		final_evidence_required: "final verification evidence is required to close the transaction",
		final_outcome_required: "the final verification outcome is required",
		approved_awaiting_acknowledgement: "the approved authority awaits acknowledgement",
		escalated_terminal: "the lineage escalated terminally; a maintainer action is required",
		invalidated_terminal: "the lineage was invalidated; a maintainer action is required",
		authority_consumed: "the approved authority was consumed by acknowledgement; a fresh START is offered",
		judgment_ledger_ready: "the judgment ledger is ready to freeze",
		final_verification_ready: "evidence resolved; final verification may run",
	};
	return {
		horizon: "partial",
		steps: [{ step: 1, kind: next.kind, reason_code: next.reason_code, description: descriptions[next.reason_code] ?? next.reason_code }],
	};
}

/** Attaches the M3 collect/execute payloads to a derived next transition. */
function attachTransitionPayloadsV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, next: JeroNextTransitionV1, discovery: { readonly artifacts: readonly import("./result-artifacts.ts").JeroResultArtifactV1[] }): JeroNextTransitionV1 {
	const repositoryContext = mintJeroRepositoryContextV1(context, record, "status");
	if (next.reason_code === "targeted_validation_ready" && next.operation === "review.validate") {
		// §A.4 (Mi5): the provider-targeted-validator vector is a self-contained
		// COLLECT input (the relay routes it by capture operation) — the M2
		// derivation now carries kind "collect" and this attachment builds its
		// full request document; review.validate executes via
		// capture→admit→validate, never directly from STATUS.
		return { ...next, collect: { inputs: [buildJeroValidationCollectInputV1(context.store.store_root, record, repositoryContext)] } };
	}
	if (next.kind === "collect") {
		switch (next.reason_code) {
			case "reviewer_results_required":
				return { ...next, collect: { inputs: buildJeroReviewerResultCollectInputsV1(context.store.store_root, record, repositoryContext) } };
			case "refuter_outcome_required":
				return { ...next, collect: { inputs: [buildJeroRefuterCollectInputV1(record, repositoryContext)] } };
			case "correction_plan_required":
				return { ...next, collect: { inputs: [buildJeroCorrectionPlanCollectInputV1(record, repositoryContext)] } };
			default:
				return next;
		}
	}
	if (next.kind === "execute" && next.reason_code === "captured_results_ready" && next.operation === "review.finalize") {
		return { ...next, execute: buildJeroFinalizeExecuteTransitionV1(record, repositoryContext, jeroResultArtifactSummariesV1(discovery.artifacts)) };
	}
	return next;
}

function currentTargetStatusV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, live: { readonly risk: { readonly tier: string; readonly original_changed_lines: number; readonly correction_budget: number }; readonly changed_path_manifest_sha256?: string; readonly target_identity: string }, lineageBound: boolean, requestedProjection: "workspace" | "staged"): JeroReviewStatusResultV1 {
	const state = record.state;
	const consumed = isJeroLineageConsumedV1(record);
	// Admitted lenses derive from BOTH the record and the on-disk artifact
	// discovery (fixture: status-v5-repository-context — captured_results_ready
	// fires once the admitted artifacts are complete on disk, which happens
	// BEFORE the freeze-ledger journal step).
	const discovery = capturedJeroArtifactsCompleteV1(context, record);
	// MA4 coherence: a lens whose admitted artifact fails the disk verification
	// (deleted or rewritten result file) no longer counts as admitted here
	// either — STATUS re-offers the reviewer collect input instead of
	// advertising a finalize whose captured_artifacts=complete precondition
	// no longer holds.
	const unverifiedLenses = new Set(discovery.missing.map(({ lens }) => lens));
	const admittedLenses = [...new Set([
		...(state.lens_results ?? []).map(({ lens }) => lens),
		...discovery.artifacts.map(({ lens }) => lens).filter((lens) => !unverifiedLenses.has(lens)),
	])] as JeroLensName[];
	const { action, next } = deriveJeroStatusActionV1({
		state: state.state,
		mode: state.mode,
		selectedLenses: state.selected_lenses ?? [],
		admittedLenses,
		pendingRefuterIds: state.pending_refuter_ids,
		fixFindingIds: state.fix_finding_ids,
		consumed,
	});
	const terminal = state.state === "approved" || state.state === "escalated" || state.state === "invalidated";
	const receiptPresent = terminal && readReceiptV1(context, record.lineage_id) !== undefined;
	// Discrepancy #4: the frozen block comes from the RECORD. Only an
	// identity-matched (non-lineage-bound) status may fall back to the live
	// manifest digest for records that predate the persisted field.
	const frozenManifest = state.changed_path_manifest_sha256 ?? (lineageBound ? undefined : live.changed_path_manifest_sha256);
	const withPayloads = attachTransitionPayloadsV1(context, record, next, discovery);
	return {
		kind: "status",
		applicability: "current_target",
		target_identity: lineageBound ? state.snapshot.identity : live.target_identity,
		// Mi6 (review): echo the REQUESTED projection on current-target
		// statuses instead of hardcoding workspace.
		projection: requestedProjection,
		receipt: { status: consumed || terminal ? (receiptPresent ? "present" : "expected_missing") : "expected_missing" },
		action,
		replayability: "not_replayable",
		authority: {
			version: "jero-authority/v1",
			lineage_id: record.lineage_id,
			state: projectJeroReviewStateV1(state.state),
			generation: state.generation,
			revision: record.revision,
			...(consumed ? { consumed: true } : {}),
		},
		frozen: {
			tier: state.risk_level ?? live.risk.tier,
			original_changed_lines: state.original_changed_lines ?? live.risk.original_changed_lines,
			correction_budget: state.correction_budget ?? live.risk.correction_budget,
			...(frozenManifest === undefined ? {} : { changed_path_manifest_sha256: frozenManifest }),
		},
		next_transition: withPayloads,
		forecast: describeTransitionV1(withPayloads),
		repository_context: mintJeroRepositoryContextV1(context, record, "status"),
	};
}

/**
 * STATUS (spec §C). Read-only: recomputes the live projection from Git,
 * matches persisted lineages by snapshot identity, and derives the action
 * from the schema-union vocabulary. M3 (§G): a STATUS with an explicit
 * lineageId — and the auto-match pass — treats correction-phase lineages as
 * lineage-bound: the identity is the frozen record identity, never a fresh
 * workspace derivation. Non-current statuses never expose `authority`/
 * `frozen`; `ambiguous` lists unique lineage ids with action `select_lineage`;
 * a corrupted record fails closed with `repair_authority`.
 */
export function reviewStatusV1(context: JeroAuthorityContextV1, target: JeroReviewStatusTargetV1): JeroReviewStatusResultV1 {
	if ((target.baseRef !== undefined) !== (target.committedOnly === true)) {
		return { kind: "refused", code: "invalid-request", detail: "baseRef and committedOnly must be paired exactly like START" };
	}
	if (target.projection !== undefined && target.projection !== "workspace" && target.projection !== "staged") {
		return { kind: "refused", code: "invalid-request", detail: `projection ${JSON.stringify(target.projection)} is not supported` };
	}
	// F1: a malformed lineageId is a typed invalid-request refusal at the
	// public boundary — never a raw JeroLineageStoreError from load().
	if (target.lineageId !== undefined && !isJeroLineageId(target.lineageId)) {
		return { kind: "refused", code: "invalid-request", detail: `lineageId ${JSON.stringify(target.lineageId)} is not a canonical review-<16hex> lineage id` };
	}
	let live;
	try {
		live = deriveJeroReviewSnapshotV1({
			cwd: target.cwd,
			mode: "ordinary",
			candidate: target.projection === "staged"
				? { kind: "staged" }
				: target.committedOnly === true && target.baseRef !== undefined ? { kind: "base-diff", baseRef: target.baseRef } : { kind: "workspace" },
			policyHash: jeroReviewPolicyHashV1("ordinary"),
		});
	} catch (error) {
		return { kind: "refused", code: "snapshot-failed", detail: error instanceof Error ? error.message : String(error) };
	}
	const requestedProjection: "workspace" | "staged" = target.projection ?? "workspace";
	const targetIdentity = live.target_identity;

	const matches: JeroLineageStateFileV1[] = [];
	const lineageBound: JeroLineageStateFileV1[] = [];
	const corrupted: { id: string; detail: string }[] = [];
	if (target.lineageId !== undefined) {
		const loaded = context.lineages.load(target.lineageId);
		if (loaded.kind === "missing") return { kind: "refused", code: "lineage-missing", detail: `lineage ${target.lineageId} does not exist` };
		if (loaded.kind === "corrupted") {
			return {
				kind: "status",
				applicability: "corrupted",
				target_identity: targetIdentity,
				projection: "workspace",
				receipt: { status: "expected_missing" },
				action: "repair_authority",
				replayability: "manual_action_required",
				candidates: [target.lineageId],
				next_transition: { kind: "stop", reason_code: "authority_corrupted" },
				corrupted_detail: loaded.detail,
			};
		}
		// §G lineage-bound matching: mid-correction the workspace has moved
		// under the fix; the named lineage binds by ID and its frozen identity.
		if (CORRECTION_PHASE_STATES.has(loaded.record.state.state)) {
			lineageBound.push(loaded.record);
		} else if (loaded.record.state.snapshot.identity === targetIdentity) {
			// The explicit path matches by identity exactly like the listing path
			// (F7): a named lineage whose frozen identity drifted from the live
			// candidate is NOT the current target.
			matches.push(loaded.record);
		}
	} else {
		for (const lineageId of context.lineages.list()) {
			const loaded = context.lineages.load(lineageId);
			if (loaded.kind === "corrupted") {
				corrupted.push({ id: lineageId, detail: loaded.detail });
				continue;
			}
			if (loaded.kind !== "ok" || isJeroLineageConsumedV1(loaded.record)) continue;
			if (loaded.record.state.snapshot.identity === targetIdentity) {
				matches.push(loaded.record);
			} else if (CORRECTION_PHASE_STATES.has(loaded.record.state.state)) {
				lineageBound.push(loaded.record);
			}
		}
	}

	if (matches.length === 1) {
		return currentTargetStatusV1(context, matches[0]!, live, false, requestedProjection);
	}
	if (matches.length > 1) {
		return {
			kind: "status",
			applicability: "ambiguous",
			target_identity: targetIdentity,
			projection: "workspace",
			receipt: { status: "not_applicable" },
			action: "select_lineage",
			replayability: "manual_action_required",
			candidates: matches.map(({ lineage_id }) => lineage_id).toSorted(),
			next_transition: { kind: "stop", reason_code: "lineage_selection_required" },
		};
	}
	if (lineageBound.length === 1) {
		// Exactly one live correction-phase lineage: current for this
		// repository, bound to its frozen identity (§G auto-match pass).
		return currentTargetStatusV1(context, lineageBound[0]!, live, true, requestedProjection);
	}
	if (lineageBound.length > 1) {
		return {
			kind: "status",
			applicability: "ambiguous",
			target_identity: targetIdentity,
			projection: "workspace",
			receipt: { status: "not_applicable" },
			action: "select_lineage",
			replayability: "manual_action_required",
			candidates: lineageBound.map(({ lineage_id }) => lineage_id).toSorted(),
			next_transition: { kind: "stop", reason_code: "lineage_selection_required" },
		};
	}
	// `unrelated`: no lineage matches the live candidate — a fresh START.
	return {
		kind: "status",
		applicability: "unrelated",
		target_identity: targetIdentity,
		projection: target.projection ?? "workspace",
		receipt: { status: "not_applicable" },
		action: "start",
		replayability: "not_replayable",
		next_transition: { kind: "execute", reason_code: "empty_candidate_start_required", operation: "review.start" },
		...(corrupted.length === 0 ? {} : { corrupted_detail: corrupted.map(({ id, detail }) => `${id}: ${detail}`).join("; ") }),
	};
}
