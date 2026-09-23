// jero-ai 评审原生操作域：START 完成、失败对账、工作区根解析、存储键与留存选择同步。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { type CandidateView, CandidateViewError, CandidateViewRegistry } from "./review-candidate-view.ts";
import { isCanonicalProcessString, NATIVE_REVIEW_OPERATION, type NativeReviewCli, type NativeStartResult } from "./authority/client-contract.ts";
import { type ReviewStatusV3 } from "./authority/wire-contract.ts";
import { isRecord } from "./jero-ai-persona-config.ts";
import {
	asNativeReviewCliError, asNativeReviewConsentBindingError, mapNativeStartResult,
	mapNativeTargetStatus, nativeStartPreAuthorityRejection, requiredStatusActionText,
	REVIEW_CONTROLLER_OPERATION, type ReviewControllerOperation
} from "./jero-ai-review-params.ts";
import {
	MAX_RETAINED_NATIVE_STATUS_SELECTIONS, NativeCaptureRouteRegistrationError,
	type NativeStartUntrackedSelection, type RetainedNativeCaptureRoute,
	type RetainedNativeStatusSelection, type RetainedNativeUntrackedSelection,
	type RetainedPreLineageNativeUntrackedSelection
} from "./jero-ai-review-consent.ts";
import { canonicalReviewCaptureBinding } from "./jero-ai-review-select.ts";
export function completeNativeStart(
	operation: ReviewControllerOperation,
	result: NativeStartResult,
	workspaceRoot: string,
	candidateView: CandidateView | undefined,
	candidateViews: CandidateViewRegistry | null,
): Record<string, unknown> {
	if (candidateView === undefined) return { operation, result: mapNativeStartResult(result), workspace_root: workspaceRoot };
	if (candidateViews && result.lensesRequired) {
		const binding = { token: candidateView.token, lineageId: result.lineageId, selectedLenses: result.selectedLenses };
		if (result.action === "resumed" && !candidateViews.hasCurrentBinding(candidateView.contributorRoot)) candidateViews.restoreCurrentFromNativeStart(binding);
		else candidateViews.bindCurrent(binding);
	} else if (candidateViews && ((result.action === "created" && result.state === "reviewing") || result.action === "resumed")) candidateViews.retain(candidateView.token, result.lineageId);
	else candidateViews?.cleanup(candidateView.token);
	const actorBinding = result.lensesRequired
		? {
			workspace_root: workspaceRoot,
			candidate_root: candidateView.root,
			candidate_tree: candidateView.candidateTree,
			candidate_paths: candidateView.paths,
		}
		: undefined;
	return {
		operation,
		result: mapNativeStartResult(result),
		workspace_root: workspaceRoot,
		...(actorBinding === undefined ? {} : { actor_binding: actorBinding }),
	};
}

// gentle-ai#4003：原生销毁之后失败的每个 Pi 侧拆除步骤
// 都是延迟清理，而非确认失败。只转发
// 已清洗的 CandidateViewError 表面；其余一切
// 都归约为该步骤的固定 code，使任何路径或命令文本都到不了
// 调用方。候选视图提示刻意走带外：没有控制器
// 操作暴露仅清理的重试，且重放 acknowledge-approved
// 会撞上已销毁的 lineage。
export const POST_BURN_CLEANUP = {
	candidateView: { code: "candidate-view-cleanup-failed", nextAction: "retry-candidate-view-cleanup-or-remove-the-view-out-of-band" },
	retainedSelection: { code: "retained-selection-cleanup-failed", nextAction: "retained-selection-clears-on-the-next-terminal-status" },
} as const;

export function deferredPostBurnCleanup(step: (typeof POST_BURN_CLEANUP)[keyof typeof POST_BURN_CLEANUP], cleanup: () => void): Record<string, unknown> | undefined {
	try {
		cleanup();
		return undefined;
	} catch (error) {
		return {
			status: "deferred",
			diagnostics: error instanceof CandidateViewError
				? { code: error.reason, message: error.message }
				: { code: step.code },
			next_action: step.nextAction,
		};
	}
}

export function nativeOperationFailure(operation: ReviewControllerOperation | "jero_review_capture", error: unknown): Record<string, unknown> {
	const value = error as { mutationOutcome?: unknown; nextAction?: unknown; diagnostics?: unknown; auditRecord?: unknown; launchAttempted?: unknown; candidateViewPreNative?: unknown; failureEnvelope?: { raw?: unknown; mutationOutcome?: unknown; replayability?: unknown; nextAction?: unknown; code?: unknown; continuation?: { command?: unknown } } };
	if (isRecord(value.failureEnvelope) && isRecord(value.failureEnvelope.raw)) {
		const mutationOutcome = value.failureEnvelope.mutationOutcome;
		return {
			operation,
			status: "blocked",
			native_failure: value.failureEnvelope.raw,
			...(mutationOutcome === "committed"
				? { mutation_performed: true, mutation_outcome: "committed" }
				: mutationOutcome === "unknown"
					? { mutation_outcome: "unknown" }
					: { mutation_performed: false, mutation_outcome: "none" }),
			...(typeof value.failureEnvelope.replayability === "string" ? { replayability: value.failureEnvelope.replayability } : {}),
			...(typeof value.failureEnvelope.nextAction === "string" ? { next_action: value.failureEnvelope.nextAction } : {}),
			// gentle-pi#627：针对过期受管理资产集的 START 预检
			// 失败封套带有顶层 continuation；把它的
			// `gentle-ai sync` 命令渲染为唯一可行动的下一步。
			...(value.failureEnvelope.code === "managed_assets_outdated" && typeof value.failureEnvelope.continuation?.command === "string"
				? { hint: `run ${value.failureEnvelope.continuation.command}` }
				: {}),
		};
	}
	// 所有同意绑定守卫都在 provider 启动之前运行，因此这是
	// 一个本地不匹配，无需对账。把它报告成原生
	// 操作失败会掩盖唯一让它可修复的事实。
	const consentBinding = asNativeReviewConsentBindingError(error);
	if (consentBinding !== undefined) {
		return {
			operation,
			status: "blocked",
			outcome: "consent-binding-invalid",
			native_invocation_attempted: false,
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none" as const,
			diagnostics: { code: consentBinding.reason, message: consentBinding.message },
			next_action: "resolve-consent-binding",
		};
	}
	if (error instanceof NativeCaptureRouteRegistrationError) {
		return {
			operation,
			status: "blocked",
			outcome: "capture-route-registration-rejected",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const mutationOutcome = value.mutationOutcome === "unknown" ? "unknown" : "none";
	const nativeCliError = asNativeReviewCliError(error);
	const nativeDiagnostics = nativeCliError?.diagnostics;
	// target-status 探测只以 `review/status` 操作标注诊断（本仓的 Node
	// 权威没有独立的 version 探测操作），在每条控制器路由上保留这类
	// 已清洗的诊断，而不是把一个可行动的失败重新标注为不透明的控制器失败。
	const preservesNativeTargetStatusDiagnostic = nativeDiagnostics?.operation === NATIVE_REVIEW_OPERATION.STATUS;
	const preservesAnswerConsentStartDiagnostic = operation === REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT && nativeDiagnostics?.operation === NATIVE_REVIEW_OPERATION.START;
	const diagnostics = operation === REVIEW_CONTROLLER_OPERATION.START && error instanceof CandidateViewError && value.candidateViewPreNative === true
		? error.diagnostics ?? { code: error.reason, message: "candidate view rejected before native START" }
		: error instanceof CandidateViewError
			? { code: error.reason, message: error.message }
			: nativeDiagnostics?.operation === `review/${operation}` || preservesNativeTargetStatusDiagnostic || preservesAnswerConsentStartDiagnostic
		? nativeDiagnostics
		: undefined;
	return {
		operation,
		status: "blocked",
		outcome: "native-operation-failed",
		...(operation === REVIEW_CONTROLLER_OPERATION.START && mutationOutcome === "none"
			? nativeStartPreAuthorityRejection()
			: mutationOutcome === "none"
				? { lineage_created: false, mutation_performed: false, mutation_outcome: "none" as const }
				: { mutation_outcome: mutationOutcome }),
		...(diagnostics === undefined ? {} : { diagnostics }),
		...(isRecord(value.auditRecord) ? { native_audit_record: value.auditRecord } : {}),
		...(mutationOutcome === "unknown" || value.nextAction === "review.status"
			? { replayability: "status_required", next_action: "review.status", required_status_action: requiredStatusActionText() }
			: { next_action: "resolve-native-operation-failure" }),
	};
}

export function nativeMutationRequiresStatus(error: unknown): boolean {
	const value = error as {
		mutationOutcome?: unknown;
		nextAction?: unknown;
		failureEnvelope?: { mutationOutcome?: unknown; replayability?: unknown; nextAction?: unknown };
	};
	return value.mutationOutcome === "unknown" ||
		value.nextAction === "review.status" ||
		value.failureEnvelope?.mutationOutcome === "unknown" ||
		value.failureEnvelope?.replayability === "status_required" ||
		value.failureEnvelope?.nextAction === "review.status";
}

export async function reconcileNativeMutationFailure(
	operation: ReviewControllerOperation,
	error: unknown,
	nativeReviewCli: NativeReviewCli,
	target: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0],
	retainedSelections: Map<string, RetainedNativeStatusSelection>,
	preOperationRevision?: string,
	canonicalRetentionRoot = target.cwd,
): Promise<Record<string, unknown>> {
	const failure = nativeOperationFailure(operation, error);
	if (!nativeMutationRequiresStatus(error)) return failure;
	if (nativeReviewCli.targetStatus === undefined) {
		return {
			...failure,
			outcome: "native-mutation-status-required",
			replayability: "status_required",
			next_action: "review.status",
			required_status_action: requiredStatusActionText(target.lineageId),
		};
	}
	try {
		const status = await nativeReviewCli.targetStatus(target);
		syncRetainedNativeStatusSelections(retainedSelections, canonicalRetentionRoot, status, target.baseRef);
		const projectedStatus = mapNativeTargetStatus(operation, status, target.lineageId);
		const { next_action: staleNextAction, required_status_action: staleStatusDirective, ...reconciledBase } = failure;
		void staleNextAction;
		void staleStatusDirective;
		// 字段缺陷（fambig，2026-08-16）：无封套的变更失败
		// 被标记为 mutationOutcome "unknown"，但对账后的权威
		// revision 与操作前 revision 相同，就证明了失败的
		// 调用从未变更。把该证明报告为 mutation_outcome none，
		// 且不对其主张任何重放禁止。所有真正模糊的结果
		// ——revision 变动、未持有操作前 revision，或 STATUS
		// 不可用——仍与从前一样保守失败。
		if (preOperationRevision !== undefined && status.authority?.revision === preOperationRevision) {
			const { replayability: staleReplayability, ...provenBase } = reconciledBase;
			void staleReplayability;
			return {
				...provenBase,
				...projectedStatus,
				status: "blocked",
				outcome: "native-mutation-status-reconciled",
				reconciliation: status.raw,
				authority_applicability: status.applicability,
				provider_action: status.action,
				mutation_performed: false,
				mutation_outcome: "none",
				mutation_outcome_reason: `authority revision unchanged across reconciliation (${preOperationRevision}); the failed operation provably did not mutate`,
			};
		}
		return {
			...reconciledBase,
			...projectedStatus,
			status: "blocked",
			outcome: "native-mutation-status-reconciled",
			reconciliation: status.raw,
			authority_applicability: status.applicability,
			provider_action: status.action,
			replayability: status.replayability,
			...(status.action === "start" && projectedStatus.next_action === undefined ? { next_action: "start" } : {}),
			required_status_action: projectedStatus.required_status_action ?? requiredStatusActionText(target.lineageId),
		};
	} catch (statusError) {
		return {
			...failure,
			outcome: "native-mutation-status-reconciliation-failed",
			reconciliation_failure: nativeOperationFailure(REVIEW_CONTROLLER_OPERATION.STATUS, statusError),
			replayability: "status_required",
			next_action: "review.status",
			required_status_action: requiredStatusActionText(target.lineageId),
		};
	}
}

function reviewWorkspaceGitIdentity(cwd: string): { toplevel: string; commonDir: string } {
	const git = (...arguments_: string[]): string =>
		execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
	const toplevel = realpathSync(git("rev-parse", "--show-toplevel"));
	const commonDir = realpathSync(resolve(cwd, git("rev-parse", "--git-common-dir")));
	return { toplevel, commonDir };
}

/**
 * 解析显式的用户授权工作区目标。显式路径可以
 * 嵌套，也可以属于与 Pi 会话 cwd 无关的仓库；
 * Git 会将其解析为规范的工作树顶层。只有当没有
 * 目标被选择或记住时，会话 cwd 才仍是
 * 旧式默认。
 */
export function resolveReviewControllerWorkspaceRoot(
	requested: string | undefined,
	sessionCwd: string,
	candidateViews: CandidateViewRegistry | null,
	lineageId: string | undefined,
): string {
	const remembered = requested === undefined && lineageId !== undefined
		? candidateViews?.resolveWorkspaceRoot(lineageId)
		: undefined;
	const selected = requested ?? remembered ?? sessionCwd;
	if (selected.trim().length === 0 || !isAbsolute(selected)) {
		throw new Error(`Review controller workspaceRoot must be an absolute path to an existing Git worktree root; received ${JSON.stringify(selected)}`);
	}
	let resolved: string;
	try {
		resolved = realpathSync(selected);
		if (!lstatSync(resolved).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(`Review controller workspaceRoot ${selected} is not an existing directory; create or adopt the worktree before binding review operations to it`);
	}
	let target: { toplevel: string; commonDir: string };
	try {
		target = reviewWorkspaceGitIdentity(resolved);
	} catch {
		if (requested === undefined && remembered === undefined) return sessionCwd;
		throw new Error(`Review controller workspaceRoot ${resolved} is not inside a Git worktree; review operations bind only to real worktrees of the session repository`);
	}
	if (lineageId !== undefined) candidateViews?.assertWorkspaceRoot(lineageId, target.toplevel);
	return target.toplevel;
}

function reviewLifecycleStorageKey(workspaceRoot: string, lineageId: string): string {
	return `${workspaceRoot}\u0000${lineageId}`;
}

function reviewCaptureSelectionStorageKey(collectBinding: string): string {
	return `capture\u0000${collectBinding}`;
}

export function cloneRetainedNativeUntrackedSelection(selection: NativeStartUntrackedSelection): RetainedNativeUntrackedSelection | undefined {
	if (selection.untrackedScope === undefined || selection.expectedUntrackedInventory === undefined) return undefined;
	return Object.freeze({
		untrackedScope: selection.untrackedScope,
		expectedUntrackedInventory: selection.expectedUntrackedInventory,
		intendedUntracked: Object.freeze([...(selection.intendedUntracked ?? [])]),
	});
}

function retainNativeStatusSelection(selections: Map<string, RetainedNativeStatusSelection>, key: string, selection: RetainedNativeStatusSelection): void {
	if (!selections.has(key)) {
		while (selections.size >= MAX_RETAINED_NATIVE_STATUS_SELECTIONS) {
			const oldestKey = selections.keys().next().value;
			if (oldestKey === undefined) return;
			selections.delete(oldestKey);
		}
	}
	selections.set(key, selection);
}

export function retainNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string, selection: RetainedNativeUntrackedSelection | undefined): void {
	if (selection !== undefined) retainNativeStatusSelection(selections, reviewLifecycleStorageKey(workspaceRoot, lineageId), selection);
}

export function readRetainedNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string): NativeStartUntrackedSelection {
	const selection = selections.get(reviewLifecycleStorageKey(workspaceRoot, lineageId));
	// 判别键是运行时契约：capture-route 条目以 baseRef 键为标记，保留条目的
	// 实际形状比联合类型宽，不得改用其他键判别。
	if (selection === undefined || "baseRef" in selection) return {};
	const untracked = selection as RetainedNativeUntrackedSelection;
	return {
		untrackedScope: untracked.untrackedScope,
		expectedUntrackedInventory: untracked.expectedUntrackedInventory,
		intendedUntracked: [...untracked.intendedUntracked],
	};
}

// gentle-pi#706：inspect 的 untrackedScope 往返把已解析的
// 选择保留在 pre-lineage 空 lineage 键下，使该工作树中下一次
// 普通 START 直接采纳它，而无需重新推导选择。
export function nativePreLineageCandidateIdentity(
	status: ReviewStatusV3,
): { targetIdentity: string; candidateTree: string } | undefined {
	const candidateTree = status.projection.currentCandidateTree;
	return isCanonicalProcessString(status.targetIdentity) && isCanonicalProcessString(candidateTree)
		? { targetIdentity: status.targetIdentity, candidateTree }
		: undefined;
}

export function readRetainedPreLineageNativeUntrackedSelection(
	selections: Map<string, RetainedNativeStatusSelection>,
	workspaceRoot: string,
): RetainedPreLineageNativeUntrackedSelection | undefined {
	const selection = selections.get(reviewLifecycleStorageKey(workspaceRoot, ""));
	return selection !== undefined &&
		!("baseRef" in selection) &&
		typeof (selection as Partial<RetainedPreLineageNativeUntrackedSelection>).targetIdentity === "string" &&
		typeof (selection as Partial<RetainedPreLineageNativeUntrackedSelection>).candidateTree === "string"
		? selection as RetainedPreLineageNativeUntrackedSelection
		: undefined;
}

export function sameNativePreLineageCandidate(
	selection: RetainedPreLineageNativeUntrackedSelection,
	status: ReviewStatusV3,
): boolean {
	const identity = nativePreLineageCandidateIdentity(status);
	return identity !== undefined &&
		identity.targetIdentity === selection.targetIdentity &&
		identity.candidateTree === selection.candidateTree;
}

function isRetainedNativeCaptureRoute(selection: RetainedNativeStatusSelection | undefined): selection is RetainedNativeCaptureRoute {
	return selection !== undefined && "workspaceRoot" in selection;
}

export function retainNativeCaptureRoutes(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, status: ReviewStatusV3, baseRef: string | undefined): void {
	const lineageId = status.authority?.lineageId;
	if (status.applicability !== "current_target" || !isCanonicalProcessString(lineageId) || isTerminalReviewAuthorityState(status.authority?.state)) return;
	const routes = (status.nextTransition?.kind === "collect" ? status.nextTransition.collect?.inputs ?? [] : []).map((input) => ({ key: reviewCaptureSelectionStorageKey(canonicalReviewCaptureBinding(input)), route: Object.freeze({ workspaceRoot, lineageId, ...(baseRef === undefined ? {} : { baseRef, committedOnly: true as const }) }) }));
	for (const { key, route } of routes) {
		const existing = selections.get(key);
		if (isRetainedNativeCaptureRoute(existing) && (existing.workspaceRoot !== route.workspaceRoot || existing.lineageId !== route.lineageId || existing.baseRef !== route.baseRef || existing.committedOnly !== route.committedOnly)) throw new NativeCaptureRouteRegistrationError("Provider collectBinding collides with a different registered route");
	}
	const current = new Set(routes.map(({ key }) => key));
	for (const [key, selection] of selections) if (isRetainedNativeCaptureRoute(selection) && selection.workspaceRoot === workspaceRoot && selection.lineageId === lineageId && !current.has(key)) selections.delete(key);
	for (const { key, route } of routes) if (!selections.has(key)) retainNativeStatusSelection(selections, key, route);
}

export function readRetainedNativeCaptureRoute(selections: Map<string, RetainedNativeStatusSelection>, collectBinding: string): RetainedNativeCaptureRoute | undefined {
	const selection = selections.get(reviewCaptureSelectionStorageKey(collectBinding));
	return isRetainedNativeCaptureRoute(selection) ? selection : undefined;
}

function isTerminalReviewAuthorityState(state: string | undefined): boolean { return state === "invalidated" || state === "approved" || state === "escalated"; }

export function clearRetainedNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string): void {
	selections.delete(reviewLifecycleStorageKey(workspaceRoot, lineageId));
}

export function clearRetainedNativeStatusSelectionsOnTerminal(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string | undefined, state: string | undefined): void {
	if (lineageId === undefined || !isTerminalReviewAuthorityState(state)) return;
	if (state !== "approved") clearRetainedNativeUntrackedSelection(selections, workspaceRoot, lineageId);
	for (const [key, selection] of selections) if (isRetainedNativeCaptureRoute(selection) && selection.workspaceRoot === workspaceRoot && selection.lineageId === lineageId) selections.delete(key);
}

export function syncRetainedNativeStatusSelections(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, status: ReviewStatusV3, baseRef: string | undefined): void {
	clearRetainedNativeStatusSelectionsOnTerminal(selections, workspaceRoot, status.authority?.lineageId, status.authority?.state);
	retainNativeCaptureRoutes(selections, workspaceRoot, status, baseRef);
}

export function requiresExplicitTargetLifecycleRoot(requested: string | undefined, sessionCwd: string, workspaceRoot: string): boolean {
	return requested !== undefined || workspaceRoot !== sessionCwd;
}

// gentle-pi#311 P4 —— 轻量 Pi 宿主中继。provider 通过在 pi 绑定的
// `review.capture-result` collect 输入上签发 --materialize token 来决定
// 宿主满足哪些捕获槽位；从不做任何推断。
// P4b：生产 runner 将中继与进程内权威
// 接缝组合（lib/authority/capture-relay.ts）——renderBinding 负责提示词
