// 代理模型档案的编排器选择。
//
// 档案是路由的完整快照，编排器是路由的一部分。与所有代理不同，
// 编排器不存放在 `models.json` 中：Pi 将其保存在自己的全局
// `settings.json` 里，即 `defaultProvider` / `defaultModel` /
// `defaultThinkingLevel`。本模块只负责读写这三个键，不做别的。
//
// 写入刻意保守。它对整个文件重新序列化，使 Pi 与其他扩展拥有的
// 所有无关键（`packages`、遥测设置、主题、终端选项）得以幸存；
// 它拒绝改动无法解析的文件而不是用新对象替换；它通过同目录
// 临时文件加重命名来替换目标，被中断的写入绝不会留下截断的 JSON。

import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	isThinkingLevel,
	normalizeModelId,
	type AgentRoutingEntry,
} from "./model-routing-authority.ts";
import { isRecord } from "./record-utils.ts";

/** 档案编排器条目拥有的三个 Pi 设置键。 */
export const ORCHESTRATOR_SETTINGS_KEYS = [
	"defaultProvider",
	"defaultModel",
	"defaultThinkingLevel",
] as const;

export interface OrchestratorModelRef {
	provider: string;
	model: string;
}

/**
 * 拆分 `provider/model` 路由 id。档案条目存储一个不透明的模型 id，
 * 而 Pi 分开存储两半，因此拆分只在这里发生。缺少提供方一半的 id
 * 会被拒绝而不是猜测：编排器写入不是臆造提供方的地方。
 */
export function parseOrchestratorModelRef(modelId: unknown): OrchestratorModelRef | undefined {
	const normalized = normalizeModelId(modelId);
	if (normalized === undefined) return undefined;
	const separator = normalized.indexOf("/");
	if (separator <= 0 || separator === normalized.length - 1) return undefined;
	return {
		provider: normalized.slice(0, separator),
		model: normalized.slice(separator + 1),
	};
}

export type OrchestratorSettingsReadResult =
	| { status: "missing" }
	| { status: "invalid"; reason: string }
	| { status: "valid"; entry?: AgentRoutingEntry; value: Record<string, unknown> };

/**
 * 从 Pi 设置文件读取生效的编排器选择。缺失或不可读的设置文件
 * 会被如实上报，绝不静默当作“无编排器”：面板必须区分“未设置”
 * 与“无法判断”。
 */
export function readOrchestratorSettings(settingsPath: string): OrchestratorSettingsReadResult {
	if (!existsSync(settingsPath)) return { status: "missing" };
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(settingsPath, "utf8"));
	} catch (error) {
		return { status: "invalid", reason: describeError(error) };
	}
	if (!isRecord(value)) return { status: "invalid", reason: "the file is not a JSON object" };
	const provider = value.defaultProvider;
	const model = value.defaultModel;
	if (typeof provider !== "string" || typeof model !== "string") {
		return { status: "valid", entry: undefined, value };
	}
	if (provider.length === 0 || model.length === 0) {
		return { status: "valid", entry: undefined, value };
	}
	const entry: AgentRoutingEntry = { model: `${provider}/${model}` };
	if (isThinkingLevel(value.defaultThinkingLevel)) entry.thinking = value.defaultThinkingLevel;
	return { status: "valid", entry, value };
}

export type OrchestratorSettingsWriteResult =
	| { status: "invalid"; reason: string }
	| { status: "unchanged" }
	| { status: "written"; previous?: string };

/**
 * 将一个编排器路由条目持久化进 Pi 设置文件。
 *
 * `entry` 是档案路由条目：`{ model?, thinking? }`。缺失 model 表示
 * 档案对编排器未置一词，文件因此保持原样——没有编排器条目的档案
 * 绝不能移动编排器，连移到“未设置”也不行。
 *
 * `previous` 携带成功写入之前的原始字节，让调用方履行自己的回滚
 * 契约。`undefined` 表示文件原本不存在，恢复即删除它。
 */
export function applyOrchestratorSettings(
	settingsPath: string,
	entry: AgentRoutingEntry,
): OrchestratorSettingsWriteResult {
	if (entry.model === undefined) return { status: "unchanged" };
	const reference = parseOrchestratorModelRef(entry.model);
	if (reference === undefined) {
		return {
			status: "invalid",
			reason: `model id ${JSON.stringify(entry.model)} is not a provider/model pair`,
		};
	}
	const read = readOrchestratorSettings(settingsPath);
	if (read.status === "invalid") return { status: "invalid", reason: read.reason };
	// 经过上面的无效检查后这里是安全的：文件要么解析为对象，
	// 要么不存在，而文件不存在意味着无需恢复。
	const previous = readPrevious(settingsPath);
	const next: Record<string, unknown> = { ...(read.status === "valid" ? read.value : {}) };
	next.defaultProvider = reference.provider;
	next.defaultModel = reference.model;
	if (entry.thinking === undefined) delete next.defaultThinkingLevel;
	else next.defaultThinkingLevel = entry.thinking;
	const text = `${JSON.stringify(next, null, 2)}\n`;
	if (previous === text) return { status: "unchanged" };
	writeFileAtomically(settingsPath, text);
	return { status: "written", previous };
}

function readPrevious(settingsPath: string): string | undefined {
	try {
		return readFileSync(settingsPath, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * 恢复被成功编排器写入替换的字节。`undefined` 表示写入创建了
 * 该文件，恢复即删除它。
 */
export function restoreOrchestratorSettings(
	settingsPath: string,
	previous: string | undefined,
): void {
	if (previous === undefined) {
		try {
			unlinkSync(settingsPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return;
	}
	writeFileAtomically(settingsPath, previous);
}

/**
 * 同目录临时文件加重命名，遵循与档案存储相同的失败纪律：每一步
 * 各自记录错误，清理永不抛错，真正破坏写入的错误才被上报。
 */
function writeFileAtomically(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
	const descriptor = openSync(
		temporary,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
		0o600,
	);
	const failures: unknown[] = [];
	try {
		writeFileSync(descriptor, text);
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

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
