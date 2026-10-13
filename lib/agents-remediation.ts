// Remediation 计划：结构、解析与工具观察证据的哈希摘要。
// 自 lib/agents-runner.ts 拆分（机械平移，语义零改动）。

import { createHash } from "node:crypto";
export interface RemediationHarnessPlan { command?: string; naReason?: string }
export interface RemediationRollbackPlan { boundary: string; command: string }
export interface RemediationScope { cwd: string; editPaths: string[]; commands: string[]; allowedEditRoots: string[] }
export interface RemediationPlan {
	editPaths?: string[];
	cwd: string;
	commands: string[];
	runtimeHarness: RemediationHarnessPlan;
	rollback: RemediationRollbackPlan;
}
export interface RemediationObservation {
	slot: number;
	toolCallId: string;
	command: string;
	cwd: string;
	exitCode: number | null;
	result: string;
}
export interface RemediationObservations {
	failedEvidenceRevision: string;
	plan: RemediationPlan;
	observations: RemediationObservation[];
	pending: Record<string, number>;
	invalid: boolean;
}
const concrete = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 3 && value.length <= 4096 && !/[\0\r\n]/.test(value);
export function parseRemediationPlan(value: unknown, cwd: string): RemediationPlan {
	const plan = value as RemediationPlan;
	if (!plan || plan.cwd !== cwd || !Array.isArray(plan.commands) || plan.commands.length < 1 || plan.commands.length > 16 || !plan.commands.every(concrete) ||
		!concrete(plan.rollback?.boundary) || !concrete(plan.rollback?.command) || !plan.runtimeHarness ||
		!(concrete(plan.runtimeHarness.command) && plan.runtimeHarness.naReason === undefined || plan.runtimeHarness.command === undefined && concrete(plan.runtimeHarness.naReason) && plan.runtimeHarness.naReason.length >= 20 && /because/i.test(plan.runtimeHarness.naReason))) throw new TypeError("Invalid remediation evidence plan");
	return structuredClone(plan);
}
export const plannedCommands = (plan: RemediationPlan) => [...plan.commands, ...(plan.runtimeHarness.command ? [plan.runtimeHarness.command] : []), plan.rollback.command];
const evidenceDigest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

// 只有配对的原生 shell 观测才能填充这份仅限修复的计划。
export function observeRemediationTool(state: RemediationObservations, raw: Record<string, unknown>): void {
	if (raw.toolName !== "bash" || typeof raw.toolCallId !== "string") return;
	const id = raw.toolCallId;
	if (raw.type === "tool_execution_start") {
		const command = (raw.args as { command?: unknown } | undefined)?.command;
		if (typeof command !== "string" || !plannedCommands(state.plan).includes(command)) return;
		if (Object.hasOwn(state.pending, id) || state.observations.some(item => item.toolCallId === id) || Object.keys(state.pending).length >= 32) { state.invalid = true; return; }
		const slot = plannedCommands(state.plan).findIndex((item, index) => item === command && !state.observations.some(observation => observation.slot === index) && !Object.values(state.pending).includes(index));
		if (slot < 0) { state.invalid = true; return; }
		state.pending[id] = slot;
	}
	if (raw.type !== "tool_execution_end" || !Object.hasOwn(state.pending, id)) return;
	const slot = state.pending[id];
	const command = plannedCommands(state.plan)[slot];
	delete state.pending[id];
	const result = raw.result as { content?: unknown; details?: { truncation?: unknown; fullOutputPath?: unknown; remediationCommand?: RemediationObservation & { truncated?: boolean } } } | undefined;
	const observed = result?.details?.remediationCommand;
	const output = JSON.stringify(result?.content ?? null);
	if (!observed || observed.toolCallId !== id || observed.command !== command || observed.cwd !== state.plan.cwd ||
		!(observed.exitCode === null || Number.isInteger(observed.exitCode)) || state.observations.length >= 32) { state.invalid = true; return; }
	const contentValid = Array.isArray(result?.content) && result.content.length > 0 && result.content.every(part =>
		part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string");
	if (raw.isError !== false || observed.exitCode !== 0 || observed.truncated || result?.details?.truncation || result?.details?.fullOutputPath || output.length > 16_000 || !contentValid) state.invalid = true;
	state.observations.push({ slot, toolCallId: id, command, cwd: observed.cwd, exitCode: observed.exitCode, result: `Observed command output ${evidenceDigest(output)}: ${output.slice(0, 400)}` });
}
export function remediationEvidence(state: RemediationObservations) {
	const find = (slot: number) => state.observations.find(item => item.slot === slot && item.command === plannedCommands(state.plan)[slot] && item.cwd === state.plan.cwd && item.exitCode === 0);
	if (state.invalid || Object.keys(state.pending).length || !/^sha256:[0-9a-f]{64}$/.test(state.failedEvidenceRevision) || !plannedCommands(state.plan).every((_, slot) => find(slot))) return undefined;
	const result = (slot: number) => `cwd ${state.plan.cwd}; retained command observation ${evidenceDigest(JSON.stringify(find(slot)))}`;
	return {
		schema: "jero.remediation-evidence/v1",
		failed_evidence_revision: state.failedEvidenceRevision,
		commands: state.plan.commands.map((command, slot) => ({ command, exit_code: 0, result: result(slot) })),
		runtime_harness: state.plan.runtimeHarness.command ? { status: "passed", command: state.plan.runtimeHarness.command, result: result(state.plan.commands.length) } : { status: "not_applicable", na_reason: state.plan.runtimeHarness.naReason },
		rollback: { boundary: state.plan.rollback.boundary, evidence: result(plannedCommands(state.plan).length - 1) },
	};
}

