// 线上契约词汇：操作/适用性/回放性/投影/能力特征等枚举与冻结常量表。
// 自 lib/authority/wire-contract.ts 拆分（机械平移，语义零改动）。

import {
	decodeReviewStatusV3
} from "./wire-contract-decode-status.ts";
export const REVIEW_INTEGRATION_CONTRACT = "gentle-ai.review-integration/v2";

export const REVIEW_INTEGRATION_OPERATION = {
	REPAIR: "review.repair",
	START: "review.start",
	STATUS: "review.status",
} as const;
export type ReviewIntegrationOperation = (typeof REVIEW_INTEGRATION_OPERATION)[keyof typeof REVIEW_INTEGRATION_OPERATION];

// 保留的枚举/联合，与身份无关：逐字复制自 lib/review-integration-v1.ts。
export const REVIEW_AUTHORITY_APPLICABILITY = {
	CURRENT_TARGET: "current_target",
	UNRELATED: "unrelated",
	AMBIGUOUS: "ambiguous",
	CORRUPTED: "corrupted",
	NOT_EVALUATED: "not_evaluated",
} as const;
export type ReviewAuthorityApplicability = (typeof REVIEW_AUTHORITY_APPLICABILITY)[keyof typeof REVIEW_AUTHORITY_APPLICABILITY];

export const REVIEW_REPLAYABILITY = {
	NOT_REPLAYABLE: "not_replayable",
	EXACT_REPLAY_SAFE: "exact_replay_safe",
	STATUS_REQUIRED: "status_required",
	MANUAL_ACTION_REQUIRED: "manual_action_required",
} as const;
export type ReviewReplayability = (typeof REVIEW_REPLAYABILITY)[keyof typeof REVIEW_REPLAYABILITY];

export const REVIEW_MUTATION_OUTCOME = {
	NOT_STARTED: "not_started",
	UNKNOWN: "unknown",
	COMMITTED: "committed",
} as const;
export type ReviewMutationOutcome = (typeof REVIEW_MUTATION_OUTCOME)[keyof typeof REVIEW_MUTATION_OUTCOME];

export const REVIEW_PROJECTION = {
	STAGED: "staged",
	WORKSPACE: "workspace",
} as const;
export type ReviewProjection = (typeof REVIEW_PROJECTION)[keyof typeof REVIEW_PROJECTION];

export const REVIEW_PROJECTION_KIND = {
	CURRENT_CHANGES: "current-changes",
	BASE_DIFF: "base-diff",
	BASE_WORKSPACE_OVERLAY: "base-workspace-overlay",
	EXACT_REVISION: "exact-revision",
	FIX_DIFF: "fix-diff",
} as const;
export type ReviewProjectionKind = (typeof REVIEW_PROJECTION_KIND)[keyof typeof REVIEW_PROJECTION_KIND];

export const REVIEW_AUTHORITY_VERSION = {
	COMPACT_V2: "compact-v2",
	LEGACY_V1: "legacy-v1",
} as const;
export type ReviewAuthorityVersion = (typeof REVIEW_AUTHORITY_VERSION)[keyof typeof REVIEW_AUTHORITY_VERSION];

// 由协议 v2 扩宽：`correction_required` 与 `validating` 是协商修正生命
// 周期新引入的 start/status 状态。
export const REVIEW_START_STATE = {
	UNREVIEWED: "unreviewed",
	REVIEWING: "reviewing",
	JUDGES_CONFIRMED: "judges_confirmed",
	FINDINGS_FROZEN: "findings_frozen",
	EVIDENCE_CLASSIFIED: "evidence_classified",
	FIX_REQUIRED: "fix_required",
	FIXING: "fixing",
	FIX_VALIDATING: "fix_validating",
	CORRECTION_REQUIRED: "correction_required",
	VALIDATING: "validating",
	READY_FINAL_VERIFICATION: "ready_final_verification",
	FINAL_VERIFYING: "final_verifying",
	APPROVED: "approved",
	ESCALATED: "escalated",
	INVALIDATED: "invalidated",
} as const;
export type ReviewStartState = (typeof REVIEW_START_STATE)[keyof typeof REVIEW_START_STATE];

export const START_ACTIONS = ["created", "resumed", "closed", "blocked-scope-action"] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const REVIEW_LENSES = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
export const RISK_REASON_CODES = ["configuration_change", "empty_content", "executable_change", "executable_mode", "hot_path", "large_change", "non_executable_only", "process_boundary", "process_scan_limit", "service_token", "shell_source"] as const;
export const RISK_SIGNALS = ["auth", "update", "security", "payments", "permissions", "shell_process"] as const;
// “collect” 与 “execute” 是 v2 封套对 next_transition 必填的活动事务的
// 投影：根动作点名转换种类，而不是读作终局 stop。
export const STATUS_ACTIONS = ["start", "recover", "maintainer_action", "select_lineage", "repair_authority", "stop", "collect", "execute"] as const;
export const RECEIPT_STATUSES = ["expected_missing", "present", "publication_pending", "not_applicable"] as const;
export type ReviewReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const REVIEW_STATUS_ACTION_DISPOSITION = {
	SCOPE_CHANGED: "scope_changed",
	INVALIDATED: "invalidated",
	ESCALATED: "escalated",
} as const;
export type ReviewStatusActionDisposition = (typeof REVIEW_STATUS_ACTION_DISPOSITION)[keyof typeof REVIEW_STATUS_ACTION_DISPOSITION];
export const REQUIRED_OPERATIONS = Object.freeze(Object.values(REVIEW_INTEGRATION_OPERATION));
// 类型化失败只被已支持的 start、status、repair 与 last-event 捕获操作
// 接受。已退役的生命周期动词保守失败。
export const FAILURE_OPERATIONS = Object.freeze([
	...REQUIRED_OPERATIONS,
	"review.capture-result",
	"review.capture-correction-plan",
	"review.capture-refuter",
	"review.capture-validation",
] as const);
export const REQUIRED_GATES = Object.freeze(["post-apply", "pre-commit", "pre-push", "pre-pr", "release"] as const);
export const REQUIRED_PROJECTIONS = Object.freeze(Object.values(REVIEW_PROJECTION));
// 每个被接受的 capabilities 身份共享的 schema 下限。各次版本再在下面
// 添加自己的 capabilities/consent/status 身份：提供方随协议次版本推进
// 更换这三个宣告（v2.1 把 consent 换成 v3；v2.2 把 status 换成 v5），
// 依据 gentle-ai main 上 vendored 的
// capabilities[-v2.1|-v2.2].schema.json 契约与来自主线开发构建的一次
// 真实 v2.2 捕获实测。
const REQUIRED_SCHEMAS_COMMON = Object.freeze([
	"gentle-ai.review-admitted-result/v2",
	"gentle-ai.review-artifact-subject/v2",
	"gentle-ai.review-authority-repair-assessment/v1",
	"gentle-ai.review-authority-status/v1",
	"gentle-ai.review-gate-request/v1",
	"gentle-ai.review-integration.failure/v2",
	"gentle-ai.review-final-verification-incident/v1",
	"gentle-ai.review-integration.operation/v2",
	"gentle-ai.review-integration.projection/v1",
	"gentle-ai.review-integration.repair/v2",
	"gentle-ai.review-receipt/v1",
	"gentle-ai.review-receipt/v2",
	"gentle-ai.review-result-artifact/v2",
	"gentle-ai.review-targeted-validation-request/v1",
	"gentle-ai.review-verification-evidence/v2",
	"https://gentle-ai.dev/schema/review/refuter/v1",
	"https://gentle-ai.dev/schema/review/reviewer/v1",
	"https://gentle-ai.dev/schema/review/validator/v1",
] as const);
// v2.3 提供方契约（首次由固定的 v2.5.0-rc.3 运行时宣告）把
// exact_receipt_replay、five_delivery_gates 与 sdd_receipt_binding 从
// 必选特性集退役，并把 exact_gate_receipt_discovery、
// one_shot_final_verification_retry 与 outcome_bound_verification_evidence
// 从可选集退役；它们都不被 Pi 的协商 v2 通道消费。更早的次版本保持
// 其冻结的需求集不变。
const REQUIRED_MANDATORY_FEATURES_V23 = Object.freeze([
	"compact_v2_authority",
	"immutable_snapshot",
	"legacy_v1_target_scoped_read_only",
	"repository_independent_capabilities",
	"restart_safe_projection",
	"target_scoped_status",
	"uniform_failure_envelope",
] as const);
// v2.3（首次由固定的 v2.5.0-rc.3 提供方宣告）从其宣告中退役了三个
// v1 时代的身份。Pi 绝不在协商 v2 通道上解码那些封套，因此 v2.3 需求
// 列表就是 v2.3 提供方契约定义的确切集合；更早的次版本保持完整的
// 公共列表。加载时的长度断言让该过滤器保持诚实：如果公共列表的
// 标识符形态偏离了这些裸标识符，模块会高声失败，而不是静默地要求
// 提供方已退役的 schema。
const RETIRED_SCHEMAS_V23: readonly string[] = Object.freeze([
	"gentle-ai.review-final-verification-incident/v1",
	"gentle-ai.review-receipt/v2",
	"gentle-ai.review-verification-evidence/v2",
]);
const REQUIRED_SCHEMAS_COMMON_V23 = Object.freeze(REQUIRED_SCHEMAS_COMMON.filter((schema) => !RETIRED_SCHEMAS_V23.includes(schema)));
if (REQUIRED_SCHEMAS_COMMON_V23.length !== REQUIRED_SCHEMAS_COMMON.length - RETIRED_SCHEMAS_V23.length) {
	throw new TypeError("v2.3 retired-schema filter must remove exactly the retired identities from the common schema list");
}
export const CAPABILITIES_SCHEMA_IDENTITIES: Readonly<Record<string, { protocolMinor: number; requiredSchemas: readonly string[]; requiredMandatoryFeatures?: readonly string[]; optionalFeatureFloor?: number }>> = Object.freeze({
	"gentle-ai.review-integration.capabilities/v2": Object.freeze({
		protocolMinor: 0,
		requiredSchemas: Object.freeze([...REQUIRED_SCHEMAS_COMMON, "gentle-ai.review-integration.capabilities/v2", "gentle-ai.review-integration.consent/v2", "gentle-ai.review-integration.start/v3", "gentle-ai.review-integration.status/v3"]),
	}),
	"gentle-ai.review-integration.capabilities/v2.1": Object.freeze({
		protocolMinor: 1,
		requiredSchemas: Object.freeze([...REQUIRED_SCHEMAS_COMMON, "gentle-ai.review-integration.capabilities/v2.1", "gentle-ai.review-integration.consent/v3", "gentle-ai.review-integration.start/v3", "gentle-ai.review-integration.status/v3"]),
	}),
	"gentle-ai.review-integration.capabilities/v2.2": Object.freeze({
		protocolMinor: 2,
		requiredSchemas: Object.freeze([...REQUIRED_SCHEMAS_COMMON, "gentle-ai.review-integration.capabilities/v2.2", "gentle-ai.review-integration.consent/v3", "gentle-ai.review-integration.start/v3", "gentle-ai.review-integration.status/v5"]),
	}),
	"gentle-ai.review-integration.capabilities/v2.3": Object.freeze({
		protocolMinor: 3,
		requiredSchemas: Object.freeze([...REQUIRED_SCHEMAS_COMMON_V23, "gentle-ai.review-integration.capabilities/v2.3", "gentle-ai.review-integration.consent/v3", "gentle-ai.review-integration.start/v4", "gentle-ai.review-integration.status/v5"]),
		requiredMandatoryFeatures: REQUIRED_MANDATORY_FEATURES_V23,
		optionalFeatureFloor: 14,
	}),
	"gentle-ai.review-integration.capabilities/v2.4": Object.freeze({
		protocolMinor: 4,
		requiredSchemas: Object.freeze([...REQUIRED_SCHEMAS_COMMON_V23, "gentle-ai.review-integration.capabilities/v2.4", "gentle-ai.review-integration.consent/v3", "gentle-ai.review-integration.start/v4", "gentle-ai.review-integration.status/v6", "gentle-ai.review-intended-untracked-selection/v1"]),
		requiredMandatoryFeatures: REQUIRED_MANDATORY_FEATURES_V23,
		optionalFeatureFloor: 14,
	}),
	// 对照已发布的 v2.6.0 二进制实测：capabilities/v2.5 宣告与 v2.4
	// 相同的必需表面（status/v6 仍为兼容性而宣告）外加新的 status/v7
	// schema，后者是经超集检查的增补而非必需项——decodeReviewStatusV3
	// 把 v7 当作 v6 的加性扩展接受，因此必需 schema 下限不变。
	// v2.6.0 二进制宣告了 15 个可选特性（下限保持 14，即其既定最小值）。
	"gentle-ai.review-integration.capabilities/v2.5": Object.freeze({
		protocolMinor: 5,
		requiredSchemas: Object.freeze([...REQUIRED_SCHEMAS_COMMON_V23, "gentle-ai.review-integration.capabilities/v2.5", "gentle-ai.review-integration.consent/v3", "gentle-ai.review-integration.start/v4", "gentle-ai.review-integration.status/v6", "gentle-ai.review-intended-untracked-selection/v1"]),
		requiredMandatoryFeatures: REQUIRED_MANDATORY_FEATURES_V23,
		optionalFeatureFloor: 14,
	}),
});
const OPTIONAL_FEATURE_NAMES = Object.freeze([
	"base_ref_workspace_overlay",
	"bounded_process_waits",
	"classified_authority_repair",
	"exact_gate_receipt_discovery",
	"native_frozen_candidate_context",
	"native_low_risk_verification",
	"native_next_transition",
	"one_shot_final_verification_retry",
	"opaque_repository_context",
	"outcome_bound_verification_evidence",
	"provider_artifact_admission",
	"provider_bound_native_git_context",
	"provider_targeted_validation_request",
	"recovered_correction_evidence",
	"risk_reasons",
	"scope_change_diagnostics",
	"validating_result_reopen",
] as const);
export const FEATURE_NAMES = Object.freeze([
	"base_ref_workspace_overlay",
	"bounded_process_waits",
	"classified_authority_repair",
	"compact_v2_authority",
	"exact_gate_receipt_discovery",
	"exact_receipt_replay",
	"five_delivery_gates",
	"immutable_snapshot",
	"legacy_v1_target_scoped_read_only",
	"native_frozen_candidate_context",
	"native_low_risk_verification",
	"native_next_transition",
	"one_shot_final_verification_retry",
	"opaque_repository_context",
	"outcome_bound_verification_evidence",
	"provider_artifact_admission",
	"provider_bound_native_git_context",
	"provider_targeted_validation_request",
	"recovered_correction_evidence",
	"repository_independent_capabilities",
	"restart_safe_projection",
	"risk_reasons",
	"scope_change_diagnostics",
	"sdd_receipt_binding",
	"target_scoped_status",
	"uniform_failure_envelope",
	"validating_result_reopen",
] as const);
export const REQUIRED_MANDATORY_FEATURES = Object.freeze(FEATURE_NAMES.filter((name) => !(OPTIONAL_FEATURE_NAMES as readonly string[]).includes(name)));

export type StartAction = (typeof START_ACTIONS)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type ReviewLens = (typeof REVIEW_LENSES)[number];
export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];
export type RiskSignal = (typeof RISK_SIGNALS)[number];
export type ReviewStatusAction = (typeof STATUS_ACTIONS)[number];
