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

// `authority.review.status` (spec §C): read-only applicability determination
// (`current_target | unrelated | ambiguous | corrupted`) recomputed from Git
// — never from provider files — plus receipt status, action/replayability,
// the frozen block, and candidate lineage listing.

export type JeroReviewApplicabilityV1 = "current_target" | "unrelated" | "ambiguous" | "corrupted";
export type JeroReceiptStatusV1 = "expected_missing" | "present" | "publication_pending" | "not_applicable";

export interface JeroReviewStatusTargetV1 {
	readonly cwd: string;
	readonly lineageId?: string;
	/** Requires `committedOnly: true`, exactly like START. */
	readonly baseRef?: string;
	readonly committedOnly?: boolean;
	readonly projection?: "workspace";
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
		readonly projection: "workspace";
		readonly receipt: { readonly status: JeroReceiptStatusV1 };
		readonly action: JeroStatusAction;
		readonly replayability: JeroReplayability;
		readonly authority?: JeroAuthorityBlockV1;
		readonly frozen?: JeroFrozenBlockV1;
		readonly candidates?: readonly string[];
		readonly next_transition: JeroNextTransitionV1;
		readonly forecast?: JeroStatusForecastV1;
		readonly corrupted_detail?: string;
	};

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

/**
 * STATUS (spec §C). Read-only: recomputes the live projection from Git,
 * matches persisted lineages by snapshot identity, and derives the action
 * from the schema-union vocabulary. Non-current statuses never expose
 * `authority`/`frozen`; `ambiguous` lists unique lineage ids with action
 * `select_lineage`; a corrupted record fails closed with `repair_authority`.
 */
export function reviewStatusV1(context: JeroAuthorityContextV1, target: JeroReviewStatusTargetV1): JeroReviewStatusResultV1 {
	if ((target.baseRef !== undefined) !== (target.committedOnly === true)) {
		return { kind: "refused", code: "invalid-request", detail: "baseRef and committedOnly must be paired exactly like START" };
	}
	if (target.projection !== undefined && target.projection !== "workspace") {
		return { kind: "refused", code: "invalid-request", detail: `projection ${JSON.stringify(target.projection)} is not implemented` };
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
			candidate: target.committedOnly === true && target.baseRef !== undefined ? { kind: "base-diff", baseRef: target.baseRef } : { kind: "workspace" },
			policyHash: jeroReviewPolicyHashV1("ordinary"),
		});
	} catch (error) {
		return { kind: "refused", code: "snapshot-failed", detail: error instanceof Error ? error.message : String(error) };
	}
	const targetIdentity = live.target_identity;

	const matches: JeroLineageStateFileV1[] = [];
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
		// The explicit path matches by identity exactly like the listing path
		// (F7): a named lineage whose frozen identity drifted from the live
		// candidate is NOT the current target — never a mixed authority block
		// carrying the live manifest digest over a frozen authority.
		if (loaded.record.state.snapshot.identity === targetIdentity) {
			matches.push(loaded.record);
		}
	} else {
		for (const lineageId of context.lineages.list()) {
			const loaded = context.lineages.load(lineageId);
			if (loaded.kind === "corrupted") {
				corrupted.push({ id: lineageId, detail: loaded.detail });
				continue;
			}
			if (loaded.kind === "ok" && loaded.record.state.snapshot.identity === targetIdentity && !isJeroLineageConsumedV1(loaded.record)) {
				matches.push(loaded.record);
			}
		}
	}

	if (matches.length === 0) {
		// `unrelated`: no lineage matches the live candidate — a fresh START.
		return {
			kind: "status",
			applicability: "unrelated",
			target_identity: targetIdentity,
			projection: "workspace",
			receipt: { status: "not_applicable" },
			action: "start",
			replayability: "not_replayable",
			next_transition: { kind: "execute", reason_code: "empty_candidate_start_required", operation: "review.start" },
			...(corrupted.length === 0 ? {} : { corrupted_detail: corrupted.map(({ id, detail }) => `${id}: ${detail}`).join("; ") }),
		};
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
	const record = matches[0]!;
	const state = record.state;
	const consumed = isJeroLineageConsumedV1(record);
	const admittedLenses = (state.lens_results ?? []).map(({ lens }) => lens) as JeroLensName[];
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
	return {
		kind: "status",
		applicability: "current_target",
		target_identity: targetIdentity,
		projection: "workspace",
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
			// Recomputed live from the matched candidate — the identity match
			// guarantees it is the frozen manifest (§C.4 binding note).
			changed_path_manifest_sha256: live.changed_path_manifest_sha256,
		},
		next_transition: next,
		forecast: describeTransitionV1(next),
	};
}
