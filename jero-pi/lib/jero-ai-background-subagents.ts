// 后台子代理策略：on/off 配置的解析、决议与渲染。唯一写入者是用户命令，自动化绝不触碰。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadRuntimeGuardrailsConfig } from "./jero-ai-guardrails.ts";
import { jeroConfigHome, isRecord } from "./jero-ai-persona-config.ts";


// ---------------------------------------------------------------------------
// 后台子代理策略 —— 项目 > 全局 > 环境变量 > 默认开启
// ---------------------------------------------------------------------------

export type BackgroundSubagentsPolicy = "on" | "off";

export type BackgroundSubagentsCapability = "ready" | "absent";



export interface BackgroundSubagentsRendering {
	policy: BackgroundSubagentsPolicy;
	capability: BackgroundSubagentsCapability;
}

/** 四个来源中哪一个决定了生效策略。 */
type BackgroundSubagentsSource =
	| "project_file"
	| "global_file"
	| "environment"
	| "default";



interface BackgroundSubagentsResolution {
	policy: BackgroundSubagentsPolicy;
	source: BackgroundSubagentsSource;
	/** 决定策略的文件存在，但未通过严格解码。 */
	malformed: boolean;
	projectFile: string;
	globalFile: string;
	projectFileExists: boolean;
	globalFileExists: boolean;
	/** 原始环境变量值，即使无法识别且不生效也会上报。 */
	envValue: string | undefined;
}



interface LoadBackgroundSubagentsOptions {
	/** 覆盖配置主目录（测试中用于避免触碰 ~/.pi）。 */
	jeroPiConfigHome?: string;
	/** 覆盖环境变量查找（测试用）。 */
	env?: Record<string, string | undefined>;
}



const BACKGROUND_SUBAGENTS_SCHEMA = "jero.background-subagents/v1";

export const BACKGROUND_SUBAGENTS_FILE = "background-subagents.json";



/** 与解析器的内置默认一致（无任何信号时 on）；capability 保守为 absent。 */
export const DEFAULT_BACKGROUND_SUBAGENTS_RENDERING: BackgroundSubagentsRendering = {
	policy: "on",
	capability: "absent",
};

/**
 * 对 {"schema":"jero.background-subagents/v1","policy":"on"|"off"} 的严格解码。
 * 任何畸形形态（JSON 损坏、schema 不符、未知键、非法 policy）
 * 都返回 undefined，让调用方保守失败为 "off"。
 */
export function parseBackgroundSubagentsPolicyFile(
	raw: string,
): BackgroundSubagentsPolicy | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	if (parsed.schema !== BACKGROUND_SUBAGENTS_SCHEMA) return undefined;
	if (parsed.policy !== "on" && parsed.policy !== "off") return undefined;
	if (Object.keys(parsed).length !== 2) return undefined;
	return parsed.policy;
}

/**
 * 解析后台子代理策略，以及决定该策略的来源。
 *
 * 解析顺序（先命中者优先，与 loadRuntimeGuardrailsConfig 一致）：
 *   1. 项目文件 `${cwd}/.pi/jero/background-subagents.json`
 *   2. 全局文件 `${configHome}/background-subagents.json`
 *      （configHome 遵循 JERO_PI_CONFIG_HOME，默认 ~/.pi/jero）
 *   3. 环境变量 JERO_PI_BACKGROUND_SUBAGENTS（"on" | "off"）
 *   4. 内置默认 "on"（并行后台委托是常规形态；想收敛经上面任一来源关掉）
 *
 * 两类显式输入保守失败为 "off"，而不是继续落到较低优先级的来源：
 * 存在但畸形的文件（归属于该文件），以及设置了但无法识别的环境变量值
 * （归属于环境变量）——"用户想控制但输入坏了"与"用户没有表态"是两种
 * 不同情况，前者绝不静默滑向默认 on。
 *
 * 四个来源且先命中优先，正是那种会让一次编辑看起来毫无效果的结构，
 * 因此决定来源被纳入返回结果，而不是让调用方自行重新推导。
 */
export function resolveBackgroundSubagentsPolicy(
	cwd: string,
	options: LoadBackgroundSubagentsOptions = {},
): BackgroundSubagentsResolution {
	const env = options.env ?? process.env;
	const envValue = env.JERO_PI_BACKGROUND_SUBAGENTS;
	let projectFile = "";
	let globalFile = "";
	try {
		const configHome = options.jeroPiConfigHome ?? jeroConfigHome();
		projectFile = join(cwd, ".pi", "jero", BACKGROUND_SUBAGENTS_FILE);
		globalFile = join(configHome, BACKGROUND_SUBAGENTS_FILE);
		const projectFileExists = existsSync(projectFile);
		const globalFileExists = existsSync(globalFile);
		const locations = { projectFile, globalFile, projectFileExists, globalFileExists, envValue };
		for (const [source, path, present] of [
			["project_file", projectFile, projectFileExists],
			["global_file", globalFile, globalFileExists],
		] as const) {
			if (!present) continue;
			let decoded: BackgroundSubagentsPolicy | undefined;
			try {
				decoded = parseBackgroundSubagentsPolicyFile(readFileSync(path, "utf8"));
			} catch {
				// 在这一层，无法读取与无法使用不可区分，
				// 两者都必须在声称拥有决定权的文件上保守失败。
				decoded = undefined;
			}
			return decoded === undefined
				? { policy: "off", source, malformed: true, ...locations }
				: { policy: decoded, source, malformed: false, ...locations };
		}
		if (envValue === "on" || envValue === "off") {
			return { policy: envValue, source: "environment", malformed: false, ...locations };
		}
		if (envValue !== undefined) {
			// 显式设置了却无法识别：保守失败为 off，绝不静默落到默认 on。
			return { policy: "off", source: "environment", malformed: false, ...locations };
		}
		return { policy: "on", source: "default", malformed: false, ...locations };
	} catch {
		return {
			policy: "on",
			source: "default",
			malformed: false,
			projectFile,
			globalFile,
			projectFileExists: false,
			globalFileExists: false,
			envValue,
		};
	}
}

/**
 * 仅返回生效策略，供不上报来源的调用方使用。
 * 通过委托实现，加载器与解析器永远不会各执一词。
 */
export function loadBackgroundSubagentsPolicy(
	cwd: string,
	options: LoadBackgroundSubagentsOptions = {},
): BackgroundSubagentsPolicy {
	return resolveBackgroundSubagentsPolicy(cwd, options).policy;
}

/** 写入全局策略文件，必要时创建配置主目录。 */
export function writeGlobalBackgroundSubagentsPolicy(
	policy: BackgroundSubagentsPolicy,
	configHome: string = jeroConfigHome(),
): string {
	const path = join(configHome, BACKGROUND_SUBAGENTS_FILE);
	mkdirSync(configHome, { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify({ schema: BACKGROUND_SUBAGENTS_SCHEMA, policy }, null, 2)}\n`,
	);
	return path;
}



function describeBackgroundSubagentsSource(
	resolution: BackgroundSubagentsResolution,
): string {
	switch (resolution.source) {
		case "project_file":
			return `project file ${resolution.projectFile}`;
		case "global_file":
			return `global file ${resolution.globalFile}`;
		case "environment":
			return "JERO_PI_BACKGROUND_SUBAGENTS";
		default:
			return "built-in default";
	}
}

/**
 * 上报生效策略、决定它的来源、已解析的能力，以及用户需要了解的
 * 关于“未”起决定作用的来源的信息。`wrote` 表示本次调用刚写入全局
 * 文件的策略；被更高优先级文件压过的写入，绝不能被报告成
 * 已经生效。
 */
export function renderBackgroundSubagentsReport(
	resolution: BackgroundSubagentsResolution,
	capability: BackgroundSubagentsCapability,
	wrote?: BackgroundSubagentsPolicy,
): { message: string; type: "info" | "warning" } {
	const lines = [
		`background subagents: ${resolution.policy} (decided by ${describeBackgroundSubagentsSource(resolution)}; capability: ${capability})`,
	];
	if (wrote !== undefined) {
		lines.push(`Wrote ${wrote} to the global file ${resolution.globalFile}.`);
	}
	if (resolution.malformed) {
		const path =
			resolution.source === "project_file" ? resolution.projectFile : resolution.globalFile;
		lines.push(
			`${path} is present but malformed, so the policy fails closed to off and no lower-priority source is consulted.`,
		);
	}
	const outranksTheWrite = wrote !== undefined && resolution.source === "project_file";
	if (outranksTheWrite) {
		lines.push(
			`That global write does not take effect here: the project file ${resolution.projectFile} outranks it. Edit or remove that project file to let the global setting decide.`,
		);
	} else if (
		wrote === undefined &&
		resolution.source === "project_file" &&
		resolution.globalFileExists
	) {
		lines.push(
			`The global file ${resolution.globalFile} exists but is outranked by that project file.`,
		);
	}
	if (resolution.envValue !== undefined) {
		if (resolution.envValue === "on" || resolution.envValue === "off") {
			if (resolution.source !== "environment") {
				lines.push(
					`JERO_PI_BACKGROUND_SUBAGENTS=${resolution.envValue} is set, but both files outrank it and it outranks the built-in default; it decides only when neither file exists.`,
				);
			}
		} else {
			lines.push(
				`JERO_PI_BACKGROUND_SUBAGENTS="${resolution.envValue}" is not a recognized value ("on" or "off"), so the policy fails closed to off.`,
			);
		}
	}
	lines.push(
		"Resolution order (first hit wins): project file, global file, JERO_PI_BACKGROUND_SUBAGENTS, built-in default on.",
	);
	return {
		message: lines.join("\n"),
		type: resolution.malformed || outranksTheWrite ? "warning" : "info",
	};
}

