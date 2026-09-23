// 危险命令护栏：bash 命令分类（block/confirm/allow）、配置文件解析、确认标题与预览。安全策略独立且权威。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { gentleAiConfigHome, isRecord } from "./jero-ai-persona-config.ts";


// 匹配 `git [全局标志] push` —— 容忍 `git` 与子命令之间的
// -C /repo 或 --work-tree=/tmp 等标志。短标志后面可以跟一个独立的取值 token。
const GIT_GLOBAL_FLAGS_SRC = String.raw`(?:\s+--?\S+(?:\s+[^-\s]\S*)?)* `;

const GIT_PUSH_RE = new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}(push)\b`);



const DENIED_BASH_PATTERNS: RegExp[] = [
	// 阻止针对 /、~ 或 ~/子目录、$HOME 或 $HOME/子目录、.. 或 . 的 rm -rf
	/\brm\s+-rf\s+(?:\/(?:\s|$)|~(?:\/|\s|$)|[$]HOME(?:\/|\s|$)|\.\.?(?:\s|$))/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\b(?=[^\n]*(?:-[^\n]*f|--force))(?=[^\n]*(?:-[^\n]*d|--directories))/,
	// 强制推送拒绝：容忍子命令前的 git 全局标志（如 -C /repo）
	new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}push\b(?=[^\n]*\s--force(?:-with-lease)?\b)`),
	new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}push\b(?=[^\n]*\s-[^\s-]*f)`),
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
];

// ---------------------------------------------------------------------------
// 自主守卫 —— 运行时护栏配置
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// 自主守卫 —— 运行时护栏配置
// ---------------------------------------------------------------------------

const GUARD_ACTION = {
	ALLOW: "allow",
	CONFIRM: "confirm",
	BLOCK: "block",
} as const;



type GuardAction = (typeof GUARD_ACTION)[keyof typeof GUARD_ACTION];

type GuardClassification = GuardAction | "not-guarded";



interface GuardMatch {
	key: GuardedCommandKey;
	action: GuardAction;
	triggerIndex: number;
}



interface GuardEvaluation {
	action: GuardClassification;
	key?: GuardedCommandKey;
	triggerIndex: number;
	matches: GuardMatch[];
}



const GUARDED_COMMAND_KEY = {
	GIT_PUSH: "gitPush",
	GIT_REBASE: "gitRebase",
	GIT_BRANCH_DELETE_FORCE: "gitBranchDeleteForce",
	NPM_PUBLISH: "npmPublish",
	PI_REMOVE: "piRemove",
} as const;



type GuardedCommandKey = (typeof GUARDED_COMMAND_KEY)[keyof typeof GUARDED_COMMAND_KEY];



type GuardedCommandsConfig = Partial<Record<GuardedCommandKey, GuardAction>>;



interface RuntimeGuardrailsConfig {
	autonomousMode: boolean;
	guardedCommands: GuardedCommandsConfig;
}



interface LoadGuardrailsOptions {
	/** 覆盖配置主目录（测试中用于避免触碰 ~/.pi）。 */
	gentlePiConfigHome?: string;
	/** 覆盖自主模式检查所用的环境（注入的 processEnv 接缝）。 */
	env?: NodeJS.ProcessEnv;
}



const GUARDED_KEY_PATTERNS: Record<GuardedCommandKey, RegExp> = {
	gitPush: GIT_PUSH_RE,
	gitRebase: /\bgit\s+(rebase)\b/,
	gitBranchDeleteForce: /\bgit\s+(branch)\s+(?:-[a-zA-Z]*D[a-zA-Z]*|-[a-zA-Z]*d[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*d[a-zA-Z]*|--delete\b[^\r\n;&|]*--force\b|--force\b[^\r\n;&|]*--delete\b)/,
	npmPublish: /\bnpm\s+(publish)\b/,
	piRemove: /\bpi\s+(remove)\b/,
};



const AUTONOMOUS_DEFAULT_ACTIONS: Record<GuardedCommandKey, GuardAction> = {
	gitPush: "allow",
	gitRebase: "confirm",
	gitBranchDeleteForce: "confirm",
	npmPublish: "block",
	piRemove: "confirm",
};



const GUARDED_COMMAND_LABELS: Record<GuardedCommandKey, string> = {
	gitPush: "git push",
	gitRebase: "git rebase",
	gitBranchDeleteForce: "forced git branch deletion",
	npmPublish: "npm publish",
	piRemove: "pi remove",
};



const SAFE_GUARDRAILS_CONFIG: RuntimeGuardrailsConfig = {
	autonomousMode: false,
	guardedCommands: {},
};

/**
 * 按运行时守卫策略对一条 shell 命令分类。
 *
 * 顺序（不可协商）：
 *   1. 硬拒绝模式 → "block"（永远生效，不能被配置覆盖）
 *   2. 若 autonomousMode 为 false → 镜像旧版 CONFIRM_BASH_PATTERNS 的结果
 *   3. 若 autonomousMode 为 true → 对命中的键使用配置的 GuardAction
 *      （对 guardedCommands 中未设置的键应用 AUTONOMOUS_DEFAULT_ACTIONS）
 *   4. 无命中 → "not-guarded"
 */


/**
 * 按运行时守卫策略对一条 shell 命令分类。
 *
 * 顺序（不可协商）：
 *   1. 硬拒绝模式 → "block"（永远生效，不能被配置覆盖）
 *   2. 若 autonomousMode 为 false → 镜像旧版 CONFIRM_BASH_PATTERNS 的结果
 *   3. 若 autonomousMode 为 true → 对命中的键使用配置的 GuardAction
 *      （对 guardedCommands 中未设置的键应用 AUTONOMOUS_DEFAULT_ACTIONS）
 *   4. 无命中 → "not-guarded"
 */
function collectGuardedMatches(
	command: string,
	config: RuntimeGuardrailsConfig,
): GuardMatch[] {
	const matches: GuardMatch[] = [];
	for (const [key, pattern] of Object.entries(GUARDED_KEY_PATTERNS) as [
		GuardedCommandKey,
		RegExp,
	][]) {
		const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);
		for (const match of command.matchAll(globalPattern)) {
			const action = config.autonomousMode
				? (config.guardedCommands[key] ?? AUTONOMOUS_DEFAULT_ACTIONS[key])
				: "confirm";
			matches.push({
				key,
				action,
				triggerIndex: match.index + match[0].lastIndexOf(match[1]),
			});
		}
	}
	return matches.sort((left, right) => left.triggerIndex - right.triggerIndex);
}



export function evaluateGuardedCommand(
	command: string,
	config: RuntimeGuardrailsConfig,
): GuardEvaluation {
	const matches = collectGuardedMatches(command, config);

	// 硬拒绝覆盖整条命令上的任何已配置动作。
	for (const pattern of DENIED_BASH_PATTERNS) {
		const denied = pattern.exec(command);
		if (!denied) continue;
		const matchedAction = matches.find((match) =>
			match.triggerIndex >= denied.index && match.triggerIndex < denied.index + denied[0].length,
		);
		return {
			action: "block",
			key: matchedAction?.key,
			triggerIndex: matchedAction?.triggerIndex ?? denied.index,
			matches,
		};
	}

	// 在所有命中中，先取配置的 block，其次 confirm，最后 allow。
	const selected = matches.find((match) => match.action === "block")
		?? matches.find((match) => match.action === "confirm")
		?? matches.find((match) => match.action === "allow");
	if (selected) return { ...selected, matches };
	return { action: "not-guarded", triggerIndex: 0, matches };
}



export function classifyGuardedCommand(
	command: string,
	config: RuntimeGuardrailsConfig,
): GuardClassification {
	return evaluateGuardedCommand(command, config).action;
}



export function guardedCommandPreview(command: string, triggerIndex: number): string {
	const start = Math.max(0, triggerIndex - 60);
	const prefix = start > 0 ? "…" : "";
	return `${prefix}${truncateToWidth(command.slice(start).replace(/\s+/g, " ").trim(), 180 - prefix.length, "…")}`;
}

/** 所有受守卫动作的确认标题；没有键命中时使用通用文案。 */


/** 所有受守卫动作的确认标题；没有键命中时使用通用文案。 */
export function guardedCommandTitle(
	key?: GuardedCommandKey,
	matches: readonly GuardMatch[] = [],
): string {
	if (matches.length > 1) {
		return `Allow guarded actions: ${matches.map((match) => GUARDED_COMMAND_LABELS[match.key]).join("; ")}?`;
	}
	return key === undefined
		? "Allow guarded command?"
		: `Allow guarded ${GUARDED_COMMAND_LABELS[key]}?`;
}



function parseGuardrailsConfigFile(
	raw: string,
): RuntimeGuardrailsConfig | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;

	const autonomousMode = parsed.autonomousMode === true;

	const rawCommands = isRecord(parsed.guardedCommands) ? parsed.guardedCommands : {};
	const guardedCommands: GuardedCommandsConfig = {};
	const validActions = new Set<string>(["allow", "confirm", "block"]);
	for (const [key, value] of Object.entries(rawCommands)) {
		if (
			typeof value === "string" &&
			validActions.has(value) &&
			Object.values(GUARDED_COMMAND_KEY).includes(key as GuardedCommandKey)
		) {
			guardedCommands[key as GuardedCommandKey] = value as GuardAction;
		}
	}

	return { autonomousMode, guardedCommands };
}

/**
 * 加载运行时护栏配置。
 *
 * 解析顺序（项目覆盖全局）：
 *   1. 检查 JERO_PI_AUTONOMOUS_MODE 环境变量 —— 若为 "1"，强制 autonomousMode=true
 *      并使用默认的受守卫命令动作。
 *   2. 从 ${gentlePiConfigHome}/runtime-guardrails.json 读取全局配置
 *   3. 从 ${cwd}/.pi/jero/runtime-guardrails.json 读取项目配置
 *      （项目值合并覆盖在全局之上）
 *   4. 任何位置的解析/读取错误 → 保守回退（返回 SAFE_GUARDRAILS_CONFIG）
 */
// 宿主注入的 processEnv（测试接缝）：在扩展创建时设置，让护栏的
// 环境变量检查与运行时其余部分读取同一份环境，
// 而不是绕过接缝去取真实的 process.env。


/**
 * 加载运行时护栏配置。
 *
 * 解析顺序（项目覆盖全局）：
 *   1. 检查 JERO_PI_AUTONOMOUS_MODE 环境变量 —— 若为 "1"，强制 autonomousMode=true
 *      并使用默认的受守卫命令动作。
 *   2. 从 ${gentlePiConfigHome}/runtime-guardrails.json 读取全局配置
 *   3. 从 ${cwd}/.pi/jero/runtime-guardrails.json 读取项目配置
 *      （项目值合并覆盖在全局之上）
 *   4. 任何位置的解析/读取错误 → 保守回退（返回 SAFE_GUARDRAILS_CONFIG）
 */
// 宿主注入的 processEnv（测试接缝）：在扩展创建时设置，让护栏的
// 环境变量检查与运行时其余部分读取同一份环境，
// 而不是绕过接缝去取真实的 process.env。
export let guardrailsProcessEnv: NodeJS.ProcessEnv = process.env;



export function loadRuntimeGuardrailsConfig(
	cwd: string,
	options: LoadGuardrailsOptions = {},
): RuntimeGuardrailsConfig {
	try {
		// 环境变量覆盖：以默认动作强制进入自主模式
		if ((options.env ?? guardrailsProcessEnv).JERO_PI_AUTONOMOUS_MODE === "1") {
			return { autonomousMode: true, guardedCommands: {} };
		}

		const configHome = options.gentlePiConfigHome ?? gentleAiConfigHome();
		const globalConfigPath = join(configHome, "runtime-guardrails.json");
		const projectConfigPath = join(cwd, ".pi", "jero", "runtime-guardrails.json");

		let merged: RuntimeGuardrailsConfig = { autonomousMode: false, guardedCommands: {} };

		if (existsSync(globalConfigPath)) {
			const globalParsed = parseGuardrailsConfigFile(
				readFileSync(globalConfigPath, "utf8"),
			);
			if (!globalParsed) return SAFE_GUARDRAILS_CONFIG;
			merged = globalParsed;
		}

		if (existsSync(projectConfigPath)) {
			const projectParsed = parseGuardrailsConfigFile(
				readFileSync(projectConfigPath, "utf8"),
			);
			if (!projectParsed) return SAFE_GUARDRAILS_CONFIG;
			// 项目值完全覆盖全局值
			merged = {
				autonomousMode: projectParsed.autonomousMode,
				guardedCommands: {
					...merged.guardedCommands,
					...projectParsed.guardedCommands,
				},
			};
		}

		return merged;
	} catch {
		return SAFE_GUARDRAILS_CONFIG;
	}
}

