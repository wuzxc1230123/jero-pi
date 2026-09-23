import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

// 同配置 OS 用户内的信任边界，不是授权通道。POSIX 权限位
// 限制新建存储；Windows 部署必须自行提供 ACL。
// 有界的同步 I/O 让发布/清理串行化，避免 promise 竞争。
export const ACTIVITY_LIMIT = 16 * 1024 * 1024;
const HEADER_LIMIT = 16 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STATUSES = ["running", "queued", "waiting", "completed", "failed", "cancelled", "timed_out"];
type ObjectValue = Record<string, any>;
/** 远端记录属于独立的只读存储，绝不进入本地 TaskStore。
 * 以 (header.sessionHash, header.incarnation, summary.id) 作键，而非裸任务 ID。
 * 头部提供父会话身份；调用方只投影该会话的任务。 */
export interface RemoteSummary {
	id: string; agent: string; label: string; status: string; model: string;
	createdAt: number; startedAt: number | null; endedAt: number | null; lastActivityAt: number;
}
export interface ActivityInput {
	task: RemoteSummary;
	thread: { version: number; dropped: number; items: readonly object[] };
}
export interface Activity { tasks: { summary: ActivityInput["task"]; thread: {
	version: number; dropped: number; items: ObjectValue[];
} }[] }
export interface Target { sessionHash: string; incarnation: string }
export interface Header extends Target {
	schema: 1; label: string; heartbeat: number; generation: number;
	counts: { running: number; queued: number; waiting: number; finished: number };
	digest: string | null; unavailable: "activity-too-large" | null;
}

const object = (v: unknown): v is ObjectValue => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const keys = (v: ObjectValue, names: string[]) => Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function label(text: string) {
	const clean = stripVTControlCharacters(text).replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
	return Array.from(clean).slice(0, 120).join("").trimEnd();
}
const pick = (v: ObjectValue, names: string[]) => Object.fromEntries(names.map((k) => [k, v[k]]));
const summaryTextKeys = ["id", "agent", "label", "status", "model"];
const summaryKeys = [...summaryTextKeys, "createdAt", "startedAt", "endedAt", "lastActivityAt"];
const toolKeys = ["kind", "callId", "name", "output", "running", "isError"];

/** 保留每个条目和每个输出字符；不含提示词回退或调用参数
 * （其中可能嵌入子代理提示词）、会话元数据或控制句柄。
 * 这是字段白名单，不是内容脱敏：保留的文本可能包含机密。 */
export function projectActivity(input: readonly ActivityInput[]): Activity {
	const activity = { tasks: input.map(({ task, thread }) => ({
		summary: pick(task, summaryKeys) as ActivityInput["task"],
		thread: { version: thread.version, dropped: thread.dropped,
			items: thread.items.map((item) => pick(item, (item as ObjectValue).kind === "tool" ? toolKeys : ["kind", "text"])) },
	})) };
	if (!validActivity(activity)) throw new Error("malformed-activity");
	return activity;
}

function validActivity(value: unknown): value is Activity {
	return object(value) && keys(value, ["tasks"]) && Array.isArray(value.tasks) && value.tasks.every((row: unknown) => {
		if (!object(row) || !keys(row, ["summary", "thread"])) return false;
		const { summary: s, thread: t } = row;
		return object(s) && keys(s, summaryKeys) && summaryTextKeys.every((k) => typeof s[k] === "string") && STATUSES.includes(s.status)
			&& integer(s.createdAt) && integer(s.lastActivityAt)
			&& [s.startedAt, s.endedAt].every((time) => time === null || integer(time))
			&& object(t) && keys(t, ["version", "dropped", "items"]) && integer(t.version) && integer(t.dropped)
			&& Array.isArray(t.items) && t.items.every((item: unknown) => object(item) && (item.kind === "tool"
				? keys(item, toolKeys) && ["callId", "name", "output"].every((k) => typeof item[k] === "string")
					&& typeof item.running === "boolean" && typeof item.isError === "boolean"
				: ["text", "thinking", "note"].includes(item.kind) && keys(item, ["kind", "text"]) && typeof item.text === "string"));
	});
}

function validTarget(value: Target) {
	return object(value) && typeof value.sessionHash === "string" && HASH.test(value.sessionHash)
		&& typeof value.incarnation === "string" && UUID.test(value.incarnation);
}
function validHeader(h: unknown): h is Header {
	if (!object(h) || !keys(h, ["schema", "sessionHash", "incarnation", "label", "heartbeat", "generation", "counts", "digest", "unavailable"])) return false;
	return validTarget(h as Header) && h.schema === 1 && typeof h.label === "string" && h.label === label(h.label)
		&& integer(h.heartbeat) && integer(h.generation) && h.generation > 0
		&& object(h.counts) && keys(h.counts, ["running", "queued", "waiting", "finished"]) && Object.values(h.counts).every(integer)
		&& ((h.unavailable === null && typeof h.digest === "string" && HASH.test(h.digest))
			|| (h.unavailable === "activity-too-large" && h.digest === null));
}
function filename(target: Target, kind: "header" | "activity") {
	if (!validTarget(target)) throw new Error("malformed");
	return `${target.sessionHash}.${target.incarnation}.${kind}.json`;
}

function directory(path: string, privateMode = false, owned = privateMode) {
	const stat = fs.lstatSync(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (owned && process.platform !== "win32"
		&& ((stat.mode & (privateMode ? 0o077 : 0o022)) !== 0 || stat.uid !== process.getuid?.()))) throw new Error("unsafe-directory");
}
function rootFor(profile: string, create = false) {
	const absolute = resolve(profile);
	// 符号链接祖先同样拒绝。调用方提供的是已存在的配置根目录。
	for (let path = absolute;; path = dirname(path)) {
		directory(path);
		if (dirname(path) === path) break;
	}
	const shared = join(absolute, "gentle-agents");
	const root = join(shared, "presence");
	// 历史模块可能已持有 0755 的共享根目录。绝不更改其权限。
	for (const path of [shared, root]) {
		if (create) {
			try { fs.mkdirSync(path, { mode: 0o700 }); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
		}
		directory(path, path === root, true);
	}
	return root;
}
function regular(stat: fs.Stats) {
	if (!stat.isFile() || stat.nlink !== 1 || (process.platform !== "win32" && stat.uid !== process.getuid?.())) throw new Error("unsafe-file");
}
function boundedRead(path: string, limit: number) {
	const before = fs.lstatSync(path);
	regular(before);
	if (before.size > limit) throw new Error("oversized");
	const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
	try {
		const stat = fs.fstatSync(fd);
		regular(stat);
		if (stat.ino !== before.ino || stat.dev !== before.dev) throw new Error("unsafe-file");
		if (stat.size > limit) throw new Error("oversized");
		const bytes = Buffer.alloc(stat.size + 1);
		let used = 0;
		while (used < bytes.length) {
			const count = fs.readSync(fd, bytes, used, bytes.length - used, null);
			if (!count) break;
			used += count;
		}
		if (used !== stat.size) throw new Error("changed-file");
		return bytes.subarray(0, used);
	} finally { fs.closeSync(fd); }
}
function reason(error: unknown) {
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" ? "missing" : code ? "io-error" : error instanceof SyntaxError ? "malformed" : (error as Error).message;
}
function atomicWrite(root: string, name: string, bytes: string) {
	directory(root, true);
	const destination = join(root, name);
	try { regular(fs.lstatSync(destination)); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	const temp = join(root, `.${name}.${randomUUID()}.tmp`);
	const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
	try {
		try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
		fs.renameSync(temp, destination);
	} finally {
		try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
}

export interface PresencePage {
	entries: (Header & { recent: boolean })[];
	scanned: number; rejected: number; overflow: boolean; unavailable?: string;
}
function emptyPage(): PresencePage {
	return { entries: [], scanned: 0, rejected: 0, overflow: false };
}

/** 有界的进程内续体：每次 next() 最多检查 128 个条目。
 * 遍历耗尽时自动关闭；中途放弃遍历的调用方必须在 finally 中关闭。
 * 溢出表示页预算已耗尽；下一页可能为空。
 * 稳定目录按 OS 顺序只遍历一次。并发变更可能导致
 * 遗漏/重复：按激活键去重，并在刷新时打开新的游标。
 * 这不是快照，也不是存活保证。不删除任何过期文件。 */
export class PresenceCursor {
	private dir?: fs.Dir;
	private readonly profile: string;
	private readonly identity: fs.Stats;
	constructor(profile: string) {
		this.profile = resolve(profile);
		const root = rootFor(this.profile);
		this.identity = fs.lstatSync(root);
		this.dir = fs.opendirSync(root);
	}
	next(now = Date.now()): PresencePage {
		const result = emptyPage();
		if (!this.dir) return { ...result, unavailable: "closed" };
		try {
			const stat = fs.lstatSync(rootFor(this.profile));
			if (stat.dev !== this.identity.dev || stat.ino !== this.identity.ino) throw new Error("changed-directory");
			while (result.scanned < 128) {
				const entry = this.dir.readSync();
				if (!entry) { this.close(); return result; }
				result.scanned++;
				if (!entry.name.endsWith(".header.json") || entry.name.startsWith(".")) continue;
				try {
					const h = JSON.parse(boundedRead(join(this.dir.path, entry.name), HEADER_LIMIT).toString("utf8"));
					if (!validHeader(h) || filename(h, "header") !== entry.name) throw new Error("malformed");
					result.entries.push({ ...h, recent: now >= h.heartbeat && now - h.heartbeat <= 15_000 });
				} catch { result.rejected++; }
			}
			result.overflow = true;
		} catch (error) { result.unavailable = reason(error); this.close(); }
		return result;
	}
	close() {
		const dir = this.dir;
		this.dir = undefined;
		dir?.closeSync();
	}
}

/** 仅首页便捷封装。一旦可见溢出，请改用 PresenceCursor。 */
export function listPresence(profile: string, now = Date.now()): PresencePage {
	try {
		const cursor = new PresenceCursor(profile);
		try { return cursor.next(now); } finally { cursor.close(); }
	} catch (error) { return { ...emptyPage(), unavailable: reason(error) }; }
}

/** 该选择同时钉住激活标识与世代号；绝不回退到其他会话。 */
export function readActivity(profile: string, selection: Header): { activity?: Activity; unavailable?: string } {
	try {
		// 目录列表只会附带这个读取方自有的显示提示。
		const { recent: _recent, ...h } = selection as Header & { recent?: boolean };
		if (!validHeader(h)) throw new Error("malformed");
		if (h.unavailable) return { unavailable: h.unavailable };
		const bytes = boundedRead(join(rootFor(profile), filename(h, "activity")), ACTIVITY_LIMIT);
		const value = JSON.parse(bytes.toString("utf8"));
		if (object(value) && integer(value.generation) && value.generation !== h.generation) throw new Error("generation-mismatch");
		if (digest(bytes) !== h.digest) throw new Error("digest-mismatch");
		if (!object(value) || !keys(value, ["schema", "sessionHash", "incarnation", "generation", "activity"])
			|| value.schema !== 1 || value.generation !== h.generation || value.sessionHash !== h.sessionHash
			|| value.incarnation !== h.incarnation || !validActivity(value.activity)) throw new Error("malformed");
		return { activity: value.activity };
	} catch (error) { return { unavailable: reason(error) }; }
}

export class PresencePublisher {
	readonly target: Readonly<Target>;
	private readonly profile: string;
	private readonly displayLabel: string;
	private header!: Header;
	private published = "";
	private pending = "";
	private timer?: ReturnType<typeof setTimeout>;
	private heartbeat?: ReturnType<typeof setInterval>;
	private disposed = false;
	private owned = new Map<string, { dev: number; ino: number }>();
	/** 定时器 I/O 失败会停止发布；消费者仍按 recent TTL 处理。 */
	error?: string;

	private constructor(options: { profile: string; sessionId: string; label: string }) {
		this.profile = options.profile;
		this.displayLabel = label(options.label);
		this.target = Object.freeze({ sessionHash: digest(options.sessionId), incarnation: randomUUID() });
	}
	static start(options: { profile: string; sessionId: string; label: string; activity: readonly ActivityInput[] }) {
		const publisher = new PresencePublisher(options);
		try {
			rootFor(options.profile, true);
			publisher.pending = JSON.stringify(projectActivity(options.activity));
			publisher.flush();
			publisher.heartbeat = setInterval(() => publisher.guarded(() => publisher.publishHeader()), 5000);
			publisher.heartbeat.unref();
			return publisher;
		} catch (error) { publisher.dispose(); throw error; }
	}
	/** 主动投影/序列化每个传入快照，以脱离调用方自有数据。
	 * 只有磁盘发布被合并；调用方应避免无关的失效请求。 */
	update(input: readonly ActivityInput[]) {
		if (this.disposed) throw new Error("disposed");
		const next = JSON.stringify(projectActivity(input));
		if (next === this.pending) return;
		this.pending = next;
		if (!this.timer && next !== this.published) {
			this.timer = setTimeout(() => {
				this.timer = undefined;
				this.guarded(() => this.flush());
			}, 400);
			this.timer.unref();
		}
	}
	private guarded(action: () => void) {
		if (this.disposed) return;
		try { action(); } catch (error) { this.error = reason(error); this.dispose(); }
	}
	private write(kind: "header" | "activity", bytes: string) {
		const root = rootFor(this.profile);
		const name = filename(this.target, kind);
		atomicWrite(root, name, bytes);
		const { dev, ino } = fs.lstatSync(join(root, name));
		this.owned.set(name, { dev, ino });
	}
	private publishHeader() {
		const header = { ...this.header, heartbeat: Date.now() };
		if (!validHeader(header)) throw new Error("malformed-header");
		this.write("header", JSON.stringify(header));
		this.header = header;
	}
	private flush() {
		if (this.pending === this.published) return;
		const activity: Activity = JSON.parse(this.pending);
		const generation = (this.header?.generation ?? 0) + 1;
		const bytes = JSON.stringify({ schema: 1, ...this.target, generation, activity });
		const oversized = Buffer.byteLength(bytes) > ACTIVITY_LIMIT;
		const counts = { running: 0, queued: 0, waiting: 0, finished: 0 };
		for (const { summary } of activity.tasks) {
			const status = summary.status;
			if (status === "running" || status === "queued" || status === "waiting") counts[status]++;
			else counts.finished++;
		}
		if (!oversized) this.write("activity", bytes);
		this.header = { schema: 1, ...this.target, label: this.displayLabel, heartbeat: Date.now(), generation,
			counts, digest: oversized ? null : digest(bytes), unavailable: oversized ? "activity-too-large" : null };
		this.publishHeader();
		this.published = this.pending;
	}
	/** 幂等、非递归的清理，仅限本次激活发布过的文件。
	 * 被替换或被链接的文件刻意留给其所有者处理。 */
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		clearTimeout(this.timer);
		clearInterval(this.heartbeat);
		this.pending = this.published = "";
		for (const [name, identity] of this.owned) {
			try {
				const path = join(rootFor(this.profile), name);
				const stat = fs.lstatSync(path);
				regular(stat);
				if (stat.dev === identity.dev && stat.ino === identity.ino) fs.unlinkSync(path);
			} catch { /* 存储变得不安全时，绝不跟随或移除替换文件。 */ }
		}
		this.owned.clear();
	}
}
