// jero-agents 测试第 2 段（共 3 段；夹具在 jero-agents-shared.ts）。
// 机械平移自原 jero-agents.test.ts，语义零改动。

import { default as assert } from "node:assert/strict";
import {
	appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
	rmSync, writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { pendingReviewMutation, REVIEW_REMINDER_RECEIPT } from "../lib/review-reminder-receipt.ts";
import { SESSION_WORKTREE_CHANGED, SESSION_WORKTREE_ENTRY } from "../lib/session-worktree-registry.ts";
import { after, default as test, mock } from "node:test";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import {
	agentRuntimePaths, agentsCollapseKey, type AgentsDeps, agentsEnabled, agentsStopKey,
	agentsViewKey, answerThroughUi, completionText, default as gentleAgents,
	legacySubagentsInstalled
} from "../extensions/jero-agents.ts";
import { historyDir, loadHistory, saveTask } from "../lib/agents-history.ts";
import { STALE_COMPLETION_MS } from "../lib/agents-completion-delivery.ts";
import { applyTaskEvent, emptyThread, TASK_EVENT, TASK_STATUS, type TaskRecord, TaskStore } from "../lib/agents-protocol.ts";
import { NativePointerScope } from "../lib/native-pointer-region.ts";
import { listPresence, PresenceCursor, PresencePublisher, readActivity } from "../lib/orchestrator-presence.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { fakeChild, type FakeChild } from "./agents-fake-child.ts";
import { AgentRunner } from "../lib/agents-runner.ts";
import { type NativeReviewCli } from "../lib/authority/client-contract.ts";
import { CHILD_METRICS_EVENT } from "../lib/runtime-metrics-children.ts";
import { renderSddPreflightPrompt } from "../lib/sdd-preflight.ts";
import {
	cwd, deps, fakeContext, fakePi, fakeTui, type Handler, home, mouse, nonGitCwd, type Overlay,
	PARENT_CONFIRMED_SDD_CONTEXT, plainTheme, type Registered, root
} from "./jero-agents-shared.ts";
import { shutdownAndRestoreNativeSpawn, tick } from "./jero-agents-shared.ts";

test("default Node spawn adapter distinguishes IPC-only and permission-capable canonical Git children", async () => {
	const childProcess = createRequire(import.meta.url)("node:child_process") as typeof import("node:child_process");
	const originalSpawn = childProcess.spawn;
	type CapturedSpawnOptions = { cwd: string; env: NodeJS.ProcessEnv; shell?: boolean; windowsHide?: boolean; detached?: boolean; stdio?: string[] };
	const captured: Array<{ command: string; args: readonly string[]; options: CapturedSpawnOptions }> = [];
	const children: FakeChild[] = [];
	const shutdown: Array<() => Promise<void>> = [];
	const canonicalGitCwd = join(root, "canonical-git-project");
	const gitBin = join(root, "canonical-git-bin");
	// Windows 的 CreateProcess 不解析无扩展名的 shebang 假 git；改用真实
	// git init 初始化探针目录——语义等价：rev-parse --git-common-dir 输出
	// ".git"，非 git 目录（nonGitCwd 位于 tmpdir，不在任何仓库内）探测
	// 自然失败。POSIX 保留 PATH 劫持的确定性假探针。
	const windowsRealGit = process.platform === "win32";
	if (windowsRealGit) {
		mkdirSync(canonicalGitCwd, { recursive: true });
		createRequire(import.meta.url)("node:child_process").execFileSync("git", ["init", canonicalGitCwd], { stdio: "ignore" });
	} else {
		mkdirSync(join(canonicalGitCwd, ".git"), { recursive: true });
		mkdirSync(gitBin, { recursive: true });
		const gitFixture = join(gitBin, "git");
		writeFileSync(gitFixture, `#!/bin/sh\nif [ "$1" = "-C" ] && [ "$2" = "${canonicalGitCwd}" ] && [ "$3" = "rev-parse" ] && [ "$4" = "--git-common-dir" ]; then\n  printf '.git\\n'\n  exit 0\nfi\nexit 1\n`);
		chmodSync(gitFixture, 0o755);
	}
	const withCanonicalGitFixture = <T>(action: () => T): T => {
		if (windowsRealGit) return action();
		const previousPath = process.env.PATH;
		process.env.PATH = gitBin;
		try {
			return action();
		} finally {
			if (previousPath === undefined) delete process.env.PATH;
			else process.env.PATH = previousPath;
		}
	};
	childProcess.spawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
		captured.push({ command, args, options: options as unknown as CapturedSpawnOptions });
		const child = fakeChild();
		children.push(child);
		return child.child;
	}) as unknown as typeof childProcess.spawn;
	syncBuiltinESMExports();
	try {
		const launch = async (mode: "task" | "background", env: NodeJS.ProcessEnv, sessionCwd = nonGitCwd) => {
			const h = fakePi();
			gentleAgents(h.pi, env, { home, agentHome: join(home, ".pi", "agent"), env, pi: { command: "/fixture/pi", args: ["--host-flag"] }, resolveWorktree: () => undefined });
			const { ctx } = fakeContext();
			(ctx.sessionManager as unknown as { getCwd(): string }).getCwd = () => sessionCwd;
			await h.fire("session_start", ctx);
			shutdown.push(() => h.fire("session_shutdown", ctx));
			return { h, ctx, result: withCanonicalGitFixture(() => h.tools.get("subagent_run")!.execute(`spawn-${mode}`, { agent: "explore", task: `Capture ${mode}`, mode }, undefined, undefined, ctx)) };
		};
		const task = await launch("task", { PATH: "/bin", FIXTURE: "task" });
		await tick();
		children[0]!.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "task complete" }] }] });
		children[0]!.emit({ type: "agent_settled" });
		await task.result;
		const background = await launch("background", { PATH: "/bin", FIXTURE: "background" });
		await background.result;
		await tick();
		const permission = await launch("task", { PATH: "/bin", FIXTURE: "permission" }, canonicalGitCwd);
		await tick();
		children[2]!.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "permission complete" }] }] });
		children[2]!.emit({ type: "agent_settled" });
		await permission.result;

		const args = ["--host-flag", "--mode", "rpc", "--session-dir", join(home, ".pi", "agent", "gentle-agents", "sessions"), "--model", "openai-codex/gpt-5.6-terra:low", "--tools", "read,grep,subagent_parent_message", "--append-system-prompt", "You map things."];
		assert.equal(captured.length, 3, "the extension reaches Node's spawn boundary for IPC-only and permission-channel launches");
		for (const [index, fixture] of ["task", "background", "permission"].entries()) {
			const permissionChannel = index === 2;
			const ownedIpc = captured[index]?.options.env.JERO_PI_AGENTS_OWNED_IPC;
			assert.match(ownedIpc ?? "", /^\d+-[a-z0-9]+$/, "the child receives an opaque owned-IPC marker");
			assert.equal(captured[index]?.command, "/fixture/pi");
			assert.deepEqual(captured[index]?.args, args);
			assert.equal(captured[index]?.options.cwd, permissionChannel ? canonicalGitCwd : nonGitCwd);
			assert.deepEqual(captured[index]?.options.env, { PATH: "/bin", FIXTURE: fixture, JERO_PI_AGENTS_CHILD: "1", JERO_PI_AGENTS_OWNED_IPC: ownedIpc, ...(permissionChannel ? { JERO_PI_AGENTS_PARENT_PERMISSION_FD: "3" } : {}) });
			assert.equal(captured[index]?.options.shell, undefined, "the adapter does not invoke a shell");
			assert.equal(captured[index]?.options.windowsHide, true, "the adapter always hides a Windows console");
			assert.equal(captured[index]?.options.detached, process.platform !== "win32", "the adapter forwards the runner's platform selection");
			assert.deepEqual(captured[index]?.options.stdio, permissionChannel ? ["pipe", "pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe", "ipc"], permissionChannel ? "canonical repository children retain an fd3 permission channel and receive messaging IPC at fd4" : "IPC-only children have no inherited permission fd");
		}
		await Promise.all(shutdown.map((close) => close()));
		assert.deepEqual(children[1]?.killed, ["SIGTERM"], "session shutdown cleans up an active background child");
		shutdown.length = 0;
	} finally {
		await shutdownAndRestoreNativeSpawn(childProcess, originalSpawn, () => Promise.all(shutdown.map((close) => close())));
	}
});

test("native spawn interception restores CommonJS and ESM exports after rejected shutdown and assertion failure", async () => {
	const childProcess = createRequire(import.meta.url)("node:child_process") as typeof import("node:child_process");
	const originalSpawn = childProcess.spawn;
	const assertRestored = async () => {
		assert.equal(childProcess.spawn, originalSpawn, "CommonJS spawn is restored");
		assert.equal((await import("node:child_process")).spawn, originalSpawn, "ESM spawn is restored");
	};
	const installMock = () => {
		childProcess.spawn = (() => fakeChild().child) as unknown as typeof childProcess.spawn;
		syncBuiltinESMExports();
	};
	const start = async (rejectShutdown: boolean) => {
		const h = fakePi();
		const fire = h.fire;
		if (rejectShutdown) {
			h.fire = async (event, ctx, payload) => {
				await fire(event, ctx, payload);
				if (event === "session_shutdown") throw new Error("forced shutdown rejection");
				return undefined;
			};
		}
		gentleAgents(h.pi, {}, { home, agentHome: join(home, ".pi", "agent"), env: { PATH: "/bin" }, pi: { command: "/fixture/pi", args: [] }, resolveWorktree: () => undefined });
		const { ctx } = fakeContext();
		await h.fire("session_start", ctx);
		await h.tools.get("subagent_run")!.execute("cleanup", { agent: "explore", task: "Keep cleanup live", mode: "background" }, undefined, undefined, ctx);
		await tick();
		return { h, ctx };
	};

	let mocked = false;
	installMock();
	mocked = true;
	try {
		const rejected = await start(true);
		await assert.rejects(shutdownAndRestoreNativeSpawn(childProcess, originalSpawn, () => rejected.h.fire("session_shutdown", rejected.ctx)), /forced shutdown rejection/);
		mocked = false;
		await assertRestored();
	} finally {
		if (mocked) {
			childProcess.spawn = originalSpawn;
			syncBuiltinESMExports();
		}
	}

	installMock();
	mocked = true;
	try {
		const asserted = await start(false);
		await assert.rejects(async () => {
			try {
				assert.fail("forced assertion failure");
			} finally {
				await shutdownAndRestoreNativeSpawn(childProcess, originalSpawn, () => asserted.h.fire("session_shutdown", asserted.ctx));
			}
		}, /forced assertion failure/);
		mocked = false;
		await assertRestored();
	} finally {
		if (mocked) {
			childProcess.spawn = originalSpawn;
			syncBuiltinESMExports();
		}
	}
});

test("explicit child roots launch and continue in the actual cwd, persist without shell, and reject other clones", async () => {
	const h = fakePi();
	const runtime = deps();
	const childRoot = join(root, "child-worktree");
	const launched: string[] = [];
	const spawnEvents: Array<() => void> = [];
	const baseSpawn = runtime.deps.spawn!;
	runtime.deps.spawn = (command, args, options) => {
		launched.push(options.cwd);
		const child = baseSpawn(command, args, options);
		const on = child.on.bind(child);
		child.on = ((event: string, listener: () => void) => {
			if (event === "spawn") spawnEvents.push(listener);
			else on(event as "exit", listener);
			return child;
		}) as typeof child.on;
		return child;
	};
	runtime.deps.resolveWorktree = (path, base) => ({ root: resolve(base, path), commonDir: path === "/other-clone" ? "/other/git" : "/fixture/common" });
	gentleAgents(h.pi, {}, runtime.deps);
	const { ctx } = fakeContext();
	(ctx.sessionManager as unknown as { getEntries(): unknown[] }).getEntries = () => h.entries;
	await h.fire("session_start", ctx);
	const run = h.tools.get("subagent_run")!;
	await assert.rejects(run.execute("bad", { agent: "explore", task: "Map", workspace_root: "/other-clone", mode: "background" }, undefined, undefined, ctx), /same Git clone/);
	assert.deepEqual(launched, []);
	const result = await run.execute("one", { agent: "explore", task: "Map /other-clone mentioned in prose", workspace_root: childRoot, mode: "background" }, undefined, undefined, ctx);
	await tick();
	assert.deepEqual(launched, [childRoot]);
	assert.deepEqual(h.entries, [], "queueing and returning a child handle do not register roots");
	spawnEvents[0]();
	assert.deepEqual(h.entries, [{ type: "custom", customType: SESSION_WORKTREE_ENTRY, data: { sessionId: "s1", root: childRoot, evidence: "subagent:spawn" } }]);
	assert.deepEqual(h.events.filter(event => event.name === SESSION_WORKTREE_CHANGED), [{ name: SESSION_WORKTREE_CHANGED, data: { sessionId: "s1" } }]);
	const details = result.details.gentleAgents as { taskId: string; cwd: string };
	assert.equal(details.cwd, childRoot);
	runtime.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "mapped" }] }] });
	runtime.children[0].emit({ type: "agent_settled" });
	await tick();
	await h.tools.get("subagent_continue")!.execute("continue", { task_id: details.taskId, prompt: "Follow up", mode: "background" }, undefined, undefined, ctx);
	await tick();
	assert.deepEqual(launched, [childRoot, childRoot]);
	spawnEvents[1]();
	assert.equal(h.entries.length, 1, "continuation dedupes the original root");
	const status = await h.tools.get("subagent_status")!.execute("status", { task_id: details.taskId }, undefined, undefined, ctx);
	assert.match(status.content[0].text, /cwd:/);
	await h.fire("session_shutdown", ctx);
	spawnEvents[1]();
	assert.equal(h.entries.length, 1, "late process events after shutdown cannot write session state");
	await tick();
});

test("SDD phase continuation requires a fresh selection and launches only that selection", async () => {
	const h = fakePi();
	const runtime = deps();
	const fixtureHome = join(root, "sdd-selection-home");
	mkdirSync(join(fixtureHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(fixtureHome, ".pi", "agent", "agents", "sdd-apply.md"), "---\ndescription: apply\ntools: [read]\n---\nSDD apply executor");
	gentleAgents(h.pi, {}, { ...runtime.deps, home: fixtureHome });
	const { ctx } = fakeContext();
	await h.fire("session_start", ctx);
	const run = await h.tools.get("subagent_run")!.execute("run", {
		agent: "sdd-apply", task: "Apply alpha", context: PARENT_CONFIRMED_SDD_CONTEXT, mode: "background",
		sdd_change: { changeName: "alpha", workspaceRoot: cwd, phase: "apply" },
	}, undefined, undefined, ctx);
	await tick();
	const taskId = (run.details.gentleAgents as { taskId: string }).taskId;
	const first = runtime.spawned[0]!;
	assert.deepEqual(JSON.parse(first[first.indexOf("--jero-sdd-change") + 1]!), { changeName: "alpha", workspaceRoot: cwd, phase: "apply" });
	runtime.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] });
	runtime.children[0].emit({ type: "agent_settled" });
	await tick();
	const missing = await h.tools.get("subagent_continue")!.execute("missing", { task_id: taskId, prompt: "Continue", mode: "background" }, undefined, undefined, ctx);
	assert.match(missing.content[0].text, /requires a fresh sdd_change/i);
	assert.equal(runtime.spawned.length, 1);
	await h.tools.get("subagent_continue")!.execute("continue", {
		task_id: taskId, prompt: "Apply beta", context: PARENT_CONFIRMED_SDD_CONTEXT, mode: "background",
		sdd_change: { changeName: "beta", workspaceRoot: cwd, phase: "apply" },
	}, undefined, undefined, ctx);
	await tick();
	const second = runtime.spawned[1]!;
	assert.deepEqual(JSON.parse(second[second.indexOf("--jero-sdd-change") + 1]!), { changeName: "beta", workspaceRoot: cwd, phase: "apply" });
	await h.fire("session_shutdown", ctx);
});

test("ordinary non-Git tasks still continue in their original cwd without registering a worktree", async () => {
	const h = fakePi();
	const runtime = deps();
	runtime.deps.resolveWorktree = () => undefined;
	gentleAgents(h.pi, {}, runtime.deps);
	const { ctx } = fakeContext();
	await h.fire("session_start", ctx);
	const result = await h.tools.get("subagent_run")!.execute("run", { agent: "explore", task: "Map", mode: "background" }, undefined, undefined, ctx);
	await tick();
	runtime.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "mapped" }] }] });
	runtime.children[0].emit({ type: "agent_settled" });
	await tick();
	const taskId = (result.details.gentleAgents as { taskId: string }).taskId;
	await h.tools.get("subagent_continue")!.execute("continue", { task_id: taskId, prompt: "Follow up", mode: "background" }, undefined, undefined, ctx);
	await tick();
	assert.equal(runtime.children.length, 2);
	assert.deepEqual(h.entries, []);
	await h.fire("session_shutdown", ctx);
	await tick();
});

test("delayed child spawn retains the originating session and cannot append into its replacement", async () => {
	const h = fakePi();
	const runtime = deps();
	const spawnEvents: Array<() => void> = [];
	const baseSpawn = runtime.deps.spawn!;
	runtime.deps.spawn = (command, args, options) => {
		const child = baseSpawn(command, args, options);
		const on = child.on.bind(child);
		child.on = ((event: string, listener: () => void) => {
			if (event === "spawn") spawnEvents.push(listener);
			else on(event as "exit", listener);
			return child;
		}) as typeof child.on;
		return child;
	};
	gentleAgents(h.pi, {}, runtime.deps);
	const { ctx } = fakeContext();
	await h.fire("session_start", ctx);
	await h.tools.get("subagent_run")!.execute("run", { agent: "explore", task: "Map", workspace_root: join(root, "old-root"), mode: "background" }, undefined, undefined, ctx);
	await tick();
	const next = fakeContext();
	(next.ctx.sessionManager as unknown as { getSessionId(): string }).getSessionId = () => "s2";
	await h.fire("session_start", next.ctx);
	spawnEvents[0]();
	await tick();
	assert.deepEqual(h.entries, [], "captured registry is closed instead of appending to the new bound API");
	await h.fire("session_shutdown", next.ctx);
});

test("agentRuntimePaths isolates sessions and transcripts by profile and retains the explicit-home fallback", () => {
	assert.deepEqual(agentRuntimePaths("/home/x", "/profiles/pi-principal/agent"), {
		sessions: join("/profiles/pi-principal/agent", "gentle-agents", "sessions"),
		transcripts: join("/profiles/pi-principal/agent", "gentle-agents", "transcripts"),
	});
	assert.deepEqual(agentRuntimePaths("/home/x", "/profiles/pi-lab/agent"), {
		sessions: join("/profiles/pi-lab/agent", "gentle-agents", "sessions"),
		transcripts: join("/profiles/pi-lab/agent", "gentle-agents", "transcripts"),
	});
	assert.deepEqual(agentRuntimePaths("/home/x"), {
		sessions: join("/home/x", ".pi", "agent", "gentle-agents", "sessions"),
		transcripts: join("/home/x", ".pi", "agent", "gentle-agents", "transcripts"),
	});
});

test("extension resolves each profile environment at setup time without changing HOME", async () => {
	const principalHome = join(root, "pi-principal", "agent");
	const labHome = join(root, "pi-lab", "agent");
	for (const [agentHome, name] of [[principalHome, "principal"], [labHome, "lab"]] as const) {
		mkdirSync(join(agentHome, "agents"), { recursive: true });
		writeFileSync(join(agentHome, "agents", `${name}.md`), `---\ndescription: ${name}\n---\n${name}`);
	}
	const withoutExplicitHome = () => {
		const harness = deps();
		const { home: _home, env: _env, ...overrides } = harness.deps;
		return overrides;
	};
	const principal = fakePi();
	gentleAgents(principal.pi, { JERO_PI_AGENT_HOME: principalHome, PI_CODING_AGENT_DIR: labHome }, withoutExplicitHome());
	const principalContext = fakeContext();
	await principal.fire("session_start", principalContext.ctx);
	assert.match((await principal.tools.get("subagent_list_agents")!.execute("p1", {}, undefined, undefined, principalContext.ctx)).content[0].text, /principal/);
	const lab = fakePi();
	gentleAgents(lab.pi, { PI_CODING_AGENT_DIR: labHome }, withoutExplicitHome());
	const labContext = fakeContext();
	await lab.fire("session_start", labContext.ctx);
	assert.match((await lab.tools.get("subagent_list_agents")!.execute("l1", {}, undefined, undefined, labContext.ctx)).content[0].text, /lab/);
});

for (const [key, tilde] of [["JERO_PI_AGENT_HOME", false], ["PI_CODING_AGENT_DIR", false], ["JERO_PI_AGENT_HOME", true], ["PI_CODING_AGENT_DIR", true]] as const) {
	test(`${key} ${tilde ? "tilde" : "relative"} profile shares an absolute parent and child session root`, async () => {
		const agentHome = join(root, `${key}-${tilde}`, "agent");
		mkdirSync(join(agentHome, "agents"), { recursive: true });
		writeFileSync(join(agentHome, "agents", "relative.md"), "---\ndescription: relative profile\n---\nMap things.");
		writeFileSync(join(agentHome, "subagents.json"), JSON.stringify({ default_model: "openai/profile-model" }));
		const env = { [key]: tilde ? `~/${relative(homedir(), agentHome)}` : relative(process.cwd(), agentHome) };
		const harness = deps();
		const { home: _home, env: _env, ...overrides } = harness.deps;
		const { pi, tools, fire } = fakePi();
		gentleAgents(pi, env, overrides);
		const { ctx } = fakeContext();
		assert.notEqual(ctx.sessionManager.getCwd(), process.cwd());
		await fire("session_start", ctx);
		await tools.get("subagent_run")!.execute("relative", { agent: "relative", task: "Map", mode: "background" }, undefined, undefined, ctx);
		await tick();
		try {
			const args = harness.spawned[0];
			const sessionDir = args[args.indexOf("--session-dir") + 1];
			const expected = join(agentHome, "gentle-agents", "sessions");
			assert.equal(sessionDir, expected);
			assert.equal(resolve(ctx.sessionManager.getCwd(), sessionDir), expected);
			assert.equal(existsSync(expected), true, "parent created the exact child session root");
			assert.match(args[args.indexOf("--model") + 1], /profile-model/);
		} finally {
			await fire("session_shutdown", ctx);
			await tick();
		}
	});
}

test("agentsEnabled and agentsCollapseKey read their flags and stay off inside a child", () => {
	assert.equal(agentsEnabled({}), true);
	assert.equal(agentsEnabled({ JERO_PI_AGENTS: "off" }), false);
	assert.equal(agentsEnabled({ JERO_PI_AGENTS_CHILD: "1" }), false);
	assert.equal(agentsCollapseKey({}), "ctrl+shift+a");
	assert.equal(agentsCollapseKey({ JERO_PI_AGENTS_KEY: "off" }), undefined);
	assert.equal(agentsViewKey({}), "alt+a");
	assert.equal(agentsViewKey({ JERO_PI_AGENTS_VIEW_KEY: "off" }), undefined);
	assert.equal(agentsStopKey({}), "alt+s");
	assert.equal(agentsStopKey({ JERO_PI_AGENTS_STOP_KEY: "" }), undefined);
	assert.equal(agentsStopKey({ JERO_PI_AGENTS_STOP_KEY: "off" }), undefined);
	const off = fakePi();
	gentleAgents(off.pi, { JERO_PI_AGENTS: "0" });
	assert.equal(off.tools.size, 0);
});

test("while pi-subagents-j0k3r is still installed the tools stay unregistered and the user is told how to switch", async () => {
	const legacyHome = join(root, "legacy-home");
	mkdirSync(join(legacyHome, ".pi", "agent"), { recursive: true });
	writeFileSync(join(legacyHome, ".pi", "agent", "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents-j0k3r", "../../work/gentle-pi"] }));
	assert.equal(legacySubagentsInstalled(legacyHome), true);
	assert.equal(legacySubagentsInstalled(home), false);
	assert.equal(legacySubagentsInstalled(join(root, "missing")), false);
	const { pi, tools, fire } = fakePi();
	gentleAgents(pi, {}, { ...deps().deps, home: legacyHome });
	assert.equal(tools.size, 0);
	const notices: string[] = [];
	const ctx = { hasUI: true, ui: { notify: (message: string, level: string) => notices.push(`${level}:${message}`) } } as unknown as ExtensionContext;
	await fire("session_start", ctx);
	assert.match(notices[0] ?? "", /^warning:❀ Gentle Agents is waiting: remove the old package first with "pi remove npm:pi-subagents-j0k3r"/);
});

test("subagent_list_agents and subagent_run in task mode launch a child with the resolved profile and return its answer", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, widget } = fakeContext();
	await fire("session_start", ctx);
	assert.deepEqual([...tools.keys()].sort(), ["subagent_cancel", "subagent_continue", "subagent_list_agents", "subagent_list_tasks", "subagent_reconcile", "subagent_reply", "subagent_result", "subagent_run", "subagent_send_message", "subagent_status"]);
	const listed = await tools.get("subagent_list_agents")!.execute("c0", {}, undefined, undefined, ctx);
	assert.match(listed.content[0].text, /- explore \(global\): maps things/);

	const running = tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Map lib/ and report every module.", label: "map lib modules", context: "Focus on agents-*.ts" }, undefined, undefined, ctx);
	await tick();
	const [args] = harness.spawned;
	assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-5.6-terra:low", "the profile effort overrides the definition");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,subagent_parent_message");
	await tick();
	assert.match(String(harness.children[0].written[1].message), /Map lib\/ and report every module\.\n\n## Context\nFocus on agents-\*\.ts/);
	assert.match(widget()![0], /^╭─ ❀ Agents · 1 active ─+╮$/);
	assert.match(widget()![1], /^│ ◐  explore  map lib modules +gpt-5\.6-terra · low · \d+s │$/);
	harness.children[0].emit({ type: "tool_execution_start", toolCallId: "c", toolName: "grep", args: {} });
	harness.children[0].emit({ type: "message_end", message: { role: "assistant", usage: { totalTokens: 12_000, cost: { total: 0.09 } } } });
	await tick();
	assert.match(widget()![1], /◐  explore  map lib modules +gpt-5\.6-terra · low · 12k · \$0\.09 · \d+s │$/);
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "lib has three agent files." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	const result = await running;
	assert.equal(result.content[0].text, "lib has three agent files.");
	assert.equal((result.details.gentleAgents as { status: string }).status, "completed");
	assert.match(widget()![1], /✓  explore  map lib modules/);
	const orphan = tools.get("subagent_run")!.execute("c9", { agent: "explore", task: "Orphan", mode: "background" }, undefined, undefined, ctx);
	await orphan;
	await tick();
	await fire("session_shutdown", ctx);
	await tick();
	assert.deepEqual(harness.children[1].killed, ["SIGTERM"], "closing pi stops the running children");
	assert.match(tools.get("subagent_run")!.renderCall({ agent: "explore" }, plainTheme).render(60).join(""), /❀ agent run · explore/);
});

test("background runs return at once; status, result, send_message, cancel, and continue follow the task", async () => {
	const { pi, tools, fire, sent, renderers } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Long job", mode: "background" }, undefined, undefined, ctx);
	const id = (started.details.gentleAgents as { taskId: string }).taskId;
	assert.match(started.content[0].text, new RegExp(`background as task ${id}`));
	await tick();
	assert.match((await tools.get("subagent_status")!.execute("c2", { task_id: id }, undefined, undefined, ctx)).content[0].text, /running · background/);
	assert.match((await tools.get("subagent_result")!.execute("c3", { task_id: id }, undefined, undefined, ctx)).content[0].text, /still running/);
	assert.match((await tools.get("subagent_send_message")!.execute("c4", { task_id: id, message: "Skip tests" }, undefined, undefined, ctx)).content[0].text, /queued/);
	await tick();
	assert.equal(harness.children[0].written.at(-1)?.message, "Skip tests");
	assert.match((await tools.get("subagent_continue")!.execute("c5", { task_id: id, prompt: "more" }, undefined, undefined, ctx)).content[0].text, /cannot be continued yet/);
	assert.match((await tools.get("subagent_list_tasks")!.execute("c6", {}, undefined, undefined, ctx)).content[0].text, new RegExp(`^${id} · explore · running`));
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "All done." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal((await tools.get("subagent_result")!.execute("c7", { task_id: id }, undefined, undefined, ctx)).content[0].text, "All done.");
	assert.equal(sent.length, 1, "a background result is delivered to the model once");
	assert.equal(sent[0].message.customType, "gentle-agents.result");
	assert.equal(sent[0].message.display, true, "completion cards remain visible");
	// The completion path must never regress to "followUp": the host drains the
	// follow-up queue only when the parent run stops calling tools, which is the
	// hour-long #867 delay. "steer" keeps the idle wake-up (triggerTurn) while
	// bounding an active parent's wait to the current turn.
	assert.deepEqual(sent[0].options, { deliverAs: "steer", triggerTurn: true });
	assert.match(String(sent[0].message.content), new RegExp(`^Subagent explore \\(task ${id}, "Long job"\\) finished\\.\n\nAll done\\.$`));
	const card = renderers.get("gentle-agents.result")!(sent[0].message, { expanded: true }, plainTheme).render(70).map(stripAnsi);
	assert.match(card[0], /^╭─ ❀ Agent result · explore ─+ collapse ╮$/);
	assert.match(card[1], /Subagent explore/);
	assert.match(card[card.length - 2], /All done\./);
	const resumed = tools.get("subagent_continue")!.execute("c8", { task_id: id, prompt: "Now summarize", mode: "task" }, undefined, undefined, ctx);
	await tick();
	const args = harness.spawned[1];
	assert.equal(args[args.indexOf("--session") + 1], "/sessions/child.jsonl");
	await tick();
	harness.children[1].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Summary." }] }] });
	harness.children[1].emit({ type: "agent_settled" });
	assert.equal((await resumed).content[0].text, "Summary.");
	assert.match((await tools.get("subagent_cancel")!.execute("c9", { task_id: id }, undefined, undefined, ctx)).content[0].text, /not running/);
	assert.match((await tools.get("subagent_status")!.execute("c10", { task_id: "nope" }, undefined, undefined, ctx)).content[0].text, /Error: no task nope/);
	assert.match((await tools.get("subagent_run")!.execute("c11", { agent: "ghost", task: "x" }, undefined, undefined, ctx)).content[0].text, /no subagent named "ghost"\. Known: explore/);
});

test("once the last task is done the card asks for one frame when its finished row expires, so an idle terminal clears it", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	let clock = 1000;
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	harness.deps.now = () => clock;
	harness.deps.schedule = (fn, ms) => {
		const timer = { fn, ms, cancelled: false };
		timers.push(timer);
		return () => {
			timer.cancelled = true;
		};
	};
	gentleAgents(pi, {}, harness.deps);
	let frames = 0;
	const { ctx, widget } = fakeContext({ requestRender: () => (frames += 1) });
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Short job", mode: "background" }, undefined, undefined, ctx);
	await tick();
	widget();
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.match(widget()![1], /✓  explore  Short job/);
	const expiry = timers.filter((timer) => !timer.cancelled && timer.ms === 60_000);
	assert.equal(expiry.length, 1, "exactly one timer waits for the finished row to leave the card");
	clock += 60_000;
	const before = frames;
	expiry[0].fn();
	assert.equal(frames, before + 1, "the expiry asks the terminal for a frame");
	assert.deepEqual(widget(), [], "the card is gone");
	assert.equal(timers.filter((timer) => !timer.cancelled && timer.ms === 60_000).length, 0, "nothing is rescheduled once the card is empty");
});

test("completionText names the outcome before the answer", () => {
	const base = { id: "t1", agent: "explore", mode: "background", prompt: "p", label: "map lib", cwd: "/r", parentSessionId: "s", status: "failed" as const, createdAt: 1, startedAt: 1, endedAt: 2, model: "m", thinking: undefined, sessionPath: null, error: "pi exited with code 1", result: null, lastStep: "x", lastActivityAt: 2, turns: 0, toolCalls: 0, tokens: 0, cost: 0 };
	assert.equal(completionText(base), 'Subagent explore (task t1, "map lib") failed.\n\nSubagent explore failed: pi exited with code 1');
	assert.equal(completionText({ ...base, status: "timed_out", error: "stalled for 4 min" }), 'Subagent explore (task t1, "map lib") timed out.\n\nSubagent explore timed_out: stalled for 4 min');
});

test("a task-mode child's dialog reaches the host UI and the answer goes back to the child", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, widget } = fakeContext();
	await fire("session_start", ctx);
	const running = tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Ask me" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].emit({ type: "extension_ui_request", id: "u1", method: "select", title: "Which file?", options: ["a.ts", "b.ts"] });
	await tick();
	await tick();
	assert.deepEqual(dialogs, ["select:❀ Which file?:a.ts|b.ts"]);
	assert.deepEqual(harness.children[0].written.at(-1), { type: "extension_ui_response", id: "u1", value: "a.ts" });
	assert.match(widget()![1], /◐  explore  Ask me/);
	harness.children[0].emit({ type: "agent_end", messages: [] });
	harness.children[0].emit({ type: "agent_settled" });
	await running;
	assert.deepEqual(await answerThroughUi(ctx.ui, { id: "u2", method: "confirm", title: "Sure?" }, { message: "really" }), { confirmed: true });
	assert.deepEqual(await answerThroughUi(ctx.ui, { id: "u3", method: "input", title: "Name" }, {}), { cancelled: true });
	assert.deepEqual(await answerThroughUi(ctx.ui, { id: "u4", method: "editor", title: "Edit" }, {}), { value: "edited" });
	assert.deepEqual(await answerThroughUi(undefined, { id: "u5", method: "select", title: "x" }, {}), { cancelled: true });
});

test("AgentsView production composition observes each pointer event once and accepts only left clicks", async () => {
	const { pi, tools, fire, commands } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, overlays, customCompletions } = fakeContext();
	await fire("session_start", ctx);

	await tools.get("subagent_run")!.execute("b", { agent: "explore", task: "b", mode: "background" }, undefined, undefined, ctx);
	await tick();
	await tools.get("subagent_run")!.execute("a", { agent: "explore", task: "a", mode: "background" }, undefined, undefined, ctx);
	await tick();

	const originalCreateMouseObserver = NativePointerScope.prototype.createMouseObserver;
	let beforeCalls = 0;
	let afterCalls = 0;
	const spy = mock.method(NativePointerScope.prototype, "createMouseObserver", function (
		this: NativePointerScope,
		requestRender?: () => void,
	) {
		const observer = originalCreateMouseObserver.call(this, requestRender);
		return {
			beforeMouse(event: TuiMouseEvent) {
				beforeCalls += 1;
				observer.beforeMouse(event);
			},
			afterMouse(event: TuiMouseEvent) {
				afterCalls += 1;
				observer.afterMouse(event);
			},
		};
	});
	try {
		const opened = commands.get("jero:agents")!.handler("", ctx);
		for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
		const overlay = overlays[0];
		assert.ok(overlay, "the production extension mounted its fullscreen interaction");
		overlay.handleInput("a"); // Directory headings remain non-actionable; Current has no wrapper.
		const lines = overlay.render(80);
		const dispatch = (event: TuiMouseEvent) => {
			const before = beforeCalls;
			const after = afterCalls;
			const result = overlay.handleMouse?.(event);
			assert.deepEqual([beforeCalls - before, afterCalls - after], [1, 1], "the root owns one observer lifecycle per event");
			return result;
		};

		assert.match(stripAnsi(overlay.render(80)[1] ?? ""), /Current orchestrator/, "the parent heading is the first visible row");
		assert.doesNotMatch(stripAnsi(overlay.render(80)[1] ?? ""), /▸/, "the heading is not a selected task");
		assert.match(stripAnsi(overlay.render(80)[2] ?? ""), /▸ └ .*Subagent/, "the first child starts selected beneath its heading");
		overlay.handleInput("k");
		overlay.handleInput("s");
		overlay.handleInput("o");
		assert.deepEqual(harness.children.map((child) => child.killed), [[], []], "heading actions never stop a child");
		assert.deepEqual(customCompletions, [], "heading actions never open a child session");
		overlay.handleInput("j");
		assert.equal(dispatch(mouse("click", "right", 4, 3, 80, lines.length)), undefined, "right click is inert");
		assert.match(stripAnsi(overlay.render(80)[2] ?? ""), /▸ └ .*Subagent/, "right click cannot select another child");
		assert.equal(dispatch(mouse("press", "left", 4, 3, 80, lines.length)), undefined, "press is inert");
		assert.equal(dispatch(mouse("click", "middle", 4, 3, 80, lines.length)), undefined, "middle click is inert");
		const leftClick = dispatch(mouse("click", "left", 4, 3, 80, lines.length));
		assert.equal((leftClick as { handled?: boolean } | undefined)?.handled, true, "left click selects a child task");
		assert.match(stripAnsi(overlay.render(80)[3] ?? ""), /▸ └ .*Subagent/, "left click selects the second child");
		overlay.handleInput("\x1b");
		await opened;
	} finally {
		spy.mock.restore();
	}
});

test("AgentsView production footer uses rendered bounds and invalidates them before the next frame", async () => {
	writeFileSync(join(home, ".pi", "agent", "agents", "寿司.md"), "---\ndescription: unicode footer target\nmodel: openai-codex/gpt-5.6-terra\n---\nFooter target.");
	const { pi, tools, fire, commands } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, overlays, customCompletions } = fakeContext();
	(ctx as unknown as { sessionManager: { getSessionId(): string; getCwd(): string } }).sessionManager = { getSessionId: () => "footer-session", getCwd: () => cwd };
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "寿司", task: "Footer target", mode: "background" }, undefined, undefined, ctx);
	await tick();

	let store: TaskStore | undefined;
	const subscribeSummary = TaskStore.prototype.subscribeSummary;
	const captureStore = mock.method(TaskStore.prototype, "subscribeSummary", function (this: TaskStore, ...args: Parameters<TaskStore["subscribeSummary"]>) {
		store ??= this;
		return subscribeSummary.apply(this, args);
	});
	try {
		const opened = commands.get("jero:agents")!.handler("", ctx);
		for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
		const overlay = overlays[0];
		assert.ok(overlay, "the production extension mounted its fullscreen interaction");
		assert.ok(store, "the overlay subscribed to the production task store");
		const selected = store.list().find((entry) => entry.parentSessionId === "footer-session");
		assert.ok(selected?.sessionPath, "the selected unicode task initially has an openable session");
		for (let index = 0; index < 12; index += 1) store.apply(selected.id, { type: TASK_EVENT.TEXT, text: `line ${index}\n` }, 2000 + index);

		const buttons = (lines: string[], label: string) => {
			const footer = lines.at(-2) ?? "";
			const start = footer.indexOf(label);
			assert.ok(start > 0, `the roomy footer exposes ${label}`);
			return { x: visibleWidth(footer.slice(0, start)), y: lines.length - 2 };
		};
		let lines = overlay.render(160).map(stripAnsi);
		let follow = buttons(lines, "[ Follow ]");
		let open = buttons(lines, "[ Open session ]");
		assert.match(lines[1] ?? "", /寿司/, "a unicode task remains inside the body, not the header or footer");
		assert.match(lines[follow.y] ?? "", /s Stop selected.*a all sessions/, "the existing stop and scope shortcuts remain beside the footer buttons");
		assert.match(overlay.render(59).map(stripAnsi).at(-2) ?? "", /\[Scope\]/, "the narrow list keeps mouse-accessible scope controls");
		lines = overlay.render(160).map(stripAnsi);
		follow = buttons(lines, "[ Follow ]");
		open = buttons(lines, "[ Open session ]");
		assert.equal(overlay.handleMouse?.(mouse("click", "left", follow.x, 0, 160, lines.length)), undefined, "header coordinates never route to a footer button");
		assert.equal(overlay.handleMouse?.(mouse("click", "left", follow.x, follow.y - 1, 160, lines.length)), undefined, "body coordinates never route to a footer button");
		assert.equal(overlay.handleMouse?.(mouse("press", "left", follow.x, follow.y, 160, lines.length)), undefined, "press is inert");
		assert.equal(overlay.handleMouse?.(mouse("click", "right", follow.x, follow.y, 160, lines.length)), undefined, "right click is inert");
		assert.equal(overlay.handleMouse?.(mouse("click", "middle", follow.x, follow.y, 160, lines.length)), undefined, "middle click is inert");
		assert.equal((overlay.handleMouse?.(mouse("move", "none", follow.x, follow.y, 160, lines.length)) as { handled?: boolean } | undefined)?.handled, true, "hover does not activate Follow");

		overlay.handleInput("\x1b[5~");
		assert.equal((overlay.handleMouse?.(mouse("click", "left", follow.x, follow.y, 160, lines.length)) as { handled?: boolean } | undefined)?.handled, true, "Follow restores tail tracking");
		assert.equal((overlay.handleMouse?.(mouse("click", "left", follow.x, follow.y, 160, lines.length)) as { handled?: boolean } | undefined)?.handled, true, "repeated Follow remains enabled instead of toggling off");
		store.apply(selected.id, { type: TASK_EVENT.TEXT, text: "line 12\n" }, 2012);
		lines = overlay.render(160).map(stripAnsi);
		assert.ok(lines.some((line) => /line 12/.test(line)), "Follow keeps the stream at its tail after manual scrolling");
		follow = buttons(lines, "[ Follow ]");
		open = buttons(lines, "[ Open session ]");
		assert.equal((overlay.handleMouse?.(mouse("click", "left", open.x, open.y, 160, lines.length)) as { handled?: boolean } | undefined)?.handled, true, "Open delegates exactly one eligible click to the existing callback");
		assert.equal(customCompletions.length, 1, "Open completes the actual ui.custom callback exactly once");
		const openedTask = customCompletions[0] as TaskRecord | undefined;
		assert.equal(openedTask?.id, selected.id, "Open completes ui.custom with the selected task before Escape");
		assert.equal(openedTask?.sessionPath, selected.sessionPath, "Open preserves the selected task's openable session in the ui.custom result");

		store.update(selected.id, { sessionPath: null });
		assert.equal(overlay.handleMouse?.(mouse("click", "left", follow.x, follow.y, 160, lines.length)), undefined, "a selected task update makes old footer coordinates inert until render");
		lines = overlay.render(160).map(stripAnsi);
		follow = buttons(lines, "[ Follow ]");
		overlay.handleInput("a");
		assert.equal(overlay.handleMouse?.(mouse("click", "left", follow.x, follow.y, 160, lines.length)), undefined, "a scope change makes old footer coordinates inert until render");
		overlay.handleInput("\x1b");
		await opened;
	} finally {
		captureStore.mock.restore();
	}
});

test("finished tasks remain available through resolveTask but never reappear in the live-only overlay", async () => {
	const { pi, tools, fire, commands, shortcuts } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, overlays } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Persist me", mode: "background" }, undefined, undefined, ctx);
	const id = (started.details.gentleAgents as { taskId: string }).taskId;
	await tick();
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Kept." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	const tasksDir = join(home, ".pi", "agent", "gentle-agents", "tasks");
	let stored = await loadHistory(tasksDir);
	for (let attempt = 0; attempt < 40 && !stored.some((entry) => entry.task.id === id); attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		stored = await loadHistory(tasksDir);
	}
	assert.ok(stored.some((entry) => entry.task.id === id && entry.task.result === "Kept."), "the finished task is on disk");

	const fresh = fakePi();
	gentleAgents(fresh.pi, {}, deps().deps);
	const again = fakeContext();
	await fresh.fire("session_start", again.ctx);
	assert.equal((await fresh.tools.get("subagent_result")!.execute("c2", { task_id: id }, undefined, undefined, again.ctx)).content[0].text, "Kept.");

	assert.ok(commands.has("jero:agents") && shortcuts.has("alt+a"));
	const opened = commands.get("jero:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	const overlay = overlays[0];
	assert.ok(overlay, "the overlay component was created");
	assert.doesNotMatch(overlay.render(80).map(stripAnsi).join("\n"), /finished|Subagent explore|Current orchestrator/);
	overlay.handleInput("a");
	overlay.handleInput("\x1b[C");
	assert.doesNotMatch(overlay.render(80).map(stripAnsi).join("\n"), /✓ Subagent explore/, "all sessions is not a historical-task browser");
	overlay.handleInput("\x1b");
	await opened;
});

