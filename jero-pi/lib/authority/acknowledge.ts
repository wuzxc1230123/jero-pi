import { jeroDomainHash } from "./canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import { isJeroLineageId } from "./store-root.ts";
import { canonicalJsonV1 } from "../review-canonical.ts";

// `authority.review.acknowledge`（spec §F）：已批准权威的焚毁。持久化
// 的 13 态枚举没有 “burned” 成员，因此焚毁发生在权威层级：一个记入
// 日志、恰好一次的 “acknowledge” 操作，其完成的日志条目本身就是回执
// 已消费的标记。回执文件得以幸存（回滚必须保留每个回执）；STATUS 把
// 已消费的血脉排除在活动目标匹配之外，这才提供了全新的 START。

export const JERO_REVIEW_ACKNOWLEDGED_SCHEMA = "jero.authority.review-acknowledged/v1";

export interface JeroReviewAcknowledgeInputV1 {
	readonly cwd: string;
	readonly lineageId: string;
	/** 调用方 STATUS 绑定持有的确切 `--target` 值。 */
	readonly targetIdentity: string;
	/** 调用方 STATUS 绑定持有的确切 `--expected-revision` 值。 */
	readonly expectedRevision: string;
	/** 调用方 STATUS 绑定持有的确切焚毁令牌（`--token=<value>`）。 */
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
 * ACKNOWLEDGE（spec §F）：恰好一次地焚毁已批准权威。各值必须等于
 * 调用方当前的 STATUS 绑定——漂移的令牌以绑定不匹配保守失败；
 * 精确的 (idempotency_key, request_hash) 重放返回存储的确认封套。
 */
export function reviewAcknowledgeV1(context: JeroAuthorityContextV1, input: JeroReviewAcknowledgeInputV1): JeroReviewAcknowledgeResultV1 {
	if (typeof input.lineageId !== "string" || input.lineageId.length === 0) return { kind: "refused", code: "invalid-request", detail: "lineageId is required" };
	if (typeof input.targetIdentity !== "string" || !/^sha256:[0-9a-f]{64}$/.test(input.targetIdentity)) return { kind: "refused", code: "invalid-request", detail: "targetIdentity must be a canonical sha256 identity" };
	if (typeof input.expectedRevision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(input.expectedRevision)) return { kind: "refused", code: "invalid-request", detail: "expectedRevision must be a canonical sha256 revision" };
	if (typeof input.token !== "string" || input.token.trim().length === 0) return { kind: "refused", code: "invalid-request", detail: "token is required" };
	// F1：畸形的 lineageId 是类型化拒绝，绝不做原始存储错误。
	if (!isJeroLineageId(input.lineageId)) return { kind: "refused", code: "invalid-request", detail: `lineageId ${JSON.stringify(input.lineageId)} is not a canonical review-<16hex> lineage id` };
	const loaded = context.lineages.load(input.lineageId);
	if (loaded.kind === "missing") return { kind: "refused", code: "lineage-missing", detail: `lineage ${input.lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { kind: "refused", code: "corrupted", detail: loaded.detail };
	const record = loaded.record;
	// 单一前置条件（上游 :2498）：state=approved。
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
	// 先做日志重放：焚毁会推进修订号，因此精确重放必然携带它原本持有的
	// 焚毁前绑定。
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
	// 绑定守卫（上游 :2512-2518）：各值必须等于调用方当前的 STATUS
	// 绑定——身份与修订号一视同仁。
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
		// 焚毁恰好消费调用方当时持有的修订号（上游 :2572）。
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
				// 状态保持 `approved`（终局）；日志条目即焚毁。
				draft: { state: current.state, request_journal: current.request_journal },
				result,
			}),
		});
		// 权威结果必须原样通过权威 JSON 的往返校验。
		if (canonicalJsonV1(outcome.result) !== canonicalJsonV1(result)) {
			return { kind: "refused", code: "authority-unavailable", detail: "stored acknowledgement does not match the burn result" };
		}
		return { kind: "acknowledged", result, replayed: false };
	} catch (error) {
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
}
