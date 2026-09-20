import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateUnifiedPatch } from "@earendil-works/pi-coding-agent";
import { lstat, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { resolveSessionWorktree, type WorktreeResolver } from "./session-worktree-registry.ts";
import { SessionChanges, readChangeSnapshot, sameSnapshot, textSnapshot, isSessionChangeEvidence,
	SESSION_CHANGE_ENTRY, SESSION_CHANGE_EVENT, SESSION_CHANGE_RELAY, type SessionChangeEvidence, type ChangeSnapshot } from "./session-changes.ts";

interface Pending { sessionId: string; inputPath: string; path: string; root: string; relativePath: string; before: ChangeSnapshot; toolName: string; evidence?: SessionChangeEvidence }
const normalized = (text: string) => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const unknown = (): ChangeSnapshot => ({ kind: "unavailable", reason: "Tool snapshots could not be verified; diff unavailable." });

/** 观察显式的 write/edit 结果，绝不从 Git 状态或 shell 文本推断所有权。 */
export function installSessionChangeCapture(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, resolver: WorktreeResolver = resolveSessionWorktree): void {
	const child = env.JERO_PI_AGENTS_CHILD === "1";
	const pending = new Map<string, Pending>();
	let current: ExtensionContext | undefined;
	let store: SessionChanges | undefined;
	const publish = (evidence: SessionChangeEvidence) => {
		if (!current || !store || current.sessionManager.getSessionId() !== store.sessionId) return;
		if (store.record(evidence)) pi.appendEntry(SESSION_CHANGE_ENTRY, { sessionId: store.sessionId, evidence });
		pi.events.emit(SESSION_CHANGE_EVENT, { sessionId: store.sessionId, notice: store.notice });
	};
	pi.on("session_start", (_event, ctx) => {
		pending.clear(); current = ctx;
		store = new SessionChanges(ctx.sessionManager.getSessionId(), ctx.sessionManager.getEntries());
	});
	const off = pi.events.on(SESSION_CHANGE_RELAY, (value) => {
		const data = value as { sessionId?: string; evidence?: unknown };
		if (child || !current || data?.sessionId !== current.sessionManager.getSessionId() || !isSessionChangeEvidence(data.evidence)) return;
		try {
			const own = resolver(current.cwd, current.cwd);
			const target = resolver(data.evidence.root, current.cwd);
			if (own && target?.root === data.evidence.root && own.commonDir === target.commonDir) publish(data.evidence);
		} catch { /* 观察不能改变工具结果。 */ }
	});
	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		if (!["write", "edit"].includes(event.toolName) || typeof input.path !== "string" || pending.size >= 32) return;
		const sessionId = ctx.sessionManager.getSessionId();
		try {
			let spelling = input.path.replace(/^@/, "").replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
			if (spelling === "~" || spelling.startsWith("~/")) spelling = homedir() + spelling.slice(1);
			const path = resolve(ctx.cwd, spelling);
			try { if ((await lstat(path)).isSymbolicLink()) return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; }
			let ancestor = dirname(path);
			for (let depth = 0; depth < 32; depth++) {
				try { await lstat(ancestor); break; } catch { if (dirname(ancestor) === ancestor) return; ancestor = dirname(ancestor); }
			}
			const canonicalAncestor = await realpath(ancestor);
			const canonicalPath = resolve(canonicalAncestor, relative(ancestor, path));
			const own = resolver(ctx.cwd, ctx.cwd), target = resolver(canonicalAncestor, ctx.cwd);
			if (!own || !target || own.commonDir !== target.commonDir) return;
			const before = await readChangeSnapshot(canonicalPath);
			if (ctx.sessionManager.getSessionId() !== sessionId || current?.sessionManager.getSessionId() !== sessionId) return;
			pending.set(event.toolCallId, { sessionId, inputPath: input.path, path: canonicalPath, root: target.root, relativePath: relative(target.root, canonicalPath), before, toolName: event.toolName });
		} catch { /* 簿记错误不得阻塞编辑。 */ }
	});
	pi.on("tool_result", async (event, ctx) => {
		const item = pending.get(event.toolCallId);
		if (!item || item.sessionId !== ctx.sessionManager.getSessionId() || item.toolName !== event.toolName || event.input.path !== item.inputPath || event.isError !== false) { pending.delete(event.toolCallId); return; }
		try {
			const after = await readChangeSnapshot(item.path);
			let before = item.before;
			let verified = after;
			if (event.toolName === "write" && after.kind === "text" && (typeof event.input.content !== "string" || !sameSnapshot(after, textSnapshot(event.input.content)))) {
				before = unknown(); verified = unknown();
			}
			if (event.toolName === "edit" && before.kind === "text" && after.kind === "text") {
				const patch = (event.details as { patch?: unknown } | undefined)?.patch;
				if (typeof event.input.path !== "string" || patch !== generateUnifiedPatch(event.input.path, normalized(before.text), normalized(after.text))) { before = unknown(); verified = unknown(); }
			}
			if (item.sessionId !== ctx.sessionManager.getSessionId() || pending.get(event.toolCallId) !== item) return;
			item.evidence = { id: event.toolCallId, root: item.root, path: item.relativePath, before, after: verified };
			// 使用既有的 RPC 工具结果封套，而不是新建 IPC 通道或模型消息。
			if (child) return { details: { ...(event.details && typeof event.details === "object" ? event.details : {}), gentleSessionChange: item.evidence } };
		} catch { pending.delete(event.toolCallId); }
	});
	pi.on("tool_execution_end", (event, ctx) => {
		const item = pending.get(event.toolCallId); pending.delete(event.toolCallId);
		if (!child && event.isError === false && item?.evidence && item.sessionId === ctx.sessionManager.getSessionId()) {
			try { publish(item.evidence); } catch { /* 保持工具的原有结果。 */ }
		}
	});
	pi.on("session_shutdown", () => { pending.clear(); current = undefined; store = undefined; off(); });
}
