import type { JeroLensName, JeroReviewMode, JeroReviewStateName } from "./protocol.ts";
import type { JeroCollectTransitionPayloadV1, JeroExecuteTransitionPayloadV1 } from "./collect-inputs.ts";

// 纯粹的评审权威转移表（spec §A.2）、持久化→线上状态投影（spec §A.1），
// 以及状态动作/原因码派生（spec §C.3）。无 IO、无环境读取、无存储访问
// ——这里的每个函数都是对类型化输入的全函数，使非法转移测试组无需
// fixture 即可钉住每个保守失败用例。

// ---------------------------------------------------------------------------
// §A.1 持久化（13 态）→ 线上（15 态）状态投影
// ---------------------------------------------------------------------------

export const JERO_WIRE_REVIEW_STATES = [
	"unreviewed", "reviewing", "judges_confirmed", "findings_frozen", "evidence_classified",
	"fix_required", "fixing", "fix_validating", "correction_required", "validating",
	"ready_final_verification", "final_verifying", "approved", "escalated", "invalidated",
] as const;
export type JeroWireReviewState = (typeof JERO_WIRE_REVIEW_STATES)[number];

const PERSISTED_TO_WIRE: Readonly<Record<JeroReviewStateName, JeroWireReviewState>> = {
	unreviewed: "unreviewed",
	reviewing: "reviewing",
	judges_confirmed: "judges_confirmed",
	findings_frozen: "findings_frozen",
	evidence_classified: "evidence_classified",
	// 持久化记录没有线上的 `correction_required`；开放的修正阶段
	// （fix_required|fixing）投影到它上面（spec §A.1）。
	fix_required: "correction_required",
	fixing: "correction_required",
	// fix_validating | ready_final_verification | final_verifying 投影到
	// 线上的 `validating` 聚合（spec §A.1）。
	fix_validating: "validating",
	ready_final_verification: "validating",
	final_verifying: "validating",
	approved: "approved",
	escalated: "escalated",
	invalidated: "invalidated",
};

/** 持久化 13 态 → 线上 15 态投影（spec §A.1 映射，由测试锁定）。 */
export function projectJeroReviewStateV1(state: JeroReviewStateName): JeroWireReviewState {
	return PERSISTED_TO_WIRE[state];
}

export const JERO_TERMINAL_REVIEW_STATES = ["approved", "escalated", "invalidated"] as const;
export type JeroTerminalReviewState = (typeof JERO_TERMINAL_REVIEW_STATES)[number];

export function isJeroTerminalReviewStateV1(state: JeroReviewStateName): state is JeroTerminalReviewState {
	return (JERO_TERMINAL_REVIEW_STATES as readonly string[]).includes(state);
}

// ---------------------------------------------------------------------------
// §A.2 转移表
// ---------------------------------------------------------------------------

export const JERO_REVIEW_EVENT_KINDS = [
	"freeze-ledger", "confirm-judges", "freeze-judgment-ledger", "resolve-evidence",
	"authorize-fix", "apply-fix", "validate-fix", "reopen-fix",
	"record-final-evidence", "finalize-outcome", "acknowledge", "escalate", "invalidate",
] as const;
export type JeroReviewEventKind = (typeof JERO_REVIEW_EVENT_KINDS)[number];

export interface JeroTransitionCheckV1 {
	readonly legal: boolean;
	readonly from: JeroReviewStateName;
	readonly event: JeroReviewEventKind;
	readonly next?: JeroReviewStateName;
	readonly reason?: string;
}

/** 除状态/模式/计数器外不依赖记录内容的守卫。 */
interface JeroTransitionGuardsV1 {
	/** 普通：至多一个修正事务（fix_rounds ≤ 1）。 */
	readonly fixRounds: number;
	/** JD：至多两个修正批次。 */
	readonly fixBatches: number;
}

const ORDINARY_MODES: readonly JeroReviewMode[] = ["ordinary_4r", "ordinary_bounded"];

export function isJeroOrdinaryModeV1(mode: JeroReviewMode): boolean {
	return ORDINARY_MODES.includes(mode);
}

/**
 * 持久化状态之上的权威转移表（spec §A.2）。未在此列出的每个条目都
 * 非法；从终局状态出发的每个变更无论模式如何都非法；跨模式事件
 * （普通血脉上的 Judgment Day 事件及反之）非法且保留计数器。
 */
export function checkJeroReviewTransitionV1(
	state: JeroReviewStateName,
	mode: JeroReviewMode,
	event: JeroReviewEventKind,
	guards: JeroTransitionGuardsV1 = { fixRounds: 0, fixBatches: 0 },
): JeroTransitionCheckV1 {
	const base = { from: state, event };
	if (isJeroTerminalReviewStateV1(state) && event !== "escalate" && event !== "invalidate" && event !== "acknowledge") {
		// 非法 #1：终局变更保守失败。来自 escalated 的 `escalate` 与
		// `invalidate` 仅作为 M5 拥有的维护表面空操作保持合法；
		// `acknowledge` 是唯一的仅限 approved 的焚毁（行 10，权威层级）。
		return { ...base, legal: false, reason: `terminal-state-${state}-is-immutable` };
	}
	if (event === "invalidate") {
		return { ...base, legal: !isJeroTerminalReviewStateV1(state) || state === "invalidated", next: "invalidated" };
	}
	if (event === "escalate") {
		return state === "escalated"
			? { ...base, legal: true, next: "escalated" }
			: isJeroTerminalReviewStateV1(state)
				? { ...base, legal: false, reason: `terminal-state-${state}-is-immutable` }
				: { ...base, legal: true, next: "escalated" };
	}
	const ordinary = isJeroOrdinaryModeV1(mode);
	if (ordinary && (event === "confirm-judges" || event === "freeze-judgment-ledger")) {
		// 非法 #9：普通血脉上的 JD 操作。
		return { ...base, legal: false, reason: "cross-mode-operation-refused" };
	}
	if (!ordinary && (event === "freeze-ledger")) {
		// 普通评审视角受理不是 JD 事件（JD 经它自己的 judges_confirmed
		// 状态冻结）。
		return { ...base, legal: false, reason: "cross-mode-operation-refused" };
	}
	switch (event) {
		case "freeze-ledger":
			// 非法 #2：评审视角恰好运行一次，只能从 `reviewing` 出发。
			return state === "reviewing"
				? { ...base, legal: true, next: "findings_frozen" }
				: { ...base, legal: false, reason: "lens-admission-requires-reviewing" };
		case "confirm-judges":
			return state === "reviewing"
				? { ...base, legal: true, next: "judges_confirmed" }
				: { ...base, legal: false, reason: "judge-admission-requires-reviewing" };
		case "freeze-judgment-ledger":
			return state === "judges_confirmed"
				? { ...base, legal: true, next: "findings_frozen" }
				: { ...base, legal: false, reason: "judgment-freeze-requires-judges-confirmed" };
		case "resolve-evidence":
			// 非法 #3：证据裁决需要已冻结的台账。
			return state === "findings_frozen"
				? { ...base, legal: true, next: "evidence_classified" }
				: { ...base, legal: false, reason: "resolve-evidence-requires-frozen-ledger" };
		case "authorize-fix": {
			// authorize-fix 在“每种”模式下都要求 fix_required。（残留的
			// `judges_confirmed` 析取分支已删除：JD 血脉绝不从
			// judges_confirmed 授权修正——该状态只经
			// freeze-judgment-ledger 离开，JD 修正循环从 fix_required 运行。）
			if (state !== "fix_required") {
				return { ...base, legal: false, reason: "authorize-fix-requires-fix-required" };
			}
			// 非法 #4：第二个修正事务保守失败。
			if (ordinary && guards.fixRounds >= 1) return { ...base, legal: false, reason: "second-correction-refused" };
			if (!ordinary && guards.fixBatches >= 2) return { ...base, legal: false, reason: "judgment-day-fix-budget-exhausted" };
			return { ...base, legal: true, next: "fixing" };
		}
		case "apply-fix":
			return state === "fixing"
				? { ...base, legal: true, next: "fix_validating" }
				: { ...base, legal: false, reason: "apply-fix-requires-fixing" };
		case "validate-fix":
			return state === "fix_validating"
				? { ...base, legal: true, next: "ready_final_verification" }
				: { ...base, legal: false, reason: "validate-fix-requires-fix-validating" };
		case "reopen-fix":
			// §A.2 行 7c：verification_failed 重开修正（不是新事务）；
			// 不计费。
			return state === "fix_validating"
				? { ...base, legal: true, next: "fixing" }
				: { ...base, legal: false, reason: "reopen-fix-requires-fix-validating" };
		case "record-final-evidence":
			return state === "ready_final_verification"
				? { ...base, legal: true, next: "final_verifying" }
				: { ...base, legal: false, reason: "final-evidence-requires-ready-final-verification" };
		case "finalize-outcome":
			return state === "final_verifying"
				? { ...base, legal: true, next: "final_verifying" }
				: { ...base, legal: false, reason: "finalize-outcome-requires-final-verifying" };
		case "acknowledge":
			// 非法 #8：非 approved 上的 acknowledge 保守失败。
			return state === "approved"
				? { ...base, legal: true, next: "approved" }
				: { ...base, legal: false, reason: "acknowledge-requires-approved" };
		default:
			return { ...base, legal: false, reason: "unknown-transition-event" };
	}
}

/** 每个终局状态都拒绝的变更类权威操作。acknowledge 焚毁不在该列表中：它是权威层级（行 10），仅从 `approved` 合法。 */
export const JERO_TERMINAL_MUTATION_EVENTS: readonly JeroReviewEventKind[] = [
	"freeze-ledger", "confirm-judges", "freeze-judgment-ledger", "resolve-evidence",
	"authorize-fix", "apply-fix", "validate-fix", "reopen-fix",
	"record-final-evidence", "finalize-outcome",
];

// ---------------------------------------------------------------------------
// §C.3 状态动作词汇与派生
// ---------------------------------------------------------------------------

// 线上 schema 联合（status-v2.schema.json 的 action 枚举），不是更窄的
// 上游 TS 解码器集合——规范差异 #2 裁定为采用 schema 联合：真实捕获
// 携带 `action:"finalize"`，而 M2 拥有该操作。
export const JERO_STATUS_ACTIONS = [
	"start", "finalize", "validate", "recover", "retry_final_verification",
	"maintainer_action", "select_lineage", "repair_authority", "reconcile_finalize", "stop",
] as const;
export type JeroStatusAction = (typeof JERO_STATUS_ACTIONS)[number];

export const JERO_REPLAYABILITY = ["not_replayable", "exact_replay_safe", "status_required", "manual_action_required"] as const;
export type JeroReplayability = (typeof JERO_REPLAYABILITY)[number];

export const JERO_ESCALATION_CAUSES = [
	"unknown_causality", "insufficient_evidence", "missing_refuter_outcome",
	"targeted_validator_rejected", "correction_budget_exceeded", "unresolved_severe_findings",
] as const;
export type JeroEscalationCause = (typeof JERO_ESCALATION_CAUSES)[number];

export interface JeroNextTransitionV1 {
	readonly kind: "execute" | "collect" | "stop";
	readonly reason_code: string;
	readonly operation?: string;
	/** M3（spec §I.2）：collect 载荷——由 collect-inputs.ts 构建的捕获输入。 */
	readonly collect?: JeroCollectTransitionPayloadV1;
	/** M3（spec §I.2）：execute 载荷——带前置条件与已受理产物的类型化操作绑定。 */
	readonly execute?: JeroExecuteTransitionPayloadV1;
}

export interface JeroStatusDerivationInputV1 {
	readonly state: JeroReviewStateName;
	readonly mode: JeroReviewMode;
	readonly selectedLenses: readonly JeroLensName[];
	readonly admittedLenses: readonly JeroLensName[];
	readonly pendingRefuterIds: readonly string[];
	readonly fixFindingIds: readonly string[];
	readonly consumed: boolean;
}

/**
 * 从持久化记录派生状态动作（schema 联合词汇）与权威的路由
 * `next_transition`（spec §C.3）。内部路由派生自 next_transition；
 * 动作是摘要词汇。
 */
export function deriveJeroStatusActionV1(input: JeroStatusDerivationInputV1): { action: JeroStatusAction; next: JeroNextTransitionV1 } {
	if (input.consumed) {
		return { action: "stop", next: { kind: "stop", reason_code: "authority_consumed" } };
	}
	switch (input.state) {
		case "unreviewed":
		case "reviewing": {
			const complete = input.selectedLenses.length > 0 &&
				input.selectedLenses.every((lens) => input.admittedLenses.includes(lens));
			if (input.selectedLenses.length === 0) {
				return { action: "finalize", next: { kind: "execute", reason_code: "captured_results_ready", operation: "review.finalize" } };
			}
			return complete
				? { action: "finalize", next: { kind: "execute", reason_code: "captured_results_ready", operation: "review.finalize" } }
				: { action: "start", next: { kind: "collect", reason_code: "reviewer_results_required" } };
		}
		case "judges_confirmed":
			return { action: "finalize", next: { kind: "execute", reason_code: "judgment_ledger_ready", operation: "review.finalize" } };
		case "findings_frozen":
			return input.pendingRefuterIds.length > 0
				? { action: "finalize", next: { kind: "collect", reason_code: "refuter_outcome_required", operation: "review.finalize" } }
				: { action: "finalize", next: { kind: "collect", reason_code: "evidence_classification_required", operation: "review.finalize" } };
		case "evidence_classified":
			return input.fixFindingIds.length > 0
				? { action: "finalize", next: { kind: "collect", reason_code: "correction_plan_required", operation: "review.finalize" } }
				: { action: "finalize", next: { kind: "execute", reason_code: "final_verification_ready", operation: "review.finalize" } };
		case "fix_required":
		case "fixing":
			return { action: "finalize", next: { kind: "collect", reason_code: "correction_plan_required", operation: "review.finalize" } };
		case "fix_validating":
			// §A.4（Mi5 评审裁决）：提供方定向 validator 向量是自包含的
			// COLLECT 输入——STATUS 以 kind “collect” 提供它并携带 validator
			// 的请求文档，review.validate 经 capture→admit→validate 路径执行
			// （扩展消费 kind === “collect”），绝不从 STATUS 直接执行。
			return { action: "validate", next: { kind: "collect", reason_code: "targeted_validation_ready", operation: "review.validate" } };
		case "ready_final_verification":
			return { action: "finalize", next: { kind: "collect", reason_code: "final_evidence_required", operation: "review.finalize" } };
		case "final_verifying":
			return { action: "finalize", next: { kind: "execute", reason_code: "final_outcome_required", operation: "review.finalize" } };
		case "approved":
			return { action: "stop", next: { kind: "execute", reason_code: "approved_awaiting_acknowledgement", operation: "review.acknowledge-approved" } };
		case "escalated":
			return { action: "maintainer_action", next: { kind: "stop", reason_code: "escalated_terminal" } };
		case "invalidated":
			return { action: "maintainer_action", next: { kind: "stop", reason_code: "invalidated_terminal" } };
		default:
			return { action: "stop", next: { kind: "stop", reason_code: "unknown_state" } };
	}
}
