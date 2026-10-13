// SDD 状态面包屑。harness bootstrap（lib/jero-ai-bootstrap.ts）注入的是
// 压缩后仍须存续的不变纪律；这里注入的是会话的活状态：磁盘状态引擎
// （lib/sdd-status.ts，native sddStatus 背后的同一实现）解析出的当前变更、
// 下一步推荐与任务进度。不变量借自 Trellis 的每回合面包屑——"必需步骤不在
// 每回合可见，就会被模型静默跳过"——因此在有活跃 SDD 变更期间的每次 LLM
// 请求都注入，内容随磁盘状态刷新（指纹去重，同指纹已存在时不重复注入）。
// 无活跃变更、变更已归档、变更选择歧义、或存储非权威（engram/none，磁盘
// 引擎无真相可宣告）时不注入。RPC 子进程与包子进程由接线处与 bootstrap
// 同门拒绝。`JERO_PI_SDD_BREADCRUMB=0|false|off` 关闭。
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SddStatus } from "./sdd-status.ts";

export const JERO_SDD_BREADCRUMB_MARKER = "jero:sdd-breadcrumb/v1";

/** `JERO_PI_SDD_BREADCRUMB=0|false|off` 关闭；默认开启。 */
export function sddBreadcrumbEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = env.JERO_PI_SDD_BREADCRUMB?.trim().toLowerCase();
	return !(value === "0" || value === "false" || value === "off");
}

export interface SddBreadcrumb {
	readonly fingerprint: string;
	readonly text: string;
}

// ---------------------------------------------------------------------------
// 面包屑专用的状态缓存。context 事件每次 LLM 请求都会解析状态，而
// resolveSddStatus 是全量磁盘扫描（changes 目录 + 每变更多文件）。指纹是
// openspec/ 树的 stat-only 深度遍历（目录与文件的 mtime/size）：tasks.md
// 勾选、spec 回写、变更增删都必然改变其中至少一项，stat 远廉于整读。
// 控制器与命令路径不经此缓存——它们要的是即席权威读数。
// ---------------------------------------------------------------------------

type SddStatusResolver = (options: { cwd: string }) => SddStatus;

const CACHE_LIMIT = 16;
const statusCache = new Map<string, { fingerprint: string; status: SddStatus }>();

function openspecFingerprint(cwd: string): string {
	const parts: string[] = [];
	const walk = (dir: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(dir).sort();
		} catch {
			parts.push("!");
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry);
			try {
				const stat = statSync(path);
				if (stat.isDirectory()) {
					parts.push(`d:${entry}:${stat.mtimeMs}`);
					walk(path);
				} else {
					parts.push(`f:${entry}:${stat.mtimeMs}:${stat.size}`);
				}
			} catch {
				parts.push(`x:${entry}`);
			}
		}
	};
	walk(join(resolve(cwd), "openspec"));
	return parts.join("|");
}

export function cachedResolveSddStatus(cwd: string, resolveStatus: SddStatusResolver): SddStatus {
	const fingerprint = openspecFingerprint(cwd);
	const cached = statusCache.get(cwd);
	if (cached !== undefined && cached.fingerprint === fingerprint) return cached.status;
	const status = resolveStatus({ cwd });
	if (statusCache.size >= CACHE_LIMIT) statusCache.clear();
	statusCache.set(cwd, { fingerprint, status });
	return status;
}

export function shouldRenderSddBreadcrumb(status: SddStatus): boolean {
	if (status.isNonAuthoritative) return false;
	if (status.archived) return false;
	return status.changeName !== null;
}

// 指纹只覆盖面包屑展示的字段：状态引擎的其余细节（路径、警告）变化不产生
// 新面包屑，避免无意义的重复注入。
export function renderSddBreadcrumb(status: SddStatus): SddBreadcrumb | undefined {
	if (!shouldRenderSddBreadcrumb(status)) return undefined;
	const fingerprint = createHash("sha256")
		.update(JSON.stringify([
			status.changeName,
			status.nextRecommended,
			status.dependencies,
			status.taskProgress.complete,
			status.taskProgress.total,
			status.blockedReasons[0] ?? null,
		]))
		.digest("hex")
		.slice(0, 16);
	const lines = [
		`${JERO_SDD_BREADCRUMB_MARKER} ${fingerprint}`,
		"",
		"SDD 状态面包屑（磁盘状态引擎的确定性投影；以此为准，不要凭记忆推断阶段）：",
		`- 变更: ${status.changeName}`,
		`- 下一步: ${status.nextRecommended}（apply=${status.dependencies.apply} verify=${status.dependencies.verify} sync=${status.dependencies.sync} archive=${status.dependencies.archive}）`,
		`- 任务: ${status.taskProgress.complete}/${status.taskProgress.total} 完成，剩余 ${status.taskProgress.remaining}`,
	];
	if (status.blockedReasons.length > 0) lines.push(`- 首个阻塞: ${status.blockedReasons[0]}`);
	lines.push("推进：把下一阶段委托给对应 sdd-* 代理（或由用户运行 /jero-sdd-continue）；实现任务完成后立即勾选 tasks.md。");
	return { fingerprint, text: lines.join("\n") };
}

// 去重扫描：string 与分段两种 content 形态都要覆盖（与 bootstrap 同形）。
export function messageContainsSddBreadcrumb(message: unknown): boolean {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (typeof content === "string") return content.includes(JERO_SDD_BREADCRUMB_MARKER);
	if (!Array.isArray(content)) return false;
	return content.some((part) =>
		typeof part === "object" && part !== null &&
		(part as { type?: unknown }).type === "text" &&
		typeof (part as { text?: unknown }).text === "string" &&
		(part as { text: string }).text.includes(JERO_SDD_BREADCRUMB_MARKER),
	);
}

function messageCarriesFingerprint(message: unknown, fingerprint: string): boolean {
	const content = (message as { content?: unknown } | undefined)?.content;
	const text = typeof content === "string"
		? content
		: Array.isArray(content)
			? content
				.filter((part) =>
					typeof part === "object" && part !== null &&
					(part as { type?: unknown }).type === "text" &&
					typeof (part as { text?: unknown }).text === "string",
				)
				.map((part) => (part as { text: string }).text)
				.join("\n")
			: "";
	return text.includes(`${JERO_SDD_BREADCRUMB_MARKER} ${fingerprint}`);
}

function firstNonCompactionSummaryIndex(messages: readonly unknown[]): number {
	let index = 0;
	while ((messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") index += 1;
	return index;
}

// 先剔除任何旧面包屑（含同指纹的，保证内容永远取最新状态），再把新鲜
// 面包屑插到压缩摘要之后。在场面包屑全部携带当前指纹时返回 undefined，
// 让本次请求的上下文保持原样。breadcrumb 为 undefined（无活跃变更）时
// 只做清理。消息形状是 UserMessage，由接线处受控转换。
export function applySddBreadcrumb(
	messages: readonly unknown[],
	breadcrumb: SddBreadcrumb | undefined,
	now: () => number = Date.now,
): unknown[] | undefined {
	const carriers = messages.filter(messageContainsSddBreadcrumb);
	if (breadcrumb && carriers.length > 0 && carriers.every((message) => messageCarriesFingerprint(message, breadcrumb.fingerprint))) {
		return undefined;
	}
	const kept = messages.filter((message) => !messageContainsSddBreadcrumb(message));
	if (!breadcrumb) return kept.length === messages.length ? undefined : kept;
	const crumb = {
		role: "user",
		content: [{ type: "text", text: breadcrumb.text }],
		timestamp: now(),
	};
	const insertAt = firstNonCompactionSummaryIndex(kept);
	return [...kept.slice(0, insertAt), crumb, ...kept.slice(insertAt)];
}
