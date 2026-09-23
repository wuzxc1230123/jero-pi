// RDD 状态与编排器提示词：状态行渲染（保守失败、记忆化）、原生评审结果备忘、评审计划解析、编排器提示词装载。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { NATIVE_REVIEW_MODE_OPERATION, NATIVE_REVIEW_MODE_SOURCE, type NativeReviewCli, type NativeReviewModeStatus, type NativeReviewAssessRequest } from "./authority/client-contract.ts";
import { verificationPlan, resolveWriterProfile, RDD_LINE, VERIFICATION_TIER, NATIVE_REVIEW_OUTCOME, type RddLine, type VerificationTier, type ReviewAssessmentV1, type NativeReviewOutcome } from "./review-risk-assessment.ts";

import { DEFAULT_BACKGROUND_SUBAGENTS_RENDERING, loadBackgroundSubagentsPolicy, type BackgroundSubagentsRendering } from "./jero-ai-background-subagents.ts";
import { ASSETS_DIR } from "./jero-ai-package-assets.ts";
import { renderBackgroundSubagentsStatusLine, resolveBackgroundSubagentsCapability } from "./jero-ai-writer-scope.ts";


/**
 * 只有当 `effective` 恰为 `on`/`off` 且 `source` 是导出的
 * `NATIVE_REVIEW_MODE_SOURCE` 值之一时，`status` 对象才可信。
 * `resolveRddModeStatus` 只会产生这种形态的值，但
 * `renderRddStatusLine` 仍在渲染边界做校验——畸形或不完整的对象
 * （上游解码出错、未来的字段变更、手工构造的测试 fixture）必须
 * 保守失败为 "unknown" 行，绝不原样渲染一个无法识别的值。
 */
export function isValidRddModeStatus(
	status: NativeReviewModeStatus | undefined,
): status is NativeReviewModeStatus {
	if (status === undefined || status === null || typeof status !== "object") return false;
	if (status.effective !== "on" && status.effective !== "off") return false;
	const validSources: readonly string[] = Object.values(NATIVE_REVIEW_MODE_SOURCE);
	return typeof status.source === "string" && validSources.includes(status.source);
}

/**
 * 渲染回执驱动开发（RDD）状态行，显示在
 * `Background subagent policy` 旁边（gentle-pi#661）。只要 `status`
 * 不是经过校验的 on/off 状态且来源可识别——`undefined`（原生读取器
 * 无法应答：二进制缺失、超时、中止，或原生 CLI 失败）或任何
 * 畸形/不完整的对象——就渲染保守失败的 "unknown" 行。这是纯渲染，
 * 从不发起原生调用，因此永不抛错。
 */


/**
 * 渲染回执驱动开发（RDD）状态行，显示在
 * `Background subagent policy` 旁边（gentle-pi#661）。只要 `status`
 * 不是经过校验的 on/off 状态且来源可识别——`undefined`（原生读取器
 * 无法应答：二进制缺失、超时、中止，或原生 CLI 失败）或任何
 * 畸形/不完整的对象——就渲染保守失败的 "unknown" 行。这是纯渲染，
 * 从不发起原生调用，因此永不抛错。
 */
export function renderRddStatusLine(
	status: NativeReviewModeStatus | undefined,
): string {
	return isValidRddModeStatus(status)
		? `Receipt-driven development: ${status.effective} (decided by ${status.source})`
		: "Receipt-driven development: unknown (native status unavailable)";
}

// 主会话提示词在每次非 SDD、非具名代理启动时都要等待它完成，
// 因此一次无界的原生读取会让会话启动卡在一个挂起的
// `gentle-ai` 子进程后面（gentle-pi#661 原生评审升级）。
// 生产调用点（before_agent_start）传入
// `AbortSignal.timeout(RDD_STATUS_TIMEOUT_MS)`；resolveRddModeStatus
// 自身也让调用与同一个信号竞速（而不只依赖 CLI 自己的信号处理），
// 这样即使面对一个忽略 `signal` 参数的 stub/mock
// reviewMode（测试正是如此），中止也能被尊重。


// 主会话提示词在每次非 SDD、非具名代理启动时都要等待它完成，
// 因此一次无界的原生读取会让会话启动卡在一个挂起的
// `gentle-ai` 子进程后面（gentle-pi#661 原生评审升级）。
// 生产调用点（before_agent_start）传入
// `AbortSignal.timeout(RDD_STATUS_TIMEOUT_MS)`；resolveRddModeStatus
// 自身也让调用与同一个信号竞速（而不只依赖 CLI 自己的信号处理），
// 这样即使面对一个忽略 `signal` 参数的 stub/mock
// reviewMode（测试正是如此），中止也能被尊重。
export const RDD_STATUS_TIMEOUT_MS = 3000;
// 该窗口内重复的会话/代理启动构建会复用上次解析的状态，
// 而不是重新拉起原生二进制。也故意记忆失败/undefined 的解析结果
// （持续故障不应在每次代理启动时重试），用较慢的恢复信号换来
// 少得多的进程拉起；下方的一次性 notify 仍会让持续故障可见。

// 该窗口内重复的会话/代理启动构建会复用上次解析的状态，
// 而不是重新拉起原生二进制。也故意记忆失败/undefined 的解析结果
// （持续故障不应在每次代理启动时重试），用较慢的恢复信号换来
// 少得多的进程拉起；下方的一次性 notify 仍会让持续故障可见。
export const RDD_STATUS_MEMO_TTL_MS = 30_000;

const rddStatusMemo = new Map<string, { readonly status: NativeReviewModeStatus | undefined; readonly expiresAt: number }>();

/** @internal 测试接缝：清空按 cwd 记忆的 RDD 状态缓存。 */


/** @internal 测试接缝：清空按 cwd 记忆的 RDD 状态缓存。 */
export function clearRddStatusMemoForTesting(): void {
	rddStatusMemo.clear();
}

// gentle-pi#668（修正版）：单个候选的最近已知结果，按仓库 realpath
// 加 targetIdentity 作为键——绝不仅按仓库，否则一个候选的结果会泄漏进
// 其他每个候选的 `assess` 调用。只会写入 declined/unavailable
// （来自 ANSWER_CONSENT）；`closed` 永不写入/派生——需显式传入。
// 缺失的条目读回 `undefined`，按 `unknown` 处理（保守失败，同 `off`）。


// gentle-pi#668（修正版）：单个候选的最近已知结果，按仓库 realpath
// 加 targetIdentity 作为键——绝不仅按仓库，否则一个候选的结果会泄漏进
// 其他每个候选的 `assess` 调用。只会写入 declined/unavailable
// （来自 ANSWER_CONSENT）；`closed` 永不写入/派生——需显式传入。
// 缺失的条目读回 `undefined`，按 `unknown` 处理（保守失败，同 `off`）。
const nativeReviewOutcomeByCandidate = new Map<string, "declined" | "unavailable">();



function nativeReviewOutcomeMemoKey(cwd: string, targetIdentity: string): string {
	try {
		return `${realpathSync(cwd)}\u0000${targetIdentity}`;
	} catch {
		return `${cwd}\u0000${targetIdentity}`;
	}
}



export function recordNativeReviewOutcome(cwd: string, targetIdentity: string, outcome: "declined" | "unavailable"): void {
	nativeReviewOutcomeByCandidate.set(nativeReviewOutcomeMemoKey(cwd, targetIdentity), outcome);
}

/** 返回恰好针对该候选记录的结果；没有记录时返回 `undefined`。 */


/** 返回恰好针对该候选记录的结果；没有记录时返回 `undefined`。 */
export function readNativeReviewOutcome(cwd: string, targetIdentity: string): "declined" | "unavailable" | undefined {
	return nativeReviewOutcomeByCandidate.get(nativeReviewOutcomeMemoKey(cwd, targetIdentity));
}

/** @internal 测试接缝：清空按候选记忆的原生评审结果缓存。 */


/** @internal 测试接缝：清空按候选记忆的原生评审结果缓存。 */
export function clearNativeReviewOutcomeMemoForTesting(): void {
	nativeReviewOutcomeByCandidate.clear();
}

// 为 `assess` 尽力获取当前候选的 target identity（gentle-pi#668）：
// 复用 `targetStatus`，一个本工具已在别处发起的原生调用。


// 为 `assess` 尽力获取当前候选的 target identity（gentle-pi#668）：
// 复用 `targetStatus`，一个本工具已在别处发起的原生调用。
async function readCurrentTargetIdentityBestEffort(
	nativeReviewCli: Pick<NativeReviewCli, "targetStatus"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (nativeReviewCli?.targetStatus === undefined) return undefined;
	try {
		const status = await nativeReviewCli.targetStatus({ cwd, ...(signal === undefined ? {} : { signal }) });
		return status.applicability === "current_target" ? status.targetIdentity : undefined;
	} catch {
		return undefined;
	}
}



function rddAbortRejection(signal: AbortSignal): Promise<never> {
	return new Promise((_resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new Error("aborted"));
			return;
		}
		signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
	});
}



async function readRddModeStatusOnce(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
): Promise<NativeReviewModeStatus | undefined> {
	if (!nativeReviewCli?.reviewMode) return undefined;
	try {
		const call = nativeReviewCli.reviewMode({ cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS, signal });
		const result = signal === undefined ? await call : await Promise.race([call, rddAbortRejection(signal)]);
		return result.status;
	} catch {
		return undefined;
	}
}

// gentle-pi#662：只读的组合式原生风险评估加上计算出的验证计划
// （`lib/review-risk-assessment.ts`），供 `jero_review` 工具的
// `assess` 操作使用。永不抛错：不可用/失败的原生 assess 调用
// （缺少该动词的旧版二进制、超时、畸形响应）解析为
// `unassessable` 档位，`verificationPlan` 对其与 `high` 一视同仁
// ——即 gentle-pi#662 的保守失败规则。


// gentle-pi#662：只读的组合式原生风险评估加上计算出的验证计划
// （`lib/review-risk-assessment.ts`），供 `jero_review` 工具的
// `assess` 操作使用。永不抛错：不可用/失败的原生 assess 调用
// （缺少该动词的旧版二进制、超时、畸形响应）解析为
// `unassessable` 档位，`verificationPlan` 对其与 `high` 一视同仁
// ——即 gentle-pi#662 的保守失败规则。
interface ReviewAssessmentPlanDetails {
	schema: "jero.review-assessment-plan/v1";
	risk: VerificationTier;
	reasons: readonly { code: string; path: string; detail: string }[];
	changedPaths: number;
	changedLines: number;
	candidate: { kind: string; baseRef: string | undefined } | null;
	rddLine: RddLine;
	nativeReviewOutcome: NativeReviewOutcome;
	// gentle-pi#668：nativeReviewOutcome 的来源——explicit（调用方
	// 显式传入）、derived（匹配到该候选本身）或 unknown。
	outcome_source: "explicit" | "derived" | "unknown";
	writerProfile: "small" | "large";
	plan: {
		writerSelfVerification: boolean;
		structuralReadbackOnly: boolean;
		independentVerifier: boolean;
		reason: string;
	};
}



// gentle-pi#662：只读原生风险评估，在渲染的
// `Receipt-driven development:` 行为 `off` 或 `unknown` 时，用原生风险
// 而非任务描述判断来给独立验证者设门。以 `jero_review` 的
// `assess` 操作暴露（不是独立工具），其可选字段经由控制器既有的
// 通用 `input` JSON 字符串传入，与 START 的
// `{"mode":...,"baseRef":...}` 完全一致。
export interface ReviewAssessInput {
	baseRef?: string;
	committedOnly?: boolean;
	writerModelId?: string;
	writerEffort?: string;
	// gentle-pi#668：调用方自己掌握的该候选结果。
	// 省略时会尝试为本候选本身的 target identity 自动派生
	// declined/unavailable（绝不是别的候选）；`closed`
	// 永不自动派生——需显式传入。
	nativeReviewOutcome?: NativeReviewOutcome;
}

export async function resolveReviewAssessmentPlan(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode" | "assess" | "targetStatus"> | null | undefined,
	cwd: string,
	input: ReviewAssessInput,
	signal?: AbortSignal,
): Promise<ReviewAssessmentPlanDetails> {
	if (input.baseRef !== undefined && input.committedOnly !== true) throw new Error("Review assess baseRef requires committedOnly: true");
	if (input.baseRef === undefined && input.committedOnly !== undefined) throw new Error("Review assess committedOnly requires an explicit baseRef");

	const status = await readRddModeStatusOnce(nativeReviewCli, cwd, signal);
	const rddLine: RddLine = isValidRddModeStatus(status) ? status.effective : RDD_LINE.UNKNOWN;
	const writerProfile = resolveWriterProfile({
		...(input.writerModelId === undefined ? {} : { model: { id: input.writerModelId } }),
		thinking: input.writerEffort,
	});

	let assessment: ReviewAssessmentV1 | undefined;
	let unassessableDetail: string | undefined;
	if (nativeReviewCli?.assess === undefined) {
		unassessableDetail = "native review assess is unavailable: the installed gentle-ai binary does not expose the assess command.";
	} else {
		try {
			const request: NativeReviewAssessRequest = {
				cwd,
				...(input.baseRef === undefined ? {} : { baseRef: input.baseRef, committedOnly: true as const }),
				...(signal === undefined ? {} : { signal }),
			};
			assessment = await nativeReviewCli.assess(request);
		} catch (error) {
			unassessableDetail = `native review assess failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	const risk: VerificationTier = assessment?.risk ?? VERIFICATION_TIER.UNASSESSABLE;
	// gentle-pi#668：显式传入永远优先；否则只针对本候选自己的
	// target identity 派生，绝不只按仓库。`closed`
	// 永不被派生。
	const targetIdentity = input.nativeReviewOutcome === undefined ? await readCurrentTargetIdentityBestEffort(nativeReviewCli, cwd, signal) : undefined;
	const derived = targetIdentity === undefined ? undefined : readNativeReviewOutcome(cwd, targetIdentity);
	const nativeReviewOutcome: NativeReviewOutcome = input.nativeReviewOutcome ?? derived ?? NATIVE_REVIEW_OUTCOME.UNKNOWN;
	const outcomeSource: "explicit" | "derived" | "unknown" = input.nativeReviewOutcome !== undefined ? "explicit" : derived === undefined ? "unknown" : "derived";
	const plan = verificationPlan({ rddLine, risk, writerProfile, nativeReviewOutcome });
	return {
		schema: "jero.review-assessment-plan/v1",
		risk,
		reasons: assessment?.reasons ?? (unassessableDetail === undefined ? [] : [{ code: "native-assess-unavailable", path: "", detail: unassessableDetail }]),
		changedPaths: assessment?.changedPaths ?? 0,
		changedLines: assessment?.changedLines ?? 0,
		candidate: assessment === undefined ? null : { kind: assessment.candidate.kind, baseRef: assessment.candidate.baseRef },
		rddLine,
		nativeReviewOutcome,
		outcome_source: outcomeSource,
		writerProfile,
		plan,
	};
}



let rddStatusUnavailableWarned = false;

/**
 * 为提示词渲染尽力读取原生 RDD 模式状态，按 cwd 记忆
 * `RDD_STATUS_MEMO_TTL_MS` 时长。复用 `reviewMode` STATUS 读取器
 * （`gentle-ai review mode status --json`，解码为
 * `NativeReviewModeStatus`），`/jero:review-mode` 命令调用的也是
 * 它。永不抛错，且在给定 `signal` 时绝不拖过其截止时间：
 * 二进制缺失、进程超时/中止、原生 CLI 失败都解析为
 * `undefined`。`ctx` 是可选的，仅在读取被吞掉时用于一次性
 * （每进程一次）的 UI 提示，让持续的原生故障在渲染的 "unknown"
 * 行之外也能被观察到。
 */


/**
 * 为提示词渲染尽力读取原生 RDD 模式状态，按 cwd 记忆
 * `RDD_STATUS_MEMO_TTL_MS` 时长。复用 `reviewMode` STATUS 读取器
 * （`gentle-ai review mode status --json`，解码为
 * `NativeReviewModeStatus`），`/jero:review-mode` 命令调用的也是
 * 它。永不抛错，且在给定 `signal` 时绝不拖过其截止时间：
 * 二进制缺失、进程超时/中止、原生 CLI 失败都解析为
 * `undefined`。`ctx` 是可选的，仅在读取被吞掉时用于一次性
 * （每进程一次）的 UI 提示，让持续的原生故障在渲染的 "unknown"
 * 行之外也能被观察到。
 */
export async function resolveRddModeStatus(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
	now: () => number = Date.now,
	ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
): Promise<NativeReviewModeStatus | undefined> {
	const nowMs = now();
	const cached = rddStatusMemo.get(cwd);
	if (cached !== undefined && cached.expiresAt > nowMs) return cached.status;
	const status = await readRddModeStatusOnce(nativeReviewCli, cwd, signal);
	rddStatusMemo.set(cwd, { status, expiresAt: nowMs + RDD_STATUS_MEMO_TTL_MS });
	if (status === undefined && !rddStatusUnavailableWarned) {
		rddStatusUnavailableWarned = true;
		if (ctx?.hasUI) {
			ctx.ui.notify(
				"Jero：回执驱动开发（receipt-driven-development）状态不可用（原生评审 CLI 缺失、超时或失败）。在恢复之前，父提示词将渲染 \"unknown\"；本提示本会话不会重复。",
				"warning",
			);
		}
	}
	return status;
}

/** 一次调用即完成解析并渲染 RDD 状态行，供生产调用点使用。 */


/** 一次调用即完成解析并渲染 RDD 状态行，供生产调用点使用。 */
export async function resolveRddStatusLine(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
	now: () => number = Date.now,
	ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
): Promise<string> {
	return renderRddStatusLine(await resolveRddModeStatus(nativeReviewCli, cwd, signal, now, ctx));
}

// 渲染出的提示词按后台策略/能力/RDD 状态键在进程生命周期内记忆；
// assets 字节本身每个键只读一次。`rddStatusLine` 默认取 "unknown"
// 兜底行（三种可渲染形态中最长的那个）而不是 ""，因此无参数的默认
// 渲染本身就是 tests/orchestrator-budget.test.ts 所度量的规范 8 KiB
// 预算的最坏情况；assets/orchestrator.md 的体量已把该最坏情况
// 计算在内。生产路径仍通过 resolveRddStatusLine 解析并传入
// 真实的行（on/off/unknown）。


// 渲染出的提示词按后台策略/能力/RDD 状态键在进程生命周期内记忆；
// assets 字节本身每个键只读一次。`rddStatusLine` 默认取 "unknown"
// 兜底行（三种可渲染形态中最长的那个）而不是 ""，因此无参数的默认
// 渲染本身就是 tests/orchestrator-budget.test.ts 所度量的规范 8 KiB
// 预算的最坏情况；assets/orchestrator.md 的体量已把该最坏情况
// 计算在内。生产路径仍通过 resolveRddStatusLine 解析并传入
// 真实的行（on/off/unknown）。
const orchestratorPromptCache = new Map<string, string>();

export function getOrchestratorPrompt(
	cwd: string = process.cwd(),
	activeTools?: readonly string[],
	rddStatusLine: string = renderRddStatusLine(undefined),
): string {
	const background: BackgroundSubagentsRendering = {
		policy: loadBackgroundSubagentsPolicy(cwd),
		capability: resolveBackgroundSubagentsCapability(cwd, activeTools),
	};
	const cacheKey = `${background.policy}:${background.capability}:${rddStatusLine}`;
	let prompt = orchestratorPromptCache.get(cacheKey);
	if (prompt === undefined) {
		prompt = renderOrchestratorPrompt(ASSETS_DIR, background, rddStatusLine);
		orchestratorPromptCache.set(cacheKey, prompt);
	}
	return prompt;
}



export function renderOrchestratorPrompt(
	assetsDir: string,
	background: BackgroundSubagentsRendering = DEFAULT_BACKGROUND_SUBAGENTS_RENDERING,
	rddStatusLine: string = renderRddStatusLine(undefined),
): string {
	const backgroundPolicyBlock = `${renderBackgroundSubagentsStatusLine(background)}\n${rddStatusLine}`;
	return readFileSync(join(assetsDir, "orchestrator.md"), "utf8")
		.replaceAll("{{JERO_PI_ASSETS_ROOT}}", assetsDir)
		.replaceAll(
			"{{JERO_PI_BACKGROUND_POLICY}}",
			backgroundPolicyBlock,
		)
		.trim();
}

// gentle-pi#560 / gentle-ai#4056, #4057：2026-08-01 起，Jero 不再向
// Pi 生成的 APPEND_SYSTEM 组合写入运行时专属的评审执行契约。本包改为
// 注入镜像 provider 契约 bundle 自带的 `orchestration/pi.md` 文本，
// 从包内镜像（contracts/review-provider-contract-mirror/）读取一次，
// 并以完整渲染的片段形式在进程生命周期内缓存。它被刻意地不并入
// getOrchestratorPrompt/orchestratorPromptCache：那个核心提示词
// 被钉死在 8192 字节预算上（tests/orchestrator-budget.test.ts）。
