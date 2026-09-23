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
	buildJeroAcknowledgeExecuteTransitionV1,
	buildJeroRefuterCollectInputV1,
	buildJeroReviewerResultCollectInputsV1,
	buildJeroValidationCollectInputV1,
} from "./collect-inputs.ts";
import { capturedJeroArtifactsCompleteV1, jeroResultArtifactSummariesV1 } from "./result-artifacts.ts";

// `authority.review.status`（spec §C）：从 Git——绝不从提供方文件——
// 重新计算只读的适用性判定（`current_target | unrelated | ambiguous |
// corrupted`），外加回执状态、动作/可重放性、冻结块与候选血脉列表。
//
// M3 新增（spec §G/§I.2）：修正阶段状态的血脉绑定匹配（显式
// lineageId，或自动匹配轮，绝不在修正中途从可变工作区重新派生身份）；
// 冻结块“始终”来自记录；STATUS current_target 发出完整的
// repository_context 块；collect 转换携带其捕获输入，finalize execute
// 携带前置条件、已受理产物与仓库上下文绑定。

export type JeroReviewApplicabilityV1 = "current_target" | "unrelated" | "ambiguous" | "corrupted";
export type JeroReceiptStatusV1 = "expected_missing" | "present" | "publication_pending" | "not_applicable";

export interface JeroReviewStatusTargetV1 {
	readonly cwd: string;
	readonly lineageId?: string;
	/** 要求 `committedOnly: true`，与 START 完全一致。 */
	readonly baseRef?: string;
	readonly committedOnly?: boolean;
	/** M3（§G）：staged 经临时索引从 Git INDEX 计算活动候选。 */
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
/** 来自“记录”（M3 差异 #4）：schema 可选——记录早于该字段时，血脉绑定的状态会省略它。 */
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

// 线上投影为修正/验证聚合的持久化状态：身份“绝不”从可变工作区重新
// 派生（spec §G 的血脉绑定投影——M2 的工作区漂移说明）。
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

/** 把 M3 的 collect/execute 载荷附加到派生的下一步转换上。 */
function attachTransitionPayloadsV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, next: JeroNextTransitionV1, discovery: { readonly artifacts: readonly import("./result-artifacts.ts").JeroResultArtifactV1[] }, cwd: string): JeroNextTransitionV1 {
	const repositoryContext = mintJeroRepositoryContextV1(context, record, "status");
	if (next.reason_code === "targeted_validation_ready" && next.operation === "review.validate") {
		// §A.4（Mi5）：提供方定向 validator 向量是自包含的 COLLECT 输入
		// （中继按捕获操作路由它）——M2 派生现在携带 kind “collect”，
		// 本附加构建其完整请求文档；review.validate 经
		// capture→admit→validate 执行，绝不从 STATUS 直接执行。
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
	if (next.kind === "execute" && next.reason_code === "approved_awaiting_acknowledgement" && next.operation === "review.acknowledge-approved") {
		return { ...next, execute: buildJeroAcknowledgeExecuteTransitionV1(record, repositoryContext, cwd) };
	}
	return next;
}

function currentTargetStatusV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, live: { readonly risk: { readonly tier: string; readonly original_changed_lines: number; readonly correction_budget: number }; readonly changed_path_manifest_sha256?: string; readonly target_identity: string }, lineageBound: boolean, requestedProjection: "workspace" | "staged", cwd: string): JeroReviewStatusResultV1 {
	const state = record.state;
	const consumed = isJeroLineageConsumedV1(record);
	// 已受理评审视角“同时”派生自记录与磁盘上的产物发现
	// （fixture：status-v5-repository-context——captured_results_ready 在
	// 已受理产物在磁盘上完整时触发，那发生在 freeze-ledger 日志步骤
	// “之前”）。
	const discovery = capturedJeroArtifactsCompleteV1(context, record);
	// MA4 连贯性：某个评审视角的已受理产物未通过磁盘校验（结果文件被
	// 删除或改写）时，在这里也不再算已受理——STATUS 重新提供评审员
	// collect 输入，而不是宣传一个 captured_artifacts=complete 前置条件
	// 已不成立的 finalize。
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
	// 差异 #4：冻结块来自“记录”。只有身份匹配（非血脉绑定）的状态才可
	// 以为早于该持久化字段的记录回退到活动清单摘要。
	const frozenManifest = state.changed_path_manifest_sha256 ?? (lineageBound ? undefined : live.changed_path_manifest_sha256);
	const withPayloads = attachTransitionPayloadsV1(context, record, next, discovery, cwd);
	return {
		kind: "status",
		applicability: "current_target",
		target_identity: lineageBound ? state.snapshot.identity : live.target_identity,
		// Mi6（评审）：当前目标状态回显“请求的”投影，而不是硬编码
		// workspace。
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
 * STATUS（spec §C）。只读：从 Git 重新计算活动投影，按快照身份匹配
 * 持久化血脉，并从 schema 联合词汇派生动作。M3（§G）：带显式
 * lineageId 的 STATUS——以及自动匹配轮——把修正阶段的血脉视为血脉
 * 绑定：身份是冻结的记录身份，绝不是新的工作区派生。非当前状态绝不
 * 暴露 `authority`/`frozen`；`ambiguous` 以动作 `select_lineage` 列出
 * 唯一的血脉 id；损坏的记录以 `repair_authority` 保守失败。
 */
export function reviewStatusV1(context: JeroAuthorityContextV1, target: JeroReviewStatusTargetV1): JeroReviewStatusResultV1 {
	if ((target.baseRef !== undefined) !== (target.committedOnly === true)) {
		return { kind: "refused", code: "invalid-request", detail: "baseRef and committedOnly must be paired exactly like START" };
	}
	if (target.projection !== undefined && target.projection !== "workspace" && target.projection !== "staged") {
		return { kind: "refused", code: "invalid-request", detail: `projection ${JSON.stringify(target.projection)} is not supported` };
	}
	// F1：畸形的 lineageId 在公共边界是类型化的 invalid-request 拒绝
	// ——绝不透出 load() 的原始 JeroLineageStoreError。
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

	// Q-B2：应用了有界修正的血脉会存储最终候选树；当活动工作区“就是”
	// 那棵树时，即使血脉的 START 快照身份早于修正，它也是当前目标。
	// 没有这条，已批准的已修正血脉对 STATUS 不可见，其 acknowledge 焚毁
	// 永远无法绑定。
	const coversLiveCandidateV1 = (record: JeroLineageStateFileV1): boolean =>
		record.state.final_candidate_tree !== undefined && record.state.final_candidate_tree === live.record.complete_snapshot_tree;

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
		// §G 血脉绑定匹配：修正中途工作区已随修正移动；被点名的血脉按
		// ID 与其冻结身份绑定。
		if (CORRECTION_PHASE_STATES.has(loaded.record.state.state)) {
			lineageBound.push(loaded.record);
		} else if (loaded.record.state.snapshot.identity === targetIdentity || coversLiveCandidateV1(loaded.record)) {
			// 显式路径与列表路径一样按身份精确匹配（F7）：冻结身份已偏离
			// 活动候选的被点名血脉“不是”当前目标——除非活动树正是该血脉
			// 自己修正后的最终树（Q-B2）。
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
			if (loaded.record.state.snapshot.identity === targetIdentity || coversLiveCandidateV1(loaded.record)) {
				matches.push(loaded.record);
			} else if (CORRECTION_PHASE_STATES.has(loaded.record.state.state)) {
				lineageBound.push(loaded.record);
			}
		}
	}

	if (matches.length === 1) {
		return currentTargetStatusV1(context, matches[0]!, live, false, requestedProjection, target.cwd);
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
		// 恰好一个活动的修正阶段血脉：对本仓库是当前状态，绑定其冻结
		// 身份（§G 自动匹配轮）。
		return currentTargetStatusV1(context, lineageBound[0]!, live, true, requestedProjection, target.cwd);
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
	// `unrelated`：没有血脉匹配活动候选——需要新的 START。
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
