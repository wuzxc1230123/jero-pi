// 已确立规范索引（知识飞轮的读取侧）。SDD sync 阶段把增量 spec 回写
// openspec/specs/，但此前没有任何机制让后续会话知道这些规范存在——同一
// 教训每个会话重学一遍。这里在 harness bootstrap 的同一注入窗口
// （session_start / session_compact 置位、agent_end 复位）把 specs/ 的域
// 索引（域路径 + Purpose 首行摘要）作为单条 user 消息注入。写入侧不需要
// 新机制：SDD sync 已拥有回写，本模块只负责"沉淀下来的东西会被看见"。
// 索引只做发现入口，内容永远以 spec.md 文件为准；域数与摘要长度有硬上限，
// 防止大规范库把索引变成第二份全文。`JERO_PI_SPEC_INDEX=0|false|off` 关闭。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const JERO_SPEC_INDEX_MARKER = "jero:spec-index/v1";

const MAX_ENTRIES = 40;
const MAX_PURPOSE_CHARS = 160;

/** `JERO_PI_SPEC_INDEX=0|false|off` 关闭；默认开启。 */
export function specIndexEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = env.JERO_PI_SPEC_INDEX?.trim().toLowerCase();
	return !(value === "0" || value === "false" || value === "off");
}

export interface SpecIndexEntry {
	readonly domain: string;
	readonly purpose: string;
}

export interface SpecIndex {
	readonly entries: readonly SpecIndexEntry[];
	readonly truncated: boolean;
}

function safeDirectories(path: string): string[] {
	try {
		return readdirSync(path)
			.filter((entry) => {
				try {
					return statSync(join(path, entry)).isDirectory();
				} catch {
					return false;
				}
			})
			.sort();
	} catch {
		return [];
	}
}

function safeRead(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

interface SpecFile {
	readonly path: string;
	readonly text: string;
}

function walkSpecFiles(specsRoot: string): SpecFile[] {
	const files: SpecFile[] = [];
	function walk(dir: string): void {
		for (const entry of safeDirectories(dir)) {
			const path = join(dir, entry);
			const specPath = join(path, "spec.md");
			// 单次读盘同时服务"非空判定"与 Purpose 提取——索引在 bootstrap
			// 窗口内的每次 LLM 请求都会求值，同一文件绝不读两遍。
			const text = safeRead(specPath);
			if (text.trim().length > 0) files.push({ path: specPath, text });
			walk(path);
		}
	}
	walk(specsRoot);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

// Purpose 首个非空行是 OpenSpec spec.md 的规范摘要位置；没有该节（或该节
// 为空）时退回文件首个非标题非列表的非空行，再退回占位说明。任何解析
// 失败都不阻塞索引。
function extractPurpose(text: string): string {
	const pick = (candidate: string): string => {
		const line = candidate
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) =>
				line.length > 0 && !line.startsWith("#") &&
				!line.startsWith("- ") && !line.startsWith("* "));
		return (line ?? "").slice(0, MAX_PURPOSE_CHARS);
	};
	const purposeMatch = text.match(/^##\s+Purpose\s*$/m);
	const purpose = purposeMatch ? pick(text.slice(purposeMatch.index + purposeMatch[0].length)) : "";
	if (purpose) return purpose;
	const fallback = pick(text);
	return fallback || "（spec.md 无 Purpose 段，读文件确认）";
}

export function buildSpecIndex(cwd: string): SpecIndex {
	const specsRoot = join(resolve(cwd), "openspec", "specs");
	const entries = walkSpecFiles(specsRoot)
		.map((file) => ({
			domain: relative(specsRoot, file.path).split(/[\\/]/).slice(0, -1).join("/"),
			purpose: extractPurpose(file.text),
		}))
		.sort((a, b) => a.domain.localeCompare(b.domain));
	const truncated = entries.length > MAX_ENTRIES;
	return {
		entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries,
		truncated,
	};
}

export function renderSpecIndexText(index: SpecIndex): string | undefined {
	if (index.entries.length === 0) return undefined;
	const lines = [
		JERO_SPEC_INDEX_MARKER,
		"",
		`已确立规范索引（openspec/specs/，${index.entries.length}${index.truncated ? "+" : ""} 个域）：`,
		...index.entries.map((entry) => `- ${entry.domain} — ${entry.purpose}`),
	];
	if (index.truncated) lines.push("- ……（域数超过上限，未列出的域直接查 openspec/specs/ 目录）");
	lines.push("", "改动列出的域之前先读对应 openspec/specs/<domain>/spec.md；SDD sync 阶段把新学到的契约回写规范。索引只是发现入口，内容以 spec.md 为准。");
	return lines.join("\n");
}

export function messageContainsSpecIndex(message: unknown): boolean {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (typeof content === "string") return content.includes(JERO_SPEC_INDEX_MARKER);
	if (!Array.isArray(content)) return false;
	return content.some((part) =>
		typeof part === "object" && part !== null &&
		(part as { type?: unknown }).type === "text" &&
		typeof (part as { text?: unknown }).text === "string" &&
		(part as { text: string }).text.includes(JERO_SPEC_INDEX_MARKER),
	);
}

/** 便宜的在场预检 + 昂贵求值：索引消息已在上下文中时绝不重扫 specs/ 树
 * （context 事件每次 LLM 请求都会走到这里，marker 去重必须发生在求值前）。 */
export function specIndexTextFor(messages: readonly unknown[], cwd: string): string | undefined {
	if (messages.some(messageContainsSpecIndex)) return undefined;
	return renderSpecIndexText(buildSpecIndex(cwd));
}

function firstNonCompactionSummaryIndex(messages: readonly unknown[]): number {
	let index = 0;
	while ((messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") index += 1;
	return index;
}

// 返回注入后的新数组；已存在索引消息时返回 undefined（索引在窗口内视为
// 常量：specs/ 的变更走下一窗口，活状态归 SDD 面包屑管）。text 为 undefined
// （无规范）时原样返回。消息形状是 UserMessage，由接线处受控转换。
export function applySpecIndex(
	messages: readonly unknown[],
	text: string | undefined,
	now: () => number = Date.now,
): unknown[] | undefined {
	if (!text || messages.some(messageContainsSpecIndex)) return undefined;
	const injected = {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: now(),
	};
	const insertAt = firstNonCompactionSummaryIndex(messages);
	return [...messages.slice(0, insertAt), injected, ...messages.slice(insertAt)];
}
