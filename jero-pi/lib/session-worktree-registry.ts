import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const SESSION_WORKTREE_ENTRY = "jero.session-worktree/v1";
export const SESSION_WORKTREE_CHANGED = "gentle-pi:session-worktree-changed";
export interface WorktreeIdentity { root: string; commonDir: string }
export type WorktreeResolver = (path: string, cwd: string) => WorktreeIdentity | undefined;
interface SessionReader {
	getSessionId(): string;
	getEntries(): readonly { type: string; customType?: string; data?: unknown }[];
}
interface RegistryHost {
	appendEntry(type: string, data: unknown): void;
	events: { emit(name: string, data: unknown): void };
}
interface Registration { sessionId: string; root: string; evidence: string }

// 将其作为完整的子环境传入，而不是叠加在继承的环境变量之上。
export function worktreeGitEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
}

// 匹配 Pi 的普通路径拼写；由 Git 而非参数来确立身份。
export function resolveSessionWorktreeWithGit(path: string, cwd: string, run: typeof execFileSync = execFileSync): WorktreeIdentity | undefined {
	try {
		let spelling = path.replace(/^@/, "").replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
		if (spelling === "~" || spelling.startsWith("~/")) spelling = homedir() + spelling.slice(1);
		const canonical = realpathSync(resolve(cwd, spelling));
		const directory = statSync(canonical).isDirectory() ? canonical : dirname(canonical);
		// 环境性的 Git 路由不得把路径重定向进另一个仓库。
		const env = worktreeGitEnvironment();
		const git = (arg: string) => String(run("git", ["--no-optional-locks", "-C", directory, "rev-parse", "--path-format=absolute", arg], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true, env })).replace(/\r?\n$/, "");
		return { root: realpathSync(git("--show-toplevel")), commonDir: realpathSync(git("--git-common-dir")) };
	} catch {
		return undefined;
	}
}

export const resolveSessionWorktree: WorktreeResolver = resolveSessionWorktreeWithGit;

export function toolWorktreePath(name: string, input: Record<string, unknown>): string | undefined {
	if (!["read", "write", "edit", "grep", "find", "ls"].includes(name)) return undefined;
	if (typeof input.path === "string") return input.path;
	return input.path === undefined && ["grep", "find", "ls"].includes(name) ? "." : undefined;
}

// 没有全局存储：两个扩展都通过各自绑定的 Pi API 追加。读取全部条目
// 也能捕捉到 shell 缺席期间发生的启动。
export class SessionWorktreeRegistry {
	readonly sessionId: string;
	private readonly host: RegistryHost;
	private readonly session: SessionReader;
	private readonly cwd: string;
	private readonly resolver: WorktreeResolver;
	private readonly identity: WorktreeIdentity | undefined;
	private readonly recorded = new Set<string>();
	private active = true;

	constructor(host: RegistryHost, session: SessionReader, cwd: string, resolver: WorktreeResolver = resolveSessionWorktree) {
		this.host = host;
		this.session = session;
		this.cwd = cwd;
		this.resolver = resolver;
		this.sessionId = session.getSessionId();
		this.identity = resolver(cwd, cwd);
	}

	start(): void {
		if (this.identity) this.register(this.identity.root, "session:cwd");
	}

	close(): void { this.active = false; }

	private isCurrent(): boolean {
		try { return this.active && this.sessionId.length > 0 && this.session.getSessionId() === this.sessionId; }
		catch { return false; }
	}

	validate(path: string): string {
		if (!this.isCurrent()) throw new Error("Cannot register a worktree for an inactive session.");
		const target = this.resolver(path, this.cwd);
		if (!target || !this.identity || target.commonDir !== this.identity.commonDir) throw new Error("Select an existing worktree in the same Git clone as this session.");
		return target.root;
	}

	private restore(): void {
		for (const entry of this.session.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== SESSION_WORKTREE_ENTRY || !entry.data || typeof entry.data !== "object") continue;
			const data = entry.data as Partial<Registration>;
			if (data.sessionId === this.sessionId && typeof data.root === "string" && typeof data.evidence === "string") this.recorded.add(data.root);
		}
	}

	register(path: string, evidence: string): string {
		const root = this.validate(path);
		this.restore();
		if (this.recorded.has(root)) return root;
		// appendEntry 是同步的，因此并发的工具完成会在让出之前完成去重。
		// 只有在成功的持久追加之后才做本地标记。
		this.host.appendEntry(SESSION_WORKTREE_ENTRY, { sessionId: this.sessionId, root, evidence } satisfies Registration);
		this.recorded.add(root);
		this.host.events.emit(SESSION_WORKTREE_CHANGED, { sessionId: this.sessionId });
		return root;
	}

	roots(): string[] {
		if (!this.isCurrent()) return [];
		this.restore();
		const roots = new Set<string>();
		for (const recorded of this.recorded) {
			try { roots.add(this.validate(recorded)); }
			catch { /* 缺失/可清理的根目录仍然持久存在，但无法被扫描。 */ }
		}
		return [...roots];
	}
}
