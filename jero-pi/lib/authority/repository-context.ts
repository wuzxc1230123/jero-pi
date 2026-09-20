import { readFileSync } from "node:fs";
import { jeroDomainHash } from "./canonical.ts";
import { assertJeroReceiptIntegrityV1, jeroReceiptPathV1 } from "./receipts.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import type { JeroAuthorityOperation, JeroReceiptEnvelopeV1 } from "./protocol.ts";

// `repository_context`——rctx1_ 句柄块（spec §C）。
//
// 上游哈希的是不透明的服务端上下文；其事实依据只是：句柄在每个血脉
// 时刻与 `(revision, target_identity)` 一一对应，并在每个
// START/STATUS/collect/execute 绑定中逐字回显。jero 保留了句柄派生
// （它已满足 1:1 性质），并从活动权威状态——日志、权威锁、回执文件
// ——派生成对的 `event_id`/`outcome`。这里不持久化任何事件台账——每个
// 结局都从对账器会使用的相同持久事实重新计算（spec §C 的 M3 升级
// 说明）。

export const JERO_REPOSITORY_CONTEXT_CAPABILITY = "review.opaque_repository_context";

export const JERO_REPOSITORY_CONTEXT_OUTCOMES = ["applied", "pending", "blocked_conflict", "durability_limited"] as const;
export type JeroRepositoryContextOutcome = (typeof JERO_REPOSITORY_CONTEXT_OUTCOMES)[number];

export interface JeroRepositoryContextV1 {
	readonly capability: typeof JERO_REPOSITORY_CONTEXT_CAPABILITY;
	/** `rctx1_<64 位十六进制>`——与 (revision, target_identity) 一一对应。 */
	readonly handle: string;
	readonly revision: string;
	readonly target_identity: string;
	/** 与 `outcome` 成对——要么都在，要么都不在（fixture 纪律）。 */
	readonly event_id?: string;
	readonly outcome?: JeroRepositoryContextOutcome;
}

const REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** 句柄派生：`rctx1_ + jeroDomainHash("repository-context", {target_identity, revision})`（M2 公式，保留）。 */
export function jeroRepositoryContextHandleV1(targetIdentity: string, revision: string): string {
	if (!IDENTITY_PATTERN.test(targetIdentity)) throw new TypeError("repository context target identity must be a canonical sha256 identity");
	if (!REVISION_PATTERN.test(revision)) throw new TypeError("repository context revision must be a canonical sha256 revision");
	return `rctx1_${jeroDomainHash("repository-context", { target_identity: targetIdentity, revision })}`;
}

/** 某个血脉时刻上某个权威操作的事件身份。 */
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
 * 对照活动权威状态推导某个操作的结局（spec §C）：任一日志条目 pending
 * 时为 `pending`（崩溃窗口，可经 prepareOperation/completeOperation 对账）；
 * 权威锁为 owned/ambiguous 时为 `blocked_conflict`；血脉已终局但回执
 * 文件尚未出现时为 `durability_limited`；该操作的日志条目完成后为
 * `applied`。
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
 * 为某个操作铸造完整的仓库上下文块。`event_id` 与 `outcome` 总是成对
 * 发出（fixture 绝不单独携带其一）；没有自己操作的只读表面
 * （STATUS current_target）传入 `"status"` 并对照血脉时刻派生。
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

/** 对搭载在类型化表面上的该块做严格解码（未知键保守失败）。 */
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
