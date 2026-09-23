// jero-agents 的 remediation 域：SDD 变更解析、范围确认、原生变更对账/接纳与 bash 域收窄。
// 自 extensions/jero-agents.ts 拆分（机械平移，语义零改动）。

import { fileURLToPath } from "node:url";
import { getPackageAssetOwner } from "./sdd-preflight.ts";
import {
	decodeNativeSddStatusV2, type NativeReviewCli, NativeReviewCliError,
	type NativeSddAcquireRequest, type NativeSddAttemptResult, type NativeSddSettleRequest
} from "./authority/client-contract.ts";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, resolve, sep } from "node:path";
import { type BashOperations, createBashToolDefinition, createLocalBashOperations, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseAgentDefinition } from "./agents-config.ts";
import { TASK_STATUS, type TaskRecord } from "./agents-protocol.ts";
import {
	parseRemediationPlan, plannedCommands, remediationEvidence, type RemediationPlan,
	type RemediationScope, type RemediationTerminalFacts, type SddChangeSelection, type TaskRequest
} from "./agents-runner.ts";
import { canonicalArtifactPath } from "./sdd-research-capabilities.ts";
const SDD_PHASE_BY_AGENT = {
	"sdd-apply": "apply",
	"sdd-remediate": "remediate",
	"sdd-verify": "verify",
	"sdd-sync": "sync",
	"sdd-archive": "archive",
} as const;

export function sddPhaseForAgent(name: string): SddChangeSelection["phase"] | undefined {
	return Object.hasOwn(SDD_PHASE_BY_AGENT, name) ? SDD_PHASE_BY_AGENT[name as keyof typeof SDD_PHASE_BY_AGENT] : undefined;
}

export function parseSddChange(value: unknown, agentName: string): SddChangeSelection | undefined {
	if (value === undefined) return undefined;
	const expectedPhase = sddPhaseForAgent(agentName);
	if (!expectedPhase) throw new Error("sdd_change is allowed only for SDD apply, verify, sync, or archive agents.");
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("sdd_change must be an object with changeName, workspaceRoot, and phase.");
	const selection = value as Record<string, unknown>;
	const keys = Object.keys(selection).sort();
	if (keys.join(",") !== (expectedPhase === "remediate" ? "changeName,failedEvidenceRevision,phase,workspaceRoot" : "changeName,phase,workspaceRoot") ||
		typeof selection.changeName !== "string" || selection.changeName.length === 0 ||
		typeof selection.workspaceRoot !== "string" || selection.workspaceRoot.length === 0 ||
		selection.phase !== expectedPhase) {
		throw new Error("sdd_change must contain only a non-empty changeName, workspaceRoot, and the agent's matching phase.");
	}
	if (expectedPhase === "remediate" && (typeof selection.failedEvidenceRevision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(selection.failedEvidenceRevision))) throw new Error("Invalid remediation revision");
	// phase 已通过上方与 expectedPhase 的相等校验，直接携带已收窄的类型。
	return { changeName: selection.changeName, workspaceRoot: selection.workspaceRoot, phase: expectedPhase, ...(expectedPhase === "remediate" ? { failedEvidenceRevision: selection.failedEvidenceRevision as string } : {}) };
}

export const REMEDIATION_SCHEMA = {
	type: "object", additionalProperties: false, required: ["plan", "attempt"],
	properties: {
		plan: { type: "object", additionalProperties: false, required: ["cwd", "commands", "runtimeHarness", "rollback"], properties: {
			editPaths: { type: "array", maxItems: 32, items: { type: "string" }, description: "Exact canonical files requested for this launch; no entry means no edit/write authority." }, cwd: { type: "string" }, commands: { type: "array", minItems: 1, maxItems: 16, items: { type: "string" } },
			runtimeHarness: { type: "object", additionalProperties: false, description: "Exactly one concrete command or prior concrete naReason containing because.", properties: { command: { type: "string" }, naReason: { type: "string" } } },
			rollback: { type: "object", additionalProperties: false, required: ["boundary", "command"], properties: { boundary: { type: "string" }, command: { type: "string" } } },
		} },
		attempt: { type: "object", additionalProperties: false, required: ["requestId", "workUnit", "evidenceGoal"], properties: {
			requestId: { type: "string" }, workUnit: { type: "string" }, evidenceGoal: { type: "string" }, token: { type: "string" }, expectedRevision: { type: "string" },
			maxAttempts: { type: "integer", minimum: 1, maximum: 100 }, maxChangedLines: { type: "integer", minimum: 1, maximum: 1000000 },
			untrackedScope: { type: "string", enum: ["select", "exclude"] }, expectedUntrackedInventory: { type: "string" }, intendedUntracked: { type: "array", items: { type: "string" } },
		} },
	},
};

export async function confirmRemediationScope(plan: RemediationPlan, action: Record<string, unknown>, context?: Pick<ExtensionContext, "hasUI" | "ui">): Promise<RemediationScope> {
	const cwd = plan.cwd, roots = action.allowedEditRoots;
	if (realpathSync(cwd) !== cwd || action.workspaceRoot !== cwd || !Array.isArray(roots) || !roots.every(root => typeof root === "string" && isAbsolute(root) && canonicalArtifactPath(root) === root)) throw new Error("Remediation native scope mismatch");
	const inside = (path: string, root: string) => path === root || path.startsWith(`${root}${sep}`);
	const editPaths = plan.editPaths ?? [];
	if (!Array.isArray(editPaths) || editPaths.length > 32 || new Set(editPaths).size !== editPaths.length) throw new Error("Ambiguous remediation paths");
	for (const path of editPaths) {
		if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || /[*?\[\]{}]/.test(path) || canonicalArtifactPath(path) !== path || !inside(path, cwd) || !roots.some(root => inside(path, root))) throw new Error("Remediation path outside canonical native scope");
		if (existsSync(path) && !lstatSync(path).isFile()) throw new Error("Remediation requires exact file paths, not directories");
	}
	const scope: RemediationScope = { cwd, editPaths: [...editPaths], commands: plannedCommands(plan), allowedEditRoots: [...roots] };
	if (!context?.hasUI || !context.ui?.confirm || await context.ui.confirm("Authorize one remediation launch", `Canonical worktree: ${cwd}\nNative allowed roots: ${JSON.stringify(roots)}\nExact edit/write files: ${JSON.stringify(editPaths)}\nExact invocations (not a shell sandbox):\n${scope.commands.map((command, slot) => `${slot}: cwd=${JSON.stringify(cwd)} command=${JSON.stringify(command)}`).join("\n")}`) !== true) throw new Error("Remediation requires fresh human authorization; no actor started");
	if (realpathSync(cwd) !== cwd || editPaths.some(path => canonicalArtifactPath(path) !== path)) throw new Error("Remediation scope changed during authorization");
	return scope;
}
export function remediationToolAllowed(scope: RemediationScope | undefined, cwd: string, tool: string, input: Record<string, unknown>): boolean {
	try {
		if (!scope || scope.cwd !== cwd || canonicalArtifactPath(cwd) !== cwd) return false;
		if (tool === "bash") return typeof input.command === "string" && scope.commands.includes(input.command);
		if (["edit", "write"].includes(tool)) {
			if (typeof input.path !== "string") return false;
			const path = resolve(cwd, input.path);
			return scope.editPaths.includes(path) && canonicalArtifactPath(path) === path && scope.allowedEditRoots.some(root => path === root || path.startsWith(`${root}${sep}`));
		}
		if (["read", "grep", "find"].includes(tool)) {
			if (input.path === undefined) return true;
			if (typeof input.path !== "string" || !input.path || isAbsolute(input.path)) return false;
			const path = resolve(cwd, input.path);
			return canonicalArtifactPath(path) === path && (path === cwd || path.startsWith(`${cwd}${sep}`));
		}
		return tool === "subagent_parent_message";
	} catch { return false; }
}

export interface RemediationReconciliationResult {
	acquireState?: NativeSddAttemptResult["state"];
	settlementState?: NativeSddAttemptResult["state"];
}

async function replayUncertainNativeMutation<T>(label: "acquire" | "settlement", invoke: () => Promise<T>): Promise<T> {
	try { return await invoke(); }
	catch (error) {
		if (error instanceof TypeError || error instanceof NativeReviewCliError && error.mutationOutcome === "none") throw error;
		try { return await invoke(); }
		catch { throw new Error(`Native remediation ${label} remains unresolved; retry only this exact retained task`); }
	}
}

function finishReconciledTask(task: TaskRecord, message: string): void {
	task.status = TASK_STATUS.FAILED;
	task.error = message;
	task.lastStep = "reconciled";
	task.endedAt ??= Date.now();
	task.lastActivityAt = Date.now();
}

export async function reconcileManagedRemediation(task: TaskRecord, native: NativeReviewCli, persist: (task: TaskRecord) => Promise<void>): Promise<RemediationReconciliationResult> {
	const state = task.sddRemediation;
	if (task.agent !== "sdd-remediate" || !state?.acquire || state.acquire.workspaceRoot !== task.cwd) throw new Error("Task is not an exact managed remediation record");
	if (state.settlement) throw new Error("Managed remediation task already has a terminal settlement");

	const settleExact = async (settle: NativeSddSettleRequest, acquireState?: NativeSddAttemptResult["state"]): Promise<RemediationReconciliationResult> => {
		if (!native.sddAttemptSettle) throw new Error("Native remediation settlement reconciliation is unavailable");
		let settlement: NativeSddAttemptResult;
		try { settlement = await replayUncertainNativeMutation("settlement", () => native.sddAttemptSettle!(structuredClone(settle))); }
		catch (error) {
			state.settlementUncertain = true;
			await persist(task);
			throw error;
		}
		state.settlement = structuredClone(settlement);
		delete state.settlementUncertain;
		finishReconciledTask(task, `Managed remediation settlement reconciled as ${settlement.state}${settlement.reason ? `(${settlement.reason})` : ""}; no actor started`);
		await persist(task);
		return { ...(acquireState === undefined ? {} : { acquireState }), settlementState: settlement.state };
	};

	if (state.settle) {
		const settle = state.settle, acquire = state.acquire;
		const sameUntracked = JSON.stringify({ scope: settle.untrackedScope, inventory: settle.expectedUntrackedInventory, intended: settle.intendedUntracked }) === JSON.stringify({ scope: acquire.untrackedScope, inventory: acquire.expectedUntrackedInventory, intended: acquire.intendedUntracked });
		if (state.acquireResult?.state !== "proceed" || !state.token || state.acquireResult.token !== state.token || settle.token !== state.token || settle.workspaceRoot !== acquire.workspaceRoot || settle.changeName !== acquire.changeName || settle.remediatesEvidenceRevision !== acquire.remediatesEvidenceRevision || !sameUntracked) throw new Error("Retained remediation settlement does not match its exact acquired authority");
		return settleExact(structuredClone(settle), state.acquireResult.state);
	}
	if (!state.acquireUncertain) throw new Error("Managed remediation task has no uncertain acquire or settlement to reconcile");
	if (state.actorClaimed) throw new Error("Managed remediation actor effects are uncertain; exact settlement or maintainer intervention is required");
	if (state.acquireResult || state.token || state.settlementUncertain) throw new Error("Managed remediation acquire history is inconsistent; maintainer intervention is required");
	if (!native.sddAttemptAcquire) throw new Error("Native remediation acquire reconciliation is unavailable");

	let acquired: NativeSddAttemptResult;
	try { acquired = await replayUncertainNativeMutation("acquire", () => native.sddAttemptAcquire!(structuredClone(state.acquire))); }
	catch (error) {
		state.acquireUncertain = true;
		await persist(task);
		throw error;
	}
	if (acquired.state === "proceed" && !acquired.token) throw new Error("Native remediation acquire reconciliation returned no token");
	state.acquireResult = structuredClone(acquired);
	delete state.acquireUncertain;
	if (acquired.state !== "proceed") {
		delete state.token;
		finishReconciledTask(task, `Managed remediation acquire reconciled as ${acquired.state}${acquired.reason ? `(${acquired.reason})` : ""}; no actor started`);
		await persist(task);
		return { acquireState: acquired.state };
	}

	state.token = acquired.token;
	const acquire = state.acquire;
	const settle: NativeSddSettleRequest = {
		workspaceRoot: acquire.workspaceRoot,
		changeName: acquire.changeName,
		token: acquired.token!,
		requestId: `reconcile-${createHash("sha256").update(JSON.stringify(acquire)).digest("hex").slice(0, 32)}`,
		outcome: "interrupted",
		diagnosis: "Acquire outcome was recovered after the actor launch boundary was refused; no managed actor was launched",
		harnessDisposition: "invalidated",
		cleanupEvidence: "No managed actor was spawned; no child cleanup was required",
		processEvidence: "spawned=false; actor_claimed=false; reconciliation=acquire",
		remediatesEvidenceRevision: acquire.remediatesEvidenceRevision,
		...(acquire.untrackedScope === undefined ? {} : { untrackedScope: acquire.untrackedScope, expectedUntrackedInventory: acquire.expectedUntrackedInventory, intendedUntracked: acquire.intendedUntracked }),
	};
	state.settle = structuredClone(settle);
	await persist(task); // 恢复出的令牌与精确的结算重放输入在原生变更前原子落盘。
	return settleExact(settle, acquired.state);
}

export async function admitManagedRemediation(request: TaskRequest, input: unknown, native: NativeReviewCli, persist: (task: TaskRecord) => Promise<void>, context?: Pick<ExtensionContext, "hasUI" | "ui">, preparedTask?: TaskRecord): Promise<Partial<TaskRequest>> {
	const selected = request.sddChange;
	const asset = fileURLToPath(new URL("../assets/agents/sdd-remediate.md", import.meta.url));
	if (request.agent.name !== "sdd-remediate" || selected?.phase !== "remediate" || selected.workspaceRoot !== request.cwd || !native.sddStatus || !native.sddAttemptAcquire || !native.sddAttemptSettle || getPackageAssetOwner("agents/sdd-remediate.md") !== "sdd" || !existsSync(request.agent.filePath) ) throw new Error("Unsupported managed remediation owner/asset or native capability; install matching package assets before retrying");
	const owned = parseAgentDefinition(readFileSync(asset, "utf8"), asset, "global");
	const installed = parseAgentDefinition(readFileSync(request.agent.filePath, "utf8"), request.agent.filePath, request.agent.scope);
	if (!("instructions" in owned) || !("instructions" in installed) || [request.agent, installed].some(agent => agent.instructions !== owned.instructions || JSON.stringify(agent.tools) !== JSON.stringify(owned.tools))) throw new Error("Unsupported remediation actor content; install matching managed assets");
	const value = input as { plan?: unknown; attempt?: NativeSddAcquireRequest };
	const plan = parseRemediationPlan(value?.plan, request.cwd);
	const status = decodeNativeSddStatusV2(await native.sddStatus({ workspaceRoot: request.cwd, changeName: selected.changeName }), selected);
	if (status.nextRecommended !== "remediate" || !status.phaseInstructions?.remediate || status.remediationState?.failedEvidenceRevision !== selected.failedEvidenceRevision) throw new Error("Stale remediation selection; refresh native status");
	if (!value?.attempt || value.attempt.remediatesEvidenceRevision !== undefined && value.attempt.remediatesEvidenceRevision !== selected.failedEvidenceRevision) throw new Error("Invalid remediation attempt intent");
	const acquire: NativeSddAcquireRequest = { ...structuredClone(value.attempt), workspaceRoot: request.cwd, changeName: selected.changeName, remediatesEvidenceRevision: selected.failedEvidenceRevision };
	const scope = await confirmRemediationScope(plan, status.actionContext, context);
	if (!preparedTask || preparedTask.cwd !== request.cwd || preparedTask.agent !== request.agent.name) throw new Error("Durable prepared remediation task required before acquire");
	preparedTask.sddRemediation = { scope, failedEvidenceRevision: selected.failedEvidenceRevision!, plan, observations: [], pending: {}, invalid: false, acquire: structuredClone(acquire) };
	await persist(preparedTask);
	let admitted;
	try { admitted = await native.sddAttemptAcquire(structuredClone(acquire)); }
	catch (error) {
		if (error instanceof TypeError || error instanceof NativeReviewCliError && error.mutationOutcome === "none") {
			preparedTask.sddRemediation.acquireResult = { state: "blocked" };
			await persist(preparedTask);
			throw error;
		}
		try { admitted = await native.sddAttemptAcquire(structuredClone(acquire)); }
		catch { preparedTask.sddRemediation.acquireUncertain = true; await persist(preparedTask); throw new Error("Unknown acquire outcome; reconcile the exact retained request, never rerun an actor"); }
	}
	preparedTask.sddRemediation.acquireResult = structuredClone(admitted);
	if (admitted.state === "proceed" && admitted.token) preparedTask.sddRemediation.token = admitted.token;
	await persist(preparedTask); // 令牌落盘先于任何执行体派发。
	if (admitted.state !== "proceed" || !admitted.token) throw new Error(`Managed remediation admission ${admitted.state}; no actor started`);
	let finalizationStarted = false;
	return {
		sddRemediation: preparedTask.sddRemediation,
		finalizeRemediation: async (task: TaskRecord, facts: RemediationTerminalFacts) => {
			if (finalizationStarted) return;
			finalizationStarted = true;
			const state = task.sddRemediation!;
			const evidence = state.failedEvidenceRevision === acquire.remediatesEvidenceRevision && task.status === TASK_STATUS.COMPLETED && facts.exited && facts.cleanupConfirmed ? remediationEvidence(state) : undefined;
			const interrupted = !facts.spawned || !facts.exited || !facts.cleanupConfirmed || task.status === TASK_STATUS.CANCELLED || task.status === TASK_STATUS.TIMED_OUT;
			const payload: NativeSddSettleRequest = {
				workspaceRoot: acquire.workspaceRoot, changeName: acquire.changeName, token: state.token!, requestId: randomUUID(),
				outcome: interrupted ? "interrupted" : evidence ? "passed" : "failed",
				diagnosis: interrupted ? "Managed remediation interrupted; retain observed uncertainty" : evidence ? "All planned remediation commands observed exit zero; independent verification remains required" : "Managed remediation failed or planned command evidence is incomplete",
				harnessDisposition: facts.cleanupConfirmed ? "reused" : "invalidated",
				cleanupEvidence: facts.cleanupConfirmed ? "Runner confirmed process cleanup" : "Runner could not confirm process cleanup; effects remain unknown",
				processEvidence: `spawned=${facts.spawned}; exited=${facts.exited}; task=${task.status}; observations=${state.observations.length}`,
				remediatesEvidenceRevision: acquire.remediatesEvidenceRevision,
				...(acquire.untrackedScope === undefined ? {} : { untrackedScope: acquire.untrackedScope, expectedUntrackedInventory: acquire.expectedUntrackedInventory, intendedUntracked: acquire.intendedUntracked }),
				...(interrupted ? {} : evidence ? { remediationEvidence: JSON.stringify(evidence) } : { evidenceRevision: `sha256:${createHash("sha256").update(JSON.stringify({ facts, observations: state.observations, invalid: state.invalid, pending: state.pending })).digest("hex")}` }),
			};
			const actorStatus = task.status;
			if (actorStatus === TASK_STATUS.COMPLETED) task.status = payload.outcome === "passed" ? TASK_STATUS.WAITING : TASK_STATUS.FAILED;
			state.settle = structuredClone(payload);
			await persist(task); // 精确的原生重放输入必须在变更之前先落盘。
			try { state.settlement = await native.sddAttemptSettle!(structuredClone(payload)); }
			catch (error) {
				if (!(error instanceof TypeError) && !(error instanceof NativeReviewCliError && error.mutationOutcome === "none")) {
					try { state.settlement = await native.sddAttemptSettle!(structuredClone(payload)); }
					catch { state.settlementUncertain = true; }
				} else state.settlementUncertain = true;
			}
			if (payload.outcome === "failed" && actorStatus === TASK_STATUS.COMPLETED) {
				task.status = TASK_STATUS.FAILED;
				task.error = "Managed remediation lacks complete passing planned-command evidence";
			}
			if (payload.outcome === "passed" && state.settlement && state.settlement.state !== "blocked") task.status = TASK_STATUS.COMPLETED;
			if (!state.settlement) {
				task.status = TASK_STATUS.FAILED;
				task.error = "Native remediation settlement unresolved; retain exact history for reconciliation";
			} else if (state.settlement.state === "blocked") {
				task.status = TASK_STATUS.FAILED;
				task.error = `Native remediation settlement blocked(${state.settlement.reason ?? "unspecified"}); current native admission decides any later attempt`;
			}
			await persist(task);
		},
	};
}

// 仅为已获准的修复子进程安装。原生的 shell 执行、取消、
// 截断与渲染仍由 SDK 定义所有。
export function remediationBash(cwd: string, operations: BashOperations = createLocalBashOperations(), scope?: RemediationScope) {
	const captured = new Map<string, { toolCallId: string; command: string; cwd: string; exitCode: number | null }>();
	const remaining = [...(scope?.commands ?? [])], used = new Set<string>();
	const stock = createBashToolDefinition(cwd);
	return {
		definition: { ...stock, async execute(...input: Parameters<typeof stock.execute>) {
			const [id, args, signal, onUpdate, ctx] = input;
			const slot = remaining.indexOf(args.command);
			if (!remediationToolAllowed(scope, ctx?.cwd ?? cwd, "bash", args) || slot < 0 || used.has(id)) throw new Error("Bash invocation is outside this launch human authorization");
			remaining.splice(slot, 1); used.add(id);
			const definition = createBashToolDefinition(cwd, { operations: { exec: async (command, directory, options) => {
				const result = await operations.exec(command, directory, options);
				if (captured.size < 32) captured.set(id, { toolCallId: id, command, cwd: directory, exitCode: result.exitCode });
				return result;
			} } });
			return definition.execute(id, args, signal, onUpdate, ctx);
		} },
		result(event: { toolCallId: string; details?: unknown }) {
			const observation = captured.get(event.toolCallId);
			captured.delete(event.toolCallId);
			return observation ? { details: { ...(event.details as object ?? {}), remediationCommand: observation } } : undefined;
		},
	};
}

