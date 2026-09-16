import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { sha256Hex } from "../review-canonical.ts";
import { jeroDomainHash } from "./canonical.ts";
import {
	JERO_SDD_ATTEMPT_OUTCOMES,
	decodeJeroSddAttemptLedgerV1,
	decodeJeroVerifyResultV1,
	type JeroSddAttemptLedgerV1,
	type JeroSddAttemptOutcome,
	type JeroSddAttemptRecordV1,
	type JeroSddAttemptState,
	type JeroVerifyResultV1,
} from "./protocol.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";

// `authority.sdd.attempt` (spec _tools/p2-m4-sdd-analysis.md §A.2/A.3/D): the
// runtime-attempt authority, in-process. The binary's `sdd-attempt acquire|
// settle` compact flow becomes a store-level append-only ledger — one file per
// (workspaceRoot, changeName) under `<store>/sdd-attempts/`, written atomically
// (temp + rename) under the authority mutation lock so an acquire is durable
// BEFORE the caller can launch any runtime-bearing work (R1). Tokens are minted
// with node:crypto and persisted only as sha256 (R2: admission re-derives from
// the ledger, never from process memory). Acquire and settle use DISTINCT
// request ids; reusing an operation's own request id is idempotent replay of
// that exact operation (sdd-status-contract.md:68). Terminal settlements retain
// the untracked scope VERBATIM (R4). The ledger never leaks into SDD status
// records (contract :66 — status reports artifact state only).
//
// Deliberately NOT verified in-process: maxChangedLines (the actor's realized
// diff size is measured by the launching layer; P4 seam) and the remediation
// observation prose (agents-runner owns observation evidence upstream).

const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CANONICAL_PROCESS_STRING = /^[^\r\n]*$/;

export type JeroSddAttemptRefusalCode =
	| "invalid-request"
	| "token-unknown"
	| "token-mismatch"
	| "no-live-attempt"
	| "stale-expected-revision"
	| "ledger-corrupted";

export type JeroSddAttemptResultV1 =
	| { readonly kind: "result"; readonly state: JeroSddAttemptState; readonly token?: string; readonly reason?: string; readonly existing?: { readonly requestId: string; readonly workUnit: string } }
	| { readonly kind: "refused"; readonly code: JeroSddAttemptRefusalCode; readonly detail: string };

export interface JeroSddAttemptSelectionV1 {
	untrackedScope?: "exclude" | "select";
	expectedUntrackedInventory?: string;
	intendedUntracked?: readonly string[];
}

export interface JeroSddAcquireInputV1 extends JeroSddAttemptSelectionV1 {
	workspaceRoot: string;
	changeName: string;
	requestId: string;
	workUnit: string;
	evidenceGoal: string;
	maxAttempts?: number;
	maxChangedLines?: number;
	/** sha256 identity, or the empty string to accept a no-prior-state ledger. */
	expectedRevision?: string;
	/** Idempotent replay token from a prior proceed. */
	token?: string;
	remediatesEvidenceRevision?: string;
}

export interface JeroSddSettleInputV1 extends JeroSddAttemptSelectionV1 {
	workspaceRoot: string;
	changeName: string;
	requestId: string;
	token: string;
	outcome: JeroSddAttemptOutcome;
	evidenceRevision?: string;
	remediationEvidence?: string;
	diagnosis: string;
	harnessDisposition: "reused" | "invalidated";
	cleanupEvidence: string;
	processEvidence: string;
	/** Optional verify-report envelope; when present its evidence_revision must match evidenceRevision. */
	verifyResult?: JeroVerifyResultV1;
}

function canonicalProcessString(value: string): boolean {
	return value.length > 0 && value === value.trim() && !value.includes("\0") && CANONICAL_PROCESS_STRING.test(value);
}

function boundedText(value: string, max: number, label: string): string {
	if (!canonicalProcessString(value) || Buffer.byteLength(value) > max) throw new Error(`${label} must be a canonical process string of at most ${max} bytes`);
	return value;
}

function optionalRevision(value: string | undefined, label: string): string | undefined {
	if (value === undefined) return undefined;
	if (value !== "" && !/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a canonical sha256 identity or the empty string`);
	return value;
}

function validateSelection(selection: JeroSddAttemptSelectionV1): void {
	const paths = selection.intendedUntracked ?? [];
	if (selection.untrackedScope === "exclude" && paths.length > 0) throw new Error("untrackedScope exclude cannot carry untracked paths");
	if (paths.some((path) => typeof path !== "string" || path.length === 0 || path.includes("\0") || path.startsWith("/") || path.split("/").includes(".."))) throw new Error("intendedUntracked must be unique non-empty repo-relative POSIX paths");
	if (new Set(paths).size !== paths.length) throw new Error("intendedUntracked must not contain duplicates");
	if (selection.expectedUntrackedInventory !== undefined && !/^sha256:[0-9a-f]{64}$/.test(selection.expectedUntrackedInventory)) throw new Error("expectedUntrackedInventory must be a canonical sha256 identity when present");
}

function validateCommon(input: { workspaceRoot: string; changeName: string; requestId: string }): string {
	if (!isAbsolute(input.workspaceRoot) || !canonicalProcessString(input.workspaceRoot)) throw new Error("workspaceRoot must be an absolute canonical path");
	if (!canonicalProcessString(input.changeName)) throw new Error("changeName must be a canonical process string");
	if (!REQUEST_ID_PATTERN.test(input.requestId)) throw new Error("requestId must match ^[a-z0-9][a-z0-9._-]{0,127}$");
	// Node's own canonical form: separator-stable on Windows, so the ledger
	// key hashes the same identity regardless of the caller's input form.
	return resolve(input.workspaceRoot);
}

function ledgerRevisionV1(ledger: JeroSddAttemptLedgerV1): string {
	return `sha256:${jeroDomainHash("sdd-attempt-ledger", { workspace_root: ledger.workspace_root, change_name: ledger.change_name, attempts: ledger.attempts })}`;
}

function ledgerPathV1(storeRoot: string, workspaceRoot: string, changeName: string): string {
	const key = jeroDomainHash("sdd-attempt-ledger-path", { workspace_root: workspaceRoot, change_name: changeName });
	return join(storeRoot, "sdd-attempts", `${key}.json`);
}

type LedgerReadV1 =
	| { readonly kind: "empty" }
	| { readonly kind: "ok"; readonly ledger: JeroSddAttemptLedgerV1 }
	| { readonly kind: "corrupted"; readonly detail: string };

function readLedgerV1(storeRoot: string, workspaceRoot: string, changeName: string): LedgerReadV1 {
	let text: string;
	try {
		text = readFileSync(ledgerPathV1(storeRoot, workspaceRoot, changeName), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "empty" };
		throw error;
	}
	try {
		return { kind: "ok", ledger: decodeJeroSddAttemptLedgerV1(JSON.parse(text)) };
	} catch (error) {
		return { kind: "corrupted", detail: error instanceof Error ? error.message : String(error) };
	}
}

function writeLedgerV1(context: JeroAuthorityContextV1, ledger: JeroSddAttemptLedgerV1): void {
	const directory = join(context.store.store_root, "sdd-attempts");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.attempt-${randomUUID()}.tmp`);
	writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, ledgerPathV1(context.store.store_root, ledger.workspace_root, ledger.change_name));
}

function liveAttemptV1(ledger: JeroSddAttemptLedgerV1): JeroSddAttemptRecordV1 | undefined {
	return [...ledger.attempts].reverse().find((attempt) => attempt.settlement === undefined);
}

function acquireResultForV1(attempt: JeroSddAttemptRecordV1): { kind: "result"; state: JeroSddAttemptState; token?: string; reason?: string } {
	return attempt.settlement === undefined
		? { kind: "result", state: "proceed" }
		: { kind: "result", state: "complete", reason: `attempt already settled ${attempt.settlement.outcome}` };
}

/**
 * `sdd-attempt acquire`: launches only on `proceed`; `blocked` names the live
 * attempt; `complete` names budget exhaustion. Request-id replay is idempotent;
 * token replay re-derives admission from the ledger, never from memory.
 */
export function acquireJeroSddAttemptV1(context: JeroAuthorityContextV1, input: JeroSddAcquireInputV1): JeroSddAttemptResultV1 {
	let root: string;
	try {
		root = validateCommon(input);
		boundedText(input.workUnit, 160, "workUnit");
		boundedText(input.evidenceGoal, 240, "evidenceGoal");
		if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 100)) throw new Error("maxAttempts must be an integer in 1..100");
		if (input.maxChangedLines !== undefined && (!Number.isInteger(input.maxChangedLines) || input.maxChangedLines < 1 || input.maxChangedLines > 1_000_000)) throw new Error("maxChangedLines must be an integer in 1..1000000");
		const expectedRevision = optionalRevision(input.expectedRevision, "expectedRevision");
		if (input.token !== undefined) boundedText(input.token, 500, "token");
		const remediates = optionalRevision(input.remediatesEvidenceRevision, "remediatesEvidenceRevision");
		if (remediates === "") throw new Error("remediatesEvidenceRevision must be a sha256 identity when present");
		validateSelection(input);
	} catch (error) {
		return { kind: "refused", code: "invalid-request", detail: error instanceof Error ? error.message : String(error) };
	}
	return context.locks.withLock(() => {
		const read = readLedgerV1(context.store.store_root, root, input.changeName);
		if (read.kind === "corrupted") return { kind: "refused", code: "ledger-corrupted", detail: read.detail } as const;
		if (read.kind === "ok") {
			// Idempotent replay of this exact acquire (contract :68).
			const byRequestId = read.ledger.attempts.find((attempt) => attempt.request_id === input.requestId);
			if (byRequestId !== undefined) return acquireResultForV1(byRequestId);
			if (input.token !== undefined) {
				const tokenHash = sha256Hex(input.token);
				const byToken = read.ledger.attempts.find((attempt) => attempt.token_hash === tokenHash);
				if (byToken !== undefined) return acquireResultForV1(byToken);
				return { kind: "refused", code: "token-unknown", detail: "token matches no recorded attempt" } as const;
			}
			const live = liveAttemptV1(read.ledger);
			if (live !== undefined) {
				return { kind: "result", state: "blocked", reason: "managed-actor-live", existing: { requestId: live.request_id, workUnit: live.work_unit } } as const;
			}
			const current = ledgerRevisionV1(read.ledger);
			if (input.expectedRevision !== undefined && input.expectedRevision !== current) {
				return { kind: "refused", code: "stale-expected-revision", detail: `expected ${input.expectedRevision}, ledger is ${current}` } as const;
			}
			if (read.ledger.attempts.length >= (input.maxAttempts ?? 100)) {
				return { kind: "result", state: "complete", reason: "attempt budget exhausted" } as const;
			}
		} else if (input.expectedRevision !== undefined && input.expectedRevision !== "") {
			return { kind: "refused", code: "stale-expected-revision", detail: `expected ${input.expectedRevision}, ledger has no prior state` } as const;
		}
		const token = `jero-attempt-${randomUUID()}`;
		const attempt: JeroSddAttemptRecordV1 = {
			request_id: input.requestId,
			acquired_at_revision: read.kind === "ok" ? ledgerRevisionV1(read.ledger) : "sha256:" + "0".repeat(64),
			token_hash: sha256Hex(token),
			work_unit: input.workUnit,
			evidence_goal: input.evidenceGoal,
			max_attempts: input.maxAttempts ?? 100,
			max_changed_lines: input.maxChangedLines ?? 1_000_000,
			expected_revision: input.expectedRevision ?? "",
			untracked_scope: input.untrackedScope ?? "exclude",
			...(input.expectedUntrackedInventory === undefined ? {} : { expected_untracked_inventory: input.expectedUntrackedInventory }),
			intended_untracked: [...(input.intendedUntracked ?? [])],
			...(input.remediatesEvidenceRevision === undefined ? {} : { remediates_evidence_revision: input.remediatesEvidenceRevision }),
		};
		const ledger: JeroSddAttemptLedgerV1 = read.kind === "ok"
			? { ...read.ledger, attempts: [...read.ledger.attempts, attempt] }
			: { schema: "jero.authority.sdd-attempt-ledger/v1" as const, workspace_root: root, change_name: input.changeName, attempts: [attempt] };
		writeLedgerV1(context, ledger);
		return { kind: "result", state: "proceed", token } as const;
	});
}

/**
 * `sdd-attempt settle`: single finalization (append-only; a second settle for
 * the same attempt refuses naming the recorded terminal state — R3). Evidence
 * pairing follows the upstream boolean exactly: interrupted carries no
 * evidence, failed requires evidence_revision, passed requires one of the two
 * evidence fields. Terminal settlements retain the untracked scope verbatim.
 */
export function settleJeroSddAttemptV1(context: JeroAuthorityContextV1, input: JeroSddSettleInputV1): JeroSddAttemptResultV1 {
	let root: string;
	let evidenceRevision: string | undefined;
	try {
		root = validateCommon(input);
		boundedText(input.token, 500, "token");
		if (!(JERO_SDD_ATTEMPT_OUTCOMES as readonly string[]).includes(input.outcome)) throw new Error("outcome must be passed, failed, or interrupted");
		evidenceRevision = optionalRevision(input.evidenceRevision, "evidenceRevision");
		if (evidenceRevision === "") throw new Error("evidenceRevision must be a sha256 identity when present");
		if (input.remediationEvidence !== undefined) boundedText(input.remediationEvidence, 500, "remediationEvidence");
		boundedText(input.diagnosis, 500, "diagnosis");
		if (input.harnessDisposition !== "reused" && input.harnessDisposition !== "invalidated") throw new Error("harnessDisposition must be reused or invalidated");
		boundedText(input.cleanupEvidence, 500, "cleanupEvidence");
		boundedText(input.processEvidence, 500, "processEvidence");
		if (input.outcome === "interrupted" ? evidenceRevision !== undefined || input.remediationEvidence !== undefined : !evidenceRevision && !(input.outcome === "passed" && input.remediationEvidence)) throw new Error("invalid terminal evidence pairing");
		if (input.verifyResult !== undefined) {
			// The caller-supplied envelope must already be the decoded record; the
			// sha256 evidence link is the settle-time binding (spec §C).
			decodeJeroVerifyResultV1(input.verifyResult);
			if (input.verifyResult.evidence_revision !== evidenceRevision) throw new Error("verifyResult.evidence_revision must match evidenceRevision");
		}
		validateSelection(input);
	} catch (error) {
		return { kind: "refused", code: "invalid-request", detail: error instanceof Error ? error.message : String(error) };
	}
	return context.locks.withLock(() => {
		const read = readLedgerV1(context.store.store_root, root, input.changeName);
		if (read.kind === "corrupted") return { kind: "refused", code: "ledger-corrupted", detail: read.detail } as const;
		if (read.kind === "empty") return { kind: "refused", code: "no-live-attempt", detail: "no attempt ledger exists for this change" } as const;
		const live = liveAttemptV1(read.ledger);
		if (live === undefined) {
			// Idempotent replay of this exact settle.
			const settled = read.ledger.attempts.find((attempt) => attempt.settlement?.request_id === input.requestId);
			if (settled !== undefined) return { kind: "result", state: "complete", reason: `attempt already settled ${settled.settlement!.outcome}` } as const;
			return { kind: "refused", code: "no-live-attempt", detail: "the recorded attempt is already settled" } as const;
		}
		if (live.token_hash !== sha256Hex(input.token)) return { kind: "refused", code: "token-mismatch", detail: "token does not admit the live attempt" } as const;
		const settledAttempt: JeroSddAttemptRecordV1 = {
			...live,
			settlement: {
				request_id: input.requestId,
				outcome: input.outcome,
				...(evidenceRevision === undefined ? {} : { evidence_revision: evidenceRevision }),
				...(input.remediationEvidence === undefined ? {} : { remediation_evidence: input.remediationEvidence }),
				diagnosis: input.diagnosis,
				harness_disposition: input.harnessDisposition,
				cleanup_evidence: input.cleanupEvidence,
				process_evidence: input.processEvidence,
				settled_untracked: [...(input.intendedUntracked ?? [])],
			},
		};
		const attempts = [...read.ledger.attempts];
		attempts[attempts.length - 1] = settledAttempt;
		writeLedgerV1(context, { ...read.ledger, attempts });
		// Proceed while budget remains; complete names exhaustion (contract :68).
		return attempts.length >= settledAttempt.max_attempts
			? ({ kind: "result", state: "complete", reason: "attempt budget exhausted" } as const)
			: ({ kind: "result", state: "proceed" } as const);
	});
}

/** The current ledger revision — the expectedRevision callers pin against. */
export function jeroSddAttemptLedgerRevisionV1(context: JeroAuthorityContextV1, workspaceRoot: string, changeName: string): string | undefined {
	const read = readLedgerV1(context.store.store_root, workspaceRoot, changeName);
	return read.kind === "ok" ? ledgerRevisionV1(read.ledger) : undefined;
}
