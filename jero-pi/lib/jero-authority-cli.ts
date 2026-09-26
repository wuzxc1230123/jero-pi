import { homedir } from "node:os";
import { join } from "node:path";
import type { NativeReviewCli, NativeReviewModeRequest, NativeReviewModeResult, NativeReviewAssessRequest, NativeSddAcquireRequest, NativeSddAttemptResult, NativeSddSettleRequest, NativeSddStatusRequest, NativeSddStatusV2, NativeStartRequest, NativeStartResult, NativeReviewConsentAnswerRequest, NativeReviewConsentAnswerResult, NativeReviewAbandonRequest, NativeReviewReclaimRequest, NativeReviewRecoverRequest, NativeReviewReconcileAuthorityRequest, NativeReviewRecoveryResult, NativeReviewCorrectionPlanCaptureRequest, NativeReviewAcknowledgeApprovedRequest, NativeReviewAcknowledgeApprovedOutcome , NativeReviewProviderRoleCaptureOutcome } from "./authority/client-contract.ts";
import { NativeReviewConsentRequiredError, REVIEW_EMPTY_CANDIDATE_HINT, consentInvocationArguments, nativeRiskEvidencePhrases, nativeUntrackedSelection, isCanonicalProcessString, NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_SCHEMA, type NativeReviewProviderRoleCaptureRequest } from "./authority/client-contract.ts";
import type { ReviewLastEventClosureV1, ReviewStatusV3 } from "./authority/wire-contract.ts";
import { decodeReviewLastEventClosureV1 } from "./authority/wire-contract.ts";
import { prepareReviewHostRelaySlot, submitReviewHostRelayPreparedResult, type ReviewHostRelayRequest, type ReviewHostRelayPreparationRunner } from "./review-host-relay.ts";
import type { ReviewAssessmentV1 } from "./review-risk-assessment.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "./authority/review.ts";
import { jeroSddStatusV1, type JeroSddStatusV2 } from "./authority/sdd-status.ts";
import { jeroSddContinueV1 } from "./authority/sdd-continue.ts";
import { reviewStatusV1 } from "./authority/status.ts";
import { reviewStartV1, type JeroReviewStartResultV1 } from "./authority/start.ts";
import { deriveJeroReviewSnapshotV1, jeroReviewPolicyHashV1 } from "./authority/snapshots.ts";
import { projectJeroClosureToWireV1, projectJeroConsentEnvelopeV1, projectJeroStatusToWireV1 } from "./authority/wire.ts";
import { getJeroReviewModeV1, setJeroReviewModeV1 } from "./authority/mode.ts";
import { assessJeroReviewRiskV1 } from "./authority/risk-assess.ts";
import { acquireJeroSddAttemptV1, settleJeroSddAttemptV1 } from "./authority/sdd-attempt.ts";
import { reviewAcknowledgeV1 } from "./authority/acknowledge.ts";
import { deriveJeroFixApplicationV1 } from "./authority/fix-application.ts";
import { renderJeroProviderRoleSlotForRelayV1, admitJeroProviderRoleResultForRelayV1, type JeroProviderRoleV1 } from "./authority/capture-relay.ts";
import { reviewFinalizeV1 } from "./authority/finalize.ts";
import { abandonJeroLineageV1, reclaimJeroAuthorityV1, recoverJeroLineageV1, reconcileJeroAuthorityV1, type JeroMaintenanceResultV1 } from "./authority/maintenance.ts";
import { buildJeroLastEventClosureV1 } from "./authority/closures.ts";

// P4d：NativeReviewCli 表面之上的进程内权威适配器。
// 此处已服务：SDD 投影对（P4c）、评审 STATUS 读取路径
// (targetStatus)、RDD 模式对、只读风险评估、SDD
// 尝试对、START 对（P4d-e：直接启动加同意
// 仪式，封套在 wire 侧铸造，应答重新冻结绑定的
// 候选），以及自 P4d-g 起的修正计划捕获、acknowledge
// 销毁与维护四联操作。仍在保守失败的 P1 桩上：提供方
// 角色向量（refuter/validation 中继执行 - 见
// _tools/p4-f-g-capture-maintenance-analysis.md Q-B）与不可达
// 评审视角声明（Q-C：权威侧无写操作）—— 每个已服务方法
// 都是类型化联合进、wire 记录出，权威拒绝以
// 携带类型化代码的错误浮出。

// 结构化重投影替代旧的双盲强转：JeroSddStatusV2 与 NativeSddStatusV2 的
// 差异只在索引签名的严格度上（wire 类型以 Record<string, unknown> 放宽），
// 逐字段展开让编译器持续检查这两个形状不再悄悄漂移。
function projectV2(status: JeroSddStatusV2): NativeSddStatusV2 {
	return {
		...status,
		planningHome: { ...status.planningHome },
		actionContext: { ...status.actionContext, allowedEditRoots: [...status.actionContext.allowedEditRoots] },
		dependencies: { ...status.dependencies },
		blockedReasons: [...status.blockedReasons],
	};
}

function contextOrThrow(cwd: string): JeroAuthorityContextV1 {
	const resolution = resolveJeroAuthorityContextV1(cwd, { globalReviewModePath: globalReviewModePathFromEnv() });
	if (resolution.kind !== "ok") throw new Error(`authority-unavailable: the jero authority refused to resolve ${cwd}: ${resolution.code}${resolution.detail === undefined ? "" : ` (${resolution.detail})`}`);
	return resolution.context;
}

// 权威从不读取环境（边界 §9.1）；这个适配器是
// 宿主的 JERO_PI_CONFIG_HOME 覆盖进入的接缝，因此 RDD 模式
// 读取看到的全局记录与所有其他 jero-pi 配置消费者一致。
function globalReviewModePathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.JERO_PI_CONFIG_HOME?.trim();
	const home = override && override !== "" ? override : join(homedir(), ".pi", "jero");
	return join(home, "review-mode.json");
}

function refusalDetail(kind: string, code: string, detail?: string): string {
	return `authority-unavailable: ${kind} refused: ${code}${detail === undefined ? "" : ` (${detail})`}`;
}

export function createJeroAuthoritySddCli(): Pick<NativeReviewCli, "sddStatus" | "sddContinue"> {
	return {
		async sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusV2> {
			const result = jeroSddStatusV1(contextOrThrow(request.workspaceRoot), { changeName: request.changeName, workspaceRoot: request.workspaceRoot });
			if (result.kind === "refused") throw new Error(refusalDetail("sdd status", result.code, result.detail));
			return projectV2(result.status);
		},
		async sddContinue(request: NativeSddStatusRequest): Promise<NativeSddStatusV2> {
			if (request.changeName === undefined || request.changeName.trim() === "") throw new Error("authority-unavailable: SDD continuation requires an exact selected change");
			const result = jeroSddContinueV1(contextOrThrow(request.workspaceRoot), { changeName: request.changeName, workspaceRoot: request.workspaceRoot });
			if (result.kind === "refused") throw new Error(refusalDetail("sdd continue", result.code, result.detail));
			return projectV2(result.status);
		},
	};
}

type JeroStartAuthorityArmV1 = Extract<JeroReviewStartResultV1, { lineage_id: string }>;

function isStartAuthorityArmV1(result: JeroReviewStartResultV1): result is JeroStartAuthorityArmV1 {
	return result.kind === "created" || result.kind === "resumed" || result.kind === "replayed" || result.kind === "closed";
}

// 镜像旧客户端的快速失败请求纪律（native-review-cli
// 对等）：配对与形状错误是在触碰权威之前抛出的 TypeError，
// 因此绝不会有半验证的请求冻结状态。
function assertStartRequestV1(request: NativeStartRequest): void {
	if (request.baseRef !== undefined && !isCanonicalProcessString(request.baseRef)) throw new TypeError("Native START baseRef must be a non-empty, trimmed, NUL-free string");
	if (request.baseRef !== undefined && request.committedOnly !== true) throw new TypeError("Native START baseRef requires explicit committedOnly acknowledgement");
	if (request.baseRef === undefined && request.committedOnly !== undefined) throw new TypeError("Native START committedOnly requires an explicit baseRef");
	if (request.targetIdentity !== undefined && !/^sha256:[0-9a-f]{64}$/.test(request.targetIdentity)) throw new TypeError("Native START targetIdentity must be a canonical sha256 identity");
	nativeUntrackedSelection(request);
}

function projectStartOutcomeV1(result: JeroReviewStartResultV1, request: Pick<NativeStartRequest, "cwd" | "baseRef" | "untrackedScope" | "expectedUntrackedInventory" | "intendedUntracked">): NativeStartResult {
	if (result.kind === "refused") throw new Error(refusalDetail("review start", result.code, result.detail));
	if (result.kind === "consent_required") {
		// wire 封套是控制器的待定注册表、摘要绑定与应答路径
		// 唯一能消费的表面；在 wire 侧铸造它
		// 让权威保持无 UI 文案（9.1 边界）。
		throw new NativeReviewConsentRequiredError(projectJeroConsentEnvelopeV1(result, request));
	}
	if (result.kind === "declined") throw new Error("authority-unavailable: review start returned a declined answer on a consent-less request");
	if (result.kind === "blocked-scope-action") {
		return {
			lineageId: "",
			state: "unreviewed",
			riskLevel: "",
			selectedLenses: [],
			changedFiles: 0,
			changedLines: 0,
			correctionBudget: 0,
			action: "blocked-scope-action",
			lensesRequired: false,
			hint: `${result.reason} (fresh intended-untracked inventory: ${result.expected_untracked_inventory})`,
		};
	}
	const evidence = nativeRiskEvidencePhrases(result.risk_level, result.risk_reasons);
	return {
		lineageId: result.lineage_id,
		state: result.state,
		riskLevel: result.risk_level,
		selectedLenses: [...result.selected_lenses],
		changedFiles: result.changed_files,
		changedLines: result.changed_lines,
		correctionBudget: result.correction_budget,
		action: result.kind,
		lensesRequired: result.lenses_required,
		riskReasons: result.risk_reasons.map((reason) => ({ ...reason })),
		...(evidence.length === 0 ? {} : { riskEvidence: [...evidence] }),
		// 旧客户端对等：只重建空候选恢复提示；
		// committed-only 启动报告零变更是真实答案，
		// 不是恢复指引。
		...(result.changed_files === 0 && request.baseRef === undefined ? { hint: REVIEW_EMPTY_CANDIDATE_HINT } : {}),
	};
}

// 重新解析铸造的调用所内嵌的未跟踪选择，使同意
// 应答重新冻结提问时所针对的确切候选
// （标志形式与 nativeUntrackedSelectionArguments 一致：--flag=value）。
function consentUntrackedSelectionV1(arguments_: readonly string[]): { untrackedScope?: "exclude" | "select"; expectedUntrackedInventory?: string; intendedUntracked?: readonly string[] } {
	let untrackedScope: "exclude" | "select" | undefined;
	let expectedUntrackedInventory: string | undefined;
	const intendedUntracked: string[] = [];
	for (const token of arguments_) {
		if (token.startsWith("--untracked-scope=")) untrackedScope = token.slice("--untracked-scope=".length) === "select" ? "select" : "exclude";
		else if (token.startsWith("--expected-untracked-inventory=")) expectedUntrackedInventory = token.slice("--expected-untracked-inventory=".length);
		else if (token.startsWith("--intended-untracked=")) intendedUntracked.push(token.slice("--intended-untracked=".length));
	}
	if (untrackedScope === undefined) return {};
	return { untrackedScope, expectedUntrackedInventory, intendedUntracked };
}

// P4d-g 共享解析器：销毁向量与修正计划 submission 所携带的
// 提供方签发的 --name=value 绑定令牌。每个标志必须恰好
// 出现一次；伪造或重放的封套会漂移并保守失败。
function exactFlagValueV1(tokens: readonly string[], flag: string): string | undefined {
	const values: string[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (token === `--${flag}`) values.push(tokens[index + 1] ?? "");
		else if (token.startsWith(`--${flag}=`)) values.push(token.slice(flag.length + 3));
	}
	if (values.length > 1) throw new TypeError(`authority-unavailable: ${flag} appears more than once in the provider binding`);
	return values[0];
}

function parseBurnTokensV1(tokens: readonly string[]): { cwd: string; lineage: string; target: string; expectedRevision: string; token: string } {
	const cwd = exactFlagValueV1(tokens, "cwd");
	const lineage = exactFlagValueV1(tokens, "lineage");
	const target = exactFlagValueV1(tokens, "target");
	const expectedRevision = exactFlagValueV1(tokens, "expected-revision");
	const burnToken = exactFlagValueV1(tokens, "token");
	if (cwd === undefined || lineage === undefined || target === undefined || expectedRevision === undefined || burnToken === undefined) {
		throw new TypeError("authority-unavailable: the acknowledge binding must carry cwd, lineage, target, expected-revision, and token");
	}
	return { cwd, lineage, target, expectedRevision, token: burnToken };
}

function assertProviderTokensV1(tokens: readonly string[]): void {
	if (tokens.length === 0) throw new TypeError("authority-unavailable: provider-issued argument tokens are required");
	if (tokens.some((token) => typeof token !== "string" || token.length === 0)) throw new TypeError("authority-unavailable: provider argument tokens must all be non-empty strings");
}

function maintenanceOutcomeV1(result: JeroMaintenanceResultV1, kind: string): NativeReviewRecoveryResult {
	if (result.kind === "refused") throw new Error(refusalDetail(kind, result.code, result.detail));
	return { record: result.auditRecord };
}

/** NativeReviewCli 表面的 P4d 已服务切片。 */
export function createJeroAuthorityReviewCli(dependencies: { providerRoleReviewer?: Parameters<typeof prepareReviewHostRelaySlot>[1] } = {}): Pick<NativeReviewCli, "sddStatus" | "sddContinue" | "targetStatus" | "reviewMode" | "assess" | "sddAttemptAcquire" | "sddAttemptSettle" | "start" | "answerConsent" | "captureCorrectionPlan" | "captureProviderRole" | "abandon" | "reclaim" | "recover" | "reconcileAuthority"> & { acknowledgeApproved?(request: NativeReviewAcknowledgeApprovedRequest): Promise<NativeReviewAcknowledgeApprovedOutcome> } {
	return {
		...createJeroAuthoritySddCli(),
		async targetStatus(request: { cwd: string; projection?: "workspace" | "staged"; baseRef?: string; committedOnly?: boolean; signal?: AbortSignal }): Promise<ReviewStatusV3> {
			const context = contextOrThrow(request.cwd);
			const result = reviewStatusV1(context, {
				cwd: request.cwd,
				...(request.baseRef === undefined ? {} : { baseRef: request.baseRef, committedOnly: true }),
				...(request.projection === undefined ? {} : { projection: request.projection }),
			});
			if (result.kind === "refused") throw new Error(refusalDetail("review status", result.code, result.detail));
			// wire 投影描述符需要权威在内部计算的
			// 实时推导；以相同选项重新推导。
			const derivation = deriveJeroReviewSnapshotV1({
				cwd: request.cwd,
				mode: "ordinary",
				candidate: request.projection === "staged"
					? { kind: "staged" }
					: request.committedOnly === true && request.baseRef !== undefined ? { kind: "base-diff", baseRef: request.baseRef } : { kind: "workspace" },
				policyHash: jeroReviewPolicyHashV1("ordinary"),
			});
			return projectJeroStatusToWireV1(result, derivation);
		},
		async reviewMode(request: NativeReviewModeRequest): Promise<NativeReviewModeResult> {
			const outcome = request.operation === "status"
				? getJeroReviewModeV1(request.cwd, { globalModePath: globalReviewModePathFromEnv() })
				: setJeroReviewModeV1(request.cwd, request.operation === "enable" ? "on" : "off", { globalModePath: globalReviewModePathFromEnv() });
			if (outcome.kind === "refused") throw new Error(refusalDetail("review mode", outcome.code, outcome.detail));
			return outcome.result as unknown as NativeReviewModeResult;
		},
		async assess(request: NativeReviewAssessRequest): Promise<ReviewAssessmentV1> {
			return assessJeroReviewRiskV1({ cwd: request.cwd, ...(request.baseRef === undefined ? {} : { baseRef: request.baseRef, committedOnly: true }) });
		},
		async start(request: NativeStartRequest): Promise<NativeStartResult> {
			assertStartRequestV1(request);
			const result = reviewStartV1(contextOrThrow(request.cwd), {
				cwd: request.cwd,
				...(request.baseRef === undefined ? {} : { baseRef: request.baseRef, committedOnly: true }),
				...(request.lineageId === undefined ? {} : { lineageId: request.lineageId }),
				...(request.targetIdentity === undefined ? {} : { targetIdentity: request.targetIdentity }),
				...(request.projection === undefined ? {} : { projection: request.projection }),
			}, {
				...(request.untrackedScope === undefined ? {} : { untrackedScope: request.untrackedScope }),
				...(request.expectedUntrackedInventory === undefined ? {} : { expectedUntrackedInventory: request.expectedUntrackedInventory }),
				...(request.intendedUntracked === undefined ? {} : { intendedUntracked: request.intendedUntracked }),
				...(request.intendedUntrackedSelection === undefined ? {} : { intendedUntrackedSelection: request.intendedUntrackedSelection }),
			});
			return projectStartOutcomeV1(result, request);
		},
		async answerConsent(request: NativeReviewConsentAnswerRequest): Promise<NativeReviewConsentAnswerResult> {
			// 一次性绑定纪律（agent、contract、cwd、target、
			// projection、answer、至多一个 lineage）由旧客户端
			// 使用的同一解析器强制执行；该调用是铸造的向量，
			// 因此这里的任何漂移都是伪造封套。
			const invocation = consentInvocationArguments(request);
			const result = reviewStartV1(contextOrThrow(request.cwd), {
				cwd: request.cwd,
				targetIdentity: request.consent.targetIdentity,
				projection: request.consent.projection,
				...(invocation.lineageId === undefined ? {} : { lineageId: invocation.lineageId }),
			}, {
				...consentUntrackedSelectionV1(invocation.arguments_),
				consent: request.answer,
			});
			if (result.kind === "declined") {
				return {
					kind: "declined",
					targetIdentity: request.consent.targetIdentity,
					projection: request.consent.projection,
					riskLevel: request.consent.riskLevel,
					changedFiles: request.consent.changedFiles,
					changedLines: request.consent.changedLines,
					consent: "declined_this_candidate",
					raw: request.consent.raw,
				};
			}
			if (isStartAuthorityArmV1(result)) {
				if (result.target_identity !== request.consent.targetIdentity) throw new Error(refusalDetail("consent answer", "identity-mismatch", "the frozen candidate no longer matches the consent target"));
				if (invocation.lineageId !== undefined && result.lineage_id !== invocation.lineageId) throw new Error(refusalDetail("consent answer", "identity-mismatch", "the started lineage does not match the consent binding"));
				return { kind: "started", start: projectStartOutcomeV1(result, { cwd: request.cwd }) };
			}
			// 重新进入闸门的已同意应答（模式翻转、存储
			// 状态在下层变化）是绑定违例，不是新的
			// 提问：封套已被消费过一次。
			throw new Error(refusalDetail("consent answer", result.kind === "refused" ? result.code : result.kind, result.kind === "refused" ? result.detail : "a granted consent answer must start the frozen candidate"));
		},
		async captureCorrectionPlan(request: NativeReviewCorrectionPlanCaptureRequest): Promise<ReviewLastEventClosureV1> {
			assertProviderTokensV1(request.argumentTokens);
			if (!Number.isSafeInteger(request.correctionLines) || request.correctionLines < 1 || request.correctionLines > 200) throw new TypeError("authority-unavailable: correction lines must be a positive integer up to 200");
			const valueIndex = request.argumentTokens.findIndex((token) => token.includes("{{value}}"));
			if (valueIndex < 0 || request.argumentTokens.filter((token) => token.includes("{{value}}")).length !== 1) throw new TypeError("authority-unavailable: the correction-plan submission requires exactly one provider-issued {{value}} token");
			const argumentTokens = request.argumentTokens.map((token, index) => index === valueIndex ? token.replaceAll("{{value}}", String(request.correctionLines)) : token);
			const lineage = exactFlagValueV1(argumentTokens, "lineage");
			const requestHash = exactFlagValueV1(argumentTokens, "request-hash");
			if (lineage === undefined || requestHash === undefined) throw new TypeError("authority-unavailable: the correction-plan binding must carry lineage and request-hash");
			const context = contextOrThrow(request.cwd);
			const result = reviewFinalizeV1(context, { cwd: request.cwd, lineageId: lineage, correction_line_forecast: request.correctionLines });
			if (result.kind === "refused") throw new Error(refusalDetail("correction plan", result.code, result.detail));
			if (result.kind !== "fix_authorized") throw new Error(`authority-unavailable: correction plan capture expected fix_authorized (got ${result.kind})`);
			// 有界编辑搭乘同一捕获：实际修正行是从存活工作树对照冻结评审
			// 树推导的（绝不由调用方声明；finalize 会在隔离存储上
			// 重新验证），因此计划应答落地时工作区已落定，
			// STATUS 随后可以提供针对性的 validator 向量。
			const fixOutcome = deriveJeroFixApplicationV1(context, lineage, request.cwd);
			if (fixOutcome.kind !== "ok") throw new Error(refusalDetail("correction plan", fixOutcome.code === "derivation-failed" ? "authority-unavailable" : fixOutcome.code, fixOutcome.detail));
			const applied = reviewFinalizeV1(context, { cwd: request.cwd, lineageId: lineage, fix_application: fixOutcome.fix });
			if (applied.kind === "refused") throw new Error(refusalDetail("correction plan", applied.code, `the derived fix could not be applied: ${applied.detail ?? ""}`));
			const loaded = context.lineages.load(lineage);
			if (loaded.kind !== "ok") throw new Error(refusalDetail("correction plan", loaded.kind, "the corrected lineage could not be reloaded"));
			const closure = buildJeroLastEventClosureV1({ operation: "review.capture-correction-plan", record: loaded.record, state: "correction_required", cwd: request.cwd, requestHash, correctionLines: request.correctionLines });
			return projectJeroClosureToWireV1(closure) as unknown as ReviewLastEventClosureV1;
		},
		async acknowledgeApproved(request: NativeReviewAcknowledgeApprovedRequest): Promise<NativeReviewAcknowledgeApprovedOutcome> {
			assertProviderTokensV1(request.argumentTokens);
			if (request.argumentTokens.some((token) => token.includes("{{value}}"))) throw new TypeError("authority-unavailable: acknowledge tokens carry no caller-substituted value");
			const parsed = parseBurnTokensV1(request.argumentTokens);
			if (request.binding !== undefined && parsed.lineage !== request.binding.lineageId) throw new Error(refusalDetail("acknowledge", "binding-mismatch", "the burn vector lineage does not match the held STATUS binding"));
			const result = reviewAcknowledgeV1(contextOrThrow(request.cwd), { cwd: request.cwd, lineageId: parsed.lineage, targetIdentity: parsed.target, expectedRevision: parsed.expectedRevision, token: parsed.token });
			if (result.kind === "refused") throw new Error(refusalDetail("acknowledge", result.code, result.detail));
			return {
				schema: "gentle-ai.review-acknowledged/v1",
				operation: "review/acknowledge-approved",
				action: "acknowledged",
				lineageId: result.result.lineage_id,
				targetIdentity: result.result.target_identity,
				consumedRevision: result.result.consumed_revision,
				authority: "burned",
				raw: result.result as unknown as Record<string, unknown>,
			};
		},
		async abandon(request: NativeReviewAbandonRequest): Promise<NativeReviewRecoveryResult> {
			const result = abandonJeroLineageV1(contextOrThrow(request.cwd), {
				lineage: request.lineage, expectedRevision: request.expectedRevision, snapshotIdentity: request.snapshotIdentity,
				capturedLensResults: [...request.capturedLensResults], findingsPresent: request.findingsPresent,
				actor: request.actor, reason: request.reason, maintainerAuthorization: request.maintainerAuthorization,
			});
			return maintenanceOutcomeV1(result, "abandon");
		},
		async reclaim(request: NativeReviewReclaimRequest): Promise<NativeReviewRecoveryResult> {
			const result = reclaimJeroAuthorityV1(contextOrThrow(request.cwd), { lineage: request.lineage, actor: request.actor, reason: request.reason });
			return maintenanceOutcomeV1(result, "reclaim");
		},
		async recover(request: NativeReviewRecoverRequest): Promise<NativeReviewRecoveryResult> {
			const result = recoverJeroLineageV1(contextOrThrow(request.cwd), {
				predecessorLineage: request.predecessorLineage, expectedPredecessorRevision: request.expectedPredecessorRevision,
				successorLineage: request.successorLineage, disposition: request.disposition,
				actor: request.actor, reason: request.reason,
				...(request.maintainerAuthorization === undefined ? {} : { maintainerAuthorization: request.maintainerAuthorization }),
			});
			return maintenanceOutcomeV1(result, "recover");
		},
		async reconcileAuthority(request: NativeReviewReconcileAuthorityRequest): Promise<NativeReviewRecoveryResult> {
			const result = reconcileJeroAuthorityV1(contextOrThrow(request.cwd), {
				predecessorLineage: request.predecessorLineage, expectedPredecessorRevision: request.expectedPredecessorRevision,
				successorLineage: request.successorLineage, expectedSuccessorRevision: request.expectedSuccessorRevision,
				actor: request.actor, reason: request.reason,
				...(request.anomalies === undefined ? {} : { anomalies: request.anomalies }),
				maintainerAuthorization: request.maintainerAuthorization,
			});
			return maintenanceOutcomeV1(result, "reconcile");
		},
		async captureProviderRole(request: NativeReviewProviderRoleCaptureRequest): Promise<NativeReviewProviderRoleCaptureOutcome> {
			if (request.captureOperation !== "review.capture-refuter" && request.captureOperation !== "review.capture-validation") {
				throw new TypeError(`Native CAPTURE_PROVIDER_ROLE supports only review.capture-refuter and review.capture-validation, received ${JSON.stringify(request.captureOperation)}`);
			}
			assertProviderTokensV1(request.argumentTokens);
			const role: JeroProviderRoleV1 = request.captureOperation === "review.capture-refuter" ? "refuter" : "validator";
			const lineage = exactFlagValueV1(request.argumentTokens, "lineage");
			if (lineage === undefined) throw new TypeError("authority-unavailable: the role vector binding must carry --lineage");
			const context = contextOrThrow(request.cwd);
			if (role === "validator") {
				// 有界编辑在 validator 运行之前落地：修复事实从
				// 存活工作树对照冻结评审树推导（绝不由
				// 调用方声明）并完成定稿；已处于校验中的 lineage
				// （重放或再捕获轮次）直接跳到渲染。
				const pre = context.lineages.load(lineage);
				if (pre.kind === "ok" && pre.record.state.state === "fixing") {
					const derived = deriveJeroFixApplicationV1(context, lineage, request.cwd);
					if (derived.kind !== "ok") throw new Error(refusalDetail("validation capture", derived.code === "derivation-failed" ? "authority-unavailable" : derived.code, derived.detail));
					const applied = reviewFinalizeV1(context, { cwd: request.cwd, lineageId: lineage, fix_application: derived.fix });
					if (applied.kind === "refused") throw new Error(refusalDetail("validation capture", applied.code, `the derived fix could not be applied: ${applied.detail ?? ""}`));
				}
			}
			const relayRequest: ReviewHostRelayRequest = {
				captureArgumentTokens: request.argumentTokens,
				targetCwd: request.cwd,
				submission: { operationToken: role === "refuter" ? "capture-refuter" : "capture-validation", argumentTokens: ["--result={{value}}"], values: [{ slot: "result", domain: "path", substitutionLocation: 0 }] },
			};
			const prepared = await prepareReviewHostRelaySlot(relayRequest, dependencies.providerRoleReviewer, (req) => renderJeroProviderRoleSlotForRelayV1(req, role));
			const result = await submitReviewHostRelayPreparedResult(prepared, (req, operationToken, submitTokens, resultFile) => admitJeroProviderRoleResultForRelayV1(req, operationToken, submitTokens, resultFile, role));
			const body = JSON.parse(result.submission) as Record<string, unknown>;
			if (body.schema === "gentle-ai.review-last-event-closure/v1") return decodeReviewLastEventClosureV1(body);
			const loaded = context.lineages.load(lineage);
			if (loaded.kind !== "ok") throw new Error(refusalDetail("role capture", loaded.kind, "the role artifact could not reload the lineage"));
			return { schema: NATIVE_REVIEW_PROVIDER_ROLE_CAPTURE_SCHEMA, lineageId: lineage, targetIdentity: loaded.record.state.snapshot.identity, role, captured: true };
		},
		async sddAttemptAcquire(request: NativeSddAcquireRequest): Promise<NativeSddAttemptResult> {
			const context = contextOrThrow(request.workspaceRoot);
			const result = acquireJeroSddAttemptV1(context, {
				workspaceRoot: request.workspaceRoot,
				changeName: request.changeName,
				requestId: request.requestId,
				workUnit: request.workUnit,
				evidenceGoal: request.evidenceGoal,
				...(request.maxAttempts === undefined ? {} : { maxAttempts: request.maxAttempts }),
				...(request.maxChangedLines === undefined ? {} : { maxChangedLines: request.maxChangedLines }),
				...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
				...(request.token === undefined ? {} : { token: request.token }),
				...(request.remediatesEvidenceRevision === undefined ? {} : { remediatesEvidenceRevision: request.remediatesEvidenceRevision }),
				...(request.untrackedScope === undefined ? {} : { untrackedScope: request.untrackedScope }),
				...(request.expectedUntrackedInventory === undefined ? {} : { expectedUntrackedInventory: request.expectedUntrackedInventory }),
				...(request.intendedUntracked === undefined ? {} : { intendedUntracked: request.intendedUntracked }),
			});
			return attemptResultV1(result);
		},
		async sddAttemptSettle(request: NativeSddSettleRequest): Promise<NativeSddAttemptResult> {
			const context = contextOrThrow(request.workspaceRoot);
			const result = settleJeroSddAttemptV1(context, {
				workspaceRoot: request.workspaceRoot,
				changeName: request.changeName,
				requestId: request.requestId,
				token: request.token,
				outcome: request.outcome,
				...(request.evidenceRevision === undefined ? {} : { evidenceRevision: request.evidenceRevision }),
				...(request.remediationEvidence === undefined ? {} : { remediationEvidence: request.remediationEvidence }),
				diagnosis: request.diagnosis,
				harnessDisposition: request.harnessDisposition,
				cleanupEvidence: request.cleanupEvidence,
				processEvidence: request.processEvidence,
				...(request.untrackedScope === undefined ? {} : { untrackedScope: request.untrackedScope }),
				...(request.expectedUntrackedInventory === undefined ? {} : { expectedUntrackedInventory: request.expectedUntrackedInventory }),
				...(request.intendedUntracked === undefined ? {} : { intendedUntracked: request.intendedUntracked }),
			});
			return attemptResultV1(result);
		},
	};
}

function attemptResultV1(result: ReturnType<typeof acquireJeroSddAttemptV1>): NativeSddAttemptResult {
	if (result.kind === "refused") throw new Error(refusalDetail("sdd attempt", result.code, result.detail));
	return { state: result.state, ...(result.token === undefined ? {} : { token: result.token }), ...(result.reason === undefined ? {} : { reason: result.reason }) };
}
