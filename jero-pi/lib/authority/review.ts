import { JeroLineageStoreV1 } from "./lineage-store.ts";
import { JeroObjectCasV1 } from "./object-cas.ts";
import { JeroAuthorityLocksV1 } from "./locks.ts";
import { resolveJeroAuthorityStoreV1, type JeroAuthorityStoreV1 } from "./store-root.ts";
import { reviewStartV1, type JeroReviewStartResultV1, type JeroReviewStartSelectionV1, type JeroReviewStartTargetV1 } from "./start.ts";
import { reviewStatusV1, type JeroReviewStatusResultV1, type JeroReviewStatusTargetV1 } from "./status.ts";
import { reviewFinalizeV1, type JeroReviewFinalizeInputV1, type JeroReviewFinalizeResultV1 } from "./finalize.ts";
import { reviewValidateV1, type JeroReviewValidateInputV1, type JeroReviewValidateResultV1 } from "./validate.ts";
import { reviewAcknowledgeV1, type JeroReviewAcknowledgeInputV1, type JeroReviewAcknowledgeResultV1 } from "./acknowledge.ts";
import { renderJeroCaptureBindingV1, nextJeroCaptureSlotsV1, type JeroCaptureRenderResultV1, type JeroCaptureSlotV1 } from "./capture.ts";
import {
	admitJeroJudgmentDayJudgesV1,
	admitJeroJudgmentDayDiscoveryFreezeV1,
	admitJeroJudgmentDayFixV1,
	admitJeroJudgmentDayRejudgmentV1,
	admitJeroJudgmentDayFinalVerificationV1,
	renderJeroJudgmentDayJudgeVectorsV1,
	buildJeroJudgmentDayRejudgmentRequestV1,
	type JeroJudgmentDayResultV1,
} from "./judgment-day.ts";
import { assessJeroReviewRiskV1, type JeroRiskAssessRequestV1 } from "./risk-assess.ts";
import { getJeroReviewModeV1, setJeroReviewModeV1, defaultGlobalReviewModePathV1, type JeroReviewModeOutcomeV1 } from "./mode.ts";
import { jeroSddStatusV1, type JeroSddStatusResultV1 } from "./sdd-status.ts";
import { jeroSddContinueV1, type JeroSddContinueResultV1 } from "./sdd-continue.ts";
import { acquireJeroSddAttemptV1, jeroSddAttemptLedgerRevisionV1, settleJeroSddAttemptV1, type JeroSddAcquireInputV1, type JeroSddAttemptResultV1, type JeroSddSettleInputV1 } from "./sdd-attempt.ts";
import { abandonJeroLineageV1, jeroAbandonAuthorizationV1, reclaimJeroAuthorityV1, reconcileJeroAuthorityV1, recoverJeroLineageV1, type JeroAbandonInputV1, type JeroMaintenanceResultV1, type JeroReconcileInputV1, type JeroRecoverInputV1 } from "./maintenance.ts";
import type { JeroReviewModeValue } from "./protocol.ts";
import type { ReviewAssessmentV1 } from "../review-risk-assessment.ts";

// 面向扩展的唯一外观，叠在已解析的 jero 权威存储之上（设计 §5.1.1
// 表）：`authority.review.start/status/finalize/validate/acknowledge`、
// `authority.risk.assess`、`authority.mode.get/set`。本模块把 M1 基底
// （血脉存储、CAS、锁、存储根）接线成一个上下文对象；每个 API 都是
// 类型化函数进、可辨识联合出。它不导入任何 extensions/ 代码，也不读
// 环境变量——§9 模块边界将由 dependency-cruiser 钉住。

export interface JeroAuthorityContextV1 {
	/** 已解析（外来检查、身份钉住）的 jero 权威存储。 */
	readonly store: JeroAuthorityStoreV1;
	/** `<store>/lineages/` 下的血脉记录。 */
	readonly lineages: JeroLineageStoreV1;
	/** `<store>/objects/` 下的内容寻址对象。 */
	readonly cas: JeroObjectCasV1;
	/** 权威变更锁；支撑血脉存储的变更类 API 与 START 的活动锁门（已释放的残留绝不阻塞）。 */
	readonly locks: JeroAuthorityLocksV1;
	/**
	 * 调用方解析的全局评审模式记录位置。权威绝不读取环境（边界
	 * §9.1）：宿主的 `JERO_PI_CONFIG_HOME` 覆盖由调用方在上下文存在
	 * 之前应用，因此每次模式读取——包括 START 的同意门——看到的
	 * 全局记录都与包的其余部分一致。
	 */
	readonly globalReviewModePath: string;
}

export type JeroAuthorityContextResolutionV1 =
	| { readonly kind: "ok"; readonly context: JeroAuthorityContextV1 }
	| { readonly kind: "refused"; readonly code: "not-a-git-repository" | "git-unavailable" | "authority-unavailable" | "foreign-authority-store"; readonly detail?: string };

/** 解析 jero 权威存储并派生所有基底句柄。 */
export function resolveJeroAuthorityContextV1(cwd: string, options: { globalReviewModePath?: string } = {}): JeroAuthorityContextResolutionV1 {
	const store = resolveJeroAuthorityStoreV1(cwd);
	if (store.kind !== "ok") {
		return { kind: "refused", code: store.kind, ...("detail" in store ? { detail: store.detail } : { detail: (store as { hits: readonly string[] }).hits.join(", ") }) };
	}
	// 锁封装“最先”构造，使血脉存储的每个变更类 API 都在权威变更锁下
	// 运行（发现 F2）：START、FINALIZE、VALIDATE 与 ACKNOWLEDGE 都经
	// 此句柄持久化。读取（load/list）保持无锁。没有操作嵌套：所有
	// apply() 回调都不会回调进存储，因此 withAuthorityLock 绝不重入
	// acquire()（底层锁是独占 mkdir，不可重入）。
	const locks = new JeroAuthorityLocksV1(store.store_root, store.repository_id, store.authority_id);
	const context: JeroAuthorityContextV1 = {
		store,
		lineages: JeroLineageStoreV1.forStore(store.store_root, { lock: locks }),
		cas: JeroObjectCasV1.forStore(store.store_root),
		locks,
		globalReviewModePath: options.globalReviewModePath ?? defaultGlobalReviewModePathV1(),
	};
	return { kind: "ok", context };
}

export const authority = {
	review: {
		/** 规范 §B——START：冻结、同意门、created/resumed/replayed/closed 变体。 */
		start: (context: JeroAuthorityContextV1, target: JeroReviewStartTargetV1, selection?: JeroReviewStartSelectionV1): JeroReviewStartResultV1 =>
			reviewStartV1(context, target, selection ?? {}),
		/** 规范 §C——STATUS：只读的适用性四元组。 */
		status: (context: JeroAuthorityContextV1, target: JeroReviewStatusTargetV1): JeroReviewStatusResultV1 =>
			reviewStatusV1(context, target),
		/** 规范 §D——FINALIZE：评审视角受理、证据裁决、修正、最终验证。 */
		finalize: (context: JeroAuthorityContextV1, input: JeroReviewFinalizeInputV1): JeroReviewFinalizeResultV1 =>
			reviewFinalizeV1(context, input),
		/** 规范 §E——VALIDATE：证据先行的修正顺序 + 定向验证。 */
		validate: (context: JeroAuthorityContextV1, input: JeroReviewValidateInputV1): JeroReviewValidateResultV1 =>
			reviewValidateV1(context, input),
		/** 规范 §F——ACKNOWLEDGE：已批准权威的焚毁，恰好一次记入日志。 */
		acknowledge: (context: JeroAuthorityContextV1, input: JeroReviewAcknowledgeInputV1): JeroReviewAcknowledgeResultV1 =>
			reviewAcknowledgeV1(context, input),
	},
	capture: {
		/** 规范 §A/§I.1——renderBinding：在进程内渲染的四个捕获槽（存储纯、不派发）。 */
		renderBinding: (slot: JeroCaptureSlotV1): JeroCaptureRenderResultV1 => renderJeroCaptureBindingV1(slot),
		/** 规范 §I.1——血脉当前状态提供的槽位。 */
		nextSlots: (context: JeroAuthorityContextV1, lineageId: string) => nextJeroCaptureSlotsV1(context, lineageId),
	},
	judgmentDay: {
		/** 规范 §F——用于发现阶段的两个盲评裁判提示向量。 */
		renderJudgeVectors: (context: JeroAuthorityContextV1, lineageId: string) => renderJeroJudgmentDayJudgeVectorsV1(context, lineageId),
		/** 规范 §F——confirm-judges：恰好受理两个盲评裁判、零个 refuter。 */
		confirmJudges: (context: JeroAuthorityContextV1, input: Parameters<typeof admitJeroJudgmentDayJudgesV1>[1]): JeroJudgmentDayResultV1 => admitJeroJudgmentDayJudgesV1(context, input),
		/** 规范 §F——freeze-judgment-ledger：冻结合并后的裁判行；零个严重发现时跳到最终验证。 */
		freezeDiscovery: (context: JeroAuthorityContextV1, input: { readonly lineageId: string }): JeroJudgmentDayResultV1 => admitJeroJudgmentDayDiscoveryFreezeV1(context, input),
		/** 规范 §F——覆盖每个幸存发现的单批次修正。 */
		applyFix: (context: JeroAuthorityContextV1, input: Parameters<typeof admitJeroJudgmentDayFixV1>[1]): JeroJudgmentDayResultV1 => admitJeroJudgmentDayFixV1(context, input),
		/** 规范 §F——预期的定向再判决请求。 */
		rejudgmentRequest: (context: JeroAuthorityContextV1, lineageId: string) => buildJeroJudgmentDayRejudgmentRequestV1(context, lineageId),
		/** 规范 §F——定向再判决：幸存 = 未被“两位”裁判共同 verified；第二轮幸存者升级。 */
		rejudge: (context: JeroAuthorityContextV1, input: Parameters<typeof admitJeroJudgmentDayRejudgmentV1>[1]): JeroJudgmentDayResultV1 => admitJeroJudgmentDayRejudgmentV1(context, input),
		/** 规范 §F——最终验证收尾（普通验证 + 第二轮幸存者升级）。 */
		finalVerification: (context: JeroAuthorityContextV1, input: Parameters<typeof admitJeroJudgmentDayFinalVerificationV1>[1]): JeroJudgmentDayResultV1 => admitJeroJudgmentDayFinalVerificationV1(context, input),
	},
	risk: {
		/** 规范 §I.7——只读风险评估；失败保守失败到 high。 */
		assess: (request: JeroRiskAssessRequestV1): ReviewAssessmentV1 => assessJeroReviewRiskV1(request),
	},
	mode: {
		/** 规范 §I.8——只读模式状态（全局 + 克隆 + 生效值）。 */
		get: (cwd: string): JeroReviewModeOutcomeV1 => getJeroReviewModeV1(cwd),
		/** 规范 §I.8——仅克隆作用域的模式变更。 */
		set: (cwd: string, value: JeroReviewModeValue): JeroReviewModeOutcomeV1 => setJeroReviewModeV1(cwd, value),
	},
	sdd: {
		/** 规范 §A.1——对 openspec 树的纯状态投影。 */
		status: (context: JeroAuthorityContextV1, request: { changeName?: string; workspaceRoot: string }): JeroSddStatusResultV1 =>
			jeroSddStatusV1(context, request),
		/** 规范 §A.4——带精确选定变更的变更型继续。 */
		continue: (context: JeroAuthorityContextV1, request: { changeName: string; workspaceRoot: string }): JeroSddContinueResultV1 =>
			jeroSddContinueV1(context, request),
		attempt: {
			/** 规范 §A.2——acquire：单一活动尝试，启动前持久（R1），令牌受理（R2）。 */
			acquire: (context: JeroAuthorityContextV1, input: JeroSddAcquireInputV1): JeroSddAttemptResultV1 =>
				acquireJeroSddAttemptV1(context, input),
			/** 规范 §A.3——settle：单一终结（R3）、逐字未跟踪范围（R4）、证据配对。 */
			settle: (context: JeroAuthorityContextV1, input: JeroSddSettleInputV1): JeroSddAttemptResultV1 =>
				settleJeroSddAttemptV1(context, input),
			/** 调用方钉为 expectedRevision 的台账修订号。 */
			revision: (context: JeroAuthorityContextV1, workspaceRoot: string, changeName: string): string | undefined =>
				jeroSddAttemptLedgerRevisionV1(context, workspaceRoot, changeName),
		},
	},
	maintenance: {
		/** 规范 _tools/p2-m5-maintenance-analysis.md——精确的八行绑定派生。 */
		abandonAuthorization: jeroAbandonAuthorizationV1,
		/** §5.1.6——对活动评审的留审计弃置；保守失败地重新推导被弃工作。 */
		abandon: (context: JeroAuthorityContextV1, input: JeroAbandonInputV1): JeroMaintenanceResultV1 =>
			abandonJeroLineageV1(context, input),
		/** §5.1.6——仓库绑定的破坏性恢复：隔离血脉、保留证据。 */
		reclaim: (context: JeroAuthorityContextV1, input: { lineage: string; actor: string; reason: string }): JeroMaintenanceResultV1 =>
			reclaimJeroAuthorityV1(context, input),
		/** §5.1.6——在继任者上记录恢复关联；前驱不受触碰，不授予新预算。 */
		recover: (context: JeroAuthorityContextV1, input: JeroRecoverInputV1): JeroMaintenanceResultV1 =>
			recoverJeroLineageV1(context, input),
		/** §5.1.6——收窄的调和：双重异常只隔离被绑定的继任者。 */
		reconcile: (context: JeroAuthorityContextV1, input: JeroReconcileInputV1): JeroMaintenanceResultV1 =>
			reconcileJeroAuthorityV1(context, input),
	},
} as const;

export type Authority = typeof authority;
