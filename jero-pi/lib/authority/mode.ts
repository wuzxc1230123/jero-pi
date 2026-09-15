import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { canonicalJsonV1, parseCanonicalJsonV1 } from "../review-canonical.ts";
import { jeroDomainHash } from "./canonical.ts";
import { decodeJeroReviewModeRecordV1, type JeroReviewModeValue } from "./protocol.ts";
import { JeroAuthorityStoreError, resolveJeroAuthorityStoreV1 } from "./store-root.ts";

// Review-mode (RDD) get/set (spec §I.8): clone-scoped mutations only — every
// set writes `<jero-store>/review-mode.json`; the global value under the jero
// config home is read-only for M2 (user-explicit `/jero:review-mode` wiring
// lands with extensions integration). The typed result mirrors the upstream
// `NativeReviewModeResult` field-for-field (operation/scope/status) so the
// extensions seam can render it unchanged.

export type JeroReviewModeSource = "default" | "global" | "clone_local";
export type JeroReviewModeReach = "machine" | "this_build";

export interface JeroReviewModeStatusV1 {
	global: "" | JeroReviewModeValue;
	cloneLocal: "" | JeroReviewModeValue;
	effective: "on" | "off";
	source: JeroReviewModeSource;
	revision?: string;
	reach?: JeroReviewModeReach;
}

export interface JeroReviewModeResultV1 {
	operation: "status" | "enable" | "disable";
	scope: "global" | "clone" | "both";
	status: JeroReviewModeStatusV1;
}

export type JeroReviewModeOutcomeV1 =
	| { readonly kind: "ok"; readonly result: JeroReviewModeResultV1 }
	| { readonly kind: "refused"; readonly code: "not-a-git-repository" | "git-unavailable" | "authority-unavailable" | "foreign-authority-store" | "mode-record-corrupted" | "mode-value-invalid"; readonly detail?: string };

export const JERO_REVIEW_MODE_FILENAME = "review-mode.json";

function globalModePath(): string {
	return join(homedir(), ".pi", "jero", JERO_REVIEW_MODE_FILENAME);
}

function cloneModePath(storeRoot: string): string {
	return join(storeRoot, JERO_REVIEW_MODE_FILENAME);
}

function readModeRecord(path: string, label: string): { value: JeroReviewModeValue | ""; corrupted?: string } {
	if (!existsSync(path)) return { value: "" };
	try {
		const decoded = decodeJeroReviewModeRecordV1(parseCanonicalJsonV1(readFileSync(path)));
		return { value: decoded.value };
	} catch (error) {
		return { value: "", corrupted: `${label}: ${error instanceof Error ? error.message : String(error)}` };
	}
}

function modeRevision(value: JeroReviewModeValue): string {
	return `sha256:${jeroDomainHash("review-mode", { schema: "jero.authority.review-mode/v1", value })}`;
}

function composeStatus(global: "" | JeroReviewModeValue, cloneLocal: "" | JeroReviewModeValue): JeroReviewModeStatusV1 {
	// The most specific explicit value wins: a set clone-local value (on OR
	// off) overrides the global one; with neither set the mode defaults ON —
	// upstream provenance native-review-cli.ts:269-271 ("Reviews are on by
	// default; this was never explicitly chosen"). Defaulting off would make
	// the §B.5 consent ceremony unreachable for default-source clones.
	const source: JeroReviewModeSource = cloneLocal !== "" ? "clone_local" : global !== "" ? "global" : "default";
	const effective: "on" | "off" = source === "clone_local" ? (cloneLocal === "on" ? "on" : "off") : source === "global" ? (global === "on" ? "on" : "off") : "on";
	return {
		global,
		cloneLocal,
		effective,
		source,
		...(cloneLocal !== "" ? { revision: modeRevision(cloneLocal) } : {}),
		// `reach` reports how far the winning explicit value extends: a global
		// value reaches the whole machine, a clone-local value this clone.
		...(source === "global" ? { reach: "machine" as const } : source === "clone_local" ? { reach: "this_build" as const } : {}),
	};
}

/** Read-only mode status; never writes, never throws raw. */
export function getJeroReviewModeV1(cwd: string, options: { globalModePath?: string } = {}): JeroReviewModeOutcomeV1 {
	const store = resolveJeroAuthorityStoreV1(cwd);
	if (store.kind !== "ok") return { kind: "refused", code: store.kind, detail: "detail" in store ? store.detail : store.hits.join(", ") };
	const global = readModeRecord(options.globalModePath ?? globalModePath(), "global review mode");
	if (global.corrupted !== undefined) return { kind: "refused", code: "mode-record-corrupted", detail: global.corrupted };
	const clone = readModeRecord(cloneModePath(store.store_root), "clone review mode");
	if (clone.corrupted !== undefined) return { kind: "refused", code: "mode-record-corrupted", detail: clone.corrupted };
	return { kind: "ok", result: { operation: "status", scope: "both", status: composeStatus(global.value, clone.value) } };
}

/** Effective mode for START's consent gate (read-only convenience). */
export function effectiveJeroReviewModeV1(storeRoot: string, options: { globalModePath?: string } = {}): { effective: "on" | "off"; corrupted?: string } {
	const global = readModeRecord(options.globalModePath ?? globalModePath(), "global review mode");
	if (global.corrupted !== undefined) return { effective: "on", corrupted: global.corrupted };
	const clone = readModeRecord(cloneModePath(storeRoot), "clone review mode");
	if (clone.corrupted !== undefined) return { effective: "on", corrupted: clone.corrupted };
	const status = composeStatus(global.value, clone.value);
	return { effective: status.effective };
}

/** Clone-scoped set: the ONLY mutation M2 offers; typed result mirrors NativeReviewModeResult. */
export function setJeroReviewModeV1(cwd: string, value: JeroReviewModeValue, options: { globalModePath?: string } = {}): JeroReviewModeOutcomeV1 {
	if (value !== "on" && value !== "off") return { kind: "refused", code: "mode-value-invalid", detail: `unsupported mode value ${JSON.stringify(value)}` };
	const store = resolveJeroAuthorityStoreV1(cwd);
	if (store.kind !== "ok") return { kind: "refused", code: store.kind, detail: "detail" in store ? store.detail : store.hits.join(", ") };
	const global = readModeRecord(options.globalModePath ?? globalModePath(), "global review mode");
	if (global.corrupted !== undefined) return { kind: "refused", code: "mode-record-corrupted", detail: global.corrupted };
	const record = { schema: "jero.authority.review-mode/v1" as const, value };
	// decode-before-write keeps the strict-decode discipline at the boundary.
	decodeJeroReviewModeRecordV1(record);
	const path = cloneModePath(store.store_root);
	try {
		mkdirSync(store.store_root, { recursive: true, mode: 0o700 });
		// Atomic temp+rename: a crash mid-write can never leave a torn or empty
		// mode record behind (a torn record would read as corrupted and fail
		// closed to mode-on, but the intent was an explicit disable).
		const staging = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
		try {
			writeFileSync(staging, `${canonicalJsonV1(record)}\n`, { mode: 0o600 });
			renameSync(staging, path);
		} finally {
			rmSync(staging, { force: true });
		}
	} catch (error) {
		throw new JeroAuthorityStoreError(`Unable to persist clone review mode: ${error instanceof Error ? error.message : String(error)}`);
	}
	return { kind: "ok", result: { operation: value === "on" ? "enable" : "disable", scope: "clone", status: composeStatus(global.value, value) } };
}
