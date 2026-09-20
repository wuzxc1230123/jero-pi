import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../review-canonical.ts";
import { isJeroLineageId, jeroLineageDirectory } from "./store-root.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import type { JeroReviewStateName } from "./protocol.ts";

// `authority.maintenance.*` (design §5.1.1 maintenance rows + §5.1.6 ruling,
// spec _tools/p2-m5-maintenance-analysis.md): the destructive recovery routes
// the Go binary served as review reclaim/recover/abandon/reconcile-authority.
// jero-pi keeps abandon and reconcile-authority (real engineering value) and
// does NOT port quarantine-legacy / repair-legacy-alias — a new package with
// a new store namespace has no historical lineages to migrate.
//
// Discipline (readme-reference.md:182-196): every destructive transition runs
// through an EXACT authorization binding the maintainer re-derives and the
// authority re-derives AGAIN before accepting — the request's binding must
// equal the freshly computed one, field for field. Fresh interactive approval
// is the extension layer's job (P4); the authority side fails closed whenever
// a required binding is absent or drifted. Recovery grants no new budget.
// Quarantine is rename-aside, never delete: the audit trail survives.
//
// The binding schema strings stay gentle-ai.* until the P5 identity pass —
// they are rendered to maintainers and hashed nowhere; renaming them here
// would silently orphan upstream-documented bindings.

// Upstream maintainer-authorization character discipline
// (native-review-cli.ts:1603-1605): non-empty, LF the only permitted control.
const CONTROL_EXCEPT_LF = "[\\u0000-\\u0009\\u000b-\\u001f\\u007f]";
const LF_ONLY_BINDING = new RegExp(CONTROL_EXCEPT_LF);

export const JERO_RECOVER_DISPOSITIONS = ["scope_changed", "invalidated", "escalated"] as const;
export type JeroRecoverDisposition = (typeof JERO_RECOVER_DISPOSITIONS)[number];

export const JERO_RECONCILE_ANOMALIES = { COMBINED: "unchanged_target,malformed_recovery_authorization" } as const;
export type JeroReconcileAnomalies = (typeof JERO_RECONCILE_ANOMALIES)[keyof typeof JERO_RECONCILE_ANOMALIES];

const TERMINAL_STATES: ReadonlySet<JeroReviewStateName> = new Set(["approved", "escalated", "invalidated"]);

export interface JeroAbandonInputV1 {
	lineage: string;
	expectedRevision: string;
	snapshotIdentity: string;
	capturedLensResults: readonly string[];
	findingsPresent: boolean;
	actor: string;
	reason: string;
	maintainerAuthorization: string;
}

export interface JeroRecoverInputV1 {
	predecessorLineage: string;
	expectedPredecessorRevision: string;
	successorLineage: string;
	disposition: JeroRecoverDisposition;
	actor: string;
	reason: string;
	maintainerAuthorization?: string;
}

export interface JeroReconcileInputV1 {
	predecessorLineage: string;
	expectedPredecessorRevision: string;
	successorLineage: string;
	expectedSuccessorRevision: string;
	actor: string;
	reason: string;
	anomalies?: JeroReconcileAnomalies;
	maintainerAuthorization: string;
}

export type JeroMaintenanceRefusalCode =
	| "invalid-request"
	| "lineage-missing"
	| "record-corrupted"
	| "not-abandonable"
	| "discarded-work-mismatch"
	| "revision-mismatch"
	| "authorization-mismatch";

export type JeroMaintenanceResultV1 =
	| { readonly kind: "abandoned" | "reclaimed" | "recovered" | "reconciled"; readonly lineage: string; readonly auditRecord: Record<string, unknown> }
	| { readonly kind: "refused"; readonly code: JeroMaintenanceRefusalCode; readonly detail: string };

/** The exact eight-line abandon binding (native-review-cli.ts:1710-1724, verbatim). */
export function jeroAbandonAuthorizationV1(request: Pick<JeroAbandonInputV1, "lineage" | "expectedRevision" | "snapshotIdentity" | "capturedLensResults" | "findingsPresent" | "actor" | "reason">): string {
	return [
		"gentle-ai.review-abandon-authorization/v2",
		`lineage=${request.lineage}`,
		`revision=${request.expectedRevision}`,
		`snapshot_identity=${request.snapshotIdentity}`,
		`reason=${request.reason}`,
		`captured_lens_results=${request.capturedLensResults.join(",")}`,
		`findings_present=${request.findingsPresent}`,
		`actor=${request.actor.trim()}`,
	].join("\n");
}

/** The exact seven-line reconcile binding (+optional dual anomaly, native-review-cli.ts:1766-1777). */
export function jeroReconcileAuthorizationV1(request: Pick<JeroReconcileInputV1, "predecessorLineage" | "expectedPredecessorRevision" | "successorLineage" | "expectedSuccessorRevision" | "actor" | "reason" | "anomalies">): string {
	return [
		"gentle-ai.review-reconcile-authorization/v1",
		`predecessor_lineage=${request.predecessorLineage}`,
		`predecessor_revision=${request.expectedPredecessorRevision}`,
		`successor_lineage=${request.successorLineage}`,
		`successor_revision=${request.expectedSuccessorRevision}`,
		`actor=${request.actor}`,
		`reason=${request.reason}`,
		...(request.anomalies === JERO_RECONCILE_ANOMALIES.COMBINED ? [`anomalies=${request.anomalies}`] : []),
	].join("\n");
}

function canonicalProcessString(value: string): boolean {
	return value.length > 0 && value === value.trim() && !value.includes("\0") && !/[\r\n]/.test(value);
}

function maintenanceSidecarV1(context: JeroAuthorityContextV1, lineageId: string): { path: string; entries: Record<string, unknown>[] } {
	const path = join(jeroLineageDirectory(context.store.store_root, lineageId), "maintenance.json");
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!Array.isArray(parsed)) throw new Error("not an array");
		return { path, entries: parsed as Record<string, unknown>[] };
	} catch {
		return { path, entries: [] };
	}
}

function appendMaintenanceV1(context: JeroAuthorityContextV1, lineageId: string, entry: Record<string, unknown>): void {
	const sidecar = maintenanceSidecarV1(context, lineageId);
	const directory = jeroLineageDirectory(context.store.store_root, lineageId);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.maintenance.${randomUUID()}.tmp`);
	writeFileSync(temporary, `${JSON.stringify([...sidecar.entries, entry], null, 2)}\n`, { mode: 0o600 });
	try { renameSync(temporary, sidecar.path); } catch (error) { rmSync(temporary, { force: true }); throw error; }
}

function appendStoreLogV1(context: JeroAuthorityContextV1, entry: Record<string, unknown>): void {
	const logPath = join(context.store.store_root, "maintenance-log.json");
	let entries: Record<string, unknown>[] = [];
	try {
		const parsed = JSON.parse(readFileSync(logPath, "utf8")) as unknown;
		if (Array.isArray(parsed)) entries = parsed as Record<string, unknown>[];
	} catch {
		// An unreadable store log starts fresh — the quarantined evidence
		// directories carry the durable history.
	}
	mkdirSync(context.store.store_root, { recursive: true, mode: 0o700 });
	const temporary = join(context.store.store_root, `.maintenance-log.${randomUUID()}.tmp`);
	writeFileSync(temporary, `${JSON.stringify([...entries, entry], null, 2)}\n`, { mode: 0o600 });
	try { renameSync(temporary, logPath); } catch (error) { rmSync(temporary, { force: true }); throw error; }
}

function loadForMaintenanceV1(context: JeroAuthorityContextV1, lineageId: string): { kind: "ok"; record: JeroLineageStateFileV1 } | { kind: "refused"; code: JeroMaintenanceRefusalCode; detail: string } {
	if (!isJeroLineageId(lineageId)) return { kind: "refused", code: "invalid-request", detail: `lineage ${JSON.stringify(lineageId)} is not a canonical review-<16hex> id` };
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "missing") return { kind: "refused", code: "lineage-missing", detail: `lineage ${lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { kind: "refused", code: "record-corrupted", detail: loaded.detail };
	return { kind: "ok", record: loaded.record };
}

/**
 * `maintenance.abandon` — the audited discard of a live review. The authority
 * re-derives non-terminal eligibility AND the exact discarded work (captured
 * lenses, findings presence, snapshot identity, revision); any drift between
 * the binding and the record refuses before anything mutates.
 */
export function abandonJeroLineageV1(context: JeroAuthorityContextV1, input: JeroAbandonInputV1): JeroMaintenanceResultV1 {
	for (const [name, value] of [["lineage", input.lineage], ["expectedRevision", input.expectedRevision], ["snapshotIdentity", input.snapshotIdentity], ["actor", input.actor], ["reason", input.reason]] as const) {
		if (!canonicalProcessString(value)) return { kind: "refused", code: "invalid-request", detail: `${name} must be a non-empty, trimmed, NUL-free single-line string` };
	}
	if (!Array.isArray(input.capturedLensResults) || input.capturedLensResults.some((entry) => !canonicalProcessString(entry))) {
		return { kind: "refused", code: "invalid-request", detail: "capturedLensResults must be an array of canonical strings" };
	}
	if (typeof input.findingsPresent !== "boolean") return { kind: "refused", code: "invalid-request", detail: "findingsPresent must be a boolean" };
	if (input.maintainerAuthorization !== jeroAbandonAuthorizationV1(input)) {
		return { kind: "refused", code: "authorization-mismatch", detail: "maintainerAuthorization must equal the exact eight-line lineage/revision/snapshot/reason/discarded-work/actor binding" };
	}
	// Read-only eligibility checks first; the journaled mutation acquires the
	// authority lock itself (runOperation), and the lock is exclusive-mkdir,
	// NOT re-entrant — no outer withLock may wrap it.
	const loaded = loadForMaintenanceV1(context, input.lineage);
	if (loaded.kind === "refused") return loaded;
	const record = loaded.record;
	if (TERMINAL_STATES.has(record.state.state)) {
		return { kind: "refused", code: "not-abandonable", detail: `lineage ${input.lineage} is already terminal (${record.state.state})` };
	}
	const derivedLenses = (record.state.lens_results ?? []).map(({ lens }) => lens).sort();
	const declaredLenses = [...input.capturedLensResults].sort();
	if (derivedLenses.join(" ") !== declaredLenses.join(" ") || input.findingsPresent !== (record.state.findings ?? []).length > 0 || input.snapshotIdentity !== record.state.snapshot.identity || input.expectedRevision !== record.revision) {
		return {
			kind: "refused",
			code: "discarded-work-mismatch",
			detail: "the binding's discarded work does not match the record (re-derived lenses, findings presence, snapshot identity, or revision drifted)",
		};
	}
	const auditRecord: Record<string, unknown> = {
		operation: "abandon",
		lineage: input.lineage,
		revision_before: record.revision,
		actor: input.actor,
		reason: input.reason,
		discarded_work: { captured_lens_results: [...input.capturedLensResults], findings_present: input.findingsPresent },
		binding_sha256: sha256Hex(input.maintainerAuthorization),
	};
	// Journaled exactly-once terminal transition (op "abandon"); the state
	// write locks internally and the optimistic-revision guard replays the
	// eligibility derivations against the record it actually mutates.
	const mutation = context.lineages.runOperation({
		lineageId: input.lineage,
		operation: "abandon",
		idempotencyKey: `abandon-${input.lineage}-${record.revision}`,
		requestHash: sha256Hex(jeroAbandonAuthorizationV1(input)),
		apply: (current: JeroLineageStateFileV1) => {
			if (TERMINAL_STATES.has(current.state.state)) throw new Error("not-abandonable");
			if (current.revision !== record.revision) throw new Error("discarded-work-mismatch");
			return {
				draft: { state: { ...current.state, state: "invalidated" as JeroReviewStateName, invalidation_reason: input.reason }, request_journal: current.request_journal },
				result: auditRecord,
			};
		},
	});
	appendMaintenanceV1(context, input.lineage, auditRecord);
	return { kind: "abandoned", lineage: input.lineage, auditRecord: mutation.result as Record<string, unknown> };
}

/**
 * `maintenance.reclaim` (the upstream RESET/RECOVER_LOCK landing point): the
 * repository-bound destructive recovery. The whole lineage directory moves
 * aside to a quarantine name — evidence retained, loadable authority gone.
 */
export function reclaimJeroAuthorityV1(context: JeroAuthorityContextV1, input: { lineage: string; actor: string; reason: string }): JeroMaintenanceResultV1 {
	for (const [name, value] of [["lineage", input.lineage], ["actor", input.actor], ["reason", input.reason]] as const) {
		if (!canonicalProcessString(value)) return { kind: "refused", code: "invalid-request", detail: `${name} must be a canonical string` };
	}
	return context.locks.withLock(() => {
		const loaded = loadForMaintenanceV1(context, input.lineage);
		if (loaded.kind === "refused") return loaded;
		const directory = jeroLineageDirectory(context.store.store_root, input.lineage);
		if (!existsSync(directory)) return { kind: "refused", code: "lineage-missing", detail: `lineage ${input.lineage} has no directory` };
		const quarantineName = `.quarantine-${input.lineage}-${randomUUID()}`;
		renameSync(directory, join(directory, "..", quarantineName));
		const auditRecord: Record<string, unknown> = {
			operation: "reclaim",
			lineage: input.lineage,
			revision_before: loaded.record.revision,
			actor: input.actor,
			reason: input.reason,
			quarantine: quarantineName,
		};
		appendStoreLogV1(context, auditRecord);
		return { kind: "reclaimed", lineage: input.lineage, auditRecord };
	});
}

function writeRecoveryV1(context: JeroAuthorityContextV1, successor: JeroLineageStateFileV1, input: { predecessorLineage: string; expectedPredecessorRevision: string; disposition: JeroRecoverDisposition; actor: string; reason: string; maintainerAuthorization?: string }): void {
	appendMaintenanceV1(context, successor.lineage_id, {
		operation: "recover",
		predecessor_lineage_id: input.predecessorLineage,
		predecessor_revision: input.expectedPredecessorRevision,
		disposition: input.disposition,
		reason: input.reason,
		actor: input.actor,
		recovered_at_revision: successor.revision,
		...(input.maintainerAuthorization === undefined ? {} : { maintainer_authorization_sha256: sha256Hex(input.maintainerAuthorization) }),
	});
}

/**
 * `maintenance.recover` — record the recovery linkage on the successor. The
 * predecessor is validated and then never touched; the successor receives the
 * recovery metadata; no budget is granted (readme :196).
 */
export function recoverJeroLineageV1(context: JeroAuthorityContextV1, input: JeroRecoverInputV1): JeroMaintenanceResultV1 {
	for (const [name, value] of [["predecessorLineage", input.predecessorLineage], ["expectedPredecessorRevision", input.expectedPredecessorRevision], ["successorLineage", input.successorLineage], ["actor", input.actor], ["reason", input.reason]] as const) {
		if (!canonicalProcessString(value)) return { kind: "refused", code: "invalid-request", detail: `${name} must be a canonical string` };
	}
	if (!(JERO_RECOVER_DISPOSITIONS as readonly string[]).includes(input.disposition)) {
		return { kind: "refused", code: "invalid-request", detail: "disposition must be scope_changed, invalidated, or escalated" };
	}
	if (input.maintainerAuthorization !== undefined && (input.maintainerAuthorization.length === 0 || LF_ONLY_BINDING.test(input.maintainerAuthorization))) {
		return { kind: "refused", code: "invalid-request", detail: "maintainerAuthorization must be a non-empty LF-only binding" };
	}
	return context.locks.withLock(() => {
		const predecessor = loadForMaintenanceV1(context, input.predecessorLineage);
		if (predecessor.kind === "refused") return predecessor;
		if (predecessor.record.revision !== input.expectedPredecessorRevision) {
			return { kind: "refused", code: "revision-mismatch", detail: `predecessor is at ${predecessor.record.revision}, binding pins ${input.expectedPredecessorRevision}` };
		}
		const successor = loadForMaintenanceV1(context, input.successorLineage);
		if (successor.kind === "refused") return successor;
		writeRecoveryV1(context, successor.record, input);
		return {
			kind: "recovered",
			lineage: input.successorLineage,
			auditRecord: { operation: "recover", predecessor_lineage_id: input.predecessorLineage, disposition: input.disposition, actor: input.actor },
		};
	});
}

/**
 * `maintenance.reconcile-authority` — intentionally narrow (readme :190):
 * with the published dual anomaly the bound invalid recovery successor is
 * quarantined; without anomalies the successor merely receives the recovery
 * linkage. The predecessor is never mutated either way.
 */
export function reconcileJeroAuthorityV1(context: JeroAuthorityContextV1, input: JeroReconcileInputV1): JeroMaintenanceResultV1 {
	for (const [name, value] of [["predecessorLineage", input.predecessorLineage], ["expectedPredecessorRevision", input.expectedPredecessorRevision], ["successorLineage", input.successorLineage], ["expectedSuccessorRevision", input.expectedSuccessorRevision], ["actor", input.actor], ["reason", input.reason]] as const) {
		if (!canonicalProcessString(value)) return { kind: "refused", code: "invalid-request", detail: `${name} must be a canonical string` };
	}
	if (input.anomalies !== undefined && input.anomalies !== JERO_RECONCILE_ANOMALIES.COMBINED) {
		return { kind: "refused", code: "invalid-request", detail: "anomalies supports only the published combined value" };
	}
	if (input.maintainerAuthorization !== jeroReconcileAuthorizationV1(input)) {
		return { kind: "refused", code: "authorization-mismatch", detail: "maintainerAuthorization must equal the exact seven-line predecessor/successor/actor/reason binding (plus the anomalies line when declared)" };
	}
	return context.locks.withLock(() => {
		const predecessor = loadForMaintenanceV1(context, input.predecessorLineage);
		if (predecessor.kind === "refused") return predecessor;
		if (predecessor.record.revision !== input.expectedPredecessorRevision) {
			return { kind: "refused", code: "revision-mismatch", detail: `predecessor is at ${predecessor.record.revision}` };
		}
		const successor = loadForMaintenanceV1(context, input.successorLineage);
		if (successor.kind === "refused") return successor;
		if (successor.record.revision !== input.expectedSuccessorRevision) {
			return { kind: "refused", code: "revision-mismatch", detail: `successor is at ${successor.record.revision}` };
		}
		const auditRecord: Record<string, unknown> = {
			operation: "reconcile-authority",
			predecessor_lineage_id: input.predecessorLineage,
			successor_lineage_id: input.successorLineage,
			actor: input.actor,
			reason: input.reason,
			...(input.anomalies === undefined ? {} : { anomalies: input.anomalies }),
			binding_sha256: sha256Hex(input.maintainerAuthorization),
		};
		if (input.anomalies === JERO_RECONCILE_ANOMALIES.COMBINED) {
			// The narrow destructive path: quarantine ONLY the bound successor.
			const directory = jeroLineageDirectory(context.store.store_root, input.successorLineage);
			if (existsSync(directory)) {
				const quarantineName = `.quarantine-${input.successorLineage}-${randomUUID()}`;
				renameSync(directory, join(directory, "..", quarantineName));
				auditRecord.quarantine = quarantineName;
			}
		} else {
			writeRecoveryV1(context, successor.record, {
				predecessorLineage: input.predecessorLineage,
				expectedPredecessorRevision: input.expectedPredecessorRevision,
				disposition: "invalidated",
				actor: input.actor,
				reason: input.reason,
			});
		}
		appendStoreLogV1(context, auditRecord);
		return { kind: "reconciled", lineage: input.successorLineage, auditRecord };
	});
}
