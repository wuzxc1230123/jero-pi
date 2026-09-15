import { jeroDomainHash } from "./canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import { isJeroLineageId } from "./store-root.ts";
import { canonicalJsonV1 } from "../review-canonical.ts";

// `authority.review.acknowledge` (spec §F): the approved-authority burn.
// The persisted 13-state enum has no "burned" member, so the burn is
// authority-level: a journaled, exactly-once "acknowledge" operation whose
// completed journal entry IS the receipt-consumed marker. The receipt file
// survives (rollback MUST preserve every receipt); STATUS excludes consumed
// lineages from live target matching, which is what offers a fresh START.

export const JERO_REVIEW_ACKNOWLEDGED_SCHEMA = "jero.authority.review-acknowledged/v1";

export interface JeroReviewAcknowledgeInputV1 {
	readonly cwd: string;
	readonly lineageId: string;
	/** The exact `--target` value the caller's STATUS binding holds. */
	readonly targetIdentity: string;
	/** The exact `--expected-revision` value the caller's STATUS binding holds. */
	readonly expectedRevision: string;
	/** The exact burn token (`--token=<value>`) the caller's STATUS binding holds. */
	readonly token: string;
	readonly idempotencyKey?: string;
}

export interface JeroReviewAcknowledgedV1 {
	readonly schema: typeof JERO_REVIEW_ACKNOWLEDGED_SCHEMA;
	readonly operation: "review/acknowledge-approved";
	readonly action: "acknowledged";
	readonly lineage_id: string;
	readonly target_identity: string;
	readonly consumed_revision: string;
	readonly authority: "burned";
}

export type JeroReviewAcknowledgeResultV1 =
	| { readonly kind: "refused"; readonly code: "invalid-request" | "lineage-missing" | "corrupted" | "acknowledge-requires-approved" | "binding-mismatch" | "authority-unavailable" | "already-consumed"; readonly detail?: string }
	| { readonly kind: "acknowledged"; readonly result: JeroReviewAcknowledgedV1; readonly replayed: boolean };

/**
 * ACKNOWLEDGE (spec §F): burn the approved authority exactly once. Values
 * must equal the caller's current STATUS binding — drifted tokens fail
 * closed as a binding mismatch; an exact (idempotency_key, request_hash)
 * replay returns the stored acknowledgement envelope.
 */
export function reviewAcknowledgeV1(context: JeroAuthorityContextV1, input: JeroReviewAcknowledgeInputV1): JeroReviewAcknowledgeResultV1 {
	if (typeof input.lineageId !== "string" || input.lineageId.length === 0) return { kind: "refused", code: "invalid-request", detail: "lineageId is required" };
	if (typeof input.targetIdentity !== "string" || !/^sha256:[0-9a-f]{64}$/.test(input.targetIdentity)) return { kind: "refused", code: "invalid-request", detail: "targetIdentity must be a canonical sha256 identity" };
	if (typeof input.expectedRevision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(input.expectedRevision)) return { kind: "refused", code: "invalid-request", detail: "expectedRevision must be a canonical sha256 revision" };
	if (typeof input.token !== "string" || input.token.trim().length === 0) return { kind: "refused", code: "invalid-request", detail: "token is required" };
	// F1: a malformed lineageId is a typed refusal, never a raw store error.
	if (!isJeroLineageId(input.lineageId)) return { kind: "refused", code: "invalid-request", detail: `lineageId ${JSON.stringify(input.lineageId)} is not a canonical review-<16hex> lineage id` };
	const loaded = context.lineages.load(input.lineageId);
	if (loaded.kind === "missing") return { kind: "refused", code: "lineage-missing", detail: `lineage ${input.lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { kind: "refused", code: "corrupted", detail: loaded.detail };
	const record = loaded.record;
	// Single precondition (upstream :2498): state=approved.
	if (record.state.state !== "approved") {
		return { kind: "refused", code: "acknowledge-requires-approved", detail: `acknowledge requires state=approved (lineage is in ${record.state.state})` };
	}
	const requestHash = jeroDomainHash("request", {
		operation: "acknowledge",
		lineage_id: input.lineageId,
		target_identity: input.targetIdentity,
		expected_revision: input.expectedRevision,
		token: input.token,
	});
	const idempotencyKey = input.idempotencyKey ?? `acknowledge:${requestHash.slice(0, 16)}`;
	// Journal replay first: the burn advances the revision, so an exact replay
	// necessarily presents the pre-burn binding it originally held.
	const existingByKey = record.request_journal.find((entry) => entry.idempotency_key === idempotencyKey);
	if (existingByKey !== undefined) {
		if (existingByKey.request_hash !== requestHash) {
			return { kind: "refused", code: "binding-mismatch", detail: "idempotency key was reused with a different burn request" };
		}
		if (existingByKey.operation === "acknowledge" && existingByKey.status === "completed") {
			return { kind: "acknowledged", result: existingByKey.canonical_result as JeroReviewAcknowledgedV1, replayed: true };
		}
	}
	const alreadyBurned = record.request_journal.some((entry) => entry.operation === "acknowledge" && entry.status === "completed");
	if (alreadyBurned) {
		return { kind: "refused", code: "already-consumed", detail: "this approved authority was already consumed by acknowledgement" };
	}
	// Binding guard (upstream :2512-2518): values must equal the caller's
	// current STATUS binding — identity and revision alike.
	if (record.state.snapshot.identity !== input.targetIdentity) {
		return { kind: "refused", code: "binding-mismatch", detail: "target identity drifted from the frozen authority target" };
	}
	if (record.revision !== input.expectedRevision) {
		return { kind: "refused", code: "binding-mismatch", detail: "expected revision drifted from the live authority revision" };
	}
	const result: JeroReviewAcknowledgedV1 = {
		schema: JERO_REVIEW_ACKNOWLEDGED_SCHEMA,
		operation: "review/acknowledge-approved",
		action: "acknowledged",
		lineage_id: input.lineageId,
		target_identity: input.targetIdentity,
		// The burn consumes exactly the revision the caller held (upstream :2572).
		consumed_revision: input.expectedRevision,
		authority: "burned",
	};
	try {
		const outcome = context.lineages.runOperation({
			lineageId: input.lineageId,
			operation: "acknowledge",
			idempotencyKey,
			requestHash,
			apply: (current) => ({
				// State stays `approved` (terminal); the journal entry is the burn.
				draft: { state: current.state, request_journal: current.request_journal },
				result,
			}),
		});
		// The canonical result must round-trip through canonical JSON unchanged.
		if (canonicalJsonV1(outcome.result) !== canonicalJsonV1(result)) {
			return { kind: "refused", code: "authority-unavailable", detail: "stored acknowledgement does not match the burn result" };
		}
		return { kind: "acknowledged", result, replayed: false };
	} catch (error) {
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
}
