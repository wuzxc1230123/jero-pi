// 模型路由应用：provider 评审角色、默认标签、旧项目覆盖迁移、applyModelConfig 系列。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { updatePackageManagedSddAgentOwnership } from "./sdd-preflight.ts";
import { normalizeRoutingEntry, readSavedModelConfigAsync as readModelRoutingAuthorityAsync, type AgentModelConfig, type AgentRoutingEntry } from "./model-routing-authority.ts";
import { isProfileOrchestratorKey } from "./agent-profiles.ts";
import { sanitizeTerminalText } from "./terminal-theme.ts";

import { agentModelProfileConfigPath, isClearRoutingEntry, isValidJsonObjectFileOrMissing, listDiscoverableAgents, listDiscoverableAgentsAsync, projectSettingsPath, removeLegacyAgentOverridesFromSettings, updateFrontmatterRouting, updateSubagentModelProfile, updateSubagentModelProfileAtPathAsync } from "./jero-ai-model-config.ts";
import { isRecord, legacyProjectModelConfigPath, modelConfigPath } from "./jero-ai-persona-config.ts";
import { pathExists } from "./jero-ai-prompts.ts";
import type { AgentSource } from "./jero-ai-sdd-startup.ts";


const PROVIDER_REVIEW_ROLES = ["review-refuter", "review-validator"] as const;



export function isProviderReviewRole(name: string): boolean {
	return PROVIDER_REVIEW_ROLES.some((role) => role === name);
}



export function modelAssignmentNames(cwd: string): string[] {
	return [...new Set([
		...PROVIDER_REVIEW_ROLES,
		...listDiscoverableAgents(cwd).map((agent) => agent.name),
	])];
}



const PROVIDER_ROUTING_DEFAULT_LABELS = {
	model: "Pi persisted default model",
	effort: "Pi persisted default effort",
} as const;



type RoutingDefaultField = keyof typeof PROVIDER_ROUTING_DEFAULT_LABELS;



export function routingDefaultLabel(name: string, field: RoutingDefaultField): string {
	return isProviderReviewRole(name) ? PROVIDER_ROUTING_DEFAULT_LABELS[field] : "inherit";
}



export function migrateLegacyProjectModelOverrides(cwd: string): number {
	const settingsPath = projectSettingsPath(cwd);
	if (!existsSync(settingsPath)) return 0;
	let settings: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
		if (!isRecord(parsed)) return 0;
		settings = { ...parsed };
	} catch {
		return 0;
	}
	const subagents = isRecord(settings.subagents) ? settings.subagents : undefined;
	const agentOverrides = isRecord(subagents?.agentOverrides)
		? subagents.agentOverrides
		: undefined;
	if (!agentOverrides) return 0;
	const agentsByName = new Map(listDiscoverableAgents(cwd).map((agent) => [agent.name, agent]));
	const migratableEntries = Object.entries(agentOverrides)
		.filter(([name]) => !isProviderReviewRole(name))
		.map(([name, value]) => ({ name, entry: normalizeRoutingEntry(value) }))
		.filter((item): item is { name: string; entry: AgentRoutingEntry } =>
			item.entry !== undefined && !isClearRoutingEntry(item.entry),
		);
	const targetPaths = new Set(
		migratableEntries.map(({ name }) =>
			agentModelProfileConfigPath(cwd, agentsByName.get(name)?.source ?? "project"),
		),
	);
	if (![...targetPaths].every(isValidJsonObjectFileOrMissing)) return 0;
	let migrated = 0;
	for (const { name, entry } of migratableEntries) {
		const source = agentsByName.get(name)?.source ?? "project";
		if (updateSubagentModelProfile(cwd, source, name, entry, { preserveExisting: true })) migrated += 1;
	}
	removeLegacyAgentOverridesFromSettings(settingsPath, settings);
	return migrated;
}



async function updateSubagentModelProfileAsync(
	cwd: string,
	source: AgentSource,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): Promise<boolean> {
	return updateSubagentModelProfileAtPathAsync(
		agentModelProfileConfigPath(cwd, source),
		name,
		entry,
		options,
	);
}



export async function applyModelConfig(
	cwd: string,
	config: AgentModelConfig,
): Promise<{ updated: number; skipped: number }> {
	let updated = 0;
	let skipped = 0;
	const seenAgents = new Set<string>();
	for (const agent of listDiscoverableAgents(cwd)) {
		if (isProviderReviewRole(agent.name)) continue;
		seenAgents.add(agent.name);
		const entry = config[agent.name];
		if (entry === undefined) {
			skipped += 1;
			continue;
		}
		if (agent.source === "builtin") {
			if (updateSubagentModelProfile(cwd, agent.source, agent.name, entry)) updated += 1;
			else skipped += 1;
			continue;
		}
		if (!agent.filePath || !existsSync(agent.filePath)) {
			skipped += 1;
		} else {
			const original = readFileSync(agent.filePath, "utf8");
			const next = updateFrontmatterRouting(original, entry);
			if (next === original) {
				skipped += 1;
			} else {
				if (!(await updatePackageManagedSddAgentOwnership(agent.filePath, original, next))) {
					writeFileSync(agent.filePath, next);
				}
				updated += 1;
			}
		}
		if (updateSubagentModelProfile(cwd, agent.source, agent.name, entry)) updated += 1;
		else skipped += 1;
	}
	for (const [name, entry] of Object.entries(config)) {
		if (isProviderReviewRole(name)) continue;
		// 编排器属于路由而非代理：它的模型存放在 Pi 的全局
		// settings.json 中，绝不能进入 subagents.json。
		if (isProfileOrchestratorKey(name)) continue;
		if (!seenAgents.has(name) && isClearRoutingEntry(entry)) {
			if (updateSubagentModelProfile(cwd, "user", name, entry)) updated += 1;
			else skipped += 1;
		}
	}
	return { updated, skipped };
}



export async function applyModelConfigAsync(
	cwd: string,
	config: AgentModelConfig,
): Promise<{ updated: number; skipped: number }> {
	let updated = 0;
	let skipped = 0;
	const seenAgents = new Set<string>();
	for (const agent of await listDiscoverableAgentsAsync(cwd)) {
		if (isProviderReviewRole(agent.name)) continue;
		seenAgents.add(agent.name);
		const entry = config[agent.name];
		if (entry === undefined) {
			skipped += 1;
			continue;
		}
		if (agent.source === "builtin") {
			if (await updateSubagentModelProfileAsync(cwd, agent.source, agent.name, entry))
				updated += 1;
			else skipped += 1;
			continue;
		}
		if (!agent.filePath || !(await pathExists(agent.filePath))) {
			skipped += 1;
		} else {
			const original = await readFile(agent.filePath, "utf8");
			const next = updateFrontmatterRouting(original, entry);
			if (next === original) {
				skipped += 1;
			} else {
				if (!(await updatePackageManagedSddAgentOwnership(agent.filePath, original, next))) {
					await writeFile(agent.filePath, next);
				}
				updated += 1;
			}
		}
		if (await updateSubagentModelProfileAsync(cwd, agent.source, agent.name, entry))
			updated += 1;
		else skipped += 1;
	}
	for (const [name, entry] of Object.entries(config)) {
		if (isProviderReviewRole(name)) continue;
		if (isProfileOrchestratorKey(name)) continue;
		if (!seenAgents.has(name) && isClearRoutingEntry(entry)) {
			if (await updateSubagentModelProfileAsync(cwd, "user", name, entry))
				updated += 1;
			else skipped += 1;
		}
	}
	return { updated, skipped };
}



export async function applySavedModelConfig(
	ctx: ExtensionContext,
	applyConfig: typeof applyModelConfigAsync = applyModelConfigAsync,
): Promise<{ updated: number; skipped: number; invalidPath?: string }> {
	const result = await readModelRoutingAuthorityAsync(
		modelConfigPath(ctx.cwd),
		legacyProjectModelConfigPath(ctx.cwd),
	);
	if (result.status === "invalid") {
		return { updated: 0, skipped: 0, invalidPath: result.path };
	}
	return applyConfig(
		ctx.cwd,
		result.status === "valid" ? result.config : {},
	);
}



export function describeModelConfig(cwd: string, config: AgentModelConfig): string[] {
	return modelAssignmentNames(cwd).map((name) => {
		const entry = config[name];
		const model = entry?.model ?? routingDefaultLabel(name, "model");
		const thinking = entry?.thinking ?? routingDefaultLabel(name, "effort");
		return `${sanitizeTerminalText(name)}: model=${sanitizeTerminalText(model)}, effort=${sanitizeTerminalText(thinking)}`;
	});
}

