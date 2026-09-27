// jero-ai 评审工具注册：jero_review_scope / jero_review_capture_group /
// jero_review_capture / jero_review 四个工具的定义与同意子状态机。
// 自 extensions/jero-ai.ts 外抽（机械平移，语义零改动）：闭包依赖经
// JeroReviewToolContext 传入，可变提醒状态（reminderState）以持有对象
// 共享，保证与 jero-ai 的事件处理器读到同一份活跃/纪元值。
// 注意：工具名由 scripts/check-docs-manifest.mjs 的 collectTools 派生，
// 该扫描显式包含本文件。

import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { consumeReviewMutation, pendingReviewMutation } from "./review-reminder-receipt.ts";
import { type JeroRenderContext, renderJeroLifecycleCall, renderJeroResult } from "./jero-ai-renderer.ts";
import { readCandidateContextManifestPage, type CandidateViewRegistry } from "./review-candidate-view.ts";
import { type NativeReviewCli } from "./authority/client-contract.ts";
import {
	authorizeDestructiveReviewOperation, parseReviewControllerParameters,
	REVIEW_CAPTURE_GROUP_PARAMETERS, REVIEW_CAPTURE_PARAMETERS, REVIEW_CONTROLLER_OPERATION,
	REVIEW_CONTROLLER_PARAMETERS, REVIEW_SCOPE_PARAMETERS, type ReviewScopeParameters,
	reviewToolOperationPath
} from "./jero-ai-review-params.ts";
import {
	completedGrantedReviewConsent, isHostReviewConsentEligibleOperation,
	pendingReviewConsentSessionKey, processRetainedNativeStatusSelections,
	type PendingReviewConsentRegistry, type PendingReviewConsentSessionKey
} from "./jero-ai-review-consent.ts";
import { resolveReviewControllerWorkspaceRoot } from "./jero-ai-review-native-ops.ts";
import { reviewTrivialityHint } from "./jero-ai-review-hint.ts";
import { assessJeroReviewRiskV1 } from "./authority/risk-assess.ts";
import { executeReviewCaptureGroupOperation, executeReviewCaptureOperation } from "./jero-ai-review-select.ts";
import { executeReviewControllerOperation } from "./jero-ai-review-controller.ts";
import { isPiConsentV3, presentReviewConsentUi } from "./review-consent-ui.ts";
import {
	grantReviewSessionPermission, hasReviewSessionPermission,
	resolveCanonicalGitRepositoryIdentity, type ReviewSessionIdentity, reviewSessionPermissionEpoch,
	sameReviewSessionIdentity
} from "./review-session-standing-permission.ts";
import type { ChildStandingReviewPermissionClient } from "./review-session-standing-permission-ipc.ts";

export interface JeroReviewToolContext {
	pi: ExtensionAPI;
	nativeReviewCli: NativeReviewCli;
	candidateViews: CandidateViewRegistry;
	pendingReviewConsentRegistry: PendingReviewConsentRegistry;
	pendingReviewConsentFallbackKey: symbol;
	reviewConsentNow: () => number;
	reviewConsentScheduleTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	childStandingReviewPermission: Pick<ChildStandingReviewPermissionClient, "requestAuthorization"> | undefined;
	reminderState: { active: boolean; epoch: number };
	capturePermissionIdentity: (context: ExtensionContext, cwd?: string) => Promise<ReviewSessionIdentity | undefined>;
	setReviewSessionPermissionStatus: (context: ExtensionContext, active: boolean) => void;
}

export function registerJeroReviewTools(context: JeroReviewToolContext): void {
	const { pi, nativeReviewCli, candidateViews, pendingReviewConsentRegistry, pendingReviewConsentFallbackKey, reviewConsentNow, reviewConsentScheduleTimer, childStandingReviewPermission, reminderState, capturePermissionIdentity, setReviewSessionPermissionStatus } = context;

	pi.registerTool({
		name: "jero_review_scope",
		renderShell: "self",
		label: "Jero Review Scope",
		description: "Read one bounded, integrity-checked page of the controller-owned frozen changed scope. This read-only tool never inspects the ambient or candidate tree.",
		parameters: REVIEW_SCOPE_PARAMETERS,
		executionMode: "parallel",
		renderCall(_args, theme, context) {
			return renderJeroLifecycleCall(
				"review scope",
				theme,
				context as JeroRenderContext | undefined,
			);
		},
		renderResult(result, options, theme, context) {
			return renderJeroResult(result, options, theme, context as JeroRenderContext | undefined);
		},
		async execute(_toolCallId, parameters) {
			const input = parameters as ReviewScopeParameters;
			const details = readCandidateContextManifestPage(input.manifest, input.sha256, input.cursor ?? 0);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});

	// 评审者捕获运行的镜头位于其 collect 绑定内，因此
	// 卡片可以显示 "review capture · risk" 而不是光秃秃的操作名。
	const lensLabel = (lens: unknown): string | undefined =>
		typeof lens === "string" && lens.length > 0 ? lens.replace(/^review-/, "") : undefined;
	const collectBindingLens = (binding: unknown): string | undefined => {
		if (typeof binding !== "string") return undefined;
		try {
			const parsed = JSON.parse(binding) as Record<string, unknown>;
			const subject = (parsed.artifactSubject ?? parsed.artifact_subject) as Record<string, unknown> | undefined;
			return lensLabel(subject?.lens);
		} catch {
			return undefined;
		}
	};
	const withLenses = (operation: string, lenses: readonly (string | undefined)[]): string => {
		const named = lenses.filter((lens): lens is string => lens !== undefined);
		return named.length === 0 ? operation : `${operation} · ${named.join(" · ")}`;
	};

	pi.registerTool({
		name: "jero_review_capture_group",
		renderShell: "self",
		label: "Jero Review Capture Group",
		description: "Capture one complete provider-issued materialize reviewer group. It validates the exact ordered current collect set, forecasts its bounded model cost, runs reviewers concurrently, and admits outputs one at a time in provider order.",
		promptSnippet: "Use one complete exact current STATUS materialize reviewer group; acknowledge its forecast before the grouped run.",
		promptGuidelines: [
			"Pass only lineageId, the complete ordered collectBindings array from one current STATUS result, and reviewerRunAcknowledged after its forecast. Never mix, reorder, duplicate, or partially select bindings.",
			"The group materializes and runs independent reviewers concurrently, but rechecks STATUS before every provider-ordered submission. It stops on a closure, correction, drift, or uncertain capture outcome; it never follows another transition or replays a prepared output.",
		],
		parameters: REVIEW_CAPTURE_GROUP_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme, context) {
			const bindings = (args as { collectBindings?: unknown }).collectBindings;
			const lenses = Array.isArray(bindings) ? bindings.map(collectBindingLens) : [];
			return renderJeroLifecycleCall(withLenses("review capture group", lenses), theme, context as JeroRenderContext | undefined);
		},
		renderResult(result, options, theme, context) {
			return renderJeroResult(result, options, theme, context as JeroRenderContext | undefined);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review capture group was cancelled");
			const details = await executeReviewCaptureGroupOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				signal,
				candidateViews,
				((sessionKey: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(sessionKey) ?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!)(pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey)),
				true,
			);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});

	pi.registerTool({
		name: "jero_review_capture",
		renderShell: "self",
		label: "Jero Review Capture",
		description: "Capture exactly one provider-issued ordinary native review collect slot. This is not a controller operation: it validates one opaque collect binding against current target-scoped STATUS, executes at most one capture, and never follows a transition.",
		promptSnippet: "Use one exact current STATUS collectBinding for one ordinary native capture; call fresh STATUS before every additional capture.",
		promptGuidelines: [
			"Pass only lineageId, the JSON-serialized exact collectBinding from current STATUS, and the route-specific optional acknowledgement or correctionLines value. Never compose provider argument tokens, prompts, results, verdicts, or lens arrays.",
			"A materialize reviewer slot first forecasts one model run; re-submit that same exact binding with reviewerRunAcknowledged: true to authorize one host relay. Correction-plan slots require correctionLines inside the provider-issued bounds, counted in diff lines (one replaced source line is one deletion plus one addition) — a different unit from the frozen logical correction budget. Refuter and validation vectors execute exactly once as provider-rendered.",
			"A native terminal closure or nonterminal capture returns directly. Do not expect automatic STATUS, FINALIZE, receipt, delivery, or another capture; call fresh STATUS before any next capture.",
		],
		parameters: REVIEW_CAPTURE_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme, context) {
			return renderJeroLifecycleCall(
				withLenses("review capture", [collectBindingLens((args as { collectBinding?: unknown }).collectBinding)]),
				theme,
				context as JeroRenderContext | undefined,
			);
		},
		renderResult(result, options, theme, context) {
			return renderJeroResult(result, options, theme, context as JeroRenderContext | undefined);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review capture was cancelled");
			const details = await executeReviewCaptureOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				signal,
				candidateViews,
				((sessionKey: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(sessionKey) ?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!)(pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey)),
				true,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "jero_review",
		renderShell: "self",
		label: "Jero Review Controller",
		description:
			"Inspect and recover review authority and start native ordinary review. Ordinary capture is available only through the separate jero_review_capture tool. Review outcomes never authorize delivery: commit, push, pull-request, and release commands follow ordinary repository policy. RESET/RECOVER remain destructive and are executed by the audited in-process authority.",
		promptSnippet: "Inspect authority, then start native ordinary review; use jero_review_capture for one current collect slot",
		promptGuidelines: [
			'Call {"operation":"inspect"} before START. New native ordinary START uses a JSON string such as "{\\"mode\\":\\"ordinary\\"}"; an explicit baseRef must be paired with committedOnly: true to request a committed range, while policyPath remains repository-local. policyHash is legacy compact-only. The controller derives lineage, Git/untracked scope, tier, lenses, authored lines, and budget; the frozen correction budget counts logical corrections, while correction-plan correctionLines count diff lines (one replaced source line is one deletion plus one addition).',
			'An inspect blocked on the intended-untracked selection returns nextStep naming the exact continuation: call select-intended-untracked with the returned selectionBinding, or call inspect again with top-level untrackedScope ("exclude", or "select" with intendedUntracked) to resolve the round trip in one call; the retained selection is adopted by the next plain START.',
			"Use RECONCILE_AUTHORITY only to quarantine one invalid native recovery successor. Supply exact predecessorLineage, expectedPredecessorRevision, successorLineage, expectedSuccessorRevision, actor, and reason values; Pi derives and displays the seven-line native authorization binding for fresh UI approval. The predecessor stays untouched, native returns the durable audit record, and Pi never falls back to RESET or RECOVER.",
			"Use ABANDON only after an explicit user decision and with exact native inputs: lineage, expectedRevision, snapshotIdentity, capturedLensResults, findingsPresent, actor, and reason. A dual reconciliation may supply only anomalies `unchanged_target,malformed_recovery_authorization` in that exact order. The legacy quarantine and alias-repair routes are retired: a jero-pi store never carries legacy authority, so invalid recovery successors go through RECONCILE_AUTHORITY and a malformed lineage goes through reclaim. `review dispose-result` is unsupported pending design.",
			"Lens, refuter, and validator verdicts are admitted natively, never Pi-authored. Use jero_review_capture with exactly one current provider-owned collectBinding for ordinary native capture; it never follows another transition.",
			"For blocked-legacy or blocked-mixed, do not call START repeatedly. Explain invalidation, request explicit user authorization, then call RESET or RECOVER only after authorization. RESET and RECOVER_LOCK route to audited native `gentle-ai review reclaim`; only RESET carries the legacy repositoryId, commonDirHash, inventoryHash, and confirmation challenge. RECOVER routes to native `gentle-ai review recover` with exactly six inputs: predecessorLineage, expectedPredecessorRevision, successorLineage, disposition, actor, and reason. Never send RECOVER the reset challenge and never send it a maintainerAuthorization: Pi reads fresh native target status, pins the predecessor lineage, revision, provider-selected disposition, and target identity, derives the exact six-line native authorization binding, displays it for fresh UI approval, and re-reads status before mutating. Negotiated target status supplies the sole accepted recovery disposition, and a caller-supplied substitute is rejected. Treat a native-input-required envelope as a request for exact values, never as permission to invent them. After a committed native recovery record, INSPECT before any fresh ordinary START.",
			"A consent-required START may be resolved inside the eligible interactive Pi host. Its third UI action is host-owned: it runs this envelope's exact provider grant once and allows later fresh validated envelopes only for the same live SessionManager, nonempty session ID, and canonical Git common-directory identity, including sibling worktrees; an unrelated repository requires a new explicit human grant. Revoke removes the current repository grant, while nonreload replacement, quit, and process exit remove all session grants; reload preserves them. It grants no provider mode, verdict, acknowledgement, maintenance, delivery, or cross-repository authority. A package-owned child may ask its parent only with the canonical digest of its exact pending target; the parent binds that digest to the task repository and fails closed otherwise. If the tool returns an unresolved envelope, present the original two provider choices without changing machine tokens, commands, target IDs, or invocations; never add the host action to the decoded provider envelope. After one explicit relayed human answer, call answer-consent exactly once with only consentBinding and answer (`granted` or `declined`). Never create host permission from tool arguments, model prose, child/headless responses, or an uncertain native result. A reported lineage_created false or pre-authority validation error proves no lineage was created. After ambiguous START output, the controller calls target-scoped native status once and returns only its declared action. An ambiguous jero_review_capture outcome independently reconciles once and never replays the capture.",
			"Use jero_review only for native review authority operations; delivery commands follow ordinary repository policy.",
			'ASSESS () is read-only and needs no lineageId: after a delegated writer returns, call {"operation":"assess"} over its diff and follow the returned plan (writerSelfVerification, structuralReadbackOnly, independentVerifier, reason) instead of judging non-triviality from the task description. Pass input as JSON only to assess a committed range ({"baseRef":"<ref>","committedOnly":true}), to record the writer profile ({"writerModelId":"...", "writerEffort":"..."}), or to state the native review\'s outcome for this candidate ({"nativeReviewOutcome":"closed|declined|unavailable|unknown"}). Omitting writerModelId and writerEffort is treated as a small writer profile (fail closed), never large, because the writer\'s actual profile is then unknown to this call; pass the writer\'s real model id/effort to get credit for a known large profile. The on-path (writer self-verification is the record, no separate verifier) holds only when nativeReviewOutcome is "closed" for this candidate; a decline, an unavailable review, or an omitted/unknown outcome falls back to the exact risk-gated plan RDD off would return, re-enabling the separate verifier -- a decline is candidate-scoped and never lowers the bar below RDD off. "closed" is never inferred: pass it only right after this same caller acknowledged the approved review for this same candidate; omitting nativeReviewOutcome only ever auto-derives declined/unavailable, bound to that exact candidate\'s own target identity, never to a different candidate or to bare repository state. The result\'s outcome_source (explicit|derived|unknown) states which. A failed or unavailable native assessment reports risk "unassessable", verified exactly like "high". This never mutates review authority state.',
			'An inspect result may carry triviality_hint (passive risk with few authored changed lines). Treat it as advisory only: confirm with the user whether the full review lifecycle is warranted before skipping it; {"operation":"assess"} is the read-only lightweight path, and START remains available.',
		],
		parameters: REVIEW_CONTROLLER_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme, context) {
			return renderJeroLifecycleCall(
				reviewToolOperationPath(args),
				theme,
				context as JeroRenderContext | undefined,
			);
		},
		renderResult(result, options, theme, context) {
			return renderJeroResult(result, options, theme, context as JeroRenderContext | undefined);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review controller operation was cancelled");
			await authorizeDestructiveReviewOperation(parameters, ctx);
			const sessionKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
			const retainedSelections = processRetainedNativeStatusSelections.get(sessionKey)
				?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!;
			// 在原生 await 之前快照：并发的自身写入即是新一代。
			const acknowledgementEpoch = reminderState.epoch;
			let acknowledgementRoot: string | undefined;
			let acknowledgementMutation: string | undefined;
			try {
				const parsed = parseReviewControllerParameters(parameters);
				if (parsed.operation === REVIEW_CONTROLLER_OPERATION.ACKNOWLEDGE_APPROVED) {
					acknowledgementRoot = resolveReviewControllerWorkspaceRoot(parsed.workspaceRoot, ctx.cwd, candidateViews, parsed.lineageId);
					acknowledgementMutation = pendingReviewMutation(ctx.sessionManager, acknowledgementRoot);
				}
			} catch { /* 非法参数与不可用根目录由控制器校验负责。 */ }
			let details = await executeReviewControllerOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				{
					signal,
					candidateViews,
					context: ctx,
					retainedUntrackedSelections: retainedSelections,
					pendingReviewConsentRegistry,
					pendingReviewConsentFallbackKey,
					reviewConsentNow,
					reviewConsentScheduleTimer,
				},
			);
			// 微小候选提示（建议性，绝不改写权威输出）：inspect 得到干净的
			// START 就绪时，用与 ASSESS 同源的进程内风险评估器补一个快照，
			// 仅在 passive 且 authored 行数极小时附加 triviality_hint。
			// 提示失败绝不影响 inspect 的权威结果。
			try {
				if (parseReviewControllerParameters(parameters).operation === REVIEW_CONTROLLER_OPERATION.INSPECT && details.status === "ready") {
					const hint = reviewTrivialityHint(assessJeroReviewRiskV1({ cwd: ctx.cwd }));
					if (hint !== undefined) details.triviality_hint = hint;
				}
			} catch { /* 提示是尽力而为的附加信息。 */ }
			if (details.operation === REVIEW_CONTROLLER_OPERATION.ACKNOWLEDGE_APPROVED &&
				details.outcome === "native-approved-acknowledgement-completed" &&
				details.status === "closed" && details.authority === "burned" &&
				typeof details.target_identity === "string") {
				try {
					if (reminderState.active && acknowledgementEpoch === reminderState.epoch && acknowledgementRoot && pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey) === sessionKey) {
						consumeReviewMutation(pi, ctx.sessionManager, acknowledgementRoot, acknowledgementMutation, "acknowledged", details.target_identity);
					}
				} catch { /* 簿记不能掩盖已确认的原生销毁。 */ }
			}
			if (
				isHostReviewConsentEligibleOperation(parameters) &&
				details.outcome === "native-review-consent-required" &&
				typeof details.consent_binding === "string"
			) {
				const resolved = pendingReviewConsentRegistry.resolve(details.consent_binding);
				const pending = resolved?.pending;
				const eligiblePending = pending !== undefined && isPiConsentV3(pending.consent)
					? pending
					: undefined;
				const answerPendingConsent = async (answer: "granted" | "declined") => executeReviewControllerOperation(
					{
						operation: REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT,
						input: JSON.stringify({ consentBinding: eligiblePending!.id, answer }),
						workspaceRoot: eligiblePending!.authorityCwd,
					},
					ctx.cwd,
					nativeReviewCli,
					{
						signal,
						candidateViews,
						context: ctx,
						retainedUntrackedSelections: retainedSelections,
						pendingReviewConsentRegistry,
						pendingReviewConsentFallbackKey,
						reviewConsentNow,
						reviewConsentScheduleTimer,
					},
				);
				let permissionWorkspaceRoot: string | undefined;
				try {
					const parsed = parseReviewControllerParameters(parameters);
					permissionWorkspaceRoot = resolveReviewControllerWorkspaceRoot(parsed.workspaceRoot, ctx.cwd, candidateViews, parsed.lineageId);
				} catch {
					// 上方成功的原生操作仍是权威；无法解析的
					// 本地绑定只是无法消耗宿主权限。
				}
				const initialIdentity = permissionWorkspaceRoot === undefined
					? undefined
					: await capturePermissionIdentity(ctx, permissionWorkspaceRoot);
				if (eligiblePending !== undefined && initialIdentity === undefined) {
					// 包子进程没有本地常备授权。它只能为其
					// 继承的父会话询问该确切待定目标的规范仓库身份，
					// 然后在本地重放该绑定一次。
					const repositoryIdentity = permissionWorkspaceRoot === undefined
						? undefined
						: await resolveCanonicalGitRepositoryIdentity(permissionWorkspaceRoot);
					if (repositoryIdentity !== undefined && await childStandingReviewPermission?.requestAuthorization(repositoryIdentity) === true) details = await answerPendingConsent("granted");
				} else if (eligiblePending !== undefined && initialIdentity !== undefined) {
					const initialEpoch = reviewSessionPermissionEpoch(initialIdentity);
					const permissionAlreadyActive = hasReviewSessionPermission(initialIdentity);
					const selection = initialEpoch === undefined
						? undefined
						: permissionAlreadyActive
							? { kind: "host-session" as const }
							: await presentReviewConsentUi(ctx, eligiblePending.consent);
					if (selection !== undefined) {
						const confirmedIdentity = await capturePermissionIdentity(ctx, permissionWorkspaceRoot);
						if (initialEpoch !== undefined && confirmedIdentity !== undefined && sameReviewSessionIdentity(initialIdentity, confirmedIdentity) && reviewSessionPermissionEpoch(confirmedIdentity) === initialEpoch) {
							const answer = selection.kind === "provider" ? selection.answer : "granted";
							details = await answerPendingConsent(answer);
							if (!permissionAlreadyActive && selection.kind === "host-session" && completedGrantedReviewConsent(details)) {
								if (grantReviewSessionPermission(confirmedIdentity, initialEpoch)) {
									setReviewSessionPermissionStatus(ctx, true);
									try { ctx.ui.notify("本 Pi 会话与该 Git 仓库已允许进行评审。", "info"); } catch { /* 仅为非阻塞指示。 */ }
								} else {
									try { ctx.ui.notify("该评审已启动，但内存中的会话权限注册表不兼容，后续候选将再次询问。", "warning"); } catch { /* 尽力而为。 */ }
								}
							}
						}
					}
				}
			}
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});
}
