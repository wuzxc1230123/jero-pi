// 代理模型档案：`/jero:profiles` 背后的全局 `models.json` 路由的具名可切换
// 快照。存储位于 `<configHome>/profiles.json`，单档案导出位于
// `<configHome>/profiles.export.json`。除底部两个路径辅助函数和轻量读写
// 封装外，这里的一切都是纯函数；扩展面板负责所有 TUI 与编排事务。

import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	normalizeModelConfig,
	type AgentModelConfig,
	type AgentRoutingEntry,
} from "./model-routing-authority.ts";
import { isRecord } from "./record-utils.ts";

export const PROFILES_KIND = "jero.agent_model_profiles/v1";
export const PROFILES_VERSION = 1;
export const PROFILE_EXPORT_KIND = "jero.agent_model_profile";
export const PROFILE_EXPORT_VERSION = 1;

export interface AgentProfilesFile {
	kind: typeof PROFILES_KIND;
	version: typeof PROFILES_VERSION;
	active?: string;
	profiles: Record<string, AgentModelConfig>;
}

export type AgentProfileErrorCode =
	| "invalid_name"
	| "duplicate_name"
	| "missing_profile"
	| "active_profile";

export class AgentProfileError extends Error {
	readonly code: AgentProfileErrorCode;

	constructor(code: AgentProfileErrorCode, message: string) {
		super(message);
		this.name = "AgentProfileError";
		this.code = code;
	}
}

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// 通过 slug 模式的名称在用作记录键时仍会与对象原型成员冲突，
// 因此这里显式拒绝它们。
const RESERVED_PROFILE_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const INHERIT_MODEL_LABEL = "inherit";

/**
 * 为编排器选择保留的路由键。
 *
 * 档案是路由的完整快照，编排器是其中的一部分，但编排器不是代理：
 * 它从不写入 `subagents.json`，从没有代理文件，其模型位于 Pi 的全局
 * `settings.json` 中。保留该键是为了让路由映射能够携带它，同时所有
 * 面向代理的路径都跳过它。
 */
export const PROFILE_ORCHESTRATOR_KEY = "orchestrator";

export function isProfileOrchestratorKey(key: string): boolean {
	return key === PROFILE_ORCHESTRATOR_KEY;
}

/** 档案自身定义的编排器条目（若档案定义了它）。 */
export function readProfileOrchestrator(
	config: AgentModelConfig,
): AgentRoutingEntry | undefined {
	if (!Object.prototype.hasOwnProperty.call(config, PROFILE_ORCHESTRATOR_KEY)) return undefined;
	const entry = config[PROFILE_ORCHESTRATOR_KEY];
	return entry && Object.keys(entry).length > 0 ? entry : undefined;
}

/**
 * 移除保留编排器键后的路由映射，供所有计数或列出角色的调用方使用：
 * 编排器不是角色。
 */
export function profileRoleEntries(config: AgentModelConfig): Array<[string, AgentRoutingEntry]> {
	return Object.entries(config).filter(([agent]) => !isProfileOrchestratorKey(agent));
}

export function isValidProfileName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		PROFILE_NAME_PATTERN.test(value) &&
		!RESERVED_PROFILE_NAMES.has(value)
	);
}

export function emptyProfilesFile(): AgentProfilesFile {
	return { kind: PROFILES_KIND, version: PROFILES_VERSION, active: undefined, profiles: {} };
}

// ---- 解析与规范化 ----

export interface ProfilesParseDrops {
	droppedProfiles: string[];
	droppedAgents: Array<{ profile: string; agent: string }>;
	/** 未指向某个已规范化档案的 `active` 标记（若存在）。 */
	droppedActive?: string;
}

export interface NormalizedProfilesFile {
	file: AgentProfilesFile;
	drops: ProfilesParseDrops;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function requireValidName(name: string): string {
	if (!isValidProfileName(name)) {
		throw new AgentProfileError(
			"invalid_name",
			`Invalid profile name: ${JSON.stringify(name)}. Use 1-64 characters (letters, numbers, '.', '_', '-') starting with a letter or number.`,
		);
	}
	return name;
}

export function normalizeProfilesFile(value: unknown): NormalizedProfilesFile | undefined {
	if (!isRecord(value)) return undefined;
	if (value.kind !== PROFILES_KIND || value.version !== PROFILES_VERSION) return undefined;
	const rawProfiles = value.profiles;
	if (!isRecord(rawProfiles)) return undefined;
	const profiles: Record<string, AgentModelConfig> = {};
	const drops: ProfilesParseDrops = { droppedProfiles: [], droppedAgents: [] };
	for (const [name, rawConfig] of Object.entries(rawProfiles)) {
		if (!isValidProfileName(name)) {
			drops.droppedProfiles.push(name);
			continue;
		}
		const config = normalizeModelConfig(rawConfig);
		if (!config) {
			drops.droppedProfiles.push(name);
			continue;
		}
		for (const agent of Object.keys(isRecord(rawConfig) ? rawConfig : {})) {
			if (!hasOwn(config, agent)) drops.droppedAgents.push({ profile: name, agent });
		}
		profiles[name] = config;
	}
	let active: string | undefined;
	if (value.active !== undefined) {
		if (
			typeof value.active === "string" &&
			isValidProfileName(value.active) &&
			hasOwn(profiles, value.active)
		) {
			active = value.active;
		} else {
			// 绝不静默清除该标记：过期的 `active` 正是操作员需要看到的状态，
			// 而不是让它凭空消失。
			drops.droppedActive =
				typeof value.active === "string" ? value.active : JSON.stringify(value.active);
		}
	}
	return { file: { kind: PROFILES_KIND, version: PROFILES_VERSION, active, profiles }, drops };
}

export type ProfilesFileParseResult =
	| { status: "invalid" }
	| { status: "valid"; file: AgentProfilesFile };

export function parseProfilesFileText(text: string): ProfilesFileParseResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { status: "invalid" };
	}
	const file = normalizeProfilesFile(value)?.file;
	return file ? { status: "valid", file } : { status: "invalid" };
}

function cloneProfileConfig(config: AgentModelConfig): AgentModelConfig {
	return Object.fromEntries(
		Object.entries(config).map(([agent, entry]) => [agent, { ...entry }]),
	);
}

function cloneProfiles(
	profiles: Record<string, AgentModelConfig>,
): Record<string, AgentModelConfig> {
	return Object.fromEntries(
		Object.entries(profiles).map(([name, config]) => [name, cloneProfileConfig(config)]),
	);
}

export function serializeProfilesFile(file: AgentProfilesFile): string {
	const payload: Record<string, unknown> = {
		kind: file.kind,
		version: file.version,
		profiles: cloneProfiles(file.profiles),
	};
	if (file.active !== undefined) payload.active = file.active;
	return `${JSON.stringify(payload, null, 2)}\n`;
}

// ---- 存储变更（每个都返回新文件，绝不改动输入） ----

export function createProfile(
	file: AgentProfilesFile,
	name: string,
	config: AgentModelConfig,
): AgentProfilesFile {
	requireValidName(name);
	if (hasOwn(file.profiles, name)) {
		throw new AgentProfileError("duplicate_name", `Profile already exists: ${name}.`);
	}
	return { ...file, profiles: { ...file.profiles, [name]: cloneProfileConfig(config) } };
}

export function updateProfile(
	file: AgentProfilesFile,
	name: string,
	config: AgentModelConfig,
): AgentProfilesFile {
	requireValidName(name);
	if (!hasOwn(file.profiles, name)) {
		throw new AgentProfileError("missing_profile", `Profile does not exist: ${name}.`);
	}
	return { ...file, profiles: { ...file.profiles, [name]: cloneProfileConfig(config) } };
}

export function duplicateProfile(
	file: AgentProfilesFile,
	from: string,
	to: string,
): AgentProfilesFile {
	requireValidName(from);
	if (!hasOwn(file.profiles, from)) {
		throw new AgentProfileError("missing_profile", `Profile does not exist: ${from}.`);
	}
	requireValidName(to);
	if (hasOwn(file.profiles, to)) {
		throw new AgentProfileError("duplicate_name", `Profile already exists: ${to}.`);
	}
	return createProfile(file, to, file.profiles[from]);
}

export function renameProfile(
	file: AgentProfilesFile,
	from: string,
	to: string,
): AgentProfilesFile {
	requireValidName(from);
	if (!hasOwn(file.profiles, from)) {
		throw new AgentProfileError("missing_profile", `Profile does not exist: ${from}.`);
	}
	requireValidName(to);
	if (hasOwn(file.profiles, to)) {
		throw new AgentProfileError("duplicate_name", `Profile already exists: ${to}.`);
	}
	const profiles = Object.fromEntries(
		Object.entries(file.profiles).map(([name, config]) => [
			name === from ? to : name,
			cloneProfileConfig(config),
		]),
	);
	return {
		...file,
		active: file.active === from ? to : file.active,
		profiles,
	};
}

export function deleteProfile(file: AgentProfilesFile, name: string): AgentProfilesFile {
	requireValidName(name);
	if (!hasOwn(file.profiles, name)) {
		throw new AgentProfileError("missing_profile", `Profile does not exist: ${name}.`);
	}
	if (file.active === name) {
		throw new AgentProfileError(
			"active_profile",
			`Profile ${name} is active. Apply another profile before deleting it.`,
		);
	}
	return {
		...file,
		profiles: Object.fromEntries(
			Object.entries(file.profiles).filter(([profileName]) => profileName !== name),
		),
	};
}

export function setActiveProfile(file: AgentProfilesFile, name: string): AgentProfilesFile {
	requireValidName(name);
	if (!hasOwn(file.profiles, name)) {
		throw new AgentProfileError("missing_profile", `Profile does not exist: ${name}.`);
	}
	return { ...file, active: name };
}

// ---- 摘要与面板决策辅助 ----

export interface ProfileModelSummary {
	model: string;
	count: number;
	roles: string[];
}

export interface ProfileSummary {
	models: ProfileModelSummary[];
	total: number;
}

export function summarizeProfile(config: AgentModelConfig): ProfileSummary {
	const byModel = new Map<string, string[]>();
	for (const [agent, entry] of profileRoleEntries(config)) {
		const model = entry?.model ?? INHERIT_MODEL_LABEL;
		const roles = byModel.get(model);
		if (roles) roles.push(agent);
		else byModel.set(model, [agent]);
	}
	const models = [...byModel.entries()]
		.map(([model, roles]) => ({
			model,
			count: roles.length,
			roles: [...roles].sort((left, right) => left.localeCompare(right)),
		}))
		.sort(
			(left, right) =>
				right.count - left.count || left.model.localeCompare(right.model),
		);
	return { models, total: models.reduce((sum, model) => sum + model.count, 0) };
}

export function formatProfileSummaryLines(summary: ProfileSummary): string[] {
	if (summary.total === 0) {
		return ["No routing entries — every agent inherits its default model."];
	}
	return summary.models.map(
		(model) =>
			`${model.count} ${model.count === 1 ? "agent" : "agents"} → ${model.model}: ${model.roles.join(", ")}`,
	);
}

export interface ProfileRoutingRow {
	agent: string;
	model: string;
	thinking: string;
}

/**
 * 每个代理一行，按稳定的字母顺序排列，使档案路由与生效路由能够逐行
 * 比较；保留的编排器键被排除在外，因为它单独渲染成一行。
 */
export function profileRoutingRows(config: AgentModelConfig): ProfileRoutingRow[] {
	return profileRoleEntries(config)
		.map(([agent, entry]) => ({
			agent,
			model: entry?.model ?? INHERIT_MODEL_LABEL,
			thinking: entry?.thinking ?? INHERIT_MODEL_LABEL,
		}))
		.sort((left, right) => left.agent.localeCompare(right.agent));
}

/**
 * 同一面板内所有路由表共享的列宽，使档案路由与生效路由逐列对齐，
 * 而不是各区块各自计算宽度。
 */
export function routingColumnWidths(
	...groups: ProfileRoutingRow[][]
): { agent: number; model: number } {
	const rows = groups.flat();
	return {
		agent: rows.reduce((width, row) => Math.max(width, row.agent.length), 0),
		model: rows.reduce((width, row) => Math.max(width, row.model.length), 0),
	};
}

export function formatRoutingRow(
	row: ProfileRoutingRow,
	widths: { agent: number; model: number },
): string {
	return `${row.agent.padEnd(widths.agent)}  ${row.model.padEnd(widths.model)}  ${row.thinking}`;
}

/**
 * 描述编排器选择的单行文本，用于面板头部。该标签区分“此档案未设置任何
 * 内容”与“settings.json 无法读取”，这是两种不同的操作员状态。
 */
export function formatOrchestratorSelection(entry: AgentRoutingEntry | undefined): string {
	if (entry?.model === undefined) {
		return entry?.thinking === undefined
			? INHERIT_MODEL_LABEL
			: `${INHERIT_MODEL_LABEL} · ${entry.thinking}`;
	}
	return entry.thinking === undefined ? entry.model : `${entry.model} · ${entry.thinking}`;
}

export interface ProfileListItem {
	id: string;
	label: string;
	description: string;
}

export function buildProfileListItems(file: AgentProfilesFile): ProfileListItem[] {
	return Object.entries(file.profiles).map(([name, config]) => {
		const roles = profileRoleEntries(config).length;
		return {
			id: name,
			label: name === file.active ? `${name} (active)` : name,
			description: `${roles} ${roles === 1 ? "role" : "roles"}`,
		};
	});
}

export function bootstrapProfilesFile(currentConfig: AgentModelConfig): AgentProfilesFile {
	const config = normalizeModelConfig(currentConfig) ?? {};
	const file = createProfile(emptyProfilesFile(), "current", config);
	return Object.keys(config).length > 0 ? setActiveProfile(file, "current") : file;
}

// ---- 单档案导出 ----

export interface ProfileExport {
	name: string;
	config: AgentModelConfig;
}

export interface ProfileExportParseResult extends ProfileExport {
	droppedAgents: string[];
}

export function serializeProfileExport(name: string, config: AgentModelConfig): string {
	requireValidName(name);
	return `${JSON.stringify(
		{
			kind: PROFILE_EXPORT_KIND,
			version: PROFILE_EXPORT_VERSION,
			name,
			config: cloneProfileConfig(config),
		},
		null,
		2,
	)}\n`;
}

export function parseProfileExportTextWithDrops(
	text: string,
): ProfileExportParseResult | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	if (value.kind !== PROFILE_EXPORT_KIND || value.version !== PROFILE_EXPORT_VERSION) {
		return undefined;
	}
	if (!isValidProfileName(value.name) || !isRecord(value.config)) return undefined;
	const config = normalizeModelConfig(value.config);
	if (!config) return undefined;
	const droppedAgents = Object.keys(value.config).filter(
		(agent) => !hasOwn(config, agent),
	);
	return { name: value.name, config, droppedAgents };
}

export function parseProfileExportText(text: string): ProfileExport | undefined {
	const result = parseProfileExportTextWithDrops(text);
	return result ? { name: result.name, config: result.config } : undefined;
}

// ---- 路径辅助与文件封装 ----

export type ProfilesFileReadResult =
	| { status: "missing" }
	| { status: "invalid" }
	| { status: "valid"; file: AgentProfilesFile; drops: ProfilesParseDrops };

export function profilesFilePath(configHome: string): string {
	return join(configHome, "profiles.json");
}

export function profileExportPath(configHome: string): string {
	return join(configHome, "profiles.export.json");
}

export function readProfilesFileResult(path: string): ProfilesFileReadResult {
	if (!existsSync(path)) return { status: "missing" };
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return { status: "invalid" };
	}
	// 经 normalizeProfilesFile 解析，让调用方能点名每个被规范化丢弃的条目，
	// 而不是静默丢失。
	const normalized = normalizeProfilesFile(value);
	if (!normalized) return { status: "invalid" };
	return { status: "valid", file: normalized.file, drops: normalized.drops };
}

/**
 * 通过同目录临时文件加重命名来替换存储。直接写入一旦被中断会留下截断的
 * JSON，届时 `readProfilesFileResult` 只能将其判为不可读，因此目标文件只会在
 * 完整文件就绪后才被替换，且临时文件在每条失败路径上都会被移除。
 */
export function writeProfilesFileSync(path: string, file: AgentProfilesFile): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
	const descriptor = openSync(
		temporary,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
		0o600,
	);
	// 每一步各自记录自己的失败，清理永不抛错，因此真正导致写入失败的那个
	// 错误才是被上报的：close 或 unlink 失败不得掩盖写入或重命名失败，
	// 且临时文件在每条路径上都会被移除。
	const failures: unknown[] = [];
	try {
		writeFileSync(descriptor, serializeProfilesFile(file));
	} catch (error) {
		failures.push(error);
	}
	try {
		closeSync(descriptor);
	} catch (error) {
		failures.push(error);
	}
	if (failures.length === 0) {
		try {
			renameSync(temporary, path);
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		unlinkSync(temporary);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(error);
	}
	if (failures.length > 0) throw failures[0];
}
