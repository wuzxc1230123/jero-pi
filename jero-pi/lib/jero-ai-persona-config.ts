// persona 与配置主目录：配置路径解析、persona 文件读写。被提示词构建与 persona 命令共用。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { PersonaMode } from "./jero-ai-prompts.ts";


export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}



export function gentleAiConfigHome(): string {
	return process.env.JERO_PI_CONFIG_HOME ?? join(homedir(), ".pi", "jero");
}



export function modelConfigPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "models.json");
}



export function modelExportPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "models.export.json");
}



export const MODEL_EXPORT_KIND = "jero.agent_model_routing";

export const MODEL_EXPORT_VERSION = 1;



export function legacyProjectModelConfigPath(cwd: string): string {
	return join(cwd, ".pi", "jero", "models.json");
}



export function projectPersonaConfigPath(cwd: string): string {
	return join(cwd, ".pi", "jero", "persona.json");
}



export function personaConfigPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "persona.json");
}



function readPersonaFile(path: string): PersonaMode | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return undefined;
		return parsed.mode === "neutral" ? "neutral" : "gentleman";
	} catch {
		return undefined;
	}
}



export function readPersonaMode(cwd: string): PersonaMode {
	return (
		readPersonaFile(projectPersonaConfigPath(cwd)) ??
		readPersonaFile(personaConfigPath(cwd)) ??
		"gentleman"
	);
}



export function writePersonaMode(cwd: string, mode: PersonaMode): string[] {
	const paths = [personaConfigPath(cwd)];
	const projectPath = projectPersonaConfigPath(cwd);
	if (existsSync(projectPath)) paths.push(projectPath);
	for (const path of paths) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify({ mode }, null, 2)}\n`);
	}
	return paths;
}

