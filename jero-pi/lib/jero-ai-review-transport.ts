// jero-ai 评审传输域：宿主传输协商、拒绝记忆与会话级协商状态解析。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	NATIVE_REVIEW_MODE_OPERATION, type NativeReviewCli, NativeReviewIntegrationError,
	type NativeTargetStatusRequest
} from "./authority/client-contract.ts";
import { type ReviewStatusV3 } from "./authority/wire-contract.ts";
import { REVIEW_CONTROLLER_OPERATION, type ReviewControllerOperation } from "./jero-ai-review-params.ts";
import {
	type PendingReviewConsentSessionKey, processRetainedNativeStatusSelections,
	type RetainedNativeStatusSelection
} from "./jero-ai-review-consent.ts";
import { syncRetainedNativeStatusSelections } from "./jero-ai-review-native-ops.ts";
// provider 实例记忆，并以确切的 provider 原因阻塞生命周期；
// Pi 绝不将其降级为无 agent 的 STATUS 回退。
export const REVIEW_HOST_AGENT = "pi" as const;
const REVIEW_TRANSPORT_REFUSAL_CODES = new Set([
	"immutable_review_transport_unsupported",
	"unsupported_agent",
	"unknown_flag",
]);
interface ReviewTransportRefusal { supported: false; code: string; message: string; }
interface NegotiatedHostTransportStatus {
	status?: ReviewStatusV3;
	transport?: ReviewTransportRefusal;
}
const reviewTransportRefusalByProvider = new WeakMap<object, ReviewTransportRefusal>();

export function clearReviewTransportProbeForTesting(nativeReviewCli: NativeReviewCli | null): void {
	if (nativeReviewCli !== null) reviewTransportRefusalByProvider.delete(nativeReviewCli as unknown as object);
}

export function hostTransportUnavailable(
	operation: ReviewControllerOperation | "jero_review_capture" | "jero_review_capture_group",
	transport: ReviewTransportRefusal,
): Record<string, unknown> {
	// #535：provider 打印的原始 `gentle-ai review ...` continuation 在本
	// 运行时是死路——Pi 不在 provider 的不可变评审运行时
	// 列表中，因此每个仅 CLI 的出口都以同一传输 code 拒绝。该
	// 拒绝因此指明在此表面运行的 continuation
	// （jero_review / jero_review_capture 包装工具），同时 provider 自己的
	// 诊断在 relay_transport 中原样保留作为证据。
	const isCapture = operation === "jero_review_capture" || operation === "jero_review_capture_group";
	return {
		...(isCapture ? { tool: operation } : { operation }),
		status: "blocked",
		outcome: "pi-host-relay-transport-unavailable",
		reason: `The native provider refused the required pi reviewer transport (${transport.code}): ${transport.message}`,
		relay_transport: transport,
		mutation_performed: false,
		mutation_outcome: "none",
		wrapper_continuation: {
			tool: "jero_review",
			operation: REVIEW_CONTROLLER_OPERATION.INSPECT,
			...(isCapture ? { then: operation } : {}),
		},
		next_action: `Install a native gentle-ai provider that supports \`review status --agent pi\`, then re-enter negotiated STATUS with jero_review {"operation":"inspect"}${!isCapture ? " and follow the transition it returns" : operation === "jero_review_capture_group" ? " and resubmit jero_review_capture_group with the complete exact ordered collectBindings that fresh STATUS returns" : " and resubmit jero_review_capture with the exact one-slot collectBinding that fresh STATUS returns"}. A provider-printed raw CLI continuation does not run in this runtime, and Pi never falls back to an agent-less lifecycle route.`,
	};
}

/**
 * 为所需的 pi 评审者传输查询已协商的 STATUS。带类型的
 * 拒绝按 provider 缓存并作为不可用返回；无论新的
 * 还是记忆中的拒绝，都不得发起无 agent 的生命周期 STATUS 请求。
 */
export async function negotiatedStatusForHostTransport(
	nativeReviewCli: NativeReviewCli,
	request: NativeTargetStatusRequest,
	retainedSelections: Map<string, RetainedNativeStatusSelection>,
	canonicalRetentionRoot = request.cwd,
): Promise<NegotiatedHostTransportStatus> {
	const provider = nativeReviewCli as unknown as object;
	const remembered = reviewTransportRefusalByProvider.get(provider);
	if (remembered !== undefined) return { transport: remembered };
	try {
		const status = await nativeReviewCli.targetStatus!({ ...request, agent: REVIEW_HOST_AGENT });
		syncRetainedNativeStatusSelections(retainedSelections, canonicalRetentionRoot, status, request.baseRef);
		return { status };
	} catch (error) {
		const code = error instanceof NativeReviewIntegrationError ? error.failureEnvelope.code : undefined;
		// 只有封闭的传输拒绝集合才被定型为不可用；其余
		// 每种失败仍是错误，走调用方的常规错误路径。
		if (code === undefined || !REVIEW_TRANSPORT_REFUSAL_CODES.has(code)) throw error;
		const transport: ReviewTransportRefusal = { supported: false, code, message: error.message };
		reviewTransportRefusalByProvider.set(provider, transport);
		return { transport };
	}
}

// gentle-pi#568：为会话解析当前已协商的评审 STATUS，
// 沿用 `agent_end` 决定是否提醒的确切守卫：一个
// 同时具备 `reviewMode` 与 `targetStatus` 的原生评审 CLI、带
// UI 的上下文，以及 RDD 生效开启。任一守卫缺失、
// 模式生效关闭，或任何 STATUS 错误或传输拒绝，都返回
// `undefined`。启动协商与变更设门的 `agent_end` 使用同一条原生
// 全目标路径；两者都不从本地变更回执推导候选范围。
export async function resolveNegotiatedReviewStatusForSession(
	nativeReviewCli: NativeReviewCli | null,
	ctx: ExtensionContext,
	sessionKey: PendingReviewConsentSessionKey,
): Promise<ReviewStatusV3 | undefined> {
	if (nativeReviewCli?.reviewMode === undefined || nativeReviewCli.targetStatus === undefined) return undefined;
	if (ctx.hasUI !== true) return undefined;
	let modeEffective: "on" | "off";
	try {
		const mode = await nativeReviewCli.reviewMode({ cwd: ctx.cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS });
		modeEffective = mode.status.effective;
	} catch {
		return undefined;
	}
	if (modeEffective === "off") return undefined;
	try {
		const retainedSelections = ((key: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(key) ?? processRetainedNativeStatusSelections.set(key, new Map()).get(key)!)(sessionKey);
		const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, { cwd: ctx.cwd }, retainedSelections, ctx.cwd);
		return negotiated.status;
	} catch {
		return undefined;
	}
}

// gentle-pi#556 / gentle-ai#4051：经 `agent_end` 发出的
// 变更设门提醒。它从不自行运行 START，因此指明唯一
