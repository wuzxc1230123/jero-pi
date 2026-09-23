import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { canonicalJsonV1, parseCanonicalJsonV1 } from "../review-canonical.ts";
import { jeroDomainHash } from "./canonical.ts";
import { decodeJeroReviewModeRecordV1, type JeroReviewModeValue } from "./protocol.ts";
import { JeroAuthorityStoreError, resolveJeroAuthorityStoreV1 } from "./store-root.ts";

// 评审模式（RDD）的读写（spec §I.8）：只做克隆作用域的变更——每次设置
// 写入 `<jero-store>/review-mode.json`；jero 配置主目录下的全局值在 M2
// 是只读的（用户显式的 `/jero:review-mode` 接线随扩展集成落地）。
// 类型化结果逐字段镜像上游的 `NativeReviewModeResult`
// （operation/scope/status），使扩展接缝可以原样渲染它。

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

/** 默认的全局记录位置；调用方在上下文存在之前应用其环境覆盖。 */
export function defaultGlobalReviewModePathV1(): string {
	return join(homedir(), ".pi", "jero", JERO_REVIEW_MODE_FILENAME);
}

function globalModePath(): string {
	return defaultGlobalReviewModePathV1();
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
	// 最具体的显式值获胜：已设置的克隆局部值（无论 on 还是 off）覆盖
	// 全局值；两者都未设置时模式默认开启——上游出处
	// native-review-cli.ts:269-271（“Reviews are on by default; this was
	// never explicitly chosen”）。默认关闭会使 default 来源克隆的 §B.5
	// 同意仪式不可达。
	const source: JeroReviewModeSource = cloneLocal !== "" ? "clone_local" : global !== "" ? "global" : "default";
	const effective: "on" | "off" = source === "clone_local" ? (cloneLocal === "on" ? "on" : "off") : source === "global" ? (global === "on" ? "on" : "off") : "on";
	return {
		global,
		cloneLocal,
		effective,
		source,
		...(cloneLocal !== "" ? { revision: modeRevision(cloneLocal) } : {}),
		// `reach` 报告获胜的显式值延伸多远：全局值覆盖整台机器，
		// 克隆局部值只覆盖本克隆。
		...(source === "global" ? { reach: "machine" as const } : source === "clone_local" ? { reach: "this_build" as const } : {}),
	};
}

/** 只读模式状态；绝不写入，绝不抛出原始错误。 */
export function getJeroReviewModeV1(cwd: string, options: { globalModePath?: string } = {}): JeroReviewModeOutcomeV1 {
	const store = resolveJeroAuthorityStoreV1(cwd);
	if (store.kind !== "ok") return { kind: "refused", code: store.kind, detail: "detail" in store ? store.detail : store.hits.join(", ") };
	const global = readModeRecord(options.globalModePath ?? globalModePath(), "global review mode");
	if (global.corrupted !== undefined) return { kind: "refused", code: "mode-record-corrupted", detail: global.corrupted };
	const clone = readModeRecord(cloneModePath(store.store_root), "clone review mode");
	if (clone.corrupted !== undefined) return { kind: "refused", code: "mode-record-corrupted", detail: clone.corrupted };
	return { kind: "ok", result: { operation: "status", scope: "both", status: composeStatus(global.value, clone.value) } };
}

/** START 同意门用的生效模式（只读便捷封装）。 */
export function effectiveJeroReviewModeV1(storeRoot: string, options: { globalModePath?: string } = {}): { effective: "on" | "off"; corrupted?: string } {
	const global = readModeRecord(options.globalModePath ?? globalModePath(), "global review mode");
	if (global.corrupted !== undefined) return { effective: "on", corrupted: global.corrupted };
	const clone = readModeRecord(cloneModePath(storeRoot), "clone review mode");
	if (clone.corrupted !== undefined) return { effective: "on", corrupted: clone.corrupted };
	const status = composeStatus(global.value, clone.value);
	return { effective: status.effective };
}

/** 克隆作用域的设置：M2 提供的唯一变更；类型化结果镜像 NativeReviewModeResult。 */
export function setJeroReviewModeV1(cwd: string, value: JeroReviewModeValue, options: { globalModePath?: string } = {}): JeroReviewModeOutcomeV1 {
	if (value !== "on" && value !== "off") return { kind: "refused", code: "mode-value-invalid", detail: `unsupported mode value ${JSON.stringify(value)}` };
	const store = resolveJeroAuthorityStoreV1(cwd);
	if (store.kind !== "ok") return { kind: "refused", code: store.kind, detail: "detail" in store ? store.detail : store.hits.join(", ") };
	const global = readModeRecord(options.globalModePath ?? globalModePath(), "global review mode");
	if (global.corrupted !== undefined) return { kind: "refused", code: "mode-record-corrupted", detail: global.corrupted };
	const record = { schema: "jero.authority.review-mode/v1" as const, value };
	// 先解码再写入，在边界处保持严格解码纪律。
	decodeJeroReviewModeRecordV1(record);
	const path = cloneModePath(store.store_root);
	try {
		mkdirSync(store.store_root, { recursive: true, mode: 0o700 });
		// 原子的临时文件+重命名：写入中途崩溃绝不会留下撕裂或空的
		// 模式记录（撕裂的记录会被读成损坏并保守失败到模式开启，
		// 但用户意图是显式关闭）。
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
