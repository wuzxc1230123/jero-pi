// 重平衡分片：自 jero-agents.test.ts 按顶层语句边界对半机械平移（语义零改动）。
// node --test 只在文件间并行；重用例扎堆单文件会抬高整套件并行的下限。

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
	agentsViewKey, answerThroughUi, completionText, default as jeroAgents,
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
	PARENT_CONFIRMED_SDD_CONTEXT, plainTheme, type Registered, root,
	tick, eventually, liveInstance, liveOverlay, liveProfile,
} from "./jero-agents-shared.ts";

test("manual agents command warns once in RPC mode and stays quiet without UI", async (t) => {
	const local = liveInstance(t, liveProfile("live-non-tui"), "non-tui");
	Object.assign(local.ctx, { mode: "rpc" });
	const notify = t.mock.method(local.ctx.ui, "notify");
	await local.commands.get("jero:agents")!.handler("", local.ctx);
	assert.equal(notify.mock.callCount(), 1);
	assert.equal(notify.mock.calls[0].arguments[1], "warning");
	assert.deepEqual(local.overlays, []);
	Object.assign(local.ctx, { hasUI: false });
	await local.commands.get("jero:agents")!.handler("", local.ctx);
	assert.equal(notify.mock.callCount(), 1, "headless invocation adds no notification");
	assert.deepEqual(local.overlays, []);
});

for (const scenario of ["recover", "shutdown", "replacement"] as const) {
	test(`live presence after owned-target publication failure: ${scenario}`, async (t) => {
		const profile = liveProfile(`live-io-${scenario}`);
		const local = liveInstance(t, profile, "io-original");
		await local.fire("session_start", local.ctx);
		const original = listPresence(profile).entries[0]!;
		const peer = scenario === "recover" ? liveInstance(t, profile, "io-original") : undefined;
		if (peer) await peer.fire("session_start", peer.ctx);
		const panel = peer ? await liveOverlay(local) : undefined;
		if (panel) {
			panel.overlay.handleInput("a");
			await eventually(() => /io-original/.test(panel.frame()), "same-session peer is visible before publication failure");
		}
		const target = join(profile, "gentle-agents", "presence", `${original.sessionHash}.${original.incarnation}.activity.json`);
		const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
		const rename = fs.renameSync;
		let failures = 0;
		const fault = t.mock.method(fs, "renameSync", (from, to) => {
			if (to === target) {
				failures++;
				throw Object.assign(new Error("fixture publication failure"), { code: "EIO" });
			}
			return rename(from, to);
		});
		syncBuiltinESMExports();
		try {
			await local.tools.get("subagent_run")!.execute("io", { agent: "local", task: "Recover activity", mode: "background" }, undefined, undefined, local.ctx);
			await eventually(() => failures > 0 && !listPresence(profile).entries.some((header) => header.incarnation === original.incarnation), "guarded flush failure must dispose the owned publication");
		} finally {
			fault.mock.restore();
			syncBuiltinESMExports();
		}
		if (scenario === "shutdown") await local.fire("session_shutdown", local.ctx);
		if (scenario === "replacement") {
			const next = fakeContext().ctx;
			next.sessionManager.getSessionId = () => "io-replacement";
			await local.fire("session_start", next);
		}
		const replacement = listPresence(profile).entries[0];
		local.children[0].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "activity after IO recovery" } });
		await tick();
		if (scenario === "recover") {
			await eventually(() => listPresence(profile).entries.some((header) => readActivity(profile, header).activity?.tasks.some((row) => row.thread.items.some((item) => item.text === "activity after IO recovery"))), "ordinary task delta must recreate presence with current activity");
			const recovered = listPresence(profile).entries;
			assert.equal(recovered.length, 2, "recovery preserves the distinct same-session peer");
			assert.ok(recovered.every((header) => header.sessionHash === original.sessionHash));
			assert.ok(recovered.every((header) => header.incarnation !== original.incarnation));
			const scans = t.mock.method(PresenceCursor.prototype, "next");
			await peer!.tools.get("subagent_run")!.execute("peer", { agent: "peer", task: "Peer after recovery", mode: "background" }, undefined, undefined, peer!.ctx);
			// The second scan starts only after the first post-recovery traversal is displayed.
			await eventually(() => scans.mock.callCount() >= 2 && /Subagent peer/.test(panel!.frame()), "same-session peer remains visible after recovery without reopening");
			assert.equal((panel!.frame().match(/Subagent local/g) ?? []).length, 1, "recovered local activity appears once, never as a read-only peer duplicate");
			assert.equal((panel!.frame().match(/Subagent peer/g) ?? []).length, 1, "the actual same-session peer remains independently visible");
		} else if (scenario === "shutdown") {
			assert.deepEqual(listPresence(profile).entries, [], "shutdown and late child events never recreate presence");
		} else {
			const headers = listPresence(profile).entries;
			assert.equal(headers.length, 1, "late old-session activity cannot resurrect its publisher");
			assert.notEqual(headers[0].sessionHash, original.sessionHash);
			assert.equal(headers[0].incarnation, replacement!.incarnation);
			assert.deepEqual(readActivity(profile, headers[0]).activity?.tasks, [], "replacement must not publish old-session tasks");
		}
	});
}

test("live-only instances sharing a session ID remain distinct and withdraw only their own incarnation", async (t) => {
	const profile = liveProfile("live-incarnation-profile");
	const local = liveInstance(t, profile, "same-live");
	const peer = liveInstance(t, profile, "same-live");
	peer.ctx.sessionManager.getCwd = () => join(realpathSync(root), "peer-cwd");
	for (const [instance, agent] of [[local, "local"], [peer, "peer"]] as const) {
		await instance.fire("session_start", instance.ctx, { reason: "startup" });
		await instance.tools.get("subagent_run")!.execute(agent, { agent, task: agent, mode: "background" }, undefined, undefined, instance.ctx);
	}
	const headers = listPresence(profile).entries;
	assert.equal(headers.length, 2);
	assert.equal(headers[0].sessionHash, headers[1].sessionHash);
	assert.notEqual(headers[0].incarnation, headers[1].incarnation);
	const panel = await liveOverlay(local);
	panel.overlay.handleInput("a");
	await eventually(() => /Subagent peer/.test(panel.frame()), "same-session peers remain independently visible");
	assert.equal((panel.frame().match(/Subagent local/g) ?? []).length, 1, "own publication is not duplicated as a peer");
	await local.fire("session_shutdown", local.ctx, { reason: "quit" });
	await panel.opened;
	assert.equal(listPresence(profile).entries.length, 1, "shutdown removes only this activation");
	assert.deepEqual(peer.children[0].killed, []);
});

test("live-only directory traverses presence overflow, excludes expired and other-profile peers, and replaces sessions", async (t) => {
	const profile = liveProfile("live-paged-profile");
	const now = Date.now();
	const oldClock = mock.method(Date, "now", () => now - 16_000);
	let expired: PresencePublisher;
	try {
		expired = PresencePublisher.start({ profile, sessionId: "expired", label: "Expired peer", activity: [] });
	} finally {
		oldClock.mock.restore();
	}
	// Simulate an abruptly closed publisher: retained files, but no renewing heartbeat.
	const stem = join(profile, "gentle-agents", "presence", `${expired.target.sessionHash}.${expired.target.incarnation}`);
	const staleFiles = ["header", "activity"].map((kind) => ({ path: `${stem}.${kind}.json`, bytes: readFileSync(`${stem}.${kind}.json`) }));
	expired.dispose();
	for (const { path, bytes } of staleFiles) writeFileSync(path, bytes, { mode: 0o600 });
	const isolated = PresencePublisher.start({ profile: liveProfile("live-isolated-profile"), sessionId: "isolated", label: "Isolated peer", activity: [] });
	t.after(() => isolated.dispose());
	for (let index = 0; index < 130; index++) {
		const publisher = PresencePublisher.start({ profile, sessionId: `idle-${index}`, label: `Idle peer ${index}`, activity: [] });
		t.after(() => publisher.dispose());
	}
	assert.equal(listPresence(profile).overflow, true, "fixture exceeds the foundation's first-page budget");
	let pageReadThisTurn = false;
	const next = PresenceCursor.prototype.next;
	const pages = t.mock.method(PresenceCursor.prototype, "next", function (this: PresenceCursor, ...args: Parameters<PresenceCursor["next"]>) {
		assert.equal(pageReadThisTurn, false, "directory pages must yield instead of blocking the UI with an unbounded loop");
		pageReadThisTurn = true;
		setImmediate(() => { pageReadThisTurn = false; });
		return next.apply(this, args);
	});
	const local = liveInstance(t, profile, "directory-local");
	await local.fire("session_start", local.ctx, { reason: "startup" });
	const panel = await liveOverlay(local);
	panel.overlay.handleInput("a");
	const seen = new Set<string>();
	await eventually(() => {
		for (let step = 0; step < 140; step++) {
			const frame = panel.frame();
			assert.doesNotMatch(frame, /Expired peer|Isolated peer/);
			for (const match of frame.matchAll(/Idle peer (\d+)/g)) seen.add(match[1]);
			panel.overlay.handleInput("j");
		}
		for (let step = 0; step < 140; step++) panel.overlay.handleInput("k");
		return seen.size === 130;
	}, "every idle orchestrator beyond the 128-entry page must eventually be reachable");
	assert.ok(pages.mock.callCount() >= 3, "the directory traversed all three fixture pages");
	panel.overlay.handleInput("q");
	await panel.opened;
	const readsAtClose = pages.mock.callCount();
	await new Promise((resolve) => setTimeout(resolve, 1100));
	assert.equal(pages.mock.callCount(), readsAtClose, "closing the overlay cancels future directory scans");
	pages.mock.restore();
	await local.fire("session_shutdown", local.ctx, { reason: "new" });
	const replacement = liveInstance(t, profile, "replacement-live");
	await replacement.fire("session_start", replacement.ctx, { reason: "new" });
	const cursor = new PresenceCursor(profile);
	const labels: string[] = [];
	try {
		let page;
		do {
			page = cursor.next();
			labels.push(...page.entries.map((entry) => entry.label));
		} while (page.overflow);
	} finally {
		cursor.close();
	}
	assert.ok(labels.some((label) => label.includes("replacement-live")));
	assert.ok(labels.every((label) => !label.includes("directory-local")), "session replacement withdraws the old activation");
	panel.overlay.handleInput("q");
	await panel.opened;
});

test("research launch transports selected grants and only matching existing extensions", async () => {
	const fixtureHome = join(root, "research-home");
	mkdirSync(join(fixtureHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(fixtureHome, ".pi", "agent", "agents", "sdd-research.md"), "---\nname: sdd-research\ntools: [read, write, fetch_content, web_search, source_check, mcp, bash]\n---\nCollect research.");
	const fake = fakePi(), runtime = deps(), { ctx } = fakeContext();
	fake.pi.getActiveTools = () => ["fetch_content", "web_search", "mcp", "bash"];
	fake.pi.getAllTools = () => fake.pi.getActiveTools().map(name => ({ name, sourceInfo: { source: "extension", path: "/installed/web.ts" } })) as never;
	const selection = { documentation: { tools: ["fetch_content"], extensions: { fetch_content: "/installed/web.ts" } } };
	const artifact = { store: "openspec", worktree: cwd, changeName: "demo", retainedIntent: "preserve denied documentation questions", locators: [{ artifact: "research", path: join(cwd, "openspec/changes/demo/research.md"), revision: 1, digest: "a".repeat(64) }] };
	let childEnv: NodeJS.ProcessEnv = {};
	jeroAgents(fake.pi, {}, { ...runtime.deps, home: fixtureHome, spawn: (command, args, options) => {
		childEnv = options.env!;
		return runtime.deps.spawn!(command, args, options);
	} });
	const result = await fake.tools.get("subagent_run")!.execute("research", { agent: "sdd-research", task: "Research docs", context: PARENT_CONFIRMED_SDD_CONTEXT, mode: "background", research_selection: selection, research_artifact: artifact }, undefined, undefined, ctx);
	await tick();
	const argv = runtime.spawned[0];
	assert.equal(argv[argv.indexOf("--tools") + 1], "read,write,fetch_content,subagent_parent_message");
	assert.equal(argv[argv.indexOf("--extension") + 1], "/installed/web.ts");
	assert.deepEqual(JSON.parse(childEnv.JERO_PI_RESEARCH_SELECTION!), selection);
	assert.deepEqual(JSON.parse(childEnv.JERO_PI_RESEARCH_ARTIFACT!), artifact);
	assert.ok(fake.tools.get("subagent_continue")!.parameters.properties.research_artifact);
	assert.ok(fake.tools.get("subagent_continue")!.parameters.properties.research_selection, "fresh selection must be expressible on continuation");
	assert.ok(JSON.parse(childEnv.JERO_PI_RESEARCH_TOOLS!).includes("subagent_parent_message"));
	assert.match(argv[argv.indexOf("--append-system-prompt") + 1], /documentation: available/);
	assert.match(argv[argv.indexOf("--append-system-prompt") + 1], /open-web: blocked/, "two reachable tools cannot admit open-web");
	runtime.children[0].emit({ type: "agent_settled" });
	await tick();
	const taskId = (result.details.jeroAgents as { taskId: string }).taskId;
	const rejected = await fake.tools.get("subagent_continue")!.execute("broaden", { task_id: taskId, prompt: "Inspect", mode: "background", research_artifact: { ...artifact, store: "none", locators: [] } }, undefined, undefined, ctx);
	assert.match(rejected.content[0].text, /scope/);
	assert.equal(runtime.spawned.length, 1);
	await fake.tools.get("subagent_continue")!.execute("resume", { task_id: taskId, prompt: "Inspect", mode: "background", research_artifact: artifact }, undefined, undefined, ctx);
	await tick();
	assert.equal(runtime.spawned.length, 2);
	assert.ok(!runtime.spawned[1].includes("--extension"), "no inherited research selection");
	assert.equal(runtime.spawned[1][runtime.spawned[1].indexOf("--tools") + 1], "read,write,subagent_parent_message");
	assert.equal(JSON.parse(childEnv.JERO_PI_RESEARCH_SELECTION!), null);
	assert.deepEqual(JSON.parse(childEnv.JERO_PI_RESEARCH_ARTIFACT!), artifact, "denial intent and exact store/path survive re-entry");
	fake.pi.getActiveTools = () => ["web_search"];
	runtime.children[1].emit({ type: "agent_settled" });
	await tick();
	const denied = await fake.tools.get("subagent_continue")!.execute("missing-tool", { task_id: taskId, prompt: "Retry same scope", mode: "background", research_selection: selection, research_artifact: artifact }, undefined, undefined, ctx);
	await tick();
	assert.ok(!runtime.spawned[2].includes("--extension"));
	runtime.children[2].emit({ type: "agent_settled" });
	await tick();
	fake.pi.getActiveTools = () => ["fetch_content", "web_search"];
	await fake.tools.get("subagent_continue")!.execute("corrected", { task_id: (denied.details.jeroAgents as { taskId: string }).taskId, prompt: "Retry same scope", mode: "background", research_selection: selection, research_artifact: artifact }, undefined, undefined, ctx);
	await tick();
	assert.equal(runtime.spawned[3][runtime.spawned[3].indexOf("--extension") + 1], "/installed/web.ts");
	assert.deepEqual(JSON.parse(childEnv.JERO_PI_RESEARCH_ARTIFACT!), artifact);
	await fake.fire("session_shutdown", ctx);
});

test("research child inventory requires every canonical open-web tool", () => {
	const required = ["web_search", "source_check", "fetch_content", "get_search_content"];
	for (const missing of [undefined, ...required]) {
		const hooks = new Map<string, (event: any) => any>();
		const active = required.filter(name => name !== missing);
		const pi = { on: (name: string, handler: (event: any) => any) => hooks.set(name, handler), getActiveTools: () => active, getAllTools: () => required.map(name => ({ name, sourceInfo: { source: "extension", path: "/installed/web.ts" } })) } as never;
		jeroAgents(pi, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: JSON.stringify(required), JERO_PI_RESEARCH_SELECTION: JSON.stringify({ documentation: { tools: ["fetch_content"], extensions: { fetch_content: "/installed/web.ts" } }, "open-web": { tools: required, extensions: Object.fromEntries(required.map(name => [name, "/installed/web.ts"])) } }) });
		const prompt = hooks.get("before_agent_start")!({ systemPrompt: "research" }).systemPrompt;
		assert.match(prompt, new RegExp(`open-web: ${missing === undefined ? "available" : "blocked"}`));
		assert.match(prompt, new RegExp(`documentation: ${missing === "fetch_content" ? "blocked" : "available"}`));
		assert.match(prompt, /Availability is not evidence/);
	}
});

test("research child rechecks local inventory and blocks gateway calls", async () => {
	const hooks = new Map<string, (event: any) => any>();
	const pi = { on: (name: string, handler: (event: any) => any) => hooks.set(name, handler), getActiveTools: () => ["read", "mcp"], getAllTools: () => [{ name: "read" }, { name: "mcp" }] } as never;
	jeroAgents(pi, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: '["read","fetch_content"]' });
	assert.match(hooks.get("before_agent_start")!({ systemPrompt: "research" }).systemPrompt, /documentation: blocked/);
	assert.equal(hooks.get("tool_call")!({ toolName: "mcp" }).block, true);
	assert.equal(hooks.get("tool_call")!({ toolName: "fetch_content" }).block, true);
	assert.equal(hooks.get("tool_call")!({ toolName: "read" }).block, true, "missing artifact scope cannot authorize a read");
});



for (const matching of [true, false]) {
 test("owned child diff relay validates the exact file independently of review bookkeeping: "+matching, async () => {
  const h=fakePi(), d=deps(), {ctx}=fakeContext();
  const target=realpathSync(cwd);
  (ctx as any).cwd=target;
  ctx.sessionManager.getCwd=()=>target;
  ctx.sessionManager.getEntries=(()=>h.entries) as any;
  ctx.sessionManager.getBranch=(()=>h.entries) as any;
  d.deps.resolveWorktree=(path,base)=>{
   const full=resolve(base,path);
   return full===target||full.startsWith(target+sep)?{root:target,commonDir:"/fixture/common"}:undefined;
  };
  const spawn=d.deps.spawn!;
  d.deps.spawn=(...args)=>{
   const child=spawn(...args),on=child.on.bind(child);
   child.on=((event,listener)=>{if(event==="spawn")queueMicrotask(listener);return on(event,listener);}) as any;
   return child;
  };
  jeroAgents(h.pi,{},d.deps);
  await h.fire("session_start",ctx);
  await h.tools.get("subagent_run")!.execute("diff",{agent:"explore",task:"Write",mode:"background",workspace_root:target},undefined,undefined,ctx);
  await tick();
  writeFileSync(join(target,"session-diff-test.ts"),"agent\n");
  const evidence={id:"write",root:target,path:matching?"session-diff-test.ts":"different.ts",before:{kind:"text",text:"original\n"},after:{kind:"text",text:"agent\n"}};
  d.children[0].emit({type:"tool_execution_start",toolCallId:"write",toolName:"write",args:{path:"session-diff-test.ts"}});
  d.children[0].emit({type:"tool_execution_end",toolCallId:"write",isError:false,result:{content:[],details:{jeroSessionChange:evidence}}});
  const relays=h.events.filter(event=>event.name==="gentle-pi:child-session-change");
  assert.equal(relays.length,matching?1:0);
  if(matching) assert.match((relays[0].data as any).evidence.id,/:write$/);
  assert.equal(h.entries.filter(entry=>entry.customType===REVIEW_REMINDER_RECEIPT).length,1);
  await h.fire("session_shutdown",ctx); await tick();
 });
}

for (const scenario of ["own", "other-root", "escaped", "sibling", "session-switch", "shutdown", "unregistered"] as const) {
	test(`child mutation attribution through registered subagent_run: ${scenario}`, async () => {
		const h = fakePi();
		const d = deps();
		const { ctx } = fakeContext();
		let sessionId = "s1";
		const sibling = join(root, "sibling");
		const childRoot = scenario === "other-root" ? sibling : cwd;
		ctx.sessionManager.getSessionId = () => sessionId;
		ctx.sessionManager.getEntries = (() => h.entries) as typeof ctx.sessionManager.getEntries;
		ctx.sessionManager.getBranch = (() => h.entries) as typeof ctx.sessionManager.getBranch;
		d.deps.resolveWorktree = (path, base) => {
			const absolute = resolve(base, path);
			const worktree = [cwd, sibling].find((candidate) => absolute === candidate || absolute.startsWith(candidate + sep));
			return worktree ? { root: worktree, commonDir: "/fixture/common" } : undefined;
		};
		const spawn = d.deps.spawn!;
		d.deps.spawn = (...args) => {
			const child = spawn(...args);
			const on = child.on.bind(child);
			child.on = ((event: string, listener: () => void) => {
				if (event === "spawn" && scenario !== "unregistered") queueMicrotask(listener);
				return on(event as "spawn", listener);
			}) as typeof child.on;
			return child;
		};
		jeroAgents(h.pi, {}, d.deps);
		await h.fire("session_start", ctx);
		await h.tools.get("subagent_run")!.execute("mutation", { agent: "explore", task: "Write", mode: "background", workspace_root: childRoot }, undefined, undefined, ctx);
		await tick();
		assert.equal(h.entries.filter((entry) => entry.customType === REVIEW_REMINDER_RECEIPT).length, 0, "spawn alone is not ownership");
		if (scenario === "session-switch") sessionId = "s2";
		if (scenario === "shutdown") await h.fire("session_shutdown", ctx);
		const path = scenario === "escaped" ? "../../outside.ts" : scenario === "sibling" ? join(sibling, "file.ts") : "file.ts";
		d.children[0].emit({ type: "tool_execution_start", toolCallId: "write", toolName: "write", args: { path } });
		d.children[0].emit({ type: "tool_execution_end", toolCallId: "write", isError: false, result: { content: [] } });
		const accepted = scenario === "own" || scenario === "other-root";
		assert.equal(h.entries.filter((entry) => entry.customType === REVIEW_REMINDER_RECEIPT).length, accepted ? 1 : 0);
		assert.equal(Boolean(pendingReviewMutation(ctx.sessionManager, cwd)), scenario === "own", "another registered root never authorizes current-root STATUS");
		if (scenario === "other-root") assert.ok(pendingReviewMutation(ctx.sessionManager, sibling));
		await h.fire("session_shutdown", ctx);
		await tick();
	});
}
