// 客户端契约词汇：操作/错误码/模式/锁/权威状态枚举与请求、结果接口。
// 自 lib/authority/client-contract.ts 拆分（机械平移，语义零改动）。

import {
	execFile
} from "node:child_process";
import {
	promisify
} from "node:util";
import {
	type ReviewAssessmentV1
} from "../review-risk-assessment.ts";
import {
	type ReviewAcknowledgedExpectationV1,
	type ReviewAcknowledgedV1,
	type ReviewConsentEnvelope,
	type ReviewLastEventClosureV1,
	type ReviewNextTransitionV3,
	type ReviewStartState,
	type ReviewStatusV3
} from "./wire-contract.ts";
export const execFileAsync = promisify(execFile);

// 协商的 review/status 响应可能携带完整的权威清单。让生产默认值足够
// 容纳该载荷，同时即使设置了 JERO_PI_REVIEW_MAX_BUFFER_BYTES 也保留
// 64 MiB 的硬上限。
export const NATIVE_REVIEW_DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const NATIVE_REVIEW_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const NATIVE_REVIEW_MAX_BUFFER_BYTES_ENV = "JERO_PI_REVIEW_MAX_BUFFER_BYTES";
export const NATIVE_REVIEW_MAX_BUFFER_CONFIGURATION_HINT = "Inspect native review state before any new START; JERO_PI_REVIEW_MAX_BUFFER_BYTES accepts a positive decimal up to 67108864.";


export const NATIVE_REVIEW_OPERATION = {
	START: "review/start",
	STATUS: "review/status",
	RECLAIM: "review/reclaim",
	RECOVER: "review/recover",
	ABANDON: "review/abandon",
	QUARANTINE_LEGACY: "review/quarantine-legacy",
	RECONCILE_AUTHORITY: "review/reconcile-authority",
	REPAIR_LEGACY_ALIAS: "review/repair-legacy-alias",
	MODE: "review/mode",
	ASSESS: "review/assess",
	CAPTURE_CORRECTION_PLAN: "review/capture-correction-plan",
	CAPTURE_PROVIDER_ROLE: "review/capture-provider-role",
	CAPTURE_UNACHIEVABLE: "review/capture-unachievable",
	ACKNOWLEDGE_APPROVED: "review/acknowledge-approved",
	SDD_STATUS: "sdd-status",
	SDD_ATTEMPT: "sdd-attempt",
	SDD_CONTINUE: "sdd-continue",
} as const;
export type NativeReviewOperation = (typeof NATIVE_REVIEW_OPERATION)[keyof typeof NATIVE_REVIEW_OPERATION];

export const NATIVE_REVIEW_ERROR_CODE = {
	UNAVAILABLE: "unavailable",
	TIMEOUT: "timeout",
	NON_ZERO: "non-zero",
	SIGNAL: "signal",
	UNEXPECTED_STDERR: "unexpected-stderr",
	OUTPUT_LIMIT: "output-limit",
	EMPTY_OUTPUT: "empty-output",
	MALFORMED_JSON: "malformed-json",
	SCHEMA_INCOMPATIBLE: "schema-incompatible",
	IDENTITY_MISMATCH: "identity-mismatch",
	VERSION_INCOMPATIBLE: "version-incompatible",
	CANCELLED: "cancelled",
	PACKAGE_BINARY_MISSING: "package-local-binary-missing",
	UNSUPPORTED_TRANSITION_OPERATION: "unsupported-transition-operation",
} as const;
export type NativeReviewErrorCode = (typeof NATIVE_REVIEW_ERROR_CODE)[keyof typeof NATIVE_REVIEW_ERROR_CODE];

export interface ExecFileRequest { file: string; arguments: readonly string[]; cwd: string; timeoutMs: number | undefined; maxBufferBytes: number; signal?: AbortSignal; }
export interface ExecFileResult { stdout: string; stderr: string; exitCode: number; signal: NodeJS.Signals | null; timedOut: boolean; outputLimitExceeded: boolean; }
export type ExecFileAdapter = (request: ExecFileRequest) => Promise<ExecFileResult>;

export interface NativeReviewCli {
	start(request: NativeStartRequest): Promise<NativeStartResult>;
	targetStatus?(request: NativeTargetStatusRequest): Promise<ReviewStatusV3>;
	answerConsent?(request: NativeReviewConsentAnswerRequest): Promise<NativeReviewConsentAnswerResult>;
	reclaim?(request: NativeReviewReclaimRequest): Promise<NativeReviewRecoveryResult>;
	recover?(request: NativeReviewRecoverRequest): Promise<NativeReviewRecoveryResult>;
	abandon?(request: NativeReviewAbandonRequest): Promise<NativeReviewRecoveryResult>;
	reconcileAuthority?(request: NativeReviewReconcileAuthorityRequest): Promise<NativeReviewRecoveryResult>;
	captureCorrectionPlan?(request: NativeReviewCorrectionPlanCaptureRequest): Promise<ReviewLastEventClosureV1>;
	captureProviderRole?(request: NativeReviewProviderRoleCaptureRequest): Promise<NativeReviewProviderRoleCaptureOutcome>;
	// gentle-pi#638：记录宿主中继的声明——某个已绑定的已选评审视角槽位在当前条件下无法完成。比 NATIVE_CLI_CONTRACTS 中固定的每个二进制都新，因此该能力以调用点邻接方式门控（见 isNativeReviewUnachievableVerbRefused），而不是用契约行。
	captureUnachievableLens?(request: NativeReviewUnachievableLensCaptureRequest): Promise<NativeReviewUnachievableLensCaptureArtifact>;
	// 在协商版本报告 `mode` 能力为真之前保持暗置（设计决策 #7，
	// organic-rdd-parity）。普通的带版本 CLI 操作，位于协商的评审集成
	// 协议之外——与上面的 reviewStatus/reclaim 同形。
	reviewMode?(request: NativeReviewModeRequest): Promise<NativeReviewModeResult>;
	// 只读风险评估（gentle-ai#4295，与 gentle-pi#662 并行落地）。与
	// reviewMode/reviewStatus 同为普通的带版本形态：没有该动词的旧
	// 二进制，或任何其他进程/解码失败，都会拒绝返回的 promise——
	// 调用方保守失败到 `high` 风险。
	assess?(request: NativeReviewAssessRequest): Promise<ReviewAssessmentV1>;
	// 面向显式选定阶段的精确原生 SDD 就绪权威。刻意与 review/RDD 门
	// 分离，且不携带交付或评审事务权威。
	sddStatus?(request: NativeSddStatusRequest): Promise<NativeSddStatusV2>;
	sddContinue?(request: NativeSddStatusRequest): Promise<NativeSddStatusV2>;
	sddAttemptAcquire?(request: NativeSddAcquireRequest): Promise<NativeSddAttemptResult>;
	sddAttemptSettle?(request: NativeSddSettleRequest): Promise<NativeSddAttemptResult>;
}

export interface NativeSddAttemptRequest extends Pick<NativeUntrackedSelectionRequest, "untrackedScope" | "expectedUntrackedInventory" | "intendedUntracked"> {
	workspaceRoot: string;
	changeName: string;
	requestId: string;
	remediatesEvidenceRevision?: string;
}
export interface NativeSddAcquireRequest extends NativeSddAttemptRequest {
	workUnit: string;
	evidenceGoal: string;
	maxAttempts?: number;
	maxChangedLines?: number;
	expectedRevision?: string;
	token?: string;
}
export const SDD_ATTEMPT_OUTCOME = { PASSED: "passed", FAILED: "failed", INTERRUPTED: "interrupted" } as const;
export interface NativeSddSettleRequest extends NativeSddAttemptRequest {
	token: string;
	outcome: (typeof SDD_ATTEMPT_OUTCOME)[keyof typeof SDD_ATTEMPT_OUTCOME];
	evidenceRevision?: string;
	remediationEvidence?: string;
	diagnosis: string;
	harnessDisposition: "reused" | "invalidated";
	cleanupEvidence: string;
	processEvidence: string;
}
export interface NativeSddAttemptResult {
	state: "proceed" | "blocked" | "complete";
	token?: string;
	reason?: string;
}

export const NATIVE_REVIEW_MODE_OPERATION = {
	STATUS: "status",
	ENABLE: "enable",
	DISABLE: "disable",
} as const;
export type NativeReviewModeOperation = (typeof NATIVE_REVIEW_MODE_OPERATION)[keyof typeof NATIVE_REVIEW_MODE_OPERATION];

export const NATIVE_REVIEW_MODE_VALUE = {
	UNSET: "",
	ON: "on",
	OFF: "off",
} as const;
export type NativeReviewModeValue = (typeof NATIVE_REVIEW_MODE_VALUE)[keyof typeof NATIVE_REVIEW_MODE_VALUE];

export const NATIVE_REVIEW_MODE_SOURCE = {
	DEFAULT: "default",
	GLOBAL: "global",
	CLONE_LOCAL: "clone_local",
} as const;
export type NativeReviewModeSource = (typeof NATIVE_REVIEW_MODE_SOURCE)[keyof typeof NATIVE_REVIEW_MODE_SOURCE];

export const NATIVE_REVIEW_MODE_REACH = {
	MACHINE: "machine",
	THIS_BUILD: "this_build",
} as const;
export type NativeReviewModeReach = (typeof NATIVE_REVIEW_MODE_REACH)[keyof typeof NATIVE_REVIEW_MODE_REACH];

export const NATIVE_REVIEW_MODE_SCOPE = {
	GLOBAL: "global",
	CLONE: "clone",
	BOTH: "both",
} as const;
export type NativeReviewModeScope = (typeof NATIVE_REVIEW_MODE_SCOPE)[keyof typeof NATIVE_REVIEW_MODE_SCOPE];

export interface NativeSddStatusRequest {
	changeName?: string;
	workspaceRoot: string;
	signal?: AbortSignal;
}

export type NativeSddPhase = "apply" | "verify" | "archive";
export type NativeSddDependencyState = "blocked" | "ready" | "all_done";

/**
 * 原生 CLI 拥有这份完整的 v2 记录。解码器校验 Pi 依赖的字段并原样
 * 返回对象，不添加、不省略、不调和本地 SDD 状态。
 */
export interface NativeSddStatusV2 extends Readonly<Record<string, unknown>> {
	schemaName: "gentle-ai.sdd-status";
	schemaVersion: 2;
	changeName: string | null;
	artifactStore: "openspec" | "engram" | "hybrid" | "none";
	planningHome: Readonly<Record<string, unknown>> & { mode: "repo-local"; path: string };
	changeRoot: string | null;
	actionContext: Readonly<Record<string, unknown>> & { mode: "repo-local"; workspaceRoot: string; allowedEditRoots: readonly string[] };
	dependencies: Readonly<Record<(typeof NATIVE_SDD_DEPENDENCIES)[number], NativeSddDependencyState>>;
	phaseInstructions?: Readonly<Record<(typeof NATIVE_SDD_INSTRUCTION_PHASES)[number], readonly string[]>>;
	blockedReasons: readonly string[];
	nextRecommended: string;
	remediationState?: { required: boolean; complete: boolean; failedEvidenceRevision: string };
}

export interface NativeReviewModeRequest {
	cwd: string;
	operation: NativeReviewModeOperation;
	signal?: AbortSignal;
}

// 只读风险评估请求（gentle-pi#662）。`baseRef` 要求显式的
// `committedOnly` 确认，与原生 START 的 baseRef/committedOnly 配对完全
// 一致，因为两者都选择已提交的范围而非环境中的工作树。
export interface NativeReviewAssessRequest {
	cwd: string;
	baseRef?: string;
	committedOnly?: boolean;
	signal?: AbortSignal;
}

export interface NativeReviewModeStatus {
	global: NativeReviewModeValue;
	cloneLocal: NativeReviewModeValue;
	effective: "on" | "off";
	source: NativeReviewModeSource;
	revision?: string;
	reach?: NativeReviewModeReach;
}

export interface NativeReviewModeResult {
	operation: NativeReviewModeOperation;
	scope: NativeReviewModeScope;
	status: NativeReviewModeStatus;
}

// 仅用于 START 的逐字匹配可容忍 stderr 白名单，以 `mode` 能力为真作
// 门控（设计决策 #6，organic-rdd-parity）。与 gentle-ai 的无头通知
// （internal/cli/review_mode.go 的 reviewConsentSkippedNotice 及其同族）
// 字节级一致，这些通知在开关打开但没有交互终端应答一次性同意问题时
// 写出——Pi 不带 TTY 派发 gentle-ai 时必然如此。任何其他文本仍以
// UNEXPECTED_STDERR 保守失败。
//
// 每个条目是固定的 gentle-ai 在仍然成功的前提下可能写入控制台流的
// 一整行。最后一个限定词正是该清单保持诚实的原因：v2.4.0 删除了
// reviewConsentSkippedDefaultProvenance（“Reviews are on by default;
// this was never explicitly chosen. ...”），它过去在解析出的模式来源为
// `default` 时随跳过通知一起出现。在自主选择的回执驱动开发下，
// default 来源的克隆早在同意仪式运行之前就被拒绝，因此固定二进制
// 不再可能输出该行，这里将其移除而不是留成死容忍。多行 stderr 原则
// 上仍可能出现——它们是各自的 Fprintln 调用，绝不是一个拼接字符串——
// 这就是成员判定按行进行的原因。
export const REVIEW_CONSENT_NOTICES = Object.freeze([
	"Jero reviewed this change without asking, because this session has no terminal to answer on. Run 'gentle-ai review mode disable' to turn reviews off, or 'gentle-ai review mode status' to see the current setting.",
	"Jero could not read an answer, so it reviewed this change and will ask again next time.",
	"Jero did not recognize that answer, so it reviewed this change and will ask again next time.",
	"Review skipped for this candidate at your request. It will be offered again on the next change.",
]);

// 每个非空行都必须在白名单内。把整个 stderr 当一个字符串匹配只在恰好
// 一条通知可能出现时成立；一旦第二条合法行加入，原本成功的 START 就
// 会被报成 unexpected-stderr。
function stderrIsTolerated(stderr: string, tolerated: readonly string[]): boolean {
	const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	return lines.length > 0 && lines.every((line) => tolerated.includes(line));
}

// gentle-ai main 在 stderr 上向人类叙述协商 STATUS 的预报头部，同时把
// 机器封套保留在 stdout（internal/cli/review_narration.go 的
// reviewNarrateForecast，已对照主线开发构建现场核实）。固定的发布版
// 不输出它，因此该叙述只在配置了开发二进制覆盖时对协商 STATUS 容忍；
// 任何其他 stderr 仍然保守失败。
const FORECAST_NARRATION_LINES = Object.freeze([
	/^Forecast horizon: (?:partial|terminal)$/,
	/^step [0-9]+: (?:execute|collect|stop); reason_code=[a-z0-9_]+; description=.+$/,
	/^Re-query STATUS after completing this partial head\.$/,
]);
function stderrIsForecastNarration(stderr: string): boolean {
	const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	return lines.length > 0 && lines.every((line) => FORECAST_NARRATION_LINES.some((pattern) => pattern.test(line)));
}

export const NATIVE_REVIEW_RECOVER_DISPOSITION = ["scope_changed", "invalidated", "escalated"] as const;
export type NativeReviewRecoverDisposition = (typeof NATIVE_REVIEW_RECOVER_DISPOSITION)[number];

export interface NativeReviewReclaimRequest {
	cwd: string;
	lineage: string;
	actor: string;
	reason: string;
	signal?: AbortSignal;
}

export interface NativeReviewRecoverRequest {
	cwd: string;
	predecessorLineage: string;
	expectedPredecessorRevision: string;
	successorLineage: string;
	disposition: NativeReviewRecoverDisposition;
	actor: string;
	reason: string;
	maintainerAuthorization?: string;
	signal?: AbortSignal;
}

export const NATIVE_REVIEW_RECONCILE_ANOMALIES = {
	COMBINED: "unchanged_target,malformed_recovery_authorization",
} as const;

export interface NativeReviewAbandonRequest {
	cwd: string;
	lineage: string;
	expectedRevision: string;
	snapshotIdentity: string;
	capturedLensResults: readonly string[];
	findingsPresent: boolean;
	actor: string;
	reason: string;
	maintainerAuthorization: string;
	signal?: AbortSignal;
}
export type NativeReviewReconcileAnomalies = (typeof NATIVE_REVIEW_RECONCILE_ANOMALIES)[keyof typeof NATIVE_REVIEW_RECONCILE_ANOMALIES];

export interface NativeReviewReconcileAuthorityRequest {
	cwd: string;
	predecessorLineage: string;
	expectedPredecessorRevision: string;
	successorLineage: string;
	expectedSuccessorRevision: string;
	actor: string;
	reason: string;
	anomalies?: NativeReviewReconcileAnomalies;
	maintainerAuthorization: string;
	signal?: AbortSignal;
}

export interface NativeReviewRecoveryResult { record: Record<string, unknown>; }

// 全新的协商 `review.repair`（契约 v2）。`repair(request)` 总是先运行
// `--mode preflight`；只有合格的评估才会被执行，并使用该评估发布的
// 精确 provider_inputs（设计决策 #6，migrate-review-integration-v2）。
// 遗留的隔离/别名修复路由已删除：jero-pi 存储从不携带遗留权威。
export interface NativeReviewAcknowledgeApprovedRequest {
	readonly argumentTokens: readonly string[];
	readonly cwd: string;
	readonly binding?: ReviewAcknowledgedExpectationV1;
	readonly signal?: AbortSignal;
}

/** `undefined` 是固定版本的静默焚毁（至 v2.5.0-rc.3 的所有发布）；封套是 #3947 的类型化焚毁。 */
export type NativeReviewAcknowledgeApprovedOutcome = ReviewAcknowledgedV1 | undefined;

export interface NativeReviewCorrectionPlanCaptureRequest {
	readonly argumentTokens: readonly string[];
	readonly correctionLines: number;
	readonly cwd: string;
	readonly signal?: AbortSignal;
}

// gentle-pi#311 P4-roles：一次 Go 持有的非评审视角提供方角色捕获。提供方
// 渲染自包含的权威推进向量（`review.capture-refuter` /
// `review.capture-validation`，带绑定令牌外加 `--agent=pi --execute=true`，
// 无提交描述符）；Pi 逐字执行渲染出的精确调用（前台），由 Go 物化角色
// 提示词、派发自己锁定的 pi 子进程并受理原始裁决。这里不编写、解析或
// 传输角色输出。
export const NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_SCHEMA = "gentle-ai.review-provider-role-capture/v1";

// 捕获操作与其终局闭包操作在上游是独立命名的。保持这个封闭映射
// 显式化：capture-validation 的闭包操作刻意采用不统一的
// `review/capture-validation`。
export const NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_CLOSURE_OPERATION = {
	"review.capture-refuter": "review.capture-refuter",
	"review.capture-validation": "review/capture-validation",
} as const;
type NativeReviewProviderRoleCaptureOperation = keyof typeof NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_CLOSURE_OPERATION;

function isNativeReviewProviderRoleCaptureOperation(operation: string): operation is NativeReviewProviderRoleCaptureOperation {
	return Object.hasOwn(NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_CLOSURE_OPERATION, operation);
}

export interface NativeReviewProviderRoleCaptureRequest {
	/** 提供方命名的捕获操作，例如 `review.capture-refuter`。 */
	readonly captureOperation: string;
	/** 提供方签发的每个参数令牌，逐字、按提供方顺序。 */
	readonly argumentTokens: readonly string[];
	/** 仅作进程工作目录；绝不渲染进调用。 */
	readonly cwd: string;
	readonly signal?: AbortSignal;
}

export interface NativeReviewProviderRoleCaptureArtifact {
	readonly schema: typeof NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_SCHEMA;
	readonly lineageId: string;
	readonly targetIdentity: string;
	readonly role: string;
	readonly captured: true;
}

// gentle-pi#638：某个已绑定已选评审视角槽位在当前条件下无法完成的类型化声明。镜像自 Go 的 reviewUnachievableLensCaptureArtifact（internal/cli/review_capture_unachievable.go）：相同的 schema 身份、相同的封闭字段集，以及 Go 强制的相同 512 字节 detail 上限，因此本客户端本地拒绝的声明绝不可能到达会接受它的二进制，反之亦然。
export const NATIVE_REVIEW_UNACHIEVABLE_LENS_CAPTURE_SCHEMA = "gentle-ai.review-capture-unachievable/v1";
export const NATIVE_REVIEW_UNACHIEVABLE_LENS_DETAIL_LIMIT = 512;

export interface NativeReviewUnachievableLensCaptureRequest {
	/** 所提供槽位的精确冻结评审血脉标识符。 */
	readonly lineageId: string;
	/** 所提供槽位的精确冻结目标身份。 */
	readonly targetIdentity: string;
	/** collect 转换提供的精确评审权威修订号。 */
	readonly expectedRevision: string;
	/** 所提供槽位的 subject-hash；Go 由它解析评审视角。 */
	readonly requestHash: string;
	/** 简短的机器可读原因，例如 relay_transport_bound_exceeded。 */
	readonly reason: string;
	/** 可选的有界证据；超过 Go 侧字节上限即拒绝。 */
	readonly detail?: string;
	/** 槽位携带的不透明提供方签发仓库上下文（若有）。 */
	readonly repositoryContext?: string;
	/** 仅作进程工作目录；绝不渲染进调用。 */
	readonly cwd: string;
	readonly signal?: AbortSignal;
}

export interface NativeReviewUnachievableLensCaptureArtifact {
	readonly schema: typeof NATIVE_REVIEW_UNACHIEVABLE_LENS_CAPTURE_SCHEMA;
	readonly lineageId: string;
	readonly targetIdentity: string;
	readonly lens: string;
	readonly selectedOrder: number;
	readonly reason: string;
	readonly recorded: true;
}

// gentle-pi#638 的失败放通能力门：`review capture-unachievable` 比 NATIVE_CLI_CONTRACTS 固定的所有已发布二进制都新，因此该动词以调用点邻接方式门控而不是用能力行。旧二进制会在 stderr 上渲染 Go 的精确 `unknown review command "capture-unachievable"` 拒绝（internal/cli/review_facade.go）且无 stdout，因此调用在任何解码之前就拒绝，捕获的诊断信息是该文本幸存的唯一位置。其余所有失败——类型化的绑定不匹配拒绝、超时、解码失败——都是调用方必须呈现的真实结局，绝不是能力信号。刻意采用鸭子类型：分类器必须像它检查的错误一样，在模块实例被重复加载时仍然存活。
const NATIVE_REVIEW_UNKNOWN_UNACHIEVABLE_VERB_REFUSAL = /unknown review command "capture-unachievable"/;

export function isNativeReviewUnachievableVerbRefused(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const stderr = (error as { diagnostics?: { stderr?: unknown } }).diagnostics?.stderr;
	return typeof stderr === "string" && NATIVE_REVIEW_UNKNOWN_UNACHIEVABLE_VERB_REFUSAL.test(stderr);
}

/** refuter 与 validator 捕获只有作为原生 last event 时才闭合。 */
export type NativeReviewProviderRoleCaptureOutcome = NativeReviewProviderRoleCaptureArtifact | ReviewLastEventClosureV1;

export const NATIVE_UNTRACKED_SCOPE = {
	EXCLUDE: "exclude",
	SELECT: "select",
} as const;
export type NativeUntrackedScope = (typeof NATIVE_UNTRACKED_SCOPE)[keyof typeof NATIVE_UNTRACKED_SCOPE];

export interface NativeIntendedUntrackedSelectionSubmission {
	readonly argumentTokens: readonly string[];
	readonly value: string;
}
export interface NativeUntrackedSelectionRequest {
	untrackedScope?: NativeUntrackedScope;
	expectedUntrackedInventory?: string;
	intendedUntracked?: readonly string[];
	intendedUntrackedSelection?: NativeIntendedUntrackedSelectionSubmission;
}

export interface NativeStartRequest extends NativeUntrackedSelectionRequest {
	cwd: string;
	baseRef?: string;
	committedOnly?: boolean;
	lineageId?: string;
	policyPath?: string;
	focus?: string;
	targetIdentity?: string;
	projection?: "workspace" | "staged";
	signal?: AbortSignal;
}
export const NATIVE_REVIEW_CONSENT_ANSWER = { GRANTED: "granted", DECLINED: "declined" } as const;
export type NativeReviewConsentAnswer = (typeof NATIVE_REVIEW_CONSENT_ANSWER)[keyof typeof NATIVE_REVIEW_CONSENT_ANSWER];
export interface NativeReviewConsentAnswerRequest { cwd: string; consent: ReviewConsentEnvelope; answer: NativeReviewConsentAnswer; signal?: AbortSignal; }
export interface NativeReviewConsentDeclinedResult {
	kind: "declined";
	targetIdentity: string;
	projection: "workspace" | "staged";
	riskLevel: "medium" | "high";
	changedFiles: number;
	changedLines: number;
	consent: "declined_this_candidate";
	raw: Readonly<Record<string, unknown>>;
}
export interface NativeReviewConsentStartedResult { kind: "started"; start: NativeStartResult; }
export type NativeReviewConsentAnswerResult = NativeReviewConsentStartedResult | NativeReviewConsentDeclinedResult;
export interface NativeTargetStatusRequest extends NativeUntrackedSelectionRequest {
	cwd: string;
	lineageId?: string;
	baseRef?: string;
	committedOnly?: boolean;
	projection?: "workspace" | "staged";
	/**
	 * 本宿主提供的不可变评审运行时。对照在线的 2.4.0-main 提供方实测：
	 * 带物化标记的中继槽位（agent=pi、materialize=true，外加提供方提交）
	 * 只有在调用方点名其 agent 时才被提供；不带 agent 的状态返回一个
	 * 宿主中继无法消费的裸 capture-result 输入。早于 v2.4.0 的提供方
	 * 未定义该标志且会拒绝它，因此调用方采用探测并回退，而不是嗅探
	 * 版本。
	 */
	agent?: "pi";
	signal?: AbortSignal;
}
export const NATIVE_REVIEW_AUTHORITY_STATUS = {
	CLEAN: "clean",
	ACTIVE: "active",
	APPROVED: "approved",
	ESCALATED: "escalated",
	RESET_IN_PROGRESS: "reset-in-progress",
	SUPERSEDED: "superseded",
	RECOVERED: "recovered",
	SAME_LINEAGE_MIXED_COLLISION: "same-lineage-mixed-collision",
	INVALID: "invalid",
} as const;
export type NativeReviewAuthorityStatus = (typeof NATIVE_REVIEW_AUTHORITY_STATUS)[keyof typeof NATIVE_REVIEW_AUTHORITY_STATUS];

export const NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION = {
	LEGACY_V1: "legacy-v1",
	COMPACT_V2: "compact-v2",
} as const;
export type NativeReviewAuthorityEntryVersion = (typeof NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION)[keyof typeof NATIVE_REVIEW_AUTHORITY_ENTRY_VERSION];

export const NATIVE_REVIEW_AUTHORITY_ENTRY_STATUS = {
	...NATIVE_REVIEW_AUTHORITY_STATUS,
	INCOMPLETE_STORE_ENTRY: "incomplete-store-entry",
	HISTORICAL_PRE_RECEIPT: "historical-pre-receipt",
	INVALIDATED: "invalidated",
} as const;
export type NativeReviewAuthorityEntryStatus = (typeof NATIVE_REVIEW_AUTHORITY_ENTRY_STATUS)[keyof typeof NATIVE_REVIEW_AUTHORITY_ENTRY_STATUS];

export const NATIVE_REVIEW_LOCK_STATUS = {
	OWNED: "owned",
	AMBIGUOUS: "ambiguous",
	// gentle-ai 2.1.8 在普通成功操作之后留下 review-transactions/v2/LOCK，
	//并将其清点为已释放（所有者已死）条目（#184）。这保持为封闭枚举：
	// 锁状态决定控制器的阻塞行为，因此未来未知的状态必须继续保守失败，
	// 而不是像仅用于诊断的元数据那样被容忍。
	RELEASED: "released",
} as const;
export type NativeReviewLockStatus = (typeof NATIVE_REVIEW_LOCK_STATUS)[keyof typeof NATIVE_REVIEW_LOCK_STATUS];

export const NATIVE_REVIEW_LOCK_OWNER_SCHEMA = {
	V1: "gentle-ai.review-store-lock/v1",
} as const;
export type NativeReviewLockOwnerSchema = (typeof NATIVE_REVIEW_LOCK_OWNER_SCHEMA)[keyof typeof NATIVE_REVIEW_LOCK_OWNER_SCHEMA];

export interface NativeReviewLockOwner {
	schema: NativeReviewLockOwnerSchema;
	ownerId: string;
	pid: number;
	host: string;
	acquiredAt: string;
}
export const NATIVE_REVIEW_RECOVERY_DISPOSITION = {
	SCOPE_CHANGED: "scope_changed",
	INVALIDATED: "invalidated",
	ESCALATED: "escalated",
} as const;
export type NativeReviewRecoveryDisposition = (typeof NATIVE_REVIEW_RECOVERY_DISPOSITION)[keyof typeof NATIVE_REVIEW_RECOVERY_DISPOSITION];

export interface NativeReviewRecovery {
	predecessorLineageId: string;
	predecessorRevision: string;
	disposition: NativeReviewRecoveryDisposition;
	reason: string;
	actor: string;
	recoveredAt: string;
	maintainerAuthorization?: string;
}
export interface NativeReviewDiscardedWorkSummary {
	capturedLensResults: readonly string[];
	findingsPresent: boolean;
}
export interface NativeReviewAuthorityEntry {
	version: NativeReviewAuthorityEntryVersion;
	lineageId?: string;
	path: string;
	status: NativeReviewAuthorityEntryStatus;
	state?: string;
	revision?: string;
	snapshotIdentity?: string;
	chainIdentity?: string;
	recovery?: NativeReviewRecovery;
	discardedWork?: NativeReviewDiscardedWorkSummary;
	problems: readonly string[];
}
export interface NativeReviewAuthorityLock {
	version: NativeReviewAuthorityEntryVersion;
	lineageId?: string;
	path: string;
	status: NativeReviewLockStatus;
	owner?: NativeReviewLockOwner;
	problem?: string;
}
export interface NativeReviewAuthorityDiagnostic {
	path: string;
	problem: string;
}
export const NATIVE_START_ACTION = { CREATED: "created", RESUMED: "resumed", REPLAYED: "replayed", CLOSED: "closed", BLOCKED_SCOPE_ACTION: "blocked-scope-action" } as const;
export type NativeStartAction = (typeof NATIVE_START_ACTION)[keyof typeof NATIVE_START_ACTION];
export interface NativeStartResult { lineageId: string; state: ReviewStartState; riskLevel: string; selectedLenses: readonly string[]; changedFiles: number; changedLines: number; correctionBudget: number; action: NativeStartAction; lensesRequired: boolean; riskReasons?: readonly Record<string, unknown>[]; nextTransition?: ReviewNextTransitionV3; raw?: Readonly<Record<string, unknown>>; riskEvidence?: readonly string[]; hint?: string; }

export const NATIVE_SDD_DEPENDENCIES = ["proposal", "specs", "design", "tasks", "apply", "verify", "archive"] as const;
export const NATIVE_SDD_INSTRUCTION_PHASES = ["apply", "verify", "remediate", "archive"] as const;
