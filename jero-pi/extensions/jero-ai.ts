// jero-ai 扩展装配：createJeroAiExtension 工厂——依赖注入、评审工具注册、
// SDD 命令与启动流程。评审域实现已拆至 lib/jero-ai-review-*（见 import/re-export）。
export function createJeroAiExtension(dependencies: JeroRuntimeDependencies = {}): (pi: ExtensionAPI) => void {
	return createJeroAiExtensionForTesting(dependencies);
}

function createJeroAiExtensionForTesting(
	dependencies: JeroRuntimeDependencies = {},
): (pi: ExtensionAPI) => void {
	// P4c/P4d：默认 CLI 是保守失败的 P1 桩，带 SDD 投影
	// 对、评审读路径、RDD 模式对、SDD 尝试对，以及
	// （P4d-e）START 对——直接启动与同意仪式——由
	// jero 权威在进程内提供（lib/jero-authority-cli.ts）。
	const nativeReviewCli = dependencies.nativeReviewCli === undefined
		? createJeroAuthorityReviewCli() as unknown as NativeReviewCli
		: dependencies.nativeReviewCli;
	const childStandingReviewPermissionLease = dependencies.childStandingReviewPermissionClient === undefined
		? acquireChildStandingReviewPermissionClient(dependencies.processEnv ?? process.env)
		: undefined;
	const childStandingReviewPermission = dependencies.childStandingReviewPermissionClient ?? childStandingReviewPermissionLease?.client;
	const reviewConsentNow = dependencies.now ?? (() => Date.now());
	const reviewConsentScheduleTimer = dependencies.scheduleTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const pendingReviewConsentRegistry = dependencies.pendingReviewConsentRegistry ?? processPendingReviewConsentRegistry;
	setGuardrailsProcessEnv(dependencies.processEnv ?? process.env);
	return function jeroAi(pi: ExtensionAPI): void {
		const flags = pi as unknown as { registerFlag?: (name: string, definition: { description: string; type: "string"; default?: string }) => void };
		flags.registerFlag?.(SDD_CHANGE_FLAG, {
			description: "Internal launch-local selected SDD change identity for package-owned child agents.",
			type: "string",
		});
	const pendingReviewConsentFallbackKey = Symbol("pending-review-consent-fallback");
	const candidateViews = dependencies.candidateViews === undefined ? new CandidateViewRegistry() : dependencies.candidateViews;
	const herdrLifecycle = createHerdrConfirmationLifecycle(pi.events);
	const permissionEnvironment = dependencies.processEnv ?? process.env;

	const setReviewSessionPermissionStatus = (context: ExtensionContext, active: boolean): void => {
		try {
			(context.ui as unknown as { setStatus?: (key: string, text?: string) => void }).setStatus?.(
				REVIEW_SESSION_PERMISSION_STATUS_KEY,
				active ? REVIEW_SESSION_PERMISSION_STATUS_TEXT : undefined,
			);
		} catch { /* 状态显示是非阻塞的，也绝不是权限权威。 */ }
	};
	const capturePermissionIdentity = (context: ExtensionContext, cwd: string = context.cwd): Promise<ReviewSessionIdentity | undefined> =>
		captureReviewSessionIdentity({ ...context, cwd }, permissionEnvironment);
	const refreshReviewSessionPermissionStatus = async (context: ExtensionContext): Promise<ReviewSessionIdentity | undefined> => {
		const identity = await capturePermissionIdentity(context);
		setReviewSessionPermissionStatus(context, identity !== undefined && hasReviewSessionPermission(identity));
		return identity;
	};
	const revokeCurrentReviewSessionPermission = (context: ExtensionContext): boolean => {
		const coordinates = reviewSessionManagerAndId(context);
		const revoked = coordinates === undefined ? false : revokeReviewSessionPermissionsForSession(coordinates.manager, coordinates.sessionId);
		setReviewSessionPermissionStatus(context, false);
		return revoked;
	};
	const revokeCurrentRepositoryReviewSessionPermission = async (context: ExtensionContext): Promise<boolean> => {
		const identity = await capturePermissionIdentity(context);
		const revoked = identity === undefined ? false : revokeReviewSessionPermission(identity);
		setReviewSessionPermissionStatus(context, false);
		return revoked;
	};

	let reminderSessionActive = true;
	let reminderEpoch = 0;
	// 纪律引导窗口：session_start / session_compact 置位，
	// agent_end / session_shutdown 复位（见下方 context 处理器）。
	let disciplineBootstrapPending = false;
	pi.on("session_shutdown", (event, context) => {
		reminderSessionActive = false;
		reminderEpoch += 1;
		disciplineBootstrapPending = false;
		// Pi 在 reload 以及会话替换/退出时都会拆除该注册表。
		try { candidateViews?.cleanupAll(); } catch { /* 保留失败的自有视图以便稍后恢复。 */ }
		const reason = (event as { reason?: unknown }).reason;
		if (reason !== "reload") {
			if (childStandingReviewPermissionLease !== undefined) childStandingReviewPermissionLease.closeIfCurrent();
			else childStandingReviewPermission?.close();
			revokeCurrentReviewSessionPermission(context);
		}
		const sessionKey = pendingReviewConsentSessionKey(context, pendingReviewConsentFallbackKey);
		cleanupAllPendingReviewConsents(pendingReviewConsentRegistry, sessionKey);
		processRetainedNativeStatusSelections.delete(sessionKey);
		processAgentEndSubagentDepth.delete(sessionKey);
	});

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
			'ASSESS (gentle-pi#662/#668) is read-only and needs no lineageId: after a delegated writer returns, call {"operation":"assess"} over its diff and follow the returned plan (writerSelfVerification, structuralReadbackOnly, independentVerifier, reason) instead of judging non-triviality from the task description. Pass input as JSON only to assess a committed range ({"baseRef":"<ref>","committedOnly":true}), to record the writer profile ({"writerModelId":"...", "writerEffort":"..."}), or to state the native review\'s outcome for this candidate ({"nativeReviewOutcome":"closed|declined|unavailable|unknown"}). Omitting writerModelId and writerEffort is treated as a small writer profile (fail closed), never large, because the writer\'s actual profile is then unknown to this call; pass the writer\'s real model id/effort to get credit for a known large profile. The on-path (writer self-verification is the record, no separate verifier) holds only when nativeReviewOutcome is "closed" for this candidate; a decline, an unavailable review, or an omitted/unknown outcome falls back to the exact risk-gated plan RDD off would return, re-enabling the separate verifier -- a decline is candidate-scoped and never lowers the bar below RDD off. "closed" is never inferred: pass it only right after this same caller acknowledged the approved review for this same candidate; omitting nativeReviewOutcome only ever auto-derives declined/unavailable, bound to that exact candidate\'s own target identity, never to a different candidate or to bare repository state. The result\'s outcome_source (explicit|derived|unknown) states which. A failed or unavailable native assessment reports risk "unassessable", verified exactly like "high". This never mutates review authority state.',
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
			const acknowledgementEpoch = reminderEpoch;
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
				signal,
				candidateViews,
				ctx,
				retainedSelections,
				pendingReviewConsentRegistry,
				pendingReviewConsentFallbackKey,
				reviewConsentNow,
				reviewConsentScheduleTimer,
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
					if (reminderSessionActive && acknowledgementEpoch === reminderEpoch && acknowledgementRoot && pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey) === sessionKey) {
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
					signal,
					candidateViews,
					ctx,
					retainedSelections,
					pendingReviewConsentRegistry,
					pendingReviewConsentFallbackKey,
					reviewConsentNow,
					reviewConsentScheduleTimer,
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

	function runSddPreflight(ctx: ExtensionContext, promptFields: readonly SddPreflightField[] = []): Promise<SddPreflightPreferences> {
		return ensureSddPreflight(ctx, { pi, installAssets: (cwd) => installPackageAssets(cwd, true, ["sdd"]), applyModelConfig: async () => applySavedModelConfig(ctx) }, { promptFields });
	}

	pi.on("session_start", async (event, ctx) => {
		reminderSessionActive = true;
		reminderEpoch += 1;
		disciplineBootstrapPending = true;
		try { candidateViews?.sweepOrphans(ctx.cwd); } catch { /* 所有权清扫不得阻塞启动。 */ }
		const reason = (event as { reason?: unknown }).reason;
		if (reason !== "reload") revokeCurrentReviewSessionPermission(ctx);
		await refreshReviewSessionPermissionStatus(ctx);
		try {
			const installResult = await installPackageAssets(ctx.cwd, true, ["delegation", "review"]);
			migrateLegacyProjectModelOverrides(ctx.cwd);
			const modelResult = await applySavedModelConfig(ctx);
			if (ctx.hasUI && modelResult.invalidPath) {
				ctx.ui.notify(
					`el Jero 已跳过模型配置：${modelResult.invalidPath} 不是合法的 JSON 或不是对象。请修复或删除该文件，然后重新运行 /jero:models。`,
					"warning",
				);
				return;
			}
			if (ctx.hasUI && modelResult.updated > 0) {
				ctx.ui.notify(
					`el Jero 已将保存的模型配置应用到 ${modelResult.updated} 个代理。全局 delegation/review 资产已就绪：${installResult.agents} 个新代理、${installResult.chains} 条新链、${installResult.support} 个新支持文件。`,
					"info",
				);
			}
		} catch (error) {
			if (ctx.hasUI) {
				const message =
					error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`el Jero 模型配置扫描失败：${message}`,
					"warning",
				);
			}
		}
		// 保留启动时的传输协商，但不要把其目标当作
		// 所有权基线：reload 可能仍有未完成的持久回执。
		try {
			const sessionKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
			await resolveNegotiatedReviewStatusForSession(nativeReviewCli, ctx, sessionKey);
		} catch {
			// 启动协商只是尽力而为；绝浮出或抛出。
		}
	});

	// 精益纪律的模式读取：倒序回放会话分支中的 lean 条目。会话管理器
	// 缺失或不可读时保守回退到 env/默认档——模式解析绝不能阻塞提示词组装。
	const readLeanBranch = (context: ExtensionContext): readonly LeanBranchEntry[] => {
		try {
			return context.sessionManager.getBranch() as readonly LeanBranchEntry[];
		} catch {
			return [];
		}
	};

	pi.on("input", async (event, ctx) => {
		// "stop lean" 是唯一的自然语言停用短语：仅命中独立短语（大小写与
		// 尾部标点容忍），由 /jero:lean 或新会话恢复开启。
		if (typeof event.text === "string" && isLeanDeactivationText(event.text)) {
			pi.appendEntry(LEAN_MODE_ENTRY_TYPE, { mode: "off" });
			if (ctx.hasUI) ctx.ui.notify("Jero 精益纪律已关闭（本会话）。/jero:lean <mode> 可重新开启。", "info");
			return { action: "handled" };
		}
		if (typeof event.text !== "string" || !isSddPreflightTrigger(event.text)) {
			return { action: "continue" };
		}
		try { await runSddPreflight(ctx); }
		catch (error) {
			if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
			return { action: "handled" };
		}
		return { action: "continue" };
	});

	let nativeSddStartupBlock: string | undefined;
	pi.on("before_agent_start", async (event, ctx) => {
		nativeSddStartupBlock = undefined;
		const isSddAgent = isSddAgentStartEvent(event);
		const isNamedAgent = isNamedAgentStartEvent(event);
		const subagentDepthKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
		if (isSddAgent || isNamedAgent) {
			processAgentEndSubagentDepth.set(subagentDepthKey, (processAgentEndSubagentDepth.get(subagentDepthKey) ?? 0) + 1);
		} else {
			processAgentEndSubagentDepth.set(subagentDepthKey, 0);
		}
		try {
			if (isSddAgent && !getSddPreflightPreferences(ctx) && ctx.mode !== "rpc") {
				await runSddPreflight(ctx);
			}
		} catch (error) {
			// Pi 会记录 before_agent_start 抛出的错误并继续。返回一个
			// 未解决的门，而不是默默丢失预检指令。
			return { systemPrompt: `${event.systemPrompt}\n\nSDD preflight unresolved: ${error instanceof Error ? error.message : String(error)}\nSTOP: Do not initialize the project, launch phases, write artifacts, or infer consent. Request session preflight confirmation before continuing.` };
		}
		const prefs = getSddPreflightPreferences(ctx);
		// RPC 子进程从不解析或持久化默认值。父会话派发门
		// 在既有的任务上下文中传输渲染出的块，且 Gentle
		// Agents 会在生成子进程之前拒绝缺失/畸形的载荷。
		const sddPrompt =
			prefs && (!isNamedAgent || isSddAgent)
				? `\n\n${renderSddPreflightPrompt(prefs)}`
				: "";
		const phase = isSddAgent ? sddPhaseFromAgentStartEvent(event) : undefined;
		const launchSddChange = readSddChangeFlag(pi);
		if (launchSddChange !== undefined && !phase) nativeSddStartupBlock = "Receiving agent has no recognized SDD phase";
		const nativeStatusPrompt = phase
			? await (async () => {
				try {
					if (launchSddChange === undefined) {
						if (phase === "sync") return `\n\n${renderNativeSddPhasePrompt(resolveStartupControllerSddStatus(ctx.cwd, undefined, true, prefs?.artifactStore), phase)}`;
						const { status } = await readCommandSddStatus("", ctx);
						if (status.changeName === null || !status.phaseInstructions || status.nextRecommended !== phase) throw new Error(`Native SDD discovery cannot run ${phase}.`);
						return `\n\n${renderNativeSddPhasePrompt(status, phase)}`;
					}
					const agentName = `sdd-${phase}`;
					const startup = await resolveSelectedNativeSddChangeStartup(
						launchSddChange,
						ctx.cwd,
						agentName,
						nativeReviewCli,
						(options) => resolveControllerSddStatus(
							options.cwd,
							options.changeName,
							true,
							prefs?.artifactStore,
						),
					);
					return `\n\n${renderNativeSddPhasePrompt(startup.status, phase)}`;
				} catch (error) {
					nativeSddStartupBlock = error instanceof Error ? error.message : String(error);
					return `\n\n## Native SDD Status Engine\nSDD selection blocked: ${nativeSddStartupBlock}\nDo not run phase work; return this blocker to the parent.`;
				}
			})()
			: launchSddChange === undefined
				? ""
				: "\n\n## Native SDD Status Engine\nSDD selection blocked: the receiving agent has no recognized SDD phase.\nDo not run phase work; return this blocker to the parent.";
		// gentle-pi#661：RDD 状态行（以及 gentle 提示词的其余部分）
		// 只为主会话构建，与下方 reviewContractPrompt 的条件
		// 互为镜像——具名/SDD 代理永远不会走到这个
		// 分支，因此不会为它们解析或计算任何行。
		// resolveRddStatusLine 永不抛错，也绝不拖过
		// RDD_STATUS_TIMEOUT_MS：缺失/超时/中止/失败的原生
		// 二进制会渲染保守失败的 "unknown" 行。
		const jeroPrompt = isNamedAgent || isSddAgent
			? ""
			: `\n\n${buildJeroPrompt(
					readPersonaMode(ctx.cwd),
					ctx.cwd,
					readActiveToolNames(pi),
					await resolveRddStatusLine(nativeReviewCli, ctx.cwd, AbortSignal.timeout(RDD_STATUS_TIMEOUT_MS), undefined, ctx),
				)}`;
		// 精益纪律（lean discipline）与 gentle 提示词同门同条件：只注入
		// 主会话——具名/SDD 代理经既有的任务上下文与阶段产物获得纪律，
		// 本注入绝不改写委派传输通道。off 渲染为空串，完全还原历史行为；
		// 档位按 会话条目 > JERO_PI_LEAN_MODE > full 解析，每次代理启动
		// 重新解析，因此 /jero:lean 切换即时生效，无需 /reload。
		const leanInstructions = isNamedAgent || isSddAgent
			? ""
			: getLeanInstructions(resolveEffectiveLeanMode(readLeanBranch(ctx), permissionEnvironment));
		const leanPrompt = leanInstructions.length === 0 ? "" : `\n\n${leanInstructions}`;
		// gentle-pi#560 / gentle-ai#4056, #4057：仅为主会话注入镜像
		// provider 契约 bundle 的评审执行契约，且只在
		// 原生评审 CLI 确实存在时注入。
		const reviewContractPrompt =
			!isNamedAgent && !isSddAgent && nativeReviewCli !== null
				? (() => {
					const fragment = loadReviewContractPromptFragment(ctx);
					return fragment === null ? "" : `\n\n${fragment}`;
				})()
				: "";
		return {
			systemPrompt: `${event.systemPrompt}${jeroPrompt}${leanPrompt}${sddPrompt}${nativeStatusPrompt}${reviewContractPrompt}${!isNamedAgent && !isSddAgent ? `\n\n${renderResearchCapabilities(resolveResearchCapabilities(pi))}` : ""}`,
		};
	});

	// gentle-pi#556 / gentle-ai#4051：RDD 开启时，代理可能完成
	// 一次已授权的实现并报告完成，却从未运行
	// 评审 STATUS 预检或提出同意问题。该
	// 处理器是只读且幂等的：它从不运行 START，从不
	// 应答同意，也不选择部分候选。持久的自身变更回执
	// 为 STATUS 设门，且只消耗该 await 之前捕获的代。
	pi.on("agent_end", async (_event, ctx) => {
		disciplineBootstrapPending = false;
		if (nativeReviewCli?.reviewMode === undefined || nativeReviewCli.targetStatus === undefined) return;
		if (ctx.hasUI !== true || !reminderSessionActive) return;
		const sessionKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
		const subagentDepth = processAgentEndSubagentDepth.get(sessionKey) ?? 0;
		if (subagentDepth > 0) {
			processAgentEndSubagentDepth.set(sessionKey, subagentDepth - 1);
			return;
		}
		const root = resolveSessionWorktree(ctx.cwd, ctx.cwd)?.root;
		if (!root) return;
		let mutation: string | undefined;
		try { mutation = pendingReviewMutation(ctx.sessionManager, root); }
		catch { return; }
		if (!mutation) return;
		const epoch = reminderEpoch;
		const status = await resolveNegotiatedReviewStatusForSession(nativeReviewCli, ctx, sessionKey);
		if (status === undefined || !reminderSessionActive || epoch !== reminderEpoch || pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey) !== sessionKey) return;
		// 另一个并发的结束或 ACK 可能已消耗该前缀。
		if (!pendingReviewMutation(ctx.sessionManager, root, mutation)) return;
		if (status.nextTransition?.kind !== "execute" || status.nextTransition.execute.operation !== "review.start") return;
		const targetIdentity = status.targetIdentity;
		pi.sendMessage(
			{
				customType: "jero.review-preflight",
				content: renderAgentEndReviewPreflightMessage(targetIdentity),
				display: true,
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		consumeReviewMutation(pi, ctx.sessionManager, root, mutation, "nudged", targetIdentity);
	});

	pi.on("tool_result", (event, ctx) => {
		if (!reminderSessionActive || event.isError !== false || (event.toolName !== "write" && event.toolName !== "edit")) return;
		if (!isRecord(event.input) || typeof event.input.path !== "string" || !event.input.path.trim()) return;
		try {
			const root = resolveSessionWorktree(event.input.path, ctx.cwd)?.root;
			if (root) recordReviewMutation(pi, ctx.sessionManager, root, { source: "direct", toolName: event.toolName, toolCallId: event.toolCallId });
		} catch { /* 回执持久化不得改变一次成功的工具结果。 */ }
	});

	// 上下文余量监控：主会话每个代理回合落定时评估一次，升级跨档各通知
	// 一次（详见 lib/jero-ai-context-monitor.ts）。RPC 子进程与无 UI 宿主
	// 直接跳过——这是用户可见提示，绝不是权威，也绝不自动触发压缩。
	let contextMonitorLevel: ContextMonitorLevel = "ok";
	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI || !contextMonitorEnabled(permissionEnvironment)) return;
		let usage: ContextUsageSnapshot | undefined;
		try { usage = ctx.getContextUsage?.() ?? undefined; } catch { return; }
		if (!usage) return;
		const verdict = evaluateContextMonitor(usage, { lastLevel: contextMonitorLevel });
		contextMonitorLevel = verdict.level;
		if (verdict.escalated && verdict.message) {
			try { ctx.ui.notify(verdict.message, verdict.notifyType); } catch { /* 通知失败绝不放大为错误。 */ }
		}
	});
	// 压缩完成（无论手动 /compact、阈值触发还是溢出恢复）即复位档位：
	// 之后用量再次上升时逐档告警重新生效。提示语是给用户的找回路径。
	pi.on("session_compact", (_event, ctx) => {
		disciplineBootstrapPending = true;
		contextMonitorLevel = "ok";
		if (ctx.mode !== "tui" || !ctx.hasUI || !contextMonitorEnabled(permissionEnvironment)) return;
		try { ctx.ui.notify(CONTEXT_COMPACT_RECOVERY_MESSAGE, "info"); } catch { /* 尽力而为。 */ }
	});
	// 纪律引导注入：压缩与重启会抹掉 harness 纪律，在置位窗口内把核心纪律
	// 作为单条 user 消息注入本代理循环的每次 LLM 请求（紧随压缩摘要之后，
	// marker 去重）。RPC 子进程是受委托的执行者，只消费父会话的精确传输块，
	// 绝不注入；包子进程同理。见 lib/jero-ai-bootstrap.ts。
	pi.on("context", (event, ctx) => {
		if (!disciplineBootstrapPending) return undefined;
		if (ctx.mode === "rpc" || permissionEnvironment.JERO_PI_AGENTS_CHILD === "1") return undefined;
		const messages = applyJeroBootstrap(event.messages);
		return messages === undefined ? undefined : { messages: messages as typeof event.messages };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (nativeSddStartupBlock && event.toolName !== "subagent_parent_message") return { block: true, reason: `SDD selection blocked: ${nativeSddStartupBlock}` };
		const sensitivePathDenied = evaluateSensitivePathTool(
			event.toolName,
			event.input,
		);
		if (sensitivePathDenied) return sensitivePathDenied;
		if (event.toolName === "subagent_run") {
			const sddAgent = sddDispatchAgentName(event.input);
			if (sddAgent === "invalid") {
				return { block: true, reason: "SDD dispatch requires exactly one shipped SDD agent name." };
			}
			if (sddAgent !== undefined) {
				// RPC 子进程是被委托的执行者，绝不是权威发起者。它
				// 必须从其交互式父会话接收已确认的块。
				if (ctx.mode === "rpc") {
					return { block: true, reason: "SDD dispatch refused: an RPC child cannot originate or persist SDD preflight defaults." };
				}
				try {
					const prefs = getSddPreflightPreferences(ctx) ?? await runSddPreflight(ctx);
					const rendered = renderSddPreflightPrompt(prefs);
					if (!prefs.prompted && ctx.hasUI) {
						return { block: true, reason: "SDD dispatch refused: interactive parent preflight lacks current-session confirmation." };
					}
					if (!isRecord(event.input)) {
						return { block: true, reason: "SDD dispatch refused: child input is malformed." };
					}
					if (event.input.context !== undefined && typeof event.input.context !== "string") {
						return { block: true, reason: "SDD dispatch refused: child context must be text." };
					}
					// 既有的 context 载荷是唯一的父到子传输通道。
					// 拒绝调用方拼写的仿制品，使子进程收到一个精确的、
					// 由父会话渲染的权威块，而不是含糊的混合物。
					const context = typeof event.input.context === "string" ? event.input.context.trim() : "";
					if (/^## SDD Session Preflight[ \t]*$/m.test(context)) {
						return { block: true, reason: "SDD dispatch refused: child context already contains an untrusted preflight block." };
					}
					event.input.context = context.length === 0
						? rendered
						: `${rendered}\n\n${context}`;
					if (!isParentConfirmedSddPreflightContext(event.input.context)) {
						return { block: true, reason: "SDD dispatch refused: rendered preflight transport is malformed." };
					}
				} catch (error) {
					return {
						block: true,
						reason: `SDD dispatch refused before child launch: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}
			const judgmentDayFixDenied = rejectInvalidJudgmentDayFixDispatch(event.input);
			if (judgmentDayFixDenied) return judgmentDayFixDenied;
			const writerScopeDenied = rejectUnscopedBoundedWriterDispatch(event.input);
			if (writerScopeDenied) return writerScopeDenied;
			try {
				injectReviewCandidateView(event.input, candidateViews);
				return undefined;
			} catch (error) {
				return {
					block: true,
					reason: error instanceof Error ? error.message : "review subagent dispatch is invalid",
				};
			}
		}
		if (event.toolName !== "bash") return undefined;
		if (!isRecord(event.input) || typeof event.input.command !== "string") {
			return undefined;
		}
		return await confirmCommand(event.input.command, ctx, pi.events, herdrLifecycle);
	});

	for (const owner of ["delegation", "review", "sdd"] as const) {
		const label = owner === "sdd" ? "SDD" : owner;
		pi.registerCommand(`jero:install-${owner}`, {
			description: `Repair or refresh only global Jero ${label} assets.`,
			handler: async (args, ctx) => {
				const force = args.includes("--force");
				const result = await installPackageAssets(ctx.cwd, force, [owner]);
				ctx.ui.notify(
					`Global Jero ${label} assets installed: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} already present.`,
					"info",
				);
			},
		});
	}

	pi.registerCommand("jero:sdd-preflight", {
		description:
			"Run or reuse session SDD preflight; use --edit to change preferences.",
		handler: async (args, ctx) => {
			if (args.trim() !== "" && args.trim() !== "--edit") {
				ctx.ui.notify("用法：/jero:sdd-preflight [--edit]", "warning");
				return;
			}
			try {
				await runSddPreflight(ctx, args.trim() === "--edit" ? SDD_PREFLIGHT_FIELDS : []);
			} catch (error) {
				ctx.ui?.notify(error instanceof Error ? error.message : String(error), "warning");
			}
		},
	});

	const readCommandSddStatus = async (args: string, ctx: ExtensionContext) => {
		const parsed = parseSddStatusCommandArgs(args);
		const request = { changeName: parsed.changeName, workspaceRoot: realpathSync(ctx.cwd) };
		if (!nativeReviewCli?.sddStatus) throw new Error("Native SDD status capability unavailable; no local fallback.");
		const status = decodeNativeSddStatusV2(await nativeReviewCli.sddStatus(request), request);
		return { parsed, request, status };
	};
	const showCommandSddStatus = (status: NativeSddStatusV2, json: boolean, ctx: ExtensionContext) => {
		ctx.ui?.notify(json ? JSON.stringify(status, null, 2) : renderNativeSddPhasePrompt(status), "info");
	};
	const handleSddStatusCommand = async (args: string, ctx: ExtensionContext) => {
		const { parsed, status } = await readCommandSddStatus(args, ctx);
		showCommandSddStatus(status, parsed.json, ctx);
	};

	pi.registerCommand("jero-sdd-status", {
		description: "Show deterministic SDD change status and instructions.",
		handler: async (args, ctx) => {
			await handleSddStatusCommand(args, ctx);
		},
	});

	const handleSddContinueCommand = async (args: string, ctx: ExtensionContext) => {
		const { parsed, request, status } = await readCommandSddStatus(args, ctx);
		const planning = status.planningHome;
		const changeRoot = status.changeRoot;
		// 原生上下文是上界，绝不是人类逐次调用的授权。
		if (status.changeName === null || !ctx.hasUI || typeof ctx.ui?.confirm !== "function" || !nativeReviewCli?.sddContinue) {
			showCommandSddStatus(status, parsed.json, ctx);
			return;
		}
		if (typeof planning !== "object" || planning === null || !("path" in planning) || typeof planning.path !== "string" || typeof changeRoot !== "string") throw new Error("Native SDD continuation lacks an exact planning path.");
		if (!["openspec", "both"].includes(String(status.artifactStore)) || !["repo-local", "workspace-planning"].includes(String(status.actionContext.mode))) throw new Error("Native SDD continuation has unsupported planning context.");
		const marker = join(changeRoot, ".jero-instance");
		const checkMarker = () => {
			try {
				if (!lstatSync(marker).isFile() || realpathSync(marker) !== marker) throw new Error("Native SDD marker is not a canonical regular file.");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		};
		checkMarker();
		if (realpathSync(changeRoot) !== changeRoot || realpathSync(planning.path) !== planning.path || changeRoot !== join(planning.path, "changes", status.changeName) || !isStrictDescendantPath(request.workspaceRoot, marker)) throw new Error("Native SDD continuation workspace or planning path mismatch.");
		if (await ctx.ui.confirm("Prepare SDD marker?", `Authorize only continuation-time preparation of ${marker}? This grants no source roots and no persistent authority.`) !== true) {
			showCommandSddStatus(status, parsed.json, ctx);
			return;
		}
		if (realpathSync(ctx.cwd) !== request.workspaceRoot || realpathSync(changeRoot) !== changeRoot) throw new Error("Native SDD continuation workspace changed during confirmation.");
		checkMarker();
		// SDD 工件收缩守卫（lib/jero-ai-sdd-guard.ts）：与"最后 seen-good"
		// 水位对比发现灾难性截断/消失时要求显式确认；拒绝则只展示状态，
		// 任何文件都不动。确认或无收缩都继续，成功推进后记录新水位。
		const shrink = evaluateSddArtifactShrink(changeRoot);
		if (shrink.shrunk.length > 0) {
			if (await ctx.ui.confirm("SDD artifact shrink detected?", renderSddShrinkReport(shrink.shrunk)) !== true) {
				showCommandSddStatus(status, parsed.json, ctx);
				return;
			}
		}
		const selected = { ...request, changeName: status.changeName };
		const continued = decodeNativeSddStatusV2(await nativeReviewCli.sddContinue(selected), selected);
		try { recordSddArtifactWatermarks(changeRoot); } catch { /* 水位记录失败不掩盖已成功的推进。 */ }
		showCommandSddStatus(continued, parsed.json, ctx);
	};

	pi.registerCommand("jero-sdd-continue", {
		description: "Resolve SDD status and route the next phase deterministically.",
		handler: async (args, ctx) => {
			await handleSddContinueCommand(args, ctx);
		},
	});

	pi.registerCommand("jero:models", {
		description: "Configure global per-agent models for el Jero.",
		handler: async (_args, ctx) => {
			await handleModelsCommand(ctx);
		},
	});

	pi.registerCommand("jero:profiles", {
		description: "Create, switch, and manage global agent-model profiles for el Jero.",
		handler: async (_args, ctx) => {
			await handleProfilesCommand(ctx);
		},
	});

	pi.registerCommand("jero:persona", {
		description: "Switch el Jero persona between gentleman and neutral.",
		handler: async (_args, ctx) => {
			await handlePersonaCommand(ctx);
		},
	});

	pi.registerCommand("jero:doctor", {
		description: "Run read-only Jero diagnostics for this Pi workspace.",
		handler: async (_args, ctx) => {
			const assetLines = packageAssetDiagnosticLines(ctx.cwd);
			const openspecConfigured = existsSync(
				join(ctx.cwd, "openspec", "config.yaml"),
			);
			const skillRegistryPresent = existsSync(
				join(ctx.cwd, ".atl", "skill-registry.md"),
			);
			const modelConfig = await readSavedModelConfigAsync(ctx.cwd);
			const engramActive = hasWritableMemoryTool(pi);
			const companionLines = companionDependencyDiagnosticLines();
			const lines = [
				"el Jero doctor",
				...assetLines,
				...companionLines,
				`${openspecConfigured ? "pass" : "warn"}: OpenSpec config ${openspecConfigured ? "present" : "missing"}`,
				`${skillRegistryPresent ? "pass" : "warn"}: Skill registry ${skillRegistryPresent ? "present" : "missing"}`,
				`${modelConfig.status === "invalid" ? "fail" : "pass"}: Global model config ${modelConfig.status}`,
				"pass: Sensitive-path guard active for read/write/edit tools",
				`${engramActive ? "pass" : "warn"}: Engram memory tools ${engramActive ? "active" : "not active in this session"}`,
				`info: Lean discipline ${resolveEffectiveLeanMode(readLeanBranch(ctx), permissionEnvironment)} (/jero:lean; off restores the historical prompt)`,
			];
			if (modelConfig.status === "invalid") {
				lines.push(`remedy: fix or remove ${modelConfig.path}`);
			}
			ctx.ui.notify(
				lines.join("\n"),
				lines.some((line) => line.startsWith("fail:")) ||
					assetLines.some((line) => line.startsWith("warn:")) ||
					companionLines.some((line) => line.startsWith("warn:")) ? "warning" : "info",
			);
		},
	});

	pi.registerCommand("jero:guard", {
		description: "Show the effective guardrail configuration (commands, hard denials, background subagents) with a copy-paste template.",
		handler: async (_args, ctx) => {
			// 只读总览：呈现三层防护的生效状态与改法，绝不改任何行为。
			try {
				const lines = guardReportLines(ctx.cwd, { env: process.env });
				ctx.ui.notify(lines.join("\n"), lines.some((line) => line.startsWith("warn:")) ? "warning" : "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("jero:review-session-permission", {
		description: "Show or revoke the process-memory review permission for this exact Pi session and Git repository (status|revoke).",
		handler: async (args, ctx) => {
			const subAction = args.trim().length === 0 ? "status" : args.trim();
			if (subAction !== "status" && subAction !== "revoke") {
				ctx.ui.notify(`未知的 /jero:review-session-permission 子操作 "${subAction}"。请使用 status 或 revoke。`, "warning");
				return;
			}
			if (subAction === "revoke") {
				const revoked = await revokeCurrentRepositoryReviewSessionPermission(ctx);
				ctx.ui.notify(revoked ? "已在此 Pi 会话中撤销该 Git 仓库的评审权限。provider 评审模式与权威未被更改。" : "此 Pi 会话中没有针对该 Git 仓库的活动评审权限。provider 评审模式与权威未被更改。", "info");
				return;
			}
			const identity = await refreshReviewSessionPermissionStatus(ctx);
			if (identity === undefined) {
				ctx.ui.notify("评审会话权限不可用：它需要交互式 Pi TUI、非子会话、非空会话 ID 以及规范的 Git 工作树。", "info");
				return;
			}
			ctx.ui.notify(hasReviewSessionPermission(identity)
				? "本 Pi 会话与该 Git 仓库已允许进行评审。使用 /jero:review-session-permission revoke 可恢复逐次询问。"
				: "本 Pi 会话的评审未获预授权；每个中高危及候选将正常逐次询问。", "info");
		},
	});

	pi.registerCommand("jero:review-mode", {
		description: "Show or set the Jero receipt-driven development kill switch (status|enable|disable). Every sub-action is user-initiated only; Pi automation never toggles it.",
		handler: async (args, ctx) => {
			const subAction = args.trim().length === 0 ? NATIVE_REVIEW_MODE_OPERATION.STATUS : args.trim();
			if (subAction !== NATIVE_REVIEW_MODE_OPERATION.STATUS && subAction !== NATIVE_REVIEW_MODE_OPERATION.ENABLE && subAction !== NATIVE_REVIEW_MODE_OPERATION.DISABLE) {
				ctx.ui.notify(`未知的 /jero:review-mode 子操作 "${subAction}"。请使用 status、disable 或 enable。`, "warning");
				return;
			}
			if (nativeReviewCli?.reviewMode === undefined) {
				ctx.ui.notify("当前协商的原生版本不支持 Jero 评审模式。", "info");
				return;
			}
			try {
				const result = await nativeReviewCli.reviewMode({ cwd: ctx.cwd, operation: subAction as NativeReviewModeOperation });
				if (subAction === NATIVE_REVIEW_MODE_OPERATION.DISABLE && result.status.effective === "off") {
					cleanupAllPendingReviewConsents(
						pendingReviewConsentRegistry,
						pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey),
					);
				}
				const report = `receipt-driven development: ${result.status.effective} (decided by ${result.status.source})`;
				// 一个变更类子操作若未改变生效模式，就没有做到
				// 用户要求的事，而只报告结果状态读起来
				// 就像做到了。恰好只有一种形态会到达这里：
				// 针对全局 off 的 `enable`。Pi 总是传
				// `--scope clone`（设计决策 #7），它只会清除
				// clone-local 覆盖，无法开启全局 RDD。原生调用
				// 以 0 退出、报告操作 "enable"，却什么都没改。要把
				// 这一点说出来，并指明能解决它的全局记录编辑。
				const requested = subAction === NATIVE_REVIEW_MODE_OPERATION.ENABLE ? "on" : subAction === NATIVE_REVIEW_MODE_OPERATION.DISABLE ? "off" : result.status.effective;
				if (result.status.effective !== requested) {
					ctx.ui.notify(`${report}\n这并未重新开启评审：/jero:review-mode enable 只会清除 clone-local 覆盖，无法压过全局 off。请将 \{"schema":"jero.authority.review-mode/v1","value":"on"\} 写入 ${join(jeroConfigHome(), "review-mode.json")} 以重新开启。`, "warning");
					return;
				}
				ctx.ui.notify(report, "info");
			} catch (error) {
				if (asNativeReviewCliError(error)?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) {
					ctx.ui.notify("当前协商的原生版本不支持 Jero 评审模式。", "info");
					return;
				}
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	// 与 jero:review-mode 互为镜像：用户所有的开关，绝不是自动开关。
	// 它在这里比在那里更重要，因为该策略决定
	// 后台子代理是否可以被启动，因此 Pi 中任何东西都不得写
	// 它。唯一的写入者就是这个处理器，且只能经显式调用到达。
	pi.registerCommand("jero:background-subagents", {
		description: "Show or set the managed background-subagents policy (status|enable|disable). Every sub-action is user-initiated only; Pi automation never toggles it.",
		handler: async (args, ctx) => {
			const subAction = args.trim().length === 0 ? "status" : args.trim();
			if (subAction !== "status" && subAction !== "enable" && subAction !== "disable") {
				ctx.ui.notify(`未知的 /jero:background-subagents 子操作 "${subAction}"。请使用 status、enable 或 disable。`, "warning");
				return;
			}
			try {
				const wrote: BackgroundSubagentsPolicy | undefined = subAction === "enable" ? "on" : subAction === "disable" ? "off" : undefined;
				if (wrote !== undefined) writeGlobalBackgroundSubagentsPolicy(wrote);
				const resolution = resolveBackgroundSubagentsPolicy(ctx.cwd);
				const capability = resolveBackgroundSubagentsCapability(ctx.cwd, readActiveToolNames(pi));
				const report = renderBackgroundSubagentsReport(resolution, capability, wrote);
				ctx.ui.notify(report.message, report.type);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	// 与 jero:review-mode 同一契约：用户所有的开关，绝不是自动开关。
	// 唯一的写入路径就是本处理器（以及输入侧的独立停用短语）。
	// 模式经会话条目持久化，并在每次代理启动时倒序回放——切换即时
	// 生效，无需 /reload；条目不进 LLM 上下文，只影响下次注入。
	pi.registerCommand("jero:lean", {
		description: "Show or set the Jero lean-discipline mode for this session (status|off|lite|full|ultra).",
		handler: async (args, ctx) => {
			const parsed = parseLeanCommand(args);
			if (parsed.kind === "invalid") {
				ctx.ui.notify(parsed.reason, "warning");
				return;
			}
			if (parsed.kind === "set") {
				pi.appendEntry(LEAN_MODE_ENTRY_TYPE, { mode: parsed.mode });
				ctx.ui.notify(
					parsed.mode === "off"
						? "Jero 精益纪律已关闭（本会话）。/jero:lean <mode> 可重新开启。"
						: `Jero 精益纪律已设为 ${parsed.mode}（本会话）。切换即时生效，无需 /reload。`,
					"info",
				);
				return;
			}
			const effective = resolveEffectiveLeanMode(readLeanBranch(ctx), permissionEnvironment);
			ctx.ui.notify(
				`${renderLeanStatusLine(effective)}（会话内生效；用 /jero:lean <off|lite|full|ultra> 切换，说 "stop lean" 关闭）`,
				"info",
			);
		},
	});

	pi.registerCommand("jero:status", {
		description: "Show Jero package status for this project.",
		handler: async (_args, ctx) => {
			const assetLines = packageAssetDiagnosticLines(ctx.cwd);
			const openspecConfigured = existsSync(
				join(ctx.cwd, "openspec", "config.yaml"),
			);
			const savedConfig = await readModelRoutingAuthorityAsync(
				modelConfigPath(ctx.cwd),
				legacyProjectModelConfigPath(ctx.cwd),
			);
			ctx.ui.notify(
				[
					"el Jero package is active.",
						`Persona: ${readPersonaMode(ctx.cwd)}`,
					`Lean discipline: ${resolveEffectiveLeanMode(readLeanBranch(ctx), permissionEnvironment)} (/jero:lean)`,
					...assetLines,
					`OpenSpec config: ${openspecConfigured ? "present" : "missing"}`,
					`Global model config: ${existsSync(modelConfigPath(ctx.cwd)) ? "present" : "missing"}`,
					`Saved model routing: ${savedConfig.status}${savedConfig.status === "invalid" ? ` (${savedConfig.path})` : ""}`,
					...(savedConfig.status === "invalid" ? [] : describeModelConfig(ctx.cwd, savedConfig.status === "valid" ? savedConfig.config : {})),
				].join("\n"),
				savedConfig.status === "invalid" || assetLines.some((line) => line.startsWith("warn:")) ? "warning" : "info",
			);
		},
	});
	};
}

export default function jeroAi(pi: ExtensionAPI): void {
	return createJeroAiExtension()(pi);
}

// 兼容再导出：这些符号已随 stage1 拆分迁往 lib/，但既有调用方
// （extensions/sdd-init.ts 与 tests/*.test.ts）仍按扩展的公开面导入。
export {
	applyModelConfig,
	applyModelConfigAsync,
	applySavedModelConfig,
} from "../lib/jero-ai-model-routing-apply.ts";
export {
	readModelConfig,
	readModelConfigAsync,
} from "../lib/jero-ai-model-config.ts";


import { consumeReviewMutation, pendingReviewMutation, recordReviewMutation } from "../lib/review-reminder-receipt.ts";
import { resolveSessionWorktree } from "../lib/session-worktree-registry.ts";
import { renderResearchCapabilities, resolveResearchCapabilities } from "../lib/sdd-research-capabilities.ts";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	ensureSddPreflight, getSddPreflightPreferences, installPackageAssets,
	isParentConfirmedSddPreflightContext, isSddPreflightTrigger, renderSddPreflightPrompt,
	SDD_PREFLIGHT_FIELDS, type SddPreflightField, type SddPreflightPreferences
} from "../lib/sdd-preflight.ts";
import { readSavedModelConfigAsync as readModelRoutingAuthorityAsync } from "../lib/model-routing-authority.ts";
import { parseSddStatusCommandArgs, renderNativeSddPhasePrompt } from "../lib/sdd-status.ts";
import { type JeroRenderContext, renderJeroLifecycleCall, renderJeroResult } from "../lib/jero-ai-renderer.ts";
import { CandidateViewRegistry, injectReviewCandidateView, readCandidateContextManifestPage } from "../lib/review-candidate-view.ts";
import {
	decodeNativeSddStatusV2, NATIVE_REVIEW_ERROR_CODE, NATIVE_REVIEW_MODE_OPERATION,
	type NativeReviewCli, type NativeReviewModeOperation, type NativeSddStatusV2
} from "../lib/authority/client-contract.ts";
import { createJeroAuthorityReviewCli } from "../lib/jero-authority-cli.ts";
import { acquireChildStandingReviewPermissionClient } from "../lib/review-session-standing-permission-ipc.ts";
import { isPiConsentV3, presentReviewConsentUi } from "../lib/review-consent-ui.ts";
import {
	captureReviewSessionIdentity, grantReviewSessionPermission, hasReviewSessionPermission,
	resolveCanonicalGitRepositoryIdentity, type ReviewSessionIdentity, reviewSessionPermissionEpoch,
	revokeReviewSessionPermission, revokeReviewSessionPermissionsForSession,
	sameReviewSessionIdentity
} from "../lib/review-session-standing-permission.ts";
import { packageAssetDiagnosticLines } from "../lib/jero-ai-package-assets.ts";
import {
	type BackgroundSubagentsPolicy, renderBackgroundSubagentsReport,
	resolveBackgroundSubagentsPolicy, writeGlobalBackgroundSubagentsPolicy
} from "../lib/jero-ai-background-subagents.ts";
import {
	readActiveToolNames, rejectInvalidJudgmentDayFixDispatch, rejectUnscopedBoundedWriterDispatch,
	resolveBackgroundSubagentsCapability, sddDispatchAgentName
} from "../lib/jero-ai-writer-scope.ts";
import { RDD_STATUS_TIMEOUT_MS, resolveRddStatusLine } from "../lib/jero-ai-rdd-status.ts";
import {
	getLeanInstructions, isLeanDeactivationText,
	LEAN_MODE_ENTRY_TYPE, parseLeanCommand,
	resolveEffectiveLeanMode, renderLeanStatusLine, type LeanBranchEntry,
} from "../lib/jero-ai-lean.ts";
import {
	CONTEXT_COMPACT_RECOVERY_MESSAGE, contextMonitorEnabled, evaluateContextMonitor,
	type ContextMonitorLevel, type ContextUsageSnapshot,
} from "../lib/jero-ai-context-monitor.ts";
import { applyJeroBootstrap } from "../lib/jero-ai-bootstrap.ts";
import { companionDependencyDiagnosticLines } from "../lib/jero-ai-companion-deps.ts";
import { evaluateSddArtifactShrink, recordSddArtifactWatermarks, renderSddShrinkReport } from "../lib/jero-ai-sdd-guard.ts";
import { buildJeroPrompt, loadReviewContractPromptFragment } from "../lib/jero-ai-prompts.ts";
import { setGuardrailsProcessEnv } from "../lib/jero-ai-guardrails.ts";
import { guardReportLines } from "../lib/jero-ai-guard-report.ts";
import {
	evaluateSensitivePathTool, hasWritableMemoryTool, isNamedAgentStartEvent, isSddAgentStartEvent,
	readSddChangeFlag, resolveSelectedNativeSddChangeStartup, SDD_CHANGE_FLAG,
	sddPhaseFromAgentStartEvent
} from "../lib/jero-ai-sdd-startup.ts";
import { confirmCommand, createHerdrConfirmationLifecycle } from "../lib/jero-ai-herdr-confirm.ts";
import { jeroConfigHome, isRecord, legacyProjectModelConfigPath, modelConfigPath, readPersonaMode } from "../lib/jero-ai-persona-config.ts";
import { readSavedModelConfigAsync } from "../lib/jero-ai-model-config.ts";
import { applyModelConfig, applySavedModelConfig, describeModelConfig, migrateLegacyProjectModelOverrides } from "../lib/jero-ai-model-routing-apply.ts";
import { handleModelsCommand } from "../lib/jero-ai-model-panel.ts";
import { handleProfilesCommand } from "../lib/jero-ai-profiles-panel.ts";
import { handlePersonaCommand } from "../lib/jero-ai-persona-command.ts";
import {
	asNativeReviewCliError, authorizeDestructiveReviewOperation, parseReviewControllerParameters,
	REVIEW_CAPTURE_GROUP_PARAMETERS, REVIEW_CAPTURE_PARAMETERS, REVIEW_CONTROLLER_OPERATION,
	REVIEW_CONTROLLER_PARAMETERS, REVIEW_SCOPE_PARAMETERS, type ReviewScopeParameters,
	reviewToolOperationPath
} from "../lib/jero-ai-review-params.ts";
import {
	cleanupAllPendingReviewConsents, completedGrantedReviewConsent,
	isHostReviewConsentEligibleOperation, isStrictDescendantPath, pendingReviewConsentSessionKey,
	type PendingReviewConsentSessionKey, processAgentEndSubagentDepth,
	processPendingReviewConsentRegistry, processRetainedNativeStatusSelections,
	REVIEW_SESSION_PERMISSION_STATUS_KEY, REVIEW_SESSION_PERMISSION_STATUS_TEXT,
	reviewSessionManagerAndId
} from "../lib/jero-ai-review-consent.ts";
import { resolveReviewControllerWorkspaceRoot } from "../lib/jero-ai-review-native-ops.ts";
import { reviewTrivialityHint } from "../lib/jero-ai-review-hint.ts";
import { assessJeroReviewRiskV1 } from "../lib/authority/risk-assess.ts";
import { resolveNegotiatedReviewStatusForSession } from "../lib/jero-ai-review-transport.ts";
import { executeReviewCaptureGroupOperation, executeReviewCaptureOperation, renderAgentEndReviewPreflightMessage } from "../lib/jero-ai-review-select.ts";
import { executeReviewControllerOperation } from "../lib/jero-ai-review-controller.ts";
import { type JeroRuntimeDependencies, resolveControllerSddStatus, resolveStartupControllerSddStatus } from "../lib/jero-ai-testing-exports.ts";

export * from "../lib/jero-ai-review-params.ts";
export * from "../lib/jero-ai-review-consent.ts";
export * from "../lib/jero-ai-review-native-ops.ts";
export * from "../lib/jero-ai-review-relay.ts";
export * from "../lib/jero-ai-review-transport.ts";
export * from "../lib/jero-ai-review-select.ts";
export * from "../lib/jero-ai-review-controller.ts";
export * from "../lib/jero-ai-testing-exports.ts";
