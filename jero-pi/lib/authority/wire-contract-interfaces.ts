// 线上契约数据形状：V2/V3/V4 接口（start/status/consent/failure/repair 等）。
// 自 lib/authority/wire-contract.ts 拆分（机械平移，语义零改动）。

import {
	FEATURE_NAMES,
	REVIEW_INTEGRATION_CONTRACT,
	type ReviewAuthorityApplicability,
	type ReviewAuthorityVersion,
	type ReviewIntegrationOperation,
	type ReviewLens,
	type ReviewMutationOutcome,
	type ReviewProjection,
	type ReviewProjectionKind,
	type ReviewReceiptStatus,
	type ReviewReplayability,
	type ReviewStartState,
	type ReviewStatusAction,
	type ReviewStatusActionDisposition,
	type RiskLevel,
	type RiskReasonCode,
	type RiskSignal,
	type StartAction
} from "./wire-contract-enums.ts";
import {
	boolean
} from "./wire-contract-decode-helpers.ts";
export interface ReviewFeatureV2 {
	name: (typeof FEATURE_NAMES)[number];
	supported: boolean;
	requires: readonly string[];
}

export interface ReviewCapabilitiesV2 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	packageVersion: string;
	buildId: string;
	executableDigest: string;
	operations: ReadonlySet<string>;
	gates: ReadonlySet<string>;
	projections: ReadonlySet<string>;
	schemas: ReadonlySet<string>;
	mandatoryFeatures: ReadonlySet<string>;
	optionalFeatures: ReadonlySet<string>;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewRiskReasonV2 {
	code: RiskReasonCode;
	signal?: RiskSignal;
	path?: string;
	oldMode?: string;
	newMode?: string;
}

export interface ChangedPathEntry {
	readonly path: string;
	readonly status: "A" | "D" | "M" | "T";
	readonly oldMode: string;
	readonly newMode: string;
	readonly deleted: boolean;
	readonly typeChanged: boolean;
	readonly modeOnly: boolean;
	readonly intendedUntracked: boolean;
}

export interface ReviewArtifactSubjectV2 {
	schema: "gentle-ai.review-artifact-subject/v2";
	subjectHash: string;
	lineageId: string;
	authorityRevision: string;
	targetIdentity: string;
	baseTree: string;
	candidateTree: string;
	changedPathManifestSha256: string;
	lens: ReviewLens;
	selectedOrder: number;
	correctionTargetIdentity?: string;
}

export interface ReviewRepositoryContextV2 {
	capability: "review.opaque_repository_context";
	handle: string;
	revision: string;
	targetIdentity: string;
	// 同一 start/v3 身份上的可选加性成员（gentle-ai main，带 `omitempty`
	// 的 Go `ReviewRepositoryContextReference`）：该上下文应用的紧凑效果
	// 事件及其已记录的结局。事实依据是 2.4.0-main 二进制捕获的已同意
	// 启动（tests/fixtures/devbinary/start-v3-consent-granted.captured.json）；
	// 已发布的 start.schema.json 比这里的发射器更窄。
	eventId?: string;
	outcome?: ReviewRepositoryContextOutcomeV1;
}

export const REPOSITORY_CONTEXT_OUTCOMES = ["applied", "pending", "blocked_conflict", "durability_limited"] as const;
export type ReviewRepositoryContextOutcomeV1 = (typeof REPOSITORY_CONTEXT_OUTCOMES)[number];

export interface ReviewStartV3 {
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	action: StartAction;
	lensesRequired: boolean;
	lineageId: string;
	state: ReviewStartState;
	riskLevel: RiskLevel;
	selectedLenses: readonly ReviewLens[];
	projection: ReviewProjection;
	changedFiles: number;
	changedLines: number;
	correctionBudget: number;
	riskReasons: readonly ReviewRiskReasonV2[];
	artifactSubjects: readonly ReviewArtifactSubjectV2[];
	targetMode?: "base-workspace-overlay";
	targetIdentity?: string;
	baseTree?: string;
	candidateTree?: string;
	changedPathManifest?: readonly ChangedPathEntry[];
	repositoryContext?: ReviewRepositoryContextV2;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewStartV4 extends Omit<ReviewStartV3, "action"> {
	action: "created" | "replayed" | "closed" | "blocked-scope-action";
	nextTransition?: ReviewNextTransitionV3;
}

export interface ReviewProjectionDescriptorV1 {
	schema: "gentle-ai.review-integration.projection/v1";
	kind: ReviewProjectionKind;
	projection: ReviewProjection;
	baseTree: string;
	initialReviewTree: string;
	currentCandidateTree: string;
	pathsDigest: string;
	paths: readonly string[];
	intendedUntracked: readonly string[];
	intendedUntrackedProof: string;
	initialSnapshotIdentity: string;
	currentSnapshotIdentity: string;
}

export interface ReviewStatusAuthorityV1 {
	version: ReviewAuthorityVersion;
	lineageId: string;
	state: string;
	generation: number;
	revision: string;
}

export interface ReviewStatusReceiptV1 {
	status: ReviewReceiptStatus;
	identity?: string;
}

export interface ReviewStatusFrozenV1 {
	tier: RiskLevel;
	originalChangedLines: number;
	correctionBudget: number;
	/** 冻结变更路径清单的摘要；绑定不带清单的捕获输入（gentle-ai#3922）。 */
	changedPathManifestSha256?: string;
}

export interface ReviewStatusReconciliationV1 {
	required: true;
}

export interface ReviewTransitionArgumentV3 {
	name: string;
	value: string;
	token?: string;
}

export interface ReviewNextTransitionExecuteV3 {
	operation: string;
	arguments: readonly ReviewTransitionArgumentV3[];
	selectorArguments?: readonly ReviewTransitionArgumentV3[];
	preconditions: readonly ReviewTransitionArgumentV3[];
	binding: { targetIdentity: string; lineageId?: string; revision?: string };
	command?: string;
}

// 宿主中介捕获槽位的提供方持有完成表单（gentle-pi#311 P4）。提供方
// 签发提交捕获字节的确切操作与参数令牌；宿主只把产物位置代入声明
// 的 {{value}} 槽位，绝不自行合成或过滤该表单。
export interface ReviewCaptureSubmissionValueV1 {
	slot: string;
	domain: string;
	substitutionLocation: number;
	/**
	 * 仅 status/v5：被替换值必须满足的产物 schema。在线 2.4.0-main 二
	 * 进制为物化 capture-result 槽位发出的单数线上 `value` 形态携带的
	 * “新”可选成员（2026-08-16 自 2.4.0-main.b1afef46 捕获）；遗留的
	 * `values` 数组行从不携带它，既有消费者不受影响。
	 */
	schema?: string;
	minimum?: number;
	maximum?: number;
}

export interface ReviewCaptureSubmissionV1 {
	operationToken: string;
	argumentTokens: readonly string[];
	values: readonly ReviewCaptureSubmissionValueV1[];
}

// 两个 Go 持有的非评审视角提供方角色捕获操作（gentle-pi#311
// P4-roles；提供方侧 gentle-ai#3264）。它们的 collect 输入是自包含的
// 权威推进向量：绑定令牌外加 `--agent=pi --execute=true`，“没有”提交
// 描述符。已知集合是封闭的——未知的角色捕获操作绝不被执行。
export const REVIEW_PROVIDER_ROLE_CAPTURE_OPERATION = {
	CAPTURE_REFUTER: "review.capture-refuter",
	CAPTURE_VALIDATION: "review.capture-validation",
} as const;
export type ReviewProviderRoleCaptureOperation = (typeof REVIEW_PROVIDER_ROLE_CAPTURE_OPERATION)[keyof typeof REVIEW_PROVIDER_ROLE_CAPTURE_OPERATION];
export const REVIEW_PROVIDER_ROLE_CAPTURE_OPERATIONS = Object.freeze(Object.values(REVIEW_PROVIDER_ROLE_CAPTURE_OPERATION));

// status/v5 的结构表面。Pi 尚无它们的消费者；它们被严格解码（按
// gentle-ai main 上 vendored 的 status-v5.schema.json 与
// correction-plan-request.schema.json 的精确键集）并透传，使 v5 提供方
// 载荷绝不因比 v3 新而被拒绝。
export interface ReviewForecastStepV1 {
	step: 1;
	kind: "execute" | "collect" | "stop";
	reasonCode: string;
	description: string;
}

export interface ReviewForecastV1 {
	horizon: "partial" | "terminal";
	steps: readonly ReviewForecastStepV1[];
}

export interface ReviewProviderTaskV1 {
	agent: "review-refuter" | "review-validator";
	role: "refuter" | "targeted-validator";
	prompt: string;
}

export interface ReviewCorrectionPlanFindingV1 {
	id: string;
	lens: "risk" | "resilience" | "readability" | "reliability";
	location: string;
	severity: "BLOCKER" | "CRITICAL";
	claim: string;
	proofRefs: readonly string[];
	evidence: string;
	evidenceClass: "deterministic" | "inferential";
	causalDisposition: "introduced" | "behavior-activated" | "worsened";
}

export interface ReviewCorrectionPlanRequestV1 {
	schema: "gentle-ai.review-correction-plan-request/v1";
	requestHash: string;
	lineageId: string;
	expectedRevision: string;
	targetIdentity: string;
	correctionBudget: number;
	fixFindingIds: readonly string[];
	findings: readonly ReviewCorrectionPlanFindingV1[];
}

export interface ReviewTargetedValidationFindingV1 {
	id: string;
	lens: "risk" | "resilience" | "readability" | "reliability";
	location: string;
	severity: "BLOCKER" | "CRITICAL";
	claim: string;
	proofRefs: readonly string[];
	evidenceClass: "deterministic" | "inferential";
	causalDisposition: "introduced" | "behavior-activated" | "worsened";
}

export interface ReviewTargetedValidationClassificationV1 {
	findingId: string;
	// 提供方的 FindingEvidence 以 omitempty 字段携带 severity，因此
	// 分类可能点名、也可能不点名它。曾因拒绝它导致每个携带它的
	// 定向验证 STATUS 不可解码。
	severity?: string;
	class: "deterministic" | "inferential";
	causalDisposition: "introduced" | "behavior-activated" | "worsened";
	proof: string;
}

export interface ReviewTargetedValidationRequestV1 {
	schema: "gentle-ai.review-targeted-validation-request/v1";
	requestHash: string;
	lineageId: string;
	expectedRevision: string;
	targetIdentity: string;
	fixFindingIds: readonly string[];
	policyContent: string;
	fixFindings: readonly ReviewTargetedValidationFindingV1[];
	fixClassifications: readonly ReviewTargetedValidationClassificationV1[];
	projection: ReviewProjection;
	correctionCandidateTree: string;
	correctionTargetIdentity: string;
	correctionPaths: readonly string[];
	correctionPathsDigest: string;
}

export interface ReviewCollectInputV3 {
	name: string;
	schema: string;
	captureOperation: string;
	arguments: readonly ReviewTransitionArgumentV3[];
	artifactSubject?: ReviewArtifactSubjectV2;
	baseTree?: string;
	candidateTree?: string;
	changedPathManifest?: readonly ChangedPathEntry[];
	submission?: ReviewCaptureSubmissionV1;
	/** 仅 status/v5：自包含的 external.run_provider_role 任务。 */
	providerTask?: ReviewProviderTaskV1;
	/** 仅 status/v5：面向 Go 持有定向 validator 的提供方持有请求。 */
	validationRequest?: ReviewTargetedValidationRequestV1;
}

// gentle-pi#627：解析过期受管资产集的确切 `gentle-ai sync` 调用
// （STATUS 的 next_transition stop 与 START 的预检失败封套都携带同一
// 形态）。
export interface ReviewManagedAssetsContinuationV1 {
	operation: "sync";
	command: string;
	agent?: string;
	staleAssets?: readonly string[];
}

// gentle-pi#638：宿主通过原生 capture-unachievable 动词声明为不可达成
// 的一个已选评审视角槽位，镜像自 Go 的
// ReviewUnachievableLensSlot（internal/cli/review_next_transition.go）。
// withdraw 形态刻意比完整的 execute 转换更窄：它是恰好针对该槽位的
// 可直接运行撤回命令，因此从未见过 collect 提供的重启也能仅凭 stop
// 收回该声明。
export interface ReviewUnachievableLensWithdrawV3 {
	operation: "review.capture-unachievable";
	command: string;
	arguments: readonly ReviewTransitionArgumentV3[];
	binding: { targetIdentity: string; lineageId?: string; revision?: string };
}

export interface ReviewUnachievableLensSlotV3 {
	lens: string;
	selectedOrder: number;
	subjectHash: string;
	reason: string;
	detail?: string;
	withdraw: ReviewUnachievableLensWithdrawV3;
}

export interface ReviewNextTransitionV3 {
	kind: "execute" | "collect" | "stop";
	reasonCode: string;
	execute?: ReviewNextTransitionExecuteV3;
	collect?: { inputs: readonly ReviewCollectInputV3[] };
	/** 仅 status/v5：有界的修正计划请求。 */
	correctionRequest?: ReviewCorrectionPlanRequestV1;
	/** 仅 stop 且 reason_code 为 managed_assets_outdated：sync 续跑。 */
	continuation?: ReviewManagedAssetsContinuationV1;
	/** 仅 stop 且 reason_code 为 unachievable_lens_slot：每个已声明槽位一条。 */
	unachievableLensSlots?: readonly ReviewUnachievableLensSlotV3[];
}

export const ESCALATION_CAUSES = ["unknown_causality", "insufficient_evidence", "missing_refuter_outcome", "targeted_validator_rejected", "correction_budget_exceeded", "unresolved_severe_findings"] as const;
export const ESCALATION_REFUTER_OUTCOMES = ["corroborated", "refuted", "inconclusive"] as const;
export interface ReviewEscalationRefuterOutcomeV1 {
	findingId: string;
	outcome: (typeof ESCALATION_REFUTER_OUTCOMES)[number];
	proof: string;
}
export interface ReviewEscalationV1 {
	cause: (typeof ESCALATION_CAUSES)[number];
	findingIds: readonly string[];
	refuterOutcomes?: readonly ReviewEscalationRefuterOutcomeV1[];
}

export interface ReviewStatusV3 {
	/** 可选的 v7 诊断证据，绝不用于路由或重建权威。 */
	escalation?: ReviewEscalationV1;
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	applicability: Exclude<ReviewAuthorityApplicability, "not_evaluated">;
	authority?: ReviewStatusAuthorityV1;
	/** status/v5 兼容元数据；被解码但绝不用作路由权威。 */
	receipt?: ReviewStatusReceiptV1;
	action: ReviewStatusAction;
	actionDisposition?: ReviewStatusActionDisposition;
	replayability: ReviewReplayability;
	frozen?: ReviewStatusFrozenV1;
	reconciliation?: ReviewStatusReconciliationV1;
	targetIdentity: string;
	authorityTargetIdentity?: string;
	projection: ReviewProjectionDescriptorV1;
	repair: AuthorityRepairAssessmentV1;
	candidates: readonly string[];
	nextTransition?: ReviewNextTransitionV3;
	/** 仅 status/v5：描述性、非路由的转换预览。 */
	forecast?: ReviewForecastV1;
	/**
	 * 仅 status/v5：在线 2.4.0-main 二进制在 reviewing 血脉绑定仓库上下文
	 * 之后发布的不透明引用。“新”结构成员——2026-08-16 自
	 * 2.4.0-main.b1afef46 捕获；已发布的 status-v5.schema.json 省略它
	 * （以捕获为准）。
	 */
	repositoryContext?: ReviewRepositoryContextV2;
	/** 仅 status/v5：定向 validator collect 输入所镜像的提供方持有请求。 */
	validationRequest?: ReviewTargetedValidationRequestV1;
	/** 仅 status/v7：合格的未跟踪路径清单摘要，`staged` 投影上省略。 */
	eligibleUntrackedInventory?: string;
	raw: Readonly<Record<string, unknown>>;
}

export interface ReviewConsentChoiceV2 {
	answer: "granted" | "declined";
	label: string;
	effect: string;
	invocation: string;
}

export interface ReviewConsentV2 {
	schema: "gentle-ai.review-integration.consent/v2";
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: "review.start";
	action: "consent_required";
	blocking: true;
	targetIdentity: string;
	projection: ReviewProjection;
	riskLevel: "medium" | "high";
	changedFiles: number;
	changedLines: number;
	headline: string;
	reason: string;
	value: string;
	riskEvidence: readonly string[];
	choices: readonly [ReviewConsentChoiceV2, ReviewConsentChoiceV2];
	offPath: { note: string; command: "/jero:review-mode disable" };
	raw: Readonly<Record<string, unknown>>;
}

// consent/v3（gentle-ai >= 2.3.0，capabilities/v2.1+）：同样的按候选
// 阻塞问题，外加一个净新增的必填成员——提供方固定的 `agent` 运行时
// 绑定。与 v2 共享的一切保持确切形态，使两种身份的消费者读到同一个
// 结构表面。
export const REVIEW_CONSENT_AGENT_V3 = {
	CLAUDE_CODE: "claude-code",
	OPENCODE: "opencode",
	CODEX: "codex",
	PI: "pi",
} as const;
export type ReviewConsentAgentV3 = (typeof REVIEW_CONSENT_AGENT_V3)[keyof typeof REVIEW_CONSENT_AGENT_V3];

export interface ReviewConsentV3 extends Omit<ReviewConsentV2, "schema"> {
	schema: "gentle-ai.review-integration.consent/v3";
	agent: ReviewConsentAgentV3;
}

// 两种被接受的同意身份之一。中继（而非解码）该封套的消费者两者都
// 接受；每个解码器仍只承认恰好一种 schema。
export type ReviewConsentEnvelope = ReviewConsentV2 | ReviewConsentV3;

export const FAILURE_REQUIRED_INPUTS = [
	"lineage_id",
	"change",
	"expected_binding_revision",
	"predecessor_lineage_id",
	"expected_predecessor_revision",
	"successor_lineage_id",
	"disposition",
	"reason",
	"actor",
	"maintainer_authorization",
	"base_ref",
] as const;
export type ReviewFailureRequiredInputV2 = (typeof FAILURE_REQUIRED_INPUTS)[number];
export const FAILURE_NEXT_ACTIONS = ["correct_request", "retry", "retry_with_bounded_backoff", "review.status", "review.repair", "explicit-maintainer-action", "stop"] as const;
export type ReviewFailureNextActionV2 = (typeof FAILURE_NEXT_ACTIONS)[number];
// 已知的 cause_category 值：vendored 的 failure.schema.json 枚举，外加
// v2.1.8 发射器在该枚举之外产出的 “incomplete_store_entry”。
// cause_category 是诊断元数据（没有任何路由依赖它），因此为前向兼容
// 容忍未知的 snake_case 值。
const FAILURE_CAUSE_CATEGORIES = ["inventory_io_or_layout", "lock_ambiguous", "reset_residue", "record_or_graph_invalid", "inventory_incomplete", "incomplete_store_entry"] as const;
export type ReviewFailureCauseCategoryV2 = (typeof FAILURE_CAUSE_CATEGORIES)[number] | (string & {});

export interface ReviewFailureTargetEvidenceV1 {
	candidateTree: string;
	pathsDigest: string;
}

export interface ReviewFailureScopeChangeV1 {
	expected: ReviewFailureTargetEvidenceV1;
	actual: ReviewFailureTargetEvidenceV1;
	differingPathCount: number;
	differingPathsDigest: string;
	predecessorLineageId: string;
	predecessorRevision: string;
	recoveryOperation: "review.recover";
	recoveryRequiredInputs: readonly string[];
}

export interface ReviewFailureBindingRevisionV1 {
	expected: string;
	current: string;
}

export interface ReviewFailureContextV2 {
	scopeChange?: ReviewFailureScopeChangeV1;
	bindingRevision?: ReviewFailureBindingRevisionV1;
}

export type ReviewFailureOperation = ReviewIntegrationOperation | "review.capture-result" | "review.capture-correction-plan" | "review.capture-refuter" | "review.capture-validation";

export interface ReviewFailureV2 {
	schema: "gentle-ai.review-integration.failure/v2";
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: ReviewFailureOperation;
	phase: "preflight" | "pre_native" | "native_running" | "native_committed" | "reconciliation";
	code: string;
	message: string;
	mutationOutcome: ReviewMutationOutcome;
	authorityApplicability: ReviewAuthorityApplicability;
	retrySafe: boolean;
	replayability: ReviewReplayability;
	lineageId?: string;
	requestDigest?: string;
	progressIdentity?: string;
	requiredInputs: readonly ReviewFailureRequiredInputV2[];
	nextAction: ReviewFailureNextActionV2;
	causeCategory?: ReviewFailureCauseCategoryV2;
	cause?: string;
	context?: ReviewFailureContextV2;
	/** 仅 code=managed_assets_outdated：sync 续跑（gentle-pi#627）。 */
	continuation?: ReviewManagedAssetsContinuationV1;
	raw: Readonly<Record<string, unknown>>;
}

export const REVIEW_ADVISORY_FINDING_SEVERITY = {
	BLOCKER: "BLOCKER",
	CRITICAL: "CRITICAL",
	WARNING: "WARNING",
	SUGGESTION: "SUGGESTION",
} as const;
export type ReviewAdvisoryFindingSeverity = (typeof REVIEW_ADVISORY_FINDING_SEVERITY)[keyof typeof REVIEW_ADVISORY_FINDING_SEVERITY];

export const REVIEW_ADVISORY_FINDING_DISPOSITION = {
	INFORMATIONAL: "informational",
	FOLLOW_UP: "follow_up",
	REFUTED: "refuted",
} as const;
export type ReviewAdvisoryFindingDisposition = (typeof REVIEW_ADVISORY_FINDING_DISPOSITION)[keyof typeof REVIEW_ADVISORY_FINDING_DISPOSITION];

export interface ReviewAdvisoryFindingV1 {
	id: string;
	lens?: string;
	location?: string;
	severity: ReviewAdvisoryFindingSeverity;
	disposition: ReviewAdvisoryFindingDisposition;
}

export interface ReviewAdvisoryFindingsV1 {
	statement: string;
	findings: readonly ReviewAdvisoryFindingV1[];
}

export interface AuthorityRepairAssessmentCandidateV1 {
	lineageId: string;
	revision: string;
	chainIdentity: string;
	eventCount: number;
	aliasEventCount: number;
	operations: readonly ("review/complete-fix" | "review/validate-fix")[];
}

export interface AuthorityRepairAssessmentCountsV1 {
	lineages: number;
	compactLineages: number;
	legacyLineages: number;
	events: number;
	bytes: number;
	eligibleCandidates: number;
	unsupportedLineages: number;
	conflicts: number;
}

export interface AuthorityRepairAssessmentV1 {
	schema: "gentle-ai.review-authority-repair-assessment/v1";
	status: "eligible" | "unsupported" | "ambiguous" | "conflicting" | "truncated";
	class?: "legacy_v1_historical_alias";
	cause?: "unsupported_historical_v1_operation_alias";
	disposition?: "quarantine-approved-historical-alias";
	repositoryBinding?: string;
	candidate?: AuthorityRepairAssessmentCandidateV1;
	counts: AuthorityRepairAssessmentCountsV1;
	supportedOperations: readonly ["review/complete-fix", "review/validate-fix"];
	authorizationSchema: "gentle-ai.review-repair-authorization/v1";
}

export interface ReviewRepairProviderInputsV2 {
	class: "legacy_v1_historical_alias";
	lineageId: string;
	expectedRevision: string;
	cause: "unsupported_historical_v1_operation_alias";
	disposition: "quarantine-approved-historical-alias";
	repositoryBinding: string;
	authorizationSchema: "gentle-ai.review-repair-authorization/v1";
}

export interface ReviewRepairExecutionV2 {
	status: "committed";
	class: "legacy_v1_historical_alias";
	lineageId: string;
	revision: string;
	chainIdentity: string;
	cause: "unsupported_historical_v1_operation_alias";
	disposition: "quarantine-approved-historical-alias";
	assessmentDigest: string;
	requestDigest: string;
	recordIdentity: string;
}

export interface ReviewRepairV2 {
	schema: "gentle-ai.review-integration.repair/v2";
	contract: typeof REVIEW_INTEGRATION_CONTRACT;
	operation: "review.repair";
	mode: "preflight" | "execute";
	assessment: AuthorityRepairAssessmentV1;
	providerInputs?: ReviewRepairProviderInputsV2;
	requiredInputs: readonly ("actor" | "reason" | "maintainer_authorization")[];
	execution?: ReviewRepairExecutionV2;
	raw: Readonly<Record<string, unknown>>;
}
