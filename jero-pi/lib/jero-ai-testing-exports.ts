// jero-ai 测试接缝：__testing 再导出表、控制器 SDD 状态解析与 JeroRuntimeDependencies。
// 自 extensions/jero-ai.ts 拆分（机械平移；剔除指向装配区工厂的死表项
// createJeroAiExtension: createJeroAiExtensionForTesting——无任何测试消费，且会形成模块环）。

import { type SddPreflightPreferences } from "./sdd-preflight.ts";
import { resolveSddStatus } from "./sdd-status.ts";
import { CandidateViewRegistry } from "./review-candidate-view.ts";
import { type NativeReviewCli } from "./authority/client-contract.ts";
import { type ChildStandingReviewPermissionClient } from "./review-session-standing-permission-ipc.ts";
import {
	loadBackgroundSubagentsPolicy, parseBackgroundSubagentsPolicyFile,
	renderBackgroundSubagentsReport, resolveBackgroundSubagentsPolicy,
	writeGlobalBackgroundSubagentsPolicy
} from "./jero-ai-background-subagents.ts";
import { readActiveToolNames, renderBackgroundSubagentsStatusLine, resolveBackgroundSubagentsCapability } from "./jero-ai-writer-scope.ts";
import {
	clearNativeReviewOutcomeMemoForTesting, clearRddStatusMemoForTesting, getOrchestratorPrompt,
	isValidRddModeStatus, RDD_STATUS_MEMO_TTL_MS, RDD_STATUS_TIMEOUT_MS, readNativeReviewOutcome,
	recordNativeReviewOutcome, renderOrchestratorPrompt, renderRddStatusLine, resolveRddModeStatus,
	resolveRddStatusLine
} from "./jero-ai-rdd-status.ts";
import { buildJeroPrompt, loadReviewContractPromptFragment, readMirroredReviewContractFragment } from "./jero-ai-prompts.ts";
import {
	classifyGuardedCommand, evaluateGuardedCommand, guardedCommandPreview, guardedCommandTitle,
	loadRuntimeGuardrailsConfig
} from "./jero-ai-guardrails.ts";
import { readSddChangeFlag, resolveSddChangeStartup, resolveSelectedNativeSddChangeStartup } from "./jero-ai-sdd-startup.ts";
import {
	listAgentsFromDir, listAgentsFromDirAsync, listDiscoverableAgents, orderDiscoverableAgents,
	readEffectiveModelConfig, readEffectiveModelConfigAsync
} from "./jero-ai-model-config.ts";
import { renderSddModelPanelForTesting } from "./jero-ai-model-panel.ts";
import { nativeStatusUnsupported, resolveReviewModeGate } from "./jero-ai-review-params.ts";
import { PendingReviewConsentRegistry } from "./jero-ai-review-consent.ts";
import { setReviewHostRelayGroupRunnersForTesting, setReviewHostRelayRunnerForTesting } from "./jero-ai-review-relay.ts";
import { clearReviewTransportProbeForTesting } from "./jero-ai-review-transport.ts";
import { executeReviewCaptureGroupOperation, executeReviewCaptureOperation } from "./jero-ai-review-select.ts";
import { executeReviewControllerOperation } from "./jero-ai-review-controller.ts";

/** @internal */
export const __testing = {
	resolveReviewModeGate,
	readEffectiveModelConfig,
	readEffectiveModelConfigAsync,
	listAgentsFromDir,
	listAgentsFromDirAsync,
	listDiscoverableAgents,
	orderDiscoverableAgents,
	classifyGuardedCommand,
	evaluateGuardedCommand,
	guardedCommandPreview,
	guardedCommandTitle,
	loadRuntimeGuardrailsConfig,
	buildJeroPrompt,
	nativeStatusUnsupported,
	executeReviewControllerOperation,
	executeReviewCaptureOperation,
	executeReviewCaptureGroupOperation,
	setReviewHostRelayRunnerForTesting,
	setReviewHostRelayGroupRunnersForTesting,
	clearReviewTransportProbeForTesting,
	renderSddModelPanel: renderSddModelPanelForTesting,
	getOrchestratorPrompt,
	renderOrchestratorPrompt,
	loadReviewContractPromptFragment,
	readMirroredReviewContractFragment,
	loadBackgroundSubagentsPolicy,
	resolveBackgroundSubagentsPolicy,
	renderBackgroundSubagentsReport,
	writeGlobalBackgroundSubagentsPolicy,
	parseBackgroundSubagentsPolicyFile,
	resolveBackgroundSubagentsCapability,
	readActiveToolNames,
	renderBackgroundSubagentsStatusLine,
	renderRddStatusLine,
	isValidRddModeStatus,
	resolveRddModeStatus,
	resolveRddStatusLine,
	RDD_STATUS_TIMEOUT_MS,
	RDD_STATUS_MEMO_TTL_MS,
	clearRddStatusMemoForTesting,
	readNativeReviewOutcome,
	recordNativeReviewOutcome,
	clearNativeReviewOutcomeMemoForTesting,
	resolveControllerSddStatus,
	resolveStartupControllerSddStatus,
	resolveSddChangeStartup,
	resolveSelectedNativeSddChangeStartup,
	readSddChangeFlag,

};

export function resolveControllerSddStatus(
	cwd: string,
	changeName: string | undefined,
	includeInstructions: boolean,
	artifactStore: SddPreflightPreferences["artifactStore"] | undefined,
) {
	return resolveSddStatus({ cwd, changeName, includeInstructions, artifactStore });
}

export function resolveStartupControllerSddStatus(
	cwd: string,
	changeName: string | undefined,
	includeInstructions: boolean,
	artifactStore: SddPreflightPreferences["artifactStore"] | undefined,
) {
	return resolveControllerSddStatus(cwd, changeName, includeInstructions, artifactStore);
}

export interface JeroRuntimeDependencies {
	nativeReviewCli?: NativeReviewCli | null;
	candidateViews?: CandidateViewRegistry | null;
	// 注入的注册表让测试与宿主集成获得显式所有权；
	// 正常的包注册共享模块本地的进程内存注册表。
	pendingReviewConsentRegistry?: PendingReviewConsentRegistry;
	// 同意绑定 TTL 时钟的确定性测试接缝。生产
	// 两者均保持 undefined，让同意路径观察真实墙钟时间；
	// 测试注入假时钟，使过期可观察，而无需 10 分钟
	// 睡眠，也不依赖排队的清理宏任务触发。
	now?: () => number;
	scheduleTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	// 会话子进程继承的环境；测试注入一个
	// 普通对象，使握手声明可观察，而无需
	// 触碰测试运行器自己的 process.env。
	processEnv?: NodeJS.ProcessEnv;
	// 包自有子进程仅通过这条父绑定的通道询问
	// 自己待定的普通 START 能否在本地重放授权。
	childStandingReviewPermissionClient?: Pick<ChildStandingReviewPermissionClient, "requestAuthorization" | "close">;
}
