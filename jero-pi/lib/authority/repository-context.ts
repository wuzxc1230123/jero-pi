import { readFileSync } from "node:fs";
import { jeroDomainHash } from "./canonical.ts";
import { assertJeroReceiptIntegrityV1, jeroReceiptPathV1 } from "./receipts.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import type { JeroAuthorityOperation, JeroReceiptEnvelopeV1 } from "./protocol.ts";

// `repository_context` — the rctx1_ handle block (spec §C).
//
// Upstream hashed an opaque server-side context; its ground truth is only
// that the handle is 1:1 with `(revision, target_identity)` per lineage
// moment and is echoed verbatim in every START/STATUS/collect/execute
// binding. jero keeps the handle derivation (it already satisfies the 1:1
// property) and derives the paired `event_id`/`outcome` from live authority
// state: the journal, the authority lock, and the receipt file. Nothing here
// persists an event ledger — every outcome is recomputed from the same
// durable facts the reconciler would use (spec §C M3 upgrade note).

export const JERO_REPOSITORY_CONTEXT_CAPABILITY = "review.opaque_repository_context";

export const JERO_REPOSITORY_CONTEXT_OUTCOMES = ["applied", "pending", "blocked_conflict", "durability_limited"] as const;
export type JeroRepositoryContextOutcome = (typeof JERO_REPOSITORY_CONTEXT_OUTCOMES)[number];

export interface JeroRepositoryContextV1 {
	readonly capability: typeof JERO_REPOSITORY_CONTEXT_CAPABILITY;
	/** `rctx1_<64-hex>` — 1:1 with (revision, target_identity). */
	readonly handle: string;
	readonly revision: string;
	readonly target_identity: string;
	/** Paired with `outcome` — always both or neither (fixture discipline). */
	readonly event_id?: string;
	readonly outcome?: JeroRepositoryContextOutcome;
}

const REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Handle derivation: `rctx1_ + jeroDomainHash("repository-context", {target_identity, revision})` (M2 formula, kept). */
export function jeroRepositoryContextHandleV1(targetIdentity: string, revision: string): string {
	if (!IDENTITY_PATTERN.test(targetIdentity)) throw new TypeError("repository context target identity must be a canonical sha256 identity");
	if (!REVISION_PATTERN.test(revision)) throw new TypeError("repository context revision must be a canonical sha256 revision");
	return `rctx1_${jeroDomainHash("repository-context", { target_identity: targetIdentity, revision })}`;
}

/** Event identity for one authority operation on one lineage moment. */
export function jeroRepositoryContextEventIdV1(lineageId: string, revision: string, operation: JeroAuthorityOperation | "status" | "capture"): string {
	if (typeof lineageId !== "string" || lineageId.length === 0) throw new TypeError("repository context event requires a lineage id");
	if (!REVISION_PATTERN.test(revision)) throw new TypeError("repository context revision must be a canonical sha256 revision");
	return `sha256:${jeroDomainHash("repository-event", { lineage_id: lineageId, revision, operation })}`;
}

function receiptPresentV1(context: JeroAuthorityContextV1, lineageId: string): boolean {
	try {
		const bytes = readFileSync(jeroReceiptPathV1(context.store.store_root, lineageId));
		const envelope = JSON.parse(bytes.toString("utf8")) as unknown;
		if (typeof envelope !== "object" || envelope === null) return false;
		assertJeroReceiptIntegrityV1(envelope as JeroReceiptEnvelopeV1);
		return true;
	} catch {
		return false;
	}
}

/**
 * Derives the outcome for one operation against the live authority state
 * (spec §C): `pending` while any journal entry is pending (the crash window,
 * reconcilable via prepareOperation/completeOperation); `blocked_conflict`
 * when the authority lock is owned/ambiguous; `durability_limited` when the
 * lineage is terminal but its receipt file is not yet present; `applied`
 * once the operation's journal entry completed.
 */
export function jeroRepositoryContextOutcomeV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, operation: JeroAuthorityOperation): JeroRepositoryContextOutcome {
	if (record.request_journal.some((entry) => entry.status === "pending")) return "pending";
	const lockStatus = context.locks.inspect();
	if (lockStatus.status === "owned" || lockStatus.status === "ambiguous") return "blocked_conflict";
	const state = record.state.state;
	if ((state === "approved" || state === "escalated") && !receiptPresentV1(context, record.lineage_id)) return "durability_limited";
	return record.request_journal.some((entry) => entry.operation === operation && entry.status === "completed") ? "applied" : "pending";
}

/**
 * Mints the full repository-context block for one operation. `event_id` and
 * `outcome` are always emitted as a pair (fixtures never carry one without
 * the other); read-only surfaces that have no operation of their own (STATUS
 * current_target) pass `"status"` and derive against the lineage moment.
 */
export function mintJeroRepositoryContextV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, operation: JeroAuthorityOperation | "status" | "capture"): JeroRepositoryContextV1 {
	const targetIdentity = record.state.snapshot.identity;
	const handle = jeroRepositoryContextHandleV1(targetIdentity, record.revision);
	const outcome = jeroRepositoryContextOutcomeV1(context, record, operation as JeroAuthorityOperation);
	return {
		capability: JERO_REPOSITORY_CONTEXT_CAPABILITY,
		handle,
		revision: record.revision,
		target_identity: targetIdentity,
		event_id: jeroRepositoryContextEventIdV1(record.lineage_id, record.revision, operation),
		outcome,
	};
}

/** Strict decode for the block as it rides typed surfaces (unknown keys fail closed). */
export function decodeJeroRepositoryContextV1(value: unknown, label = "repository_context"): JeroRepositoryContextV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label}: expected object`);
	const parsed = value as Record<string, unknown>;
	const allowed = ["capability", "handle", "revision", "target_identity", "event_id", "outcome"];
	for (const key of Object.keys(parsed)) if (!allowed.includes(key)) throw new TypeError(`${label}: unknown key "${key}"`);
	for (const key of ["capability", "handle", "revision", "target_identity"]) {
		if (typeof parsed[key] !== "string" || (parsed[key] as string).length === 0) throw new TypeError(`${label}.${key}: expected non-empty string`);
	}
	if (parsed.capability !== JERO_REPOSITORY_CONTEXT_CAPABILITY) throw new TypeError(`${label}.capability must be ${JERO_REPOSITORY_CONTEXT_CAPABILITY}`);
	if (!/^rctx[12]_[0-9a-f]{64}$/.test(parsed.handle as string)) throw new TypeError(`${label}.handle must be an rctx1_/rctx2_ handle`);
	if (!REVISION_PATTERN.test(parsed.revision as string)) throw new TypeError(`${label}.revision must be a canonical sha256 revision`);
	if (!IDENTITY_PATTERN.test(parsed.target_identity as string)) throw new TypeError(`${label}.target_identity must be a canonical sha256 identity`);
	const hasEvent = parsed.event_id !== undefined;
	const hasOutcome = parsed.outcome !== undefined;
	if (hasEvent !== hasOutcome) throw new TypeError(`${label}: event_id and outcome must be paired`);
	let outcome: JeroRepositoryContextOutcome | undefined;
	if (hasOutcome) {
		outcome = parsed.outcome as JeroRepositoryContextOutcome;
		if (!(JERO_REPOSITORY_CONTEXT_OUTCOMES as readonly string[]).includes(outcome)) throw new TypeError(`${label}.outcome is unsupported`);
	}
	return {
		capability: JERO_REPOSITORY_CONTEXT_CAPABILITY,
		handle: parsed.handle as string,
		revision: parsed.revision as string,
		target_identity: parsed.target_identity as string,
		...(hasEvent ? { event_id: parsed.event_id as string } : {}),
		...(outcome === undefined ? {} : { outcome }),
	};
}
