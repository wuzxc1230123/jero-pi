// 护栏傻瓜式配置报告：把"当前生效什么、来自哪里、去哪里改、怎么写"渲染成
// 一份可直接照抄的说明。只读，不改变任何护栏行为。
// 三层防护的配置入口统一在这里呈现：
//   1. 命令护栏  —— runtime-guardrails.json（全局/项目）
//   2. 敏感路径护栏 —— 固定规则，不可配置（doctor 报告其激活状态）
//   3. 后台子代理 —— background-subagents.json（on/off/渲染）
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	AUTONOMOUS_DEFAULT_ACTIONS,
	DENIED_BASH_PATTERNS,
	GUARDED_COMMAND_KEY,
	GUARDED_COMMAND_LABELS,
	GUARDED_KEY_PATTERNS,
	parseGuardrailsConfigFile,
} from "./jero-ai-guardrails.ts";
import { gentleAiConfigHome } from "./jero-ai-persona-config.ts";
import { BACKGROUND_SUBAGENTS_FILE, renderBackgroundSubagentsReport, resolveBackgroundSubagentsPolicy } from "./jero-ai-background-subagents.ts";
import { resolveBackgroundSubagentsCapability } from "./jero-ai-writer-scope.ts";

export type GuardActionView = "allow" | "confirm" | "block" | "mirror-confirm";
export type GuardSourceView = "env" | "project" | "global" | "autonomous-default" | "non-autonomous-mirror";

export interface GuardCommandView {
	readonly key: string;
	readonly label: string;
	readonly action: GuardActionView;
	readonly source: GuardSourceView;
}

export interface GuardrailsStatus {
	readonly autonomousMode: boolean;
	readonly modeSource: "env" | "project" | "global" | "default";
	readonly globalFile: string;
	readonly projectFile: string;
	readonly projectFileExists: boolean;
	readonly globalFileExists: boolean;
	readonly parseError: string | undefined;
	readonly commands: readonly GuardCommandView[];
}

/** 解析有效护栏配置及其来源链（与 loadRuntimeGuardrailsConfig 同序，只读旁路）。 */
export function resolveGuardrailsStatus(
	cwd: string,
	options: { env?: NodeJS.ProcessEnv; gentlePiConfigHome?: string } = {},
): GuardrailsStatus {
	const configHome = options.gentlePiConfigHome ?? gentleAiConfigHome();
	const globalFile = join(configHome, "runtime-guardrails.json");
	const projectFile = join(cwd, ".pi", "jero", "runtime-guardrails.json");
	const globalFileExists = existsSync(globalFile);
	const projectFileExists = existsSync(projectFile);

	if (options.env?.JERO_PI_AUTONOMOUS_MODE === "1") {
		return statusView(true, "env", globalFile, projectFile, globalFileExists, projectFileExists, undefined, "env");
	}
	let parseError: string | undefined;
	let autonomousMode = false;
	let modeSource: "project" | "global" | "default" = "default";
	const overrides: Partial<Record<string, { action: GuardActionView; source: "project" | "global" }>> = {};
	if (globalFileExists) {
		const parsed = parseGuardrailsConfigFile(readFileSync(globalFile, "utf8"));
		if (!parsed) parseError = `全局配置不是合法的 runtime-guardrails.json：${globalFile}`;
		else {
			autonomousMode = parsed.autonomousMode;
			modeSource = "global";
			for (const key of Object.values(GUARDED_COMMAND_KEY)) {
				const action = parsed.guardedCommands[key];
				if (action) overrides[key] = { action, source: "global" };
			}
		}
	}
	if (projectFileExists) {
		const parsed = parseGuardrailsConfigFile(readFileSync(projectFile, "utf8"));
		if (!parsed) parseError = parseError ?? `项目配置不是合法的 runtime-guardrails.json：${projectFile}`;
		else {
			autonomousMode = parsed.autonomousMode;
			modeSource = "project";
			for (const key of Object.values(GUARDED_COMMAND_KEY)) {
				const action = parsed.guardedCommands[key];
				if (action) overrides[key] = { action, source: "project" };
			}
		}
	}
	return statusView(autonomousMode, modeSource, globalFile, projectFile, globalFileExists, projectFileExists, parseError, undefined, overrides);
}

function statusView(
	autonomousMode: boolean,
	modeSource: GuardrailsStatus["modeSource"],
	globalFile: string,
	projectFile: string,
	globalFileExists: boolean,
	projectFileExists: boolean,
	parseError: string | undefined,
	envForced: "env" | undefined,
	overrides?: Partial<Record<string, { action: GuardActionView; source: "project" | "global" }>>,
): GuardrailsStatus {
	const commands = (Object.values(GUARDED_COMMAND_KEY)).map((key) => {
		const override = overrides?.[key];
		if (autonomousMode) {
			const action = override?.action ?? AUTONOMOUS_DEFAULT_ACTIONS[key];
			const source = override?.source ?? "autonomous-default";
			return { key, label: GUARDED_COMMAND_LABELS[key], action: action as GuardActionView, source: source as GuardSourceView };
		}
		// 非自主模式：镜像旧版确认行为；显式覆盖仍生效
		const action = override?.action ?? "mirror-confirm";
		const source = override?.source ?? "non-autonomous-mirror";
		return { key, label: GUARDED_COMMAND_LABELS[key], action, source: source as GuardSourceView };
	});
	return {
		autonomousMode,
		modeSource: envForced ?? modeSource,
		globalFile,
		projectFile,
		globalFileExists,
		projectFileExists,
		parseError,
		commands,
	};
}

const ACTION_LABELS: Record<string, string> = {
	allow: "allow（直接放行）",
	confirm: "confirm（每次确认）",
	block: "block（硬拒绝）",
	"mirror-confirm": "confirm（默认镜像确认）",
};

/** 傻瓜式报告：状态 + 每条命令的生效动作与来源 + 硬拒绝清单 + 可照抄模板。 */
export function guardReportLines(cwd: string, options: { env?: NodeJS.ProcessEnv; gentlePiConfigHome?: string } = {}): string[] {
	const status = resolveGuardrailsStatus(cwd, options);
	const lines: string[] = [
		"el Jero guard —— 防护配置总览",
		`autonomousMode: ${status.autonomousMode ? "on" : "off"}（来源：${status.modeSource}）`,
		`全局配置文件: ${status.globalFile}${status.globalFileExists ? "（存在）" : "（不存在，可创建）"}`,
		`项目配置文件: ${status.projectFile}${status.projectFileExists ? "（存在，优先生效）" : "（不存在，可创建）"}`,
	];
	if (status.parseError) lines.push(`warn: ${status.parseError}（忽略该文件，保守回退）`);
	lines.push("", "受守卫命令的生效动作：");
	for (const command of status.commands) {
		lines.push(`  ${command.label} → ${ACTION_LABELS[command.action] ?? command.action}（来源：${command.source}）`);
	}
	lines.push(
		"",
		`永远硬拒绝（不可配置，共 ${DENIED_BASH_PATTERNS.length} 类）：rm -rf /|~|.. 、git reset --hard、git clean -fd、git push --force、chmod -R 777 等`,
		`敏感路径护栏（read/write/edit 触碰 .ssh/.env/*.pem 等）：固定规则，不可配置`,
	);
	const subagents = resolveBackgroundSubagentsPolicy(cwd);
	const subagentsReport = renderBackgroundSubagentsReport(subagents, resolveBackgroundSubagentsCapability(cwd));
	lines.push("", "后台子代理：", ...subagentsReport.message.split("\n").map((line) => `  ${line}`));
	lines.push("", "照抄模板（写到上面任一配置文件即可生效，项目覆盖全局）：", ...guardTemplateLines(status.projectFile));
	return lines;
}

/** 可照抄的最小配置模板 + 修改指引。 */
export function guardTemplateLines(projectFile: string): string[] {
	const keys = (Object.values(GUARDED_COMMAND_KEY))
		.map((key) => `\t// ${GUARDED_COMMAND_LABELS[key]}：allow | confirm | block\n\t"${key}": "${AUTONOMOUS_DEFAULT_ACTIONS[key]}",`)
		.join("\n");
	return [
		"```json",
		"{",
		'\t"autonomousMode": true,   // true = 按下表放行；false = 全部按确认处理',
		'\t"guardedCommands": {',
		keys,
		"\t}",
		"}",
		"```",
		`写到 ${projectFile}（仅本项目）或全局 runtime-guardrails.json。`,
		`环境变量 JERO_PI_AUTONOMOUS_MODE=1 可强制自主模式（优先级最高）。`,
		`后台子代理开关写 ${BACKGROUND_SUBAGENTS_FILE}（内容 {"schema":"jero.background-subagents/v1","policy":"on"|"off"}，项目文件优先于全局）。`,
	];
}
