// D7：客户端契约，内化到权威之下（设计 6，native-review-cli ->
// lib/authority）。保守失败的桩保留为可测试注入的参考实现与 Q-C 的
// 不可达成表面；生产默认值是进程内适配器（lib/jero-authority-cli.ts）。
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, posix, win32 } from "node:path";
import { promisify } from "node:util";
import { decodeReviewAssessmentV1, type ReviewAssessmentV1 } from "../review-risk-assessment.ts";
import {
	REVIEW_INTEGRATION_CONTRACT,
	decodeReviewAcknowledgedV1,
	decodeReviewConsentV2,
	decodeReviewConsentV3,
	decodeReviewFailureV2,
	decodeReviewLastEventClosureV1,
	decodeReviewRepairV2,
	decodeReviewResultArtifactV2,
	decodeReviewStartV3,
	decodeReviewStartV4,
	decodeReviewStatusV3,
	type ReviewAcknowledgedExpectationV1,
	type ReviewAcknowledgedV1,
	type ReviewConsentEnvelope,
	type ReviewFailureV2,
	type ReviewRepairV2,
	type ReviewNextTransitionV3,
	type ReviewStartState,
	type ReviewStartV3,
	type ReviewStartV4,
	type ReviewStatusV3,
	type ReviewLastEventClosureV1,
} from "./wire-contract.ts";

const execFileAsync = promisify(execFile);

// 协商的 review/status 响应可能携带完整的权威清单。让生产默认值足够
// 容纳该载荷，同时即使设置了 JERO_PI_REVIEW_MAX_BUFFER_BYTES 也保留
// 64 MiB 的硬上限。
export const NATIVE_REVIEW_DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const NATIVE_REVIEW_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const NATIVE_REVIEW_MAX_BUFFER_BYTES_ENV = "JERO_PI_REVIEW_MAX_BUFFER_BYTES";
const NATIVE_REVIEW_MAX_BUFFER_CONFIGURATION_HINT = "Inspect native review state before any new START; JERO_PI_REVIEW_MAX_BUFFER_BYTES accepts a positive decimal up to 67108864.";


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
export function isCanonicalProcessString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

interface NativeUntrackedSelection {
	untrackedScope?: NativeUntrackedScope;
	expectedUntrackedInventory?: string;
	intendedUntracked?: readonly string[];
}

function isNativeUntrackedPath(value: unknown): value is string {
	return isCanonicalProcessString(value)
		&& !posix.isAbsolute(value)
		&& !win32.isAbsolute(value)
		&& !value.includes("\\")
		&& value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function nativeUntrackedSelection(request: NativeUntrackedSelectionRequest): NativeUntrackedSelection {
	const { untrackedScope, expectedUntrackedInventory, intendedUntracked } = request;
	const declared = untrackedScope !== undefined || expectedUntrackedInventory !== undefined || intendedUntracked !== undefined;
	if (!declared) return {};
	if (
		(untrackedScope !== NATIVE_UNTRACKED_SCOPE.EXCLUDE && untrackedScope !== NATIVE_UNTRACKED_SCOPE.SELECT) ||
		!isCanonicalProcessString(expectedUntrackedInventory) ||
		(intendedUntracked !== undefined && (!Array.isArray(intendedUntracked) || intendedUntracked.some((path) => !isNativeUntrackedPath(path) || intendedUntracked.indexOf(path) !== intendedUntracked.lastIndexOf(path))))
	) {
		throw new TypeError("Native untracked selection must declare one scope, one inventory digest, and unique repository-relative paths");
	}
	if (untrackedScope === NATIVE_UNTRACKED_SCOPE.EXCLUDE && (intendedUntracked?.length ?? 0) > 0) {
		throw new TypeError("Native exclude untracked selection cannot include paths");
	}
	if (untrackedScope === NATIVE_UNTRACKED_SCOPE.SELECT && (intendedUntracked?.length ?? 0) === 0) {
		throw new TypeError("Native select untracked selection requires at least one path");
	}
	return {
		untrackedScope,
		expectedUntrackedInventory,
		intendedUntracked: intendedUntracked === undefined ? undefined : [...intendedUntracked],
	};
}

function nativeUntrackedSelectionArguments(selection: NativeUntrackedSelection): readonly string[] {
	if (selection.untrackedScope === undefined) return [];
	return [
		`--untracked-scope=${selection.untrackedScope}`,
		`--expected-untracked-inventory=${selection.expectedUntrackedInventory!}`,
		...(selection.untrackedScope === NATIVE_UNTRACKED_SCOPE.SELECT
			? selection.intendedUntracked!.map((path) => `--intended-untracked=${path}`)
			: []),
	];
}

const NATIVE_RISK_LEVEL = ["low", "medium", "high"] as const;

// gentle-ai 协商的 `start/v2` 封套是封闭 schema
// （`additionalProperties: false`），因此其普通兄弟携带的两个投影无法
// 在不引入新契约版本的情况下加进去。两者都是 `start/v2` 已作为必填
// 字段上报的事实的投影，协商调用方在这里重建它们，而不是落得比普通
// 调用方更糟的恢复境况。这些是 Pi 侧对原生事实的渲染，绝不声称 CLI
// 发送了它们：封套省略它们的每个版本，`riskEvidence`/`hint` 能力行
// 都保持暗置。
//
// internal/cli/review_mode.go 与 review_facade.go 的逐字节镜像。
// `reviewConsentEvidencePhrases` 在那里被记录为唯一的措辞来源，使其
// 各表面不会漂移，这让这里成为第二个表面：无法识别的原因码因此
// 不渲染任何内容而不是猜测，且 nativeRiskEvidencePhrases 在
// tests/native-review-parity.test.ts 中对照 gentle-ai fixture 钉住，
// 词汇变化会高声失败。
export const REVIEW_EMPTY_CANDIDATE_HINT =
	"the candidate has no pending changes; already-committed work can be reviewed by rerunning review start with --base-ref <commit> naming the base to compare against";
const REVIEW_MEDIUM_RISK_REASON = "this change is not purely passive documentation, so it gets one consolidated review.";
const REVIEW_EMPTY_CONTENT_CODE = "empty_content";
const REVIEW_RISK_SUBJECT_BY_CODE: Readonly<Record<string, string>> = Object.freeze({
	service_token: "service credentials",
	shell_source: "shell scripting",
	process_boundary: "code that starts other processes",
	process_scan_limit: "code that starts other processes",
	executable_mode: "an executable permission change",
	executable_change: "an executable change",
	configuration_change: "a configuration change",
});
const REVIEW_RISK_SUBJECT_BY_SIGNAL: Readonly<Record<string, string>> = Object.freeze({
	auth: "authentication",
	update: "the update path",
	security: "security",
	payments: "payments",
	data_exposure: "data exposure",
	data_loss: "data loss",
	permissions: "permissions",
	shell_process: "shell or process execution",
});
// Go 的信号开关没有空默认分支：每个 hot_path 原因都会发声，未映射的
// 信号退化为这个措辞而不是把路径整个丢掉。
const REVIEW_RISK_UNKNOWN_SIGNAL_SUBJECT = "a sensitive area";

interface NativeRiskEvidenceReason {
	readonly code?: string;
	readonly signal?: string;
	readonly path?: string;
}

function nativeRiskEvidenceSubject(reason: NativeRiskEvidenceReason): string {
	const code = typeof reason.code === "string" ? reason.code : "";
	if (code === "hot_path") {
		const signal = typeof reason.signal === "string" ? reason.signal : "";
		return REVIEW_RISK_SUBJECT_BY_SIGNAL[signal] ?? REVIEW_RISK_UNKNOWN_SIGNAL_SUBJECT;
	}
	return REVIEW_RISK_SUBJECT_BY_CODE[code] ?? "";
}

function nativeRiskEvidencePhrase(reason: NativeRiskEvidenceReason): string {
	const path = typeof reason.path === "string" ? reason.path.trim() : "";
	// 空文件先点名再描述。其余主语读作 “<什么变了> in <路径>”，
	// 对没有字节的文件那样写会断言并不存在的内容。
	if (reason.code === REVIEW_EMPTY_CONTENT_CODE) {
		return path === "" ? "" : `${path}, an empty file whose type cannot be determined from its content`;
	}
	const subject = nativeRiskEvidenceSubject(reason);
	if (subject === "" || path === "") return subject;
	return `${subject} in ${path}`;
}

export function nativeRiskEvidencePhrases(riskLevel: string, reasons: readonly NativeRiskEvidenceReason[]): readonly string[] {
	if (riskLevel !== "high" && riskLevel !== "medium") return [];
	const phrases = reasons.map((reason) => nativeRiskEvidencePhrase(reason)).filter((phrase) => phrase !== "");
	return riskLevel === "medium" ? [REVIEW_MEDIUM_RISK_REASON, ...phrases] : phrases;
}
const NATIVE_REVIEW_LENS = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
const NATIVE_START_ACTION_VALUES = Object.values(NATIVE_START_ACTION);
// 钉住表刻意在 #3587 未发布期间保持不变。last-event 捕获支持通过显式
// 的开发二进制覆盖来演练；不允许源码级的钉住或契约行变更。
const ORGANIC_PARITY_DARK = { mode: false, riskEvidence: false, hint: false, delivery: false } as const;

export const NATIVE_CLI_CONTRACTS = Object.freeze({
	"2.1.4": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: false, inventory: false, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.5": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.6": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.7": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.8": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: false, quarantineLegacy: false, reconcileAuthority: true, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.9": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.10": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, ...ORGANIC_PARITY_DARK }),
	"2.1.11": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, ...ORGANIC_PARITY_DARK }),
	// 首个能力为真的行，并按设计决策 #1 的要求与本提交中的三重钉住
	// 升级配对。
	//
	// 四个 organic-parity 列只点亮两个，因为能力行是一种承诺，而这两个
	// 的数据已被证明能到达 Pi 实际消费的协商路径：
	//
	//   mode      `gentle-ai review mode status` 直接回答 review-mode/v1
	//             封套。
	//   delivery  门控结果携带 `delivery`（关闭杀开关时为
	//             “disabled/unmanaged”），已对照 v2.2.0 验证。
	//
	// riskEvidence 与 hint 刻意保持暗置。两者在 gentle-ai v2.2.0 中都
	// 存在，但只在普通 start 封套上；启动解码器承载的协商
	// `review-integration.start/v2` 携带的是 `risk_reasons` 而非
	// `risk_evidence`，且完全省略 `hint`。点亮它们会宣传不可能到达的
	// 数据。要关闭该缺口需要上游扩展协商启动封套，那会动到字节钉住
	// 的 fixture，因此属于 gentle-ai 发布，而不是 Pi 的能力翻转。
	"2.2.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 2.2.1 重复 2.2.0，因为 Pi 所讲通道的线上协议没有变化。v2.2.1 在
	// review-integration/v1 上宣告 capabilities/v1.5（协议次版本 5），
	// 但协商启动封套仍是封闭的 `start/v2`，因此 riskEvidence 与 hint
	// 保持暗置，理由与 2.2.0 相同。该发布确实公开了第二个契约
	// review-integration/v2，其 `start/v3` 携带 base/candidate 树——但
	// Pi 尚未协商它，而能力行必须描述使用中的通道。
	"2.2.1": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 2.2.2 出于相同原因重复 2.2.1，且是对照已发布的 v2.2.2 二进制确认
	// 而非假设：它在 review-integration/v1 上仍宣告 capabilities/v1.5，
	// 协商启动封套仍是封闭的 `start/v2`，因此 riskEvidence 与 hint
	// 仍无法到达。
	"2.2.2": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照已发布的 v2.2.3 二进制实测：v2 通道仍是协议 2.0，操作集与
	// Pi 消费的封闭 START 字段不变，因此既有能力列不变。
	"2.2.3": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照已发布的 v2.4.0 二进制实测：v2 通道宣告 capabilities/v2.2 并
	// 应答 status/v5 与 consent/v3，既有解码器都已能读取，而 Pi 消费的
	// START 封套仍是携带 `risk_reasons`、无 `risk_evidence` 也无 `hint`
	// 的 `start/v3`，因此既有能力列不变。v2.4.0 还把回执驱动开发改为
	// 自主选择，这改变的是模式封套报告的内容，而非是否报告。v2.2.4
	// 与 v2.3.0 发布时 Pi 仍停留在 2.2.3；它们从未被钉住或探测，因此
	// 没有对应行。
	"2.4.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 通过将确切的 v2.5.0-rc.3 标签构建送入 gentle-ai-bench 驱动的旅程
	// 语料（退出码 0）实测，该语料演练 Pi 消费的启动/状态/捕获/验证/
	// 模式/交付生命周期。v2 通道宣告 capabilities/v2.3，其评审 START 是
	// #499 已解码的 `start/v4` 续跑封套；Pi 消费的封闭字段未变，因此
	// 各列与 2.4.0 行一致。riskEvidence 与 hint 保持暗置：仍未被证明
	// 能到达 Pi 读取的协商路径。
	"2.5.0-rc.3": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照从签名档案安装的已发布 v2.5.0 二进制实测：v2 通道上的
	// `review capabilities` 宣告 capabilities/v2.4（协议次版本 4），并
	// 应答 status/v6、consent/v3 与 `start/v4` 续跑，解码器都已能读取。
	// rc.3 到稳定版之间 Pi 消费的封闭字段没有变化，因此各列与
	// 2.5.0-rc.3 行一致。riskEvidence 与 hint 保持暗置：仍未被证明能
	// 到达 Pi 读取的协商 START 路径。
	"2.5.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照从签名档案安装的已发布 v2.6.0 二进制实测：v2 通道上的
	// `review capabilities` 宣告 capabilities/v2.5（协议次版本 5），并
	// 应答 status/v7、consent/v3 与 `start/v4` 续跑，解码器都已能读取。
	// `review mode status --json` 仍应答 `gentle-ai.rdd-mode-status/v1`，
	// `review validate --gate pre-commit` 仍应答携带 `delivery` 的
	// `gentle-ai.review-gate-result/v1`，两者均对照二进制验证。在
	// `review start` 期间拒绝 consent/v3 提示时，`risk_evidence` 仍只
	// 出现在那个阻塞封套上，绝不出现在协商的 `start/v4` 续跑上，因此
	// riskEvidence 与 hint 保持暗置，理由与自 2.2.0 以来每一行相同：
	// 仍未被证明能到达 Pi 读取的协商 START 路径。2.5.0 到 2.6.0 之间
	// Pi 消费的封闭字段没有变化，因此各列与 2.5.0 行一致。
	"2.6.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照从签名档案安装的已发布 v2.7.0 二进制实测：v2 通道上的
	// `review capabilities` 仍宣告 capabilities/v2.5（协议次版本 5），并
	// 应答 status/v7、consent/v3 与 `start/v4` 续跑，解码器都已能读取。
	// `review mode status --json` 仍应答 `gentle-ai.rdd-mode-status/v1`，
	// `review validate --gate pre-commit` 仍应答携带 `delivery` 的
	// `gentle-ai.review-gate-result/v1`，两者均对照二进制验证。
	// riskEvidence 与 hint 保持暗置，理由与自 2.2.0 以来每一行相同：
	// 仍未被证明能到达 Pi 读取的协商 START 路径。2.6.0 到 2.7.0 之间
	// Pi 消费的封闭字段没有变化，因此各列与 2.6.0 行一致。
	"2.7.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照从签名发布档案取得的已发布 v2.8.0 linux/amd64 二进制实测。
	// v2 通道仍宣告 capabilities/v2.5（协议次版本 5），schema 为
	// status/v7、consent/v3 与 start/v4。2.7.0 到 2.8.0 之间 Pi 消费的
	// 封闭字段没有变化，因此本行重复 2.7.0。riskEvidence 与 hint 保持
	// 暗置，因为两者都未被证明能到达 Pi 消费的协商 START 路径。
	"2.8.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// v2.8.1 只改了运行时遥测的模型归因（gentle-ai#4536）；2.8.0 到
	// 2.8.1 之间 Pi 消费的封闭字段没有变化，因此本行完全重复 2.8.0。
	// riskEvidence 与 hint 保持暗置，因为两者都未被证明能到达 Pi 消费
	// 的协商 START 路径。
	"2.8.1": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// v2.8.2 发布了 OpenCode SDD 预检插件修复、community-tools 的 RTK
	// 获取，以及 Claude Code Stop 遥测。提供方契约 semver 保持 1.2.0；
	// 同一钉住重新镜像了在该 semver 下漂移过的捆绑字节（评审视角的
	// inspection.status “unavailable”、定向 validator 的
	// regressions/inspection 成员、七个 Pi 停止原因码）。这些都不触及
	// 本行协商的封闭 START/STATUS 字段，因此它完全重复 2.8.1。
	// riskEvidence 与 hint 保持暗置，因为两者都未被证明能到达 Pi 消费
	// 的协商 START 路径。
	"2.8.2": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// v2.9.0 发布了自主选择的 RTK Community Tool 集成（#4560，仅
	// installer/sync/TUI）、SDD 尝试台账修复（#4564、#4567、#4569——
	// 修正指针现在先按链相等再按形状判定，拒绝措辞也变了）、同步
	// telemetry-runtime 符号链接根（#4565）、OpenCode 评审员 Task 包装
	// 解码（#4545），以及 Engram 协议资产措辞（#4179）。通过在
	// gentle-ai 源码树中对 v2.8.2 与 v2.9.0 标签之间的
	// contracts/review-integration/v2 和 contracts/review-provider-contract
	// 做 diff 实测：零字节变化。以上都不触及本行协商的封闭 START/
	// STATUS 字段，因此它完全重复 2.8.2。riskEvidence 与 hint 保持暗置，
	// 因为两者都未被证明能到达 Pi 消费的协商 START 路径。
	"2.9.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// v2.9.1 发布了恢复兼容的 OpenCode 评审同意（#4584）与从会话转录
	// 派生 Claude Code SDD 派发权威（#4575、#4551）。通过在 gentle-ai
	// 源码树中对 v2.9.0 与 v2.9.1 标签之间的
	// contracts/review-integration/v2 和 contracts/review-provider-contract
	// 做 diff 实测：零字节变化。两个变更都不触及本行协商的封闭
	// START/STATUS 字段，因此它完全重复 2.9.0。riskEvidence 与 hint 保持
	// 暗置，因为两者都未被证明能到达 Pi 消费的协商 START 路径。
	"2.9.1": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
});

export interface NativeReviewProcessDiagnostics {
	operation: NativeReviewOperation;
	error_code: NativeReviewErrorCode;
	exit_code?: number;
	signal?: NodeJS.Signals;
	timed_out: boolean;
	output_limit_exceeded: boolean;
	max_buffer_bytes?: number;
	configuration_hint?: string;
	stderr?: string;
}

export class NativeReviewCliError extends Error {
	readonly code: NativeReviewErrorCode;
	readonly operation: NativeReviewOperation;
	readonly launchAttempted: boolean;
	readonly mutating: boolean;
	readonly mutationOutcome: "none" | "unknown";
	readonly nextAction?: "review.status";
	readonly diagnostics: NativeReviewProcessDiagnostics;
	readonly auditRecord?: Record<string, unknown>;
	constructor(code: NativeReviewErrorCode, operation: NativeReviewOperation, launchAttempted: boolean, mutating: boolean, message: string, diagnostics?: NativeReviewProcessDiagnostics, auditRecord?: Record<string, unknown>) {
		super(message);
		this.name = "NativeReviewCliError";
		this.code = code;
		this.operation = operation;
		this.launchAttempted = launchAttempted;
		this.mutating = mutating;
		this.mutationOutcome = launchAttempted && mutating ? "unknown" : "none";
		this.nextAction = this.mutationOutcome === "unknown" && operation !== NATIVE_REVIEW_OPERATION.SDD_ATTEMPT ? "review.status" : undefined;
		this.diagnostics = diagnostics ?? { operation, error_code: code, timed_out: false, output_limit_exceeded: false };
		this.auditRecord = auditRecord;
	}
}

// 扩展发出的每个 gentle-ai CLI 调用共用的唯一中央运行器。jero-pi M3
// （设计 §8）：gentle-pi.review-relay/v1 握手声明已删除——中继在进程内
// 渲染并受理，因此任何派发都不再有需要声明的跨进程契约。
export function gentleAiProcessEnvironment(base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	return { ...base };
}

export function createNodeExecFileAdapter(): ExecFileAdapter {
	return async (request) => {
		try {
			const output = await execFileAsync(request.file, [...request.arguments], { cwd: request.cwd, encoding: "utf8", shell: false, windowsHide: true, timeout: request.timeoutMs, maxBuffer: request.maxBufferBytes, signal: request.signal });
			return { stdout: output.stdout, stderr: output.stderr, exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
		} catch (error) {
			const detail = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number; signal?: NodeJS.Signals; killed?: boolean };
			if (detail.code === "ENOENT" || detail.code === "EACCES" || detail.name === "AbortError") throw error;
			const outputLimitExceeded = detail.code === "ENOBUFS" || detail.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
			return { stdout: detail.stdout ?? "", stderr: detail.stderr ?? "", exitCode: typeof detail.code === "number" ? detail.code : 1, signal: detail.signal ?? null, timedOut: !outputLimitExceeded && detail.killed === true, outputLimitExceeded };
		}
	};
}

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected object");
	return value as Record<string, unknown>;
}
function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	const parsed = object(value);
	const allowed = [...required, ...optional];
	if (required.some((key) => !(key in parsed)) || Object.keys(parsed).some((key) => !allowed.includes(key))) throw new Error("unexpected object shape");
	return parsed;
}
function requiredString(value: unknown): string { if (typeof value !== "string" || value.length === 0) throw new Error("expected string"); return value; }
function stringValue(value: unknown): string { if (typeof value !== "string") throw new Error("expected string"); return value; }
function sha256Identity(value: unknown): string { const parsed = requiredString(value); if (!/^sha256:[0-9a-f]{64}$/.test(parsed)) throw new Error("expected canonical SHA-256 identity"); return parsed; }
function booleanValue(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("expected boolean"); return value; }
function nonNegativeInteger(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("expected safe non-negative integer"); return value; }
function positiveInteger(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("expected safe positive integer"); return value; }
function stringArray(value: unknown): readonly string[] { if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) throw new Error("expected string array"); return value; }
function decodeSelectedLenses(value: unknown, riskLevel: string, lensesRequired: boolean): readonly string[] {
	if (value === null && riskLevel === "low" && !lensesRequired) return [];
	return stringArray(value);
}
function enumString(value: unknown, allowed: readonly string[]): string { const parsed = stringValue(value); if (!allowed.includes(parsed)) throw new Error("unsupported enum"); return parsed; }
const NATIVE_DIAGNOSTIC_TEXT_LIMIT = 4_096;

function sanitizeNativeDiagnosticText(value: string, limit = NATIVE_DIAGNOSTIC_TEXT_LIMIT): string {
	const normalized = value
		.replace(/\x1b](?:[^\x07\x1b]|\x1b(?!\\))*?(?:\x07|\x1b\\)/g, "[REDACTED CONTROL]")
		.replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, "[REDACTED CONTROL]")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "[REDACTED CONTROL]")
		.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED PEM]")
		.replace(/("(?:token|password|secret|api_key|apikey|authorization|cookie|private_key|access_token|github_token|[a-z0-9_-]+_token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, "$1\"[REDACTED]\"")
		.replace(/\b(Bearer)\s+[^\s]+/gi, "$1 [REDACTED]")
		.replace(/\b(token|secret|password|authorization|cookie|private_key|access_token|github_token|[a-z0-9_-]+_token|api[_-]?key)\s*([:=])\s*[^\s]+/gi, "$1$2[REDACTED]")
		.replace(/[\u0000-\u001f\u007f]/g, "");
	return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 14)}…[truncated]`;
}

// 在外观输出之前，从被重复加载的模块实例重建诊断信息。
export function sanitizeForeignNativeReviewDiagnostics(value: unknown): NativeReviewProcessDiagnostics | undefined {
	try {
		const raw = exactObject(value, ["operation", "error_code", "timed_out", "output_limit_exceeded"], ["exit_code", "signal", "max_buffer_bytes", "configuration_hint", "stderr"]);
		const operation = enumString(raw.operation, Object.values(NATIVE_REVIEW_OPERATION)) as NativeReviewOperation;
		const errorCode = enumString(raw.error_code, Object.values(NATIVE_REVIEW_ERROR_CODE)) as NativeReviewErrorCode;
		const signal = raw.signal === undefined ? undefined : requiredString(raw.signal);
		const maxBufferBytes = raw.max_buffer_bytes === undefined ? undefined : positiveInteger(raw.max_buffer_bytes);
		const configurationHint = raw.configuration_hint === undefined ? undefined : stringValue(raw.configuration_hint);
		if (
			(signal !== undefined && !/^SIG[A-Z0-9]{1,12}$/.test(signal)) ||
			(maxBufferBytes === undefined) !== (configurationHint === undefined) ||
			(configurationHint !== undefined && (errorCode !== NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT || configurationHint !== NATIVE_REVIEW_MAX_BUFFER_CONFIGURATION_HINT))
		) return undefined;
		return {
			operation,
			error_code: errorCode,
			...(raw.exit_code === undefined ? {} : { exit_code: nonNegativeInteger(raw.exit_code) }),
			...(signal === undefined ? {} : { signal: signal as NodeJS.Signals }),
			timed_out: booleanValue(raw.timed_out),
			output_limit_exceeded: booleanValue(raw.output_limit_exceeded),
			...(maxBufferBytes === undefined ? {} : { max_buffer_bytes: maxBufferBytes, configuration_hint: configurationHint! }),
			...(raw.stderr === undefined ? {} : { stderr: sanitizeNativeDiagnosticText(stringValue(raw.stderr)) }),
		};
	} catch { return undefined; }
}

function nativeProcessDiagnostics(operation: NativeReviewOperation, code: NativeReviewErrorCode, result?: ExecFileResult, maxBufferBytes?: number): NativeReviewProcessDiagnostics {
	const outputLimitExceeded = result?.outputLimitExceeded === true;
	return {
		operation,
		error_code: code,
		...(result === undefined ? {} : { exit_code: result.exitCode }),
		...(result?.signal === null || result?.signal === undefined ? {} : { signal: result.signal }),
		timed_out: !outputLimitExceeded && result?.timedOut === true,
		output_limit_exceeded: outputLimitExceeded,
		...(code === NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT && maxBufferBytes !== undefined
			? { max_buffer_bytes: maxBufferBytes, configuration_hint: NATIVE_REVIEW_MAX_BUFFER_CONFIGURATION_HINT }
			: {}),
		...(result?.stderr.trim() ? { stderr: sanitizeNativeDiagnosticText(result.stderr) } : {}),
	};
}

function parseJson(stdout: string, operation: NativeReviewOperation, mutating: boolean, diagnostics: NativeReviewProcessDiagnostics): Record<string, unknown> {
	if (stdout.length === 0) throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT, operation, true, mutating, "native command returned empty output", { ...diagnostics, error_code: NATIVE_REVIEW_ERROR_CODE.EMPTY_OUTPUT });
	try { return object(JSON.parse(stdout)); } catch { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON, operation, true, mutating, "native command returned malformed JSON", { ...diagnostics, error_code: NATIVE_REVIEW_ERROR_CODE.MALFORMED_JSON }); }
}
function decodeNativeMaintenanceResult(value: unknown, expectedOperation: NativeReviewOperation): NativeReviewRecoveryResult {
	const body = exactObject(value, ["operation", "record"]);
	if (body.operation !== expectedOperation) throw new Error("wrong native maintenance discriminator");
	return { record: object(body.record) };
}
function decodeLegacyReconcileAudit(value: unknown): NativeReviewRecoveryResult {
	const record = exactObject(value, ["schema", "predecessor_lineage", "successor_lineage", "outcome"]);
	if (record.schema !== "gentle-ai.review-reconcile-audit/v1") throw new Error("wrong legacy reconcile audit schema");
	for (const field of ["predecessor_lineage", "successor_lineage", "outcome"]) requiredString(record[field]);
	return { record };
}
// 未实现的 next_transition.execute.operation 值绝不能进入 argv 合成。
// 对解码前的原始正文检查，使 gentle-pi 未实现的操作（例如未来的
// `dispose-result`）以具名的类型化拒绝失败，而不是泛泛的 schema 不
// 兼容错误，且发生在任何客户端尝试为其构建调用之前（设计决策 #6，
// migrate-review-integration-v2）。
const NATIVE_REVIEW_SUPPORTED_TRANSITION_OPERATIONS = new Set(["review.start", "review.recover", "review.repair", "review.acknowledge-approved"]);
function assertSupportedNextTransitionOperation(body: Record<string, unknown>): void {
	const nextTransition = body.next_transition;
	if (typeof nextTransition !== "object" || nextTransition === null || Array.isArray(nextTransition)) return;
	const execute = (nextTransition as Record<string, unknown>).execute;
	if (typeof execute !== "object" || execute === null || Array.isArray(execute)) return;
	const operation = (execute as Record<string, unknown>).operation;
	if (typeof operation === "string" && !NATIVE_REVIEW_SUPPORTED_TRANSITION_OPERATIONS.has(operation)) {
		throw nativeError(NATIVE_REVIEW_ERROR_CODE.UNSUPPORTED_TRANSITION_OPERATION, NATIVE_REVIEW_OPERATION.STATUS, false, `unsupported-transition-operation: gentle-pi does not implement the next_transition operation "${operation}"; refusing rather than synthesizing an invocation for it`);
	}
}
function decode<T>(operation: NativeReviewOperation, mutating: boolean, callback: () => T, diagnostics = nativeProcessDiagnostics(operation, NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE)): T {
	try { return callback(); } catch (error) { if (error instanceof NativeReviewCliError) throw error; throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE, operation, true, mutating, "native response is schema incompatible", { ...diagnostics, error_code: NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE }); }
}
function decodeReviewStartResponse(value: unknown): ReviewStartV3 | ReviewStartV4 {
	const body = object(value);
	return body.schema === "gentle-ai.review-integration.start/v4"
		? decodeReviewStartV4(body)
		: decodeReviewStartV3(body);
}
function decodeReleaseEvidence(value: unknown): void {
	const release = exactObject(value, ["release_tree", "configuration_hash", "generated_artifact_hash", "provenance_hash", "publication_boundary_hash", "publication_state", "evidence_freshness_hash", "evidence_freshness_state"]);
	for (const field of ["release_tree", "configuration_hash", "generated_artifact_hash", "provenance_hash", "publication_boundary_hash", "evidence_freshness_hash"]) requiredString(release[field]);
	if (release.publication_state !== "sealed" || release.evidence_freshness_state !== "current") throw new Error("invalid release evidence");
}
function isWindowsRepositoryPath(value: string): boolean { return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value); }
export function normalizeNativeReviewCwd(value: string, platform: NodeJS.Platform = process.platform): string {
	if (platform !== "win32") return value;
	const gitBashDrive = /^\/([A-Za-z])(?:\/(.*))?$/.exec(value);
	const windowsPath = gitBashDrive === null
		? value
		: `${gitBashDrive[1]!.toUpperCase()}:/${gitBashDrive[2] ?? ""}`;
	if (!isWindowsRepositoryPath(windowsPath)) return windowsPath;
	const normalized = win32.normalize(windowsPath);
	return normalized.replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);
}
async function canonicalNativeReviewCwd(value: string): Promise<string> {
	const normalized = normalizeNativeReviewCwd(value);
	try { return await realpath(normalized); }
	catch { return normalized; }
}
async function repositoryPathIdentity(value: string): Promise<string> {
	const windowsPath = isWindowsRepositoryPath(value);
	try { return `filesystem:${windowsPath ? (await realpath(value)).toLowerCase() : await realpath(value)}`; }
	catch { return `path:${windowsPath ? win32.normalize(value).toLowerCase() : posix.normalize(value)}`; }
}
async function repositoriesMatch(requested: string, returned: string): Promise<boolean> {
	return (await repositoryPathIdentity(requested)) === (await repositoryPathIdentity(returned));
}
function decodeSnapshot(value: unknown): void {
	const snapshot = exactObject(value, ["kind", "base_tree", "candidate_tree", "paths_digest", "intended_untracked", "intended_untracked_proof", "paths", "identity"], ["ledger_ids"]);
	enumString(snapshot.kind, ["current-changes", "base-diff", "commit-range", "fix-diff"]);
	for (const field of ["base_tree", "candidate_tree", "paths_digest", "intended_untracked_proof", "identity"]) requiredString(snapshot[field]);
	stringArray(snapshot.intended_untracked); stringArray(snapshot.paths);
	if (snapshot.ledger_ids !== undefined) stringArray(snapshot.ledger_ids);
}
function decodeFinding(value: unknown): void {
	const finding = exactObject(value, ["id"], ["lens", "location", "severity", "claim", "proof_refs"]);
	requiredString(finding.id);
	if (finding.lens !== undefined) enumString(finding.lens, ["risk", "resilience", "readability", "reliability"]);
	if (finding.location !== undefined) stringValue(finding.location);
	if (finding.severity !== undefined) enumString(finding.severity, ["BLOCKER", "CRITICAL", "WARNING", "SUGGESTION"]);
	if (finding.claim !== undefined) stringValue(finding.claim);
	if (finding.proof_refs !== undefined) stringArray(finding.proof_refs);
}
function decodeLensResult(value: unknown): void {
	const result = exactObject(value, ["lens", "findings", "evidence", "result_hash"]);
	enumString(result.lens, NATIVE_REVIEW_LENS);
	if (!Array.isArray(result.findings)) throw new Error("invalid lens findings");
	for (const finding of result.findings) decodeFinding(finding);
	stringArray(result.evidence); requiredString(result.result_hash);
}
function decodeFindingEvidence(value: unknown): void {
	const evidence = exactObject(value, ["finding_id", "class", "proof"], ["causal_disposition"]);
	requiredString(evidence.finding_id); enumString(evidence.class, ["deterministic", "inferential", "insufficient"]); requiredString(evidence.proof);
	if (evidence.causal_disposition !== undefined) enumString(evidence.causal_disposition, ["introduced", "behavior-activated", "worsened", "pre-existing", "base-only", "unknown"]);
}
function decodeValidationCheck(value: unknown): void {
	const check = exactObject(value, ["evidence_hash", "fix_delta_hash", "passed"]);
	requiredString(check.evidence_hash); requiredString(check.fix_delta_hash); booleanValue(check.passed);
}
function decodeReviewTransaction(value: unknown): void {
	const transaction = exactObject(
		value,
		["schema", "lineage_id", "mode", "generation", "state", "snapshot", "base_tree", "paths_digest", "initial_review_tree", "final_candidate_tree", "fix_delta_hash", "policy_hash", "ledger_hash", "ledger_findings_hash", "evidence_hash", "judge_proofs", "counters", "findings", "classifications", "outcomes", "fix_finding_ids", "pending_refuter_ids", "fix_caused_findings", "follow_ups"],
		["genesis_paths", "invalidation_reason", "judge_proof_hash", "judge_agreement_hash", "release", "failed_evidence_revision", "original_criteria", "correction_regression", "risk_level", "selected_lenses", "lens_results", "original_changed_lines", "correction_budget", "proposed_correction_lines", "actual_correction_lines"],
	);
	if (transaction.schema !== "gentle-ai.review-transaction/v1") throw new Error("invalid review transaction schema");
	requiredString(transaction.lineage_id); enumString(transaction.mode, ["ordinary_4r", "ordinary_bounded", "judgment_day"]); nonNegativeInteger(transaction.generation);
	enumString(transaction.state, ["unreviewed", "reviewing", "judges_confirmed", "findings_frozen", "evidence_classified", "fix_required", "fixing", "fix_validating", "ready_final_verification", "final_verifying", "approved", "escalated", "invalidated"]);
	decodeSnapshot(transaction.snapshot);
	for (const field of ["base_tree", "paths_digest", "initial_review_tree", "final_candidate_tree", "fix_delta_hash", "policy_hash", "ledger_hash", "ledger_findings_hash", "evidence_hash"]) stringValue(transaction[field]);
	for (const field of ["genesis_paths", "fix_finding_ids", "pending_refuter_ids"]) if (transaction[field] !== undefined) stringArray(transaction[field]);
	for (const field of ["invalidation_reason", "judge_proof_hash", "judge_agreement_hash", "failed_evidence_revision"]) if (transaction[field] !== undefined) requiredString(transaction[field]);
	if (!Array.isArray(transaction.judge_proofs)) throw new Error("invalid judge proofs");
	for (const proof of transaction.judge_proofs) {
		const row = exactObject(proof, ["judge_id", "execution_hash", "result_hash", "blind", "confirmed"]);
		requiredString(row.judge_id); requiredString(row.execution_hash); requiredString(row.result_hash); booleanValue(row.blind); booleanValue(row.confirmed);
	}
	const counters = exactObject(transaction.counters, ["full_reviews", "refuter_batches", "fix_batches", "scoped_fix_validations", "final_verifications", "fix_rounds", "scoped_rejudgments", "judge_executions"], ["risk_executions", "resilience_executions", "readability_executions", "reliability_executions"]);
	for (const value of Object.values(counters)) nonNegativeInteger(value);
	for (const field of ["findings", "fix_caused_findings"]) {
		if (!Array.isArray(transaction[field])) throw new Error("invalid transaction findings");
		for (const finding of transaction[field]) decodeFinding(finding);
	}
	const classifications = object(transaction.classifications);
	for (const evidence of Object.values(classifications)) decodeFindingEvidence(evidence);
	const outcomes = object(transaction.outcomes);
	for (const outcome of Object.values(outcomes)) enumString(outcome, ["corroborated", "refuted", "inconclusive", "info"]);
	if (!Array.isArray(transaction.follow_ups)) throw new Error("invalid follow-ups");
	for (const followUp of transaction.follow_ups) {
		const row = exactObject(followUp, ["observation", "proof_refs"]);
		requiredString(row.observation); stringArray(row.proof_refs);
	}
	for (const field of ["original_criteria", "correction_regression"]) if (transaction[field] !== undefined) decodeValidationCheck(transaction[field]);
	if (transaction.release !== undefined) decodeReleaseEvidence(transaction.release);
	if (transaction.risk_level !== undefined) enumString(transaction.risk_level, NATIVE_RISK_LEVEL);
	if (transaction.selected_lenses !== undefined) for (const lens of stringArray(transaction.selected_lenses)) enumString(lens, NATIVE_REVIEW_LENS);
	if (transaction.lens_results !== undefined) {
		if (!Array.isArray(transaction.lens_results)) throw new Error("invalid lens results");
		for (const result of transaction.lens_results) decodeLensResult(result);
	}
	for (const field of ["original_changed_lines", "correction_budget", "proposed_correction_lines", "actual_correction_lines"]) if (transaction[field] !== undefined) nonNegativeInteger(transaction[field]);
}
function hasCanonicalSelectedLenses(riskLevel: string, selectedLenses: readonly string[]): boolean {
	if (new Set(selectedLenses).size !== selectedLenses.length) return false;
	if (riskLevel === "low") return selectedLenses.length === 0;
	if (riskLevel === "medium") return selectedLenses.length === 1;
	return selectedLenses.length === NATIVE_REVIEW_LENS.length
		&& NATIVE_REVIEW_LENS.every((lens) => selectedLenses.includes(lens));
}

function hasValidLensesRequired(action: NativeStartAction, state: string, riskLevel: string, lensesRequired: boolean): boolean {
	if (riskLevel === "low") return !lensesRequired;
	if (action === NATIVE_START_ACTION.CREATED) return state === "reviewing" && lensesRequired;
	if (action === NATIVE_START_ACTION.RESUMED) return !lensesRequired || state === "reviewing";
	return !lensesRequired;
}

function nativeError(code: NativeReviewErrorCode, operation: NativeReviewOperation, mutating: boolean, message: string, result?: ExecFileResult, launchAttempted = true, auditRecord?: Record<string, unknown>, maxBufferBytes?: number): NativeReviewCliError {
	return new NativeReviewCliError(code, operation, launchAttempted, mutating, message, nativeProcessDiagnostics(operation, code, result, maxBufferBytes), auditRecord);
}

interface NativeJsonExecution {
	body: Record<string, unknown>;
	exitCode: number;
	process: ExecFileResult;
}

const NATIVE_SDD_DEPENDENCIES = ["proposal", "specs", "design", "tasks", "apply", "verify", "archive"] as const;
const NATIVE_SDD_INSTRUCTION_PHASES = ["apply", "verify", "remediate", "archive"] as const;
const NATIVE_SDD_NEXT_RECOMMENDATIONS = ["apply", "verify", "remediate", "archive", "archived", "resolve-blockers", "sdd-new", "select-change", "propose", "spec", "design", "tasks"] as const;
const NATIVE_SDD_DEPENDENCY_STATES = ["blocked", "ready", "all_done"] as const;

/** 严格校验原生 v2 契约，同时保留其完整记录。 */
export function decodeNativeSddStatusV2(value: unknown, request: Pick<NativeSddStatusRequest, "changeName" | "workspaceRoot">): NativeSddStatusV2 {
	const status = object(value);
	if (status.schemaName !== "gentle-ai.sdd-status" || status.schemaVersion !== 2) throw new Error("wrong native SDD status schema");
	if ((request.changeName !== undefined && status.changeName !== request.changeName) || (status.changeName !== null && !isCanonicalProcessString(status.changeName))) throw new Error("native SDD status change identity mismatch");
	const artifactStore = enumString(status.artifactStore, ["openspec", "engram", "hybrid", "none"]);
	const planningHome = object(status.planningHome);
	if (planningHome.mode !== "repo-local" || !isCanonicalProcessString(planningHome.path)) throw new Error("invalid native SDD planning home");
	const expectedOpenSpecHome = join(request.workspaceRoot, "openspec");
	if (planningHome.path !== expectedOpenSpecHome && !((artifactStore === "engram" || artifactStore === "hybrid") && planningHome.path === "engram:sdd")) throw new Error("native SDD planning home escaped its workspace");
	if (status.changeRoot !== null && !isCanonicalProcessString(status.changeRoot)) throw new Error("invalid native SDD change root");
	const actionContext = object(status.actionContext);
	if (actionContext.mode !== "repo-local" || actionContext.workspaceRoot !== request.workspaceRoot || !isCanonicalProcessString(actionContext.workspaceRoot)) throw new Error("native SDD status workspace root mismatch");
	const allowedEditRoots = stringArray(actionContext.allowedEditRoots);
	if (!allowedEditRoots.includes(request.workspaceRoot) || allowedEditRoots.some((root) => !isAbsolute(root) || root !== join(root))) throw new Error("invalid native SDD allowed edit roots");
	const dependencies = object(status.dependencies);
	for (const phase of NATIVE_SDD_DEPENDENCIES) {
		if (enumString(dependencies[phase], NATIVE_SDD_DEPENDENCY_STATES) !== dependencies[phase]) throw new Error("invalid native SDD dependency");
	}
	if (Object.keys(dependencies).length !== NATIVE_SDD_DEPENDENCIES.length) throw new Error("native SDD dependencies have an unsupported shape");
	if (status.instructions !== undefined) throw new Error("native SDD status uses phaseInstructions, not instructions");
	if (status.phaseInstructions !== undefined) {
		const instructions = object(status.phaseInstructions);
		for (const phase of NATIVE_SDD_INSTRUCTION_PHASES) stringArray(instructions[phase]);
		if (Object.keys(instructions).length !== NATIVE_SDD_INSTRUCTION_PHASES.length) throw new Error("native SDD instructions have an unsupported shape");
	}
	if (status.nextRecommended === "remediate" || status.remediationState !== undefined) {
		const remediation = object(status.remediationState);
		if (typeof remediation.required !== "boolean" || typeof remediation.complete !== "boolean" || typeof remediation.failedEvidenceRevision !== "string" || (remediation.failedEvidenceRevision !== "" && !/^sha256:[0-9a-f]{64}$/.test(remediation.failedEvidenceRevision)) || (status.nextRecommended === "remediate" && (!remediation.required || remediation.complete || !remediation.failedEvidenceRevision))) throw new Error("Invalid native remediation state");
	}
	stringArray(status.blockedReasons);
	enumString(status.nextRecommended, NATIVE_SDD_NEXT_RECOMMENDATIONS);
	return status as NativeSddStatusV2;
}

export function nativeReviewAbandonAuthorization(request: Pick<NativeReviewAbandonRequest, "lineage" | "expectedRevision" | "snapshotIdentity" | "capturedLensResults" | "findingsPresent" | "actor" | "reason">): string {
	// gentle-ai 0ed9225f 从被弃工作摘要中移除了证据记录，因此原生 v2 门
	// 校验精确的八行绑定（schema、lineage、revision、snapshot_identity、
	// reason、captured_lens_results、findings_present、actor）——没有需要
	// 派生或中继的 evidence_records_present 行。
	return [
		"gentle-ai.review-abandon-authorization/v2",
		`lineage=${request.lineage}`,
		`revision=${request.expectedRevision}`,
		`snapshot_identity=${request.snapshotIdentity}`,
		`reason=${request.reason}`,
		`captured_lens_results=${request.capturedLensResults.join(",")}`,
		`findings_present=${request.findingsPresent}`,
		`actor=${request.actor.trim()}`,
	].join("\n");
}

export function nativeReviewRecoverAuthorization(request: Pick<NativeReviewRecoverRequest, "predecessorLineage" | "expectedPredecessorRevision" | "actor" | "reason"> & { targetIdentity: string }): string {
	return [
		"gentle-ai.review-recovery-authorization/v1",
		`predecessor_lineage=${request.predecessorLineage}`,
		`predecessor_revision=${request.expectedPredecessorRevision}`,
		`target_identity=${request.targetIdentity}`,
		`actor=${request.actor.trim()}`,
		`reason=${request.reason.trim()}`,
	].join("\n");
}

export function nativeReviewReconcileAuthorization(request: Pick<NativeReviewReconcileAuthorityRequest, "predecessorLineage" | "expectedPredecessorRevision" | "successorLineage" | "expectedSuccessorRevision" | "actor" | "reason" | "anomalies">): string {
	return [
		"gentle-ai.review-reconcile-authorization/v1",
		`predecessor_lineage=${request.predecessorLineage}`,
		`predecessor_revision=${request.expectedPredecessorRevision}`,
		`successor_lineage=${request.successorLineage}`,
		`successor_revision=${request.expectedSuccessorRevision}`,
		`actor=${request.actor}`,
		`reason=${request.reason}`,
		...(request.anomalies === NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED ? [`anomalies=${request.anomalies}`] : []),
	].join("\n");
}

export class NativeReviewIntegrationError extends Error {
	readonly failureEnvelope: ReviewFailureV2;
	readonly mutationOutcome: ReviewFailureV2["mutationOutcome"];
	readonly nextAction: string;
	readonly launchAttempted = true;
	constructor(failure: ReviewFailureV2) {
		super(failure.message);
		this.name = "NativeReviewIntegrationError";
		this.failureEnvelope = failure;
		this.mutationOutcome = failure.mutationOutcome;
		this.nextAction = failure.nextAction;
	}
}

// 当协商 START 应答的是一个同意问题（固定线上的 `consent/v2`，
// gentle-ai >= 2.3.0 的 `consent/v3`；action 为 “consent_required”）
// 而不是 `start/v3` 时抛出。提供方尚未冻结任何权威：Pi 必须中继这个
// 完整的候选作用域问题，且只能通过封套携带的确切调用之一作答。
export class NativeReviewConsentRequiredError extends Error {
	readonly consent: ReviewConsentEnvelope;
	readonly launchAttempted = true;
	readonly mutationOutcome = "none";
	constructor(consent: ReviewConsentEnvelope) {
		super(consent.headline);
		this.name = "NativeReviewConsentRequiredError";
		this.consent = consent;
	}
}

// 当提供方签发的同意调用不再匹配 Pi 正在应答的绑定时抛出。这些守卫
// 全部在启动提供方之前运行，因此失败是本地的且未变更任何内容。它
// 携带自己的身份正是为了让调用方绝不把它上报为提供方故障：这里一个
// 不透明的 `native-operation-failed` 曾让 issue #247 去追查一个 Pi 实际
// 转发了的缺失 `--cwd`。
export class NativeReviewConsentBindingError extends Error {
	readonly reason: string;
	readonly launchAttempted = false;
	readonly mutationOutcome = "none";
	constructor(reason: string, message: string) {
		super(message);
		this.name = "NativeReviewConsentBindingError";
		this.reason = reason;
	}
}

function splitNativeConsentInvocation(invocation: string): readonly string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;
	let started = false;
	const source = invocation.trim();
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index]!;
		if (escaping) {
			current += character;
			escaping = false;
			started = true;
			continue;
		}
		// 提供方调用不是 shell 命令。逐字保留每个路径反斜杠，包括带引号
		// 的 UNC 与盘符根路径。引号之外，只有后随空白的反斜杠才并入含
		// 空白的词元。
		const next = source[index + 1];
		if (character === "\\" && quote === undefined && next !== undefined && /\s/.test(next)) {
			escaping = true;
			started = true;
			continue;
		}
		if (quote !== undefined) {
			if (character === quote) quote = undefined;
			else current += character;
			started = true;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			started = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (started) {
				words.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		current += character;
		started = true;
	}
	if (quote !== undefined || escaping) throw new TypeError("Native consent invocation has invalid quoting");
	if (started) words.push(current);
	return words;
}

function exactConsentOption(arguments_: readonly string[], name: string): string {
	const values: string[] = [];
	for (let index = 0; index < arguments_.length; index += 1) {
		const token = arguments_[index]!;
		if (token === name) {
			const value = arguments_[index + 1];
			if (value === undefined) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", `Native consent invocation ${name} is missing its value`);
			values.push(value);
			index += 1;
		} else if (token.startsWith(`${name}=`)) values.push(token.slice(name.length + 1));
	}
	if (values.length !== 1) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", `Native consent invocation requires exactly one ${name}`);
	return values[0]!;
}

// 只有当每条精确的提供方重放路径都恰好携带一个 `--agent pi` 选项时，
// Pi 同意封套才绑定到 Pi。仅凭外层封套的 agent 无法绑定被省略、内嵌、
// 重复或冲突的调用。
function validatePiConsentChoiceAgentBindings(consent: ReviewConsentEnvelope): void {
	if (!("agent" in consent) || consent.agent !== "pi") return;
	for (const choice of consent.choices) {
		const arguments_ = splitNativeConsentInvocation(choice.invocation).slice(1);
		if (exactConsentOption(arguments_, "--agent") !== "pi") {
			throw new NativeReviewConsentBindingError("consent-invocation-agent-changed", "Native Pi consent invocation agent binding changed");
		}
	}
}

function optionalConsentLineageOption(arguments_: readonly string[]): string | undefined {
	const values: string[] = [];
	for (let index = 0; index < arguments_.length; index += 1) {
		const token = arguments_[index]!;
		if (token === "--lineage") {
			const value = arguments_[index + 1];
			if (value === undefined || value.startsWith("--")) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", "Native consent invocation --lineage is missing its value");
			values.push(value);
			index += 1;
		} else if (token.startsWith("--lineage=")) values.push(token.slice("--lineage=".length));
	}
	if (values.length > 1) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", "Native consent invocation permits at most one --lineage");
	if (values.length === 0) return undefined;
	const lineageId = values[0]!;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(lineageId)) throw new NativeReviewConsentBindingError("consent-invocation-option-invalid", "Native consent invocation --lineage is malformed");
	return lineageId;
}

interface ConsentInvocation {
	arguments_: readonly string[];
	lineageId?: string;
}

export function consentInvocationArguments(request: NativeReviewConsentAnswerRequest): ConsentInvocation {
	validatePiConsentChoiceAgentBindings(request.consent);
	const choice = request.consent.choices.find((candidate) => candidate.answer === request.answer);
	if (choice === undefined) throw new NativeReviewConsentBindingError("consent-answer-unknown", "Native consent answer must be granted or declined");
	const words = splitNativeConsentInvocation(choice.invocation);
	if (words[0] !== "gentle-ai" || words[1] !== "review" || words[2] !== "start") throw new NativeReviewConsentBindingError("consent-invocation-not-start", "Native consent invocation is not a provider review START");
	const arguments_ = words.slice(1);
	if (exactConsentOption(arguments_, "--contract") !== REVIEW_INTEGRATION_CONTRACT) throw new NativeReviewConsentBindingError("consent-invocation-contract-changed", "Native consent invocation contract changed");
	const providerCwd = exactConsentOption(arguments_, "--cwd");
	const requestedCwd = normalizeNativeReviewCwd(request.cwd);
	if (normalizeNativeReviewCwd(providerCwd) !== requestedCwd) throw new NativeReviewConsentBindingError("consent-invocation-cwd-changed", "Native consent invocation repository binding changed");
	if (exactConsentOption(arguments_, "--target") !== request.consent.targetIdentity) throw new NativeReviewConsentBindingError("consent-invocation-target-changed", "Native consent invocation target binding changed");
	if (exactConsentOption(arguments_, "--projection") !== request.consent.projection) throw new NativeReviewConsentBindingError("consent-invocation-projection-changed", "Native consent invocation projection binding changed");
	const lineageId = optionalConsentLineageOption(arguments_);
	if (exactConsentOption(arguments_, "--consent") !== request.answer || arguments_.at(-1) !== request.answer) throw new NativeReviewConsentBindingError("consent-invocation-answer-changed", "Native consent invocation answer binding changed");
	return { arguments_, ...(lineageId === undefined ? {} : { lineageId }) };
}

function decodeDeclinedConsentStart(value: unknown, expected: NativeReviewConsentAnswerRequest): NativeReviewConsentDeclinedResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Native declined consent result must be an object");
	const body = value as Record<string, unknown>;
	if (body.operation !== "review/start" || body.action !== "declined" || body.consent !== "declined_this_candidate") throw new TypeError("Native declined consent result has an invalid identity");
	if (body.target_identity !== expected.consent.targetIdentity || body.projection !== expected.consent.projection || body.risk_level !== expected.consent.riskLevel) throw new TypeError("Native declined consent result target binding changed");
	if (body.lenses_required !== false || !Array.isArray(body.selected_lenses) || body.selected_lenses.length !== 0 || !Array.isArray(body.lens_bindings) || body.lens_bindings.length !== 0) throw new TypeError("Native declined consent result must create no review authority");
	if (typeof body.changed_files !== "number" || !Number.isSafeInteger(body.changed_files) || body.changed_files < 0 || typeof body.changed_lines !== "number" || !Number.isSafeInteger(body.changed_lines) || body.changed_lines < 0) throw new TypeError("Native declined consent result has invalid change counts");
	if (body.lineage_id !== "" || body.state !== "" || body.correction_budget !== 0) throw new TypeError("Native declined consent result cannot carry review authority");
	return {
		kind: "declined",
		targetIdentity: expected.consent.targetIdentity,
		projection: expected.consent.projection,
		riskLevel: expected.consent.riskLevel,
		changedFiles: body.changed_files,
		changedLines: body.changed_lines,
		consent: "declined_this_candidate",
		raw: body,
	};
}

interface NegotiatedExecution {
	body: Record<string, unknown>;
	exitCode: number;
	// 仅对零退出、无正文且未打印任何内容的操作为真：固定版本的静默确认
	// 焚毁。绝不为它合成正文。
	silent?: true;
}

export interface NativeReviewAdmittedResultManifest {
	readonly schema: string;
	readonly subjectHash: string;
	readonly admissionDecision: string;
	readonly lens?: string;
	readonly path?: string;
	readonly reference?: string;
}
function decodeNativeAdmittedResultManifest(value: unknown): NativeReviewAdmittedResultManifest {
	// 受理答案经精确身份的前向解码器路由（解码器新鲜度纪律）：完整的
	// 活动封套——身份常量、绑定字段与唯一定位符规则——在任何内容交给
	// FINALIZE 之前校验，gentle-ai main 新增的未知字段被拒绝而不是被
	// 静默丢弃。
	const artifact = decodeReviewResultArtifactV2(value);
	return Object.freeze({
		schema: artifact.schema,
		subjectHash: artifact.subjectHash,
		admissionDecision: artifact.admissionDecision,
		lens: artifact.lens,
		...(artifact.path === undefined ? {} : { path: artifact.path }),
		...(artifact.reference === undefined ? {} : { reference: artifact.reference }),
	});
}

// gentle-pi#311 P4-roles：一次已执行提供方角色向量的严格确认。不可变
// 的裁决字节存放在 Go 持有的紧凑存储槽位中；本封套只点名捕获所证明
// 的绑定，超出该确切形态之外的任何内容都被拒绝。
function decodeNativeProviderRoleCaptureArtifact(value: unknown): NativeReviewProviderRoleCaptureArtifact {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("native provider role capture artifact must be an object");
	const body = value as Record<string, unknown>;
	const allowed = new Set(["schema", "lineage_id", "target_identity", "role", "captured"]);
	for (const key of Object.keys(body)) if (!allowed.has(key)) throw new TypeError(`native provider role capture artifact carries unexpected key ${key}`);
	const text = (key: string): string => {
		const found = body[key];
		if (typeof found !== "string" || found.trim() !== found || found.length === 0) throw new TypeError(`native provider role capture artifact ${key} must be a non-empty trimmed string`);
		return found;
	};
	if (text("schema") !== NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_SCHEMA) throw new TypeError(`native provider role capture artifact schema must be ${NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_SCHEMA}`);
	const role = text("role");
	if (role !== "refuter" && role !== "targeted-validator") throw new TypeError(`native provider role capture artifact role must be refuter or targeted-validator, received ${role}`);
	if (body.captured !== true) throw new TypeError("native provider role capture artifact must report captured: true");
	return Object.freeze({
		schema: NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_SCHEMA,
		lineageId: text("lineage_id"),
		targetIdentity: text("target_identity"),
		role,
		captured: true,
	});
}

// gentle-pi#638：Go 为某个不可达成槽位打印的已记录声明。封闭键集、
// 精确的 schema 身份，以及 Go 自己从请求哈希解析出的评审视角——宿主
// 绝不主张哪个评审视角失败，只读回提供方绑定的那一个。
function decodeNativeUnachievableLensCaptureArtifact(value: unknown): NativeReviewUnachievableLensCaptureArtifact {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("native unachievable lens capture artifact must be an object");
	const body = value as Record<string, unknown>;
	const allowed = new Set(["schema", "lineage_id", "target_identity", "lens", "selected_order", "reason", "recorded"]);
	for (const key of Object.keys(body)) if (!allowed.has(key)) throw new TypeError(`native unachievable lens capture artifact carries unexpected key ${key}`);
	const text = (key: string): string => {
		const found = body[key];
		if (typeof found !== "string" || found.trim() !== found || found.length === 0) throw new TypeError(`native unachievable lens capture artifact ${key} must be a non-empty trimmed string`);
		return found;
	};
	if (text("schema") !== NATIVE_REVIEW_UNACHIEVABLE_LENS_CAPTURE_SCHEMA) throw new TypeError(`native unachievable lens capture artifact schema must be ${NATIVE_REVIEW_UNACHIEVABLE_LENS_CAPTURE_SCHEMA}`);
	if (typeof body.selected_order !== "number" || !Number.isSafeInteger(body.selected_order) || body.selected_order < 0) throw new TypeError("native unachievable lens capture artifact selected_order must be a non-negative integer");
	if (body.recorded !== true) throw new TypeError("native unachievable lens capture artifact must report recorded: true");
	return Object.freeze({ schema: NATIVE_REVIEW_UNACHIEVABLE_LENS_CAPTURE_SCHEMA, lineageId: text("lineage_id"), targetIdentity: text("target_identity"), lens: text("lens"), selectedOrder: body.selected_order, reason: text("reason"), recorded: true });
}

// D7 片段 4：保守失败的桩类已删除。进程内适配器
// （lib/jero-authority-cli.ts）是唯一的默认 CLI；它不提供的操作就是
// 不存在，调用方按能力关闭（调用点邻接门）守卫，绝不做静默的传输
// 回退。

