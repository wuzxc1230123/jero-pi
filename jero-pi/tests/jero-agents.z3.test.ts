// jero-agents 测试第 3 段（共 3 段；夹具在 jero-agents-shared.ts）。
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
import { eventually, tick } from "./jero-agents-shared.ts";

test("the overlay confirms a running task once and reports when it finishes during confirmation", async () => {
	const { pi, tools, fire, commands, sent } = fakePi();
	const harness = deps();
	const modalHome = join(root, "modal-home");
	mkdirSync(join(modalHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(modalHome, ".pi", "agent", "agents", "explore.md"), "---\ndescription: maps things\nmodel: openai-codex/gpt-5.6-terra\n---\nYou map things.");
	writeFileSync(join(modalHome, ".pi", "agent", "subagents.json"), JSON.stringify({ max_concurrency: 2 }));
	harness.deps.home = modalHome;
	let answerConfirmation: (confirmed: boolean) => void = () => {};
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, overlays } = fakeContext(fakeTui, () => new Promise((resolve) => {
		answerConfirmation = resolve;
	}));
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Race", mode: "background" }, undefined, undefined, ctx);
	await tick();
	const opened = commands.get("jero:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	const overlay = overlays[0];
	assert.ok(overlay, "the overlay component was created");
	overlay.handleInput("s");
	overlay.handleInput("c");
	await tick();
	assert.deepEqual(dialogs, ["confirm:Stop explore?:Current work may be incomplete."], "s and its compatibility alias share one confirmation");
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Finished first." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	answerConfirmation(true);
	await tick();
	assert.match(dialogs.at(-1) ?? "", /^notify:Task explore already finished\.$/);
	assert.equal(sent.length, 1, "a normal completion during confirmation still reaches the parent");
	overlay.handleInput("\x1b");
	await opened;
});

test("the overlay stops a queued selection immediately without confirmation", async () => {
	const { pi, tools, fire, commands } = fakePi();
	const harness = deps();
	const queueHome = join(root, "queue-home");
	mkdirSync(join(queueHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(queueHome, ".pi", "agent", "agents", "explore.md"), "---\ndescription: maps things\n---\nYou map things.");
	writeFileSync(join(queueHome, ".pi", "agent", "subagents.json"), JSON.stringify({ max_concurrency: 1 }));
	harness.deps.home = queueHome;
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, overlays } = fakeContext();
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "First", mode: "background" }, undefined, undefined, ctx);
	await tick();
	const queued = await tools.get("subagent_run")!.execute("c2", { agent: "explore", task: "Queued", mode: "background" }, undefined, undefined, ctx);
	const queuedId = (queued.details.gentleAgents as { taskId: string }).taskId;
	const opened = commands.get("jero:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	overlays[0]!.handleInput("s");
	await tick();
	assert.deepEqual(dialogs, ["notify:Stopped explore."], "queued work stops without confirmation");
	assert.match((await tools.get("subagent_status")!.execute("c3", { task_id: queuedId }, undefined, undefined, ctx)).content[0].text, /cancelled/);
	overlays[0]!.handleInput("\x1b");
	await opened;
});

test("the overlay explains that stopping a waiting subagent dismisses its question", async () => {
	const { pi, tools, fire, commands } = fakePi();
	const harness = deps();
	const waitingHome = join(root, "waiting-home");
	mkdirSync(join(waitingHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(waitingHome, ".pi", "agent", "agents", "explore.md"), "---\ndescription: maps things\n---\nYou map things.");
	harness.deps.home = waitingHome;
	let answerInput: (value: string | undefined) => void = () => {};
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, overlays } = fakeContext(fakeTui, async () => true, () => new Promise<string | undefined>((resolve) => {
		answerInput = resolve;
	}));
	await fire("session_start", ctx);
	const running = tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Ask", mode: "task" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].emit({ type: "extension_ui_request", id: "wait", method: "input", title: "Need input" });
	await tick();
	const opened = commands.get("jero:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	overlays[0]!.handleInput("s");
	await tick();
	assert.ok(dialogs.includes("confirm:Stop explore?:Its pending question will be dismissed."));
	assert.match((await running).content[0].text, /cancelled/);
	answerInput(undefined);
	overlays[0]!.handleInput("\x1b");
	await opened;
});

test("restored task history cannot enter the live panel or execute stop even with the current session ID", async () => {
	const { pi, fire, commands, tools } = fakePi();
	const harness = deps();
	const historyHome = join(root, "history-home");
	const historical: TaskRecord = { id: "history-running", agent: "explore", mode: "background", prompt: "p", label: "p", cwd, parentSessionId: "s1", status: TASK_STATUS.RUNNING, createdAt: 1, startedAt: 1, endedAt: null, model: "m", thinking: undefined, sessionPath: null, error: null, result: null, lastStep: "working", lastActivityAt: 1, turns: 0, toolCalls: 0, tokens: 0, cost: 0 };
	await saveTask(historyDir(historyHome), historical, emptyThread());
	harness.deps.home = historyHome;
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs, overlays } = fakeContext();
	await fire("session_start", ctx);
	await tools.get("subagent_status")!.execute("restore", { task_id: historical.id }, undefined, undefined, ctx);
	const opened = commands.get("jero:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	assert.doesNotMatch(stripAnsi(overlays[0]!.render(80).join("\n")), /Stop selected|Subagent explore/);
	overlays[0]!.handleInput("s");
	overlays[0]!.handleInput("c");
	await tick();
	assert.deepEqual(dialogs, []);
	overlays[0]!.handleInput("\x1b");
	await opened;
});

test("Alt+S confirms a snapshot of active subagents and suppresses their follow-up delivery", async () => {
	const { pi, tools, fire, shortcuts, sent } = fakePi();
	const harness = deps();
	let answerConfirmation: (confirmed: boolean) => void = () => {};
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs } = fakeContext(fakeTui, () => new Promise<boolean>((resolve) => {
		answerConfirmation = resolve;
	}));
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "First", mode: "background" }, undefined, undefined, ctx);
	await tick();
	const shortcut = shortcuts.get("alt+s");
	assert.ok(shortcut, "Alt+S is registered by default");
	assert.equal(shortcut.description, "Stop active subagent(s)");
	const stopping = shortcut.handler(ctx);
	await tick();
	await tools.get("subagent_run")!.execute("c2", { agent: "explore", task: "Second", mode: "background" }, undefined, undefined, ctx);
	await tick();
	answerConfirmation(true);
	await stopping;
	assert.deepEqual(dialogs, ["confirm:Stop 1 active subagent?:Only these 1 subagent will stop. Current work may be incomplete.", "notify:Stopped 1 subagent."]);
	assert.equal(sent.length, 0, "intentional cancellation does not start a follow-up turn");
	assert.match((await tools.get("subagent_list_tasks")!.execute("c3", {}, undefined, undefined, ctx)).content[0].text, /running/, "a subagent started during confirmation remains active");
	const secondConfirmation = shortcut.handler(ctx);
	await tick();
	assert.match(dialogs.at(-1) ?? "", /^confirm:Stop 1 active subagent\?/);
	answerConfirmation(false);
	await secondConfirmation;
	await fire("session_shutdown", ctx);
});

test("the card follows the active session: after /new the earlier session's tasks leave it, and come back on /resume", async () => {
	const { pi, tools, commands, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, widget, overlays } = fakeContext();
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Long job", mode: "background" }, undefined, undefined, ctx);
	await tick();
	assert.match(widget()![1], /◐  explore  Long job/);
	const sessions = ctx as unknown as { sessionManager: { getSessionId(): string; getCwd(): string } };
	sessions.sessionManager = { getSessionId: () => "s2", getCwd: () => cwd };
	await fire("session_start", ctx, { type: "session_start", reason: "new" });
	assert.deepEqual(widget(), [], "the new session starts with an empty card");
	assert.match((await tools.get("subagent_list_tasks")!.execute("c2", {}, undefined, undefined, ctx)).content[0].text, /No subagent tasks in this session/);
	const opened = commands.get("jero:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	const overlay = overlays[0]!;
	assert.match(stripAnsi(overlay.render(80)[0]), /this session · 0 active/, "the overlay opens on the active session");
	overlay.handleInput("a");
	assert.doesNotMatch(overlay.render(80).map(stripAnsi).join("\n"), /◐ Subagent explore/, "retained children of a replaced session do not imply an open orchestrator");
	overlay.handleInput("\x1b");
	await opened;
	sessions.sessionManager = { getSessionId: () => "s1", getCwd: () => cwd };
	await fire("session_start", ctx, { type: "session_start", reason: "resume" });
	assert.match(widget()![1], /◐  explore  Long job/, "resuming the first session shows its task again");
});

test("the card caps its rows to the terminal height and says how many tasks are hidden", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, widget } = fakeContext({ requestRender() {}, terminal: { rows: 20 } } as { requestRender(): void });
	await fire("session_start", ctx);
	for (let index = 0; index < 6; index += 1) await tools.get("subagent_run")!.execute(`c${index}`, { agent: "explore", task: `Job ${index}`, label: `job ${index}`, mode: "background" }, undefined, undefined, ctx);
	await tick();
	const card = widget()!;
	assert.equal(card.length, 8, "a 20-row terminal gets five card rows (four tasks and the overflow line) inside the frame, then the spacer");
	assert.match(card[0], /2 active · 4 queued/);
	assert.match(card[5], /^│ … 2 more · alt\+a to view +│$/);
});

test("the production overlay reads terminal rows at render time without a minimum-height override", async () => {
	const { pi, fire, commands } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	let rows = 10;
	const overlayTui = { terminal: { get rows() { return rows; } }, requestRender() {} };
	const { ctx, overlays, customOptions } = fakeContext(fakeTui, async () => true, async () => undefined, overlayTui);
	await fire("session_start", ctx);
	const opened = commands.get("jero:agents")!.handler("", ctx);
	for (let attempt = 0; attempt < 40 && overlays.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
	const overlay = overlays[0]!;
	assert.deepEqual(customOptions[0], { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" } });
	assert.equal(overlay.render(80).length, 10, "the overlay uses the full terminal height");
	rows = 5;
	assert.equal(overlay.render(80).length, 5, "a live terminal resize changes the production frame budget");
	rows = 2;
	assert.equal(overlay.render(80).length, 1, "tiny terminals retain bounded controls rather than forced chrome");
	overlay.handleInput("\x1b");
	await opened;
});

// Issue #867: a completion settling while the parent agent run is active must
// be held by the extension and flushed at the next turn boundary, not parked
// in the host's followUp queue until the whole orchestrator run stops calling
// tools.
test("a background completion settling while the parent agent runs is delivered exactly once at the next turn end", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Chained turns", mode: "background" }, undefined, undefined, ctx);
	const id = (started.details.gentleAgents as { taskId: string }).taskId;
	await tick();
	await fire("agent_start", ctx);
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Chained done." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0, "nothing enters the conversation while the parent agent run is active");
	await fire("turn_end", ctx);
	const results = sent.filter((entry) => entry.message.customType === "gentle-agents.result");
	assert.equal(results.length, 1, "the held completion is delivered exactly once at turn_end");
	assert.match(String(results[0]!.message.content), new RegExp(`task ${id}, "Chained turns"`));
	// Pins the delivery mode against the host's drain semantics: "followUp" is
	// drained by the run loop only in its stop branch, so a parent that keeps
	// calling tools would see the completion when the whole run ends. "steer" is
	// polled every turn and injected before the next LLM call, bounding the wait
	// to the current turn.
	assert.deepEqual(results[0]!.options, { deliverAs: "steer", triggerTurn: true });
	await fire("turn_end", ctx);
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 1, "a later turn_end never replays the completion");
	await fire("session_shutdown", ctx);
});

test("a completion held past the stale window becomes transcript-only content and never re-enters the conversation", async () => {
	const { pi, tools, fire, sent, entries, entryRenderers } = fakePi();
	const harness = deps();
	let clock = 1000;
	harness.deps.now = () => clock;
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Slow orchestrator", mode: "background" }, undefined, undefined, ctx);
	const id = (started.details.gentleAgents as { taskId: string }).taskId;
	await tick();
	await fire("agent_start", ctx);
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Late answer." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	clock += STALE_COMPLETION_MS + 1_000;
	await fire("turn_end", ctx);
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0, "a stale completion never enters the model context");
	const stale = entries.filter((entry) => entry.customType === "gentle-agents.stale-result");
	assert.equal(stale.length, 1, "the human still sees the stale completion as durable transcript content");
	assert.match(JSON.stringify(stale[0]!.data), new RegExp(id), "the stale notice names the task");
	const rendered = entryRenderers.get("gentle-agents.stale-result")!(stale[0]!, { expanded: true }, plainTheme).render(90).map(stripAnsi).join("\n");
	assert.match(rendered, /stale/i);
	assert.match(rendered, new RegExp(id));
	assert.match(rendered, /explore/);
	assert.match(rendered, /ago/);
	await fire("session_shutdown", ctx);
});

test("a completion the parent already pulled is dropped silently at the next turn end", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Pulled early", mode: "background" }, undefined, undefined, ctx);
	const id = (started.details.gentleAgents as { taskId: string }).taskId;
	await tick();
	await fire("agent_start", ctx);
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Pulled answer." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0);
	assert.match((await tools.get("subagent_result")!.execute("c2", { task_id: id }, undefined, undefined, ctx)).content[0].text, /Pulled answer\./);
	await fire("turn_end", ctx);
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0, "a consumed completion is dropped instead of replayed");
	await fire("session_shutdown", ctx);
});

test("a session restart never replays a completion still pending from before it", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Restarted", mode: "background" }, undefined, undefined, ctx);
	await tick();
	await fire("agent_start", ctx);
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Unclaimed answer." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0);
	await fire("session_start", ctx, { reason: "resume" });
	await fire("turn_end", ctx);
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0, "a resumed session starts with an empty completion queue");
	await fire("session_shutdown", ctx);
});

test("a background completion owned by a prior session is dropped, never delivered into the current session", async () => {
	const { pi, tools, fire, sent, entries } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	await tools.get("subagent_run")!.execute("c1", { agent: "explore", task: "Cross session", mode: "background" }, undefined, undefined, ctx);
	await tick();
	(ctx.sessionManager as { getSessionId(): string }).getSessionId = () => "s2";
	await fire("session_start", ctx, { type: "session_start", reason: "new" });
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Cross answer." }] }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	await fire("turn_end", ctx);
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0, "the replacement session receives no completion it does not own");
	assert.equal(entries.filter((entry) => entry.customType === "gentle-agents.stale-result").length, 0);
	await fire("session_shutdown", ctx);
});

test("aborting the caller's signal cancels the subagent, records it, and says why", async () => {
	const { pi, tools, fire } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx, dialogs } = fakeContext();
	await fire("session_start", ctx);
	const controller = new AbortController();
	const pending = tools.get("subagent_run")!.execute("abort", { agent: "explore", task: "keep working" }, controller.signal, undefined, ctx);
	await tick();
	controller.abort();
	await tick();
	const yielded = await pending;
	const details = (yielded.details as { gentleAgents?: { taskId: string; status: string } }).gentleAgents!;
	assert.equal(details.status, "cancelled", "the run is recorded as cancelled");
	assert.match((yielded as { content: Array<{ text: string }> }).content[0].text, /cancelled/);
	assert.ok(
		dialogs.some((entry) => entry.startsWith("notify:") && /cancelled/.test(entry) && /tool call was aborted/.test(entry)),
		"a warning names the abort and the cancellation",
	);
	assert.equal(harness.children[0].killed.length > 0, true, "the runner terminated the child");
});

test("selected child routes recheck provenance and keep separately authorized local tools", () => {
 const names = ["fetch_content", "web_search", "read", "write", "mem_save", "subagent_parent_message"];
 const selection = { documentation: { tools: ["fetch_content"], extensions: { fetch_content: "/installed/web.ts" } } };
 const path = join(root, "openspec/changes/demo/research.md");
 const scope = { store: "both", worktree: root, changeName: "demo", retainedIntent: "docs", locators: [{ artifact: "research", path, revision: 1, digest: "a".repeat(64), engram: { topic_key: "sdd/demo/research" } }] };
 for (const mismatch of ["none", "path", "sdk", "inactive", "unregistered", "restriction"]) {
  const hooks = new Map<string, (event: { toolName?: string; systemPrompt?: string; input?: object }, ctx?: { cwd: string }) => { block?: boolean; systemPrompt?: string } | undefined>();
  const active = names.filter(name => mismatch !== "inactive" || name !== "fetch_content");
  const registered = names.filter(name => mismatch !== "unregistered" || name !== "fetch_content");
  const pi = { on: (name: string, hook: typeof hooks extends Map<string, infer H> ? H : never) => hooks.set(name, hook), getActiveTools: () => active,
   getAllTools: () => registered.map(name => ({ name, sourceInfo: { source: mismatch === "sdk" && name === "fetch_content" ? "sdk" : "extension", path: mismatch === "path" ? "/other.ts" : "/installed/web.ts" } })) };
  gentleAgents(pi as never, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: JSON.stringify(names.filter(name => mismatch !== "restriction" || name !== "fetch_content")), JERO_PI_RESEARCH_SELECTION: JSON.stringify(selection), JERO_PI_RESEARCH_ARTIFACT: JSON.stringify(scope) });
  const call = hooks.get("tool_call")!;
  assert.equal(call({ toolName: "fetch_content" })?.block, mismatch === "none" ? undefined : true, mismatch);
  assert.equal(call({ toolName: "web_search" })?.block, true, "available but unselected");
  for (const toolName of names.slice(2)) assert.equal(call({ toolName, input: toolName === "mem_save" ? { topic: "sdd/demo/research", content: '{"revision":2}' } : { path, content: '{"revision":2}' } }, { cwd: root })?.block, ["write", "mem_save"].includes(toolName) ? true : undefined, toolName);
 }
});

test("research child narrows artifact arguments and observes actual dual-store readbacks", async () => {
 const { createHash } = await import("node:crypto");
 const cwd = join(root, "bounded-child");
 mkdirSync(cwd, { recursive: true });
 const bytes = '{"revision":1,"outcome":"blocked"}';
 const locator = { artifact: "research", path: join(cwd, "openspec/changes/demo/research.md"), revision: 1, digest: createHash("sha256").update(bytes).digest("hex"), engram: { topic_key: "sdd/demo/research" } };
 const scope = { store: "both", worktree: cwd, changeName: "demo", retainedIntent: "fetch missing; preserve questions", locators: [locator] };
 const hooks = new Map<string, (...args: unknown[]) => unknown>();
 let active = ["read", "write", "mem_read", "mem_save", "subagent_parent_message"];
 const journal = join(cwd, "session.jsonl"); writeFileSync(journal, "");
 const pi = { appendEntry: (customType, data) => appendFileSync(journal, JSON.stringify({ type: "custom", customType, data }) + "\n"), on: (name: string, fn: (...args: unknown[]) => unknown) => hooks.set(name, fn), getActiveTools: () => active, getAllTools: () => active.map(name => ({ name })) };
 gentleAgents(pi as never, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: JSON.stringify(active), JERO_PI_RESEARCH_ARTIFACT: JSON.stringify(scope) });
 const ctx = { cwd, sessionManager: { getEntries: () => [], getSessionFile: () => journal } };
 const prompt = hooks.get("before_agent_start")!({ systemPrompt: "research" }, ctx) as { systemPrompt: string };
 assert.match(prompt.systemPrompt, /retainedIntent/);
 assert.match(prompt.systemPrompt, /never authority/);
 const call = (toolName: string, input: object, toolCallId = "c") => hooks.get("tool_call")!({ toolName, input, toolCallId }, ctx) as { block: boolean } | undefined;
 const result = (toolName: string, input: object, content: string, isError = false) => hooks.get("tool_result")!({ toolName, input, toolCallId: "c", content: [{ type: "text", text: content }], isError }, ctx) as { content: { text: string }[]; isError?: boolean };
 const render = (body: string) => "saved 2026-01-01T00:00:00.000Z" + String.fromCharCode(10) + String.fromCharCode(10) + body;
 const readInput = { topic: locator.engram.topic_key };
 const save = (content: string) => ({ topic: locator.engram.topic_key, content });
 assert.equal(call("write", { path: locator.path, content: '{"revision":2,"outcome":"blocked"}' })?.block, true, "initial readback must precede mutation");
 assert.equal(call("write", { path: join(cwd, "outside.md") })?.block, true);
 assert.equal(call("mem_read", { topic: "sdd/other/research" })?.block, true);
 assert.equal(call("mem_save", { topic: "sdd/other/research" })?.block, true);
 assert.equal(call("read", { path: locator.path }), undefined);
 assert.match(result("read", { path: locator.path }, bytes).content.at(-1)!.text, /incomplete/);
 assert.equal(call("mem_read", readInput), undefined);
 assert.match(result("mem_read", readInput, render(bytes)).content.at(-1)!.text, /all selected stores/);
 hooks.get("before_agent_start")!({ systemPrompt: "fresh generation" }, ctx);
 assert.equal(call("write", { path: locator.path, content: '{"revision":5}' })?.block, true, "new generation cannot reuse initial authorization");
 call("read", { path: locator.path }); result("read", { path: locator.path }, bytes);
 call("mem_read", readInput); result("mem_read", readInput, render(bytes));
 const next = '{"revision":5,"outcome":"partial"}';
 assert.equal(call("write", { path: locator.path, content: next }), undefined);
 call("read", { path: locator.path }, "pending-read");
 const pendingRead = hooks.get("tool_result")!({ toolName: "read", input: { path: locator.path }, toolCallId: "pending-read", content: [{ type: "text", text: bytes }], isError: false }, ctx) as { content: { text: string }[] };
 assert.match(pendingRead.content.at(-1)!.text, /incomplete/, "old bytes cannot complete a pending mutation");
 result("write", { path: locator.path, content: next }, "written");
 call("read", { path: locator.path });
 assert.match(result("read", { path: locator.path }, next).content.at(-1)!.text, /incomplete/);
 assert.equal(call("mem_save", save(next)), undefined);
 result("mem_save", save(next), "saved");
 call("read", { path: locator.path });
 result("read", { path: locator.path }, next);
 call("mem_read", readInput);
 assert.match(result("mem_read", readInput, render(next)).content.at(-1)!.text, /all selected stores/);
 assert.equal(call("write", { path: locator.path, content: '{"revision":2}' })?.block, true, "revision 1 to 5 to 2 is refused");
 const newer = '{"revision":6}';
 assert.equal(call("mem_save", save(newer)), undefined);
 result("mem_save", save(newer), "saved");
 call("mem_read", readInput);
 assert.equal(result("mem_read", readInput, render(next)).isError, true, "a save supersedes the accepted body; only the written digest converges");
 call("write", { path: locator.path, content: '{"revision":3,"outcome":"partial"}' });
 result("write", { path: locator.path }, "permission denied", true);
 call("mem_read", readInput);
 assert.match(result("mem_read", readInput, render(next)).content.at(-1)!.text, /proposal_ready=false/, "write attempt invalidates prior readback even when denied");
 call("mem_read", readInput);
 assert.equal(result("mem_read", readInput, render(bytes)).isError, true);
 assert.equal(call("write", { path: locator.path, content: '{"revision":4}' })?.block, true, "stale/divergent readback must refuse recovery writes");
 assert.equal(call("mem_save", save('{"revision":4}'))?.block, true);
 active = active.filter(name => name !== "write");
 assert.equal(call("write", { path: locator.path })?.block, true);
 assert.equal((hooks.get("tool_call")!({ toolName: "read", input: { path: locator.path } }, { cwd: root }) as { block: boolean }).block, true);
 active.push("write");
 gentleAgents(pi as never, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: JSON.stringify(active), JERO_PI_RESEARCH_ARTIFACT: JSON.stringify(scope) });
 call("read", { path: locator.path });
 result("read", { path: locator.path }, bytes);
 call("mem_read", readInput);
 result("mem_read", readInput, render(bytes));
 call("write", { path: locator.path, content: next });
 result("write", { path: locator.path, content: next }, "written");
 const divergent = '{"revision":2,"outcome":"done"}';
 call("mem_save", save(divergent));
 result("mem_save", save(divergent), "saved");
 call("read", { path: locator.path });
 result("read", { path: locator.path }, next);
 call("mem_read", readInput);
 assert.equal(result("mem_read", readInput, render(divergent)).isError, true, "individually matching but divergent hybrid writes never converge");
 for (const completion of [[], [{ type: "text", text: "" }], [{ type: "text", text: "denied" }]]) {
  gentleAgents(pi as never, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: JSON.stringify(active), JERO_PI_RESEARCH_ARTIFACT: JSON.stringify({ ...scope, store: "openspec", locators: [{ ...locator, engram: undefined }] }) });
  call("read", { path: locator.path }); result("read", { path: locator.path }, bytes);
  assert.equal(call("write", { path: locator.path, content: next }), undefined);
  assert.equal(call("write", { path: locator.path, content: next }, "overlap")?.block, true);
  hooks.get("tool_result")!({ toolName: "write", input: { path: locator.path, content: next }, toolCallId: "c", content: completion, isError: completion.length > 0 && completion[0].text === "denied" }, ctx);
  call("read", { path: locator.path });
  assert.match(result("read", { path: locator.path }, next).content.at(-1)!.text, /proposal_ready=false/, "failed or malformed write cannot establish completion");
  assert.equal(call("write", { path: locator.path, content: '{"revision":6}' })?.block, true);
 }
 for (const tool of ["write", "mem_save"]) {
  const memory = tool === "mem_save", readTool = memory ? "mem_read" : "read";
  const input = memory ? readInput : { path: locator.path };
  const mutation = memory ? save(next) : { path: locator.path, content: next };
  gentleAgents(pi as never, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: JSON.stringify(active), JERO_PI_RESEARCH_ARTIFACT: JSON.stringify({ ...scope, store: memory ? "engram" : "openspec", locators: [{ ...locator, path: memory ? undefined : locator.path, engram: memory ? locator.engram : undefined }] }) });
  call(readTool, input); result(readTool, input, memory ? render(bytes) : bytes);
  assert.equal(call(tool, mutation), undefined);
  assert.doesNotThrow(() => hooks.get("tool_result")!({ toolName: tool, input: mutation, toolCallId: "c", content: [null], isError: false }, ctx));
  call(readTool, input);
  assert.match(result(readTool, input, memory ? render(next) : next).content.at(-1)!.text, /proposal_ready=false/);
  assert.equal(call(tool, { ...mutation, content: '{"revision":6}' })?.block, true);
 }
 for (const store of ["openspec", "engram", "both"]) {
  for (const bad of ["missing", "malformed", "revision", "digest", "header", "body", "worktree"]) {
   gentleAgents(pi as never, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: JSON.stringify(active), JERO_PI_RESEARCH_ARTIFACT: JSON.stringify({ ...scope, store, locators: [{ ...locator, path: store === "engram" ? undefined : locator.path, engram: store === "openspec" ? undefined : locator.engram }] }) });
   const memory = store !== "openspec";
   const tool = memory ? "mem_read" : "read";
   const input = memory ? readInput : { path: locator.path };
   if (store === "both") {
    call("read", { path: locator.path });
    result("read", { path: locator.path }, bytes);
    assert.equal(call("write", { path: locator.path, content: next })?.block, true, "both initial stores must match before either mutation");
   }
   if (bad !== "missing") {
    const body = bad === "revision" ? '{"revision":0}' : bad === "digest" ? '{"revision":1,"different":true}' : bytes;
    const content = bad === "header" ? "loaded 2026-01-01T00:00:00.000Z" + String.fromCharCode(10) + String.fromCharCode(10) + bytes : bad === "body" ? render(bytes) + " " : memory ? render(body) : body;
    if (bad === "worktree") {
     assert.equal((hooks.get("tool_call")!({ toolName: tool, input, toolCallId: "c" }, { cwd: root }) as { block: boolean }).block, true);
    } else {
     call(tool, input);
     assert.equal(result(tool, input, bad === "malformed" ? "{" : content).isError, true);
    }
   }
   if (store !== "engram") assert.equal(call("write", { path: locator.path, content: next })?.block, true, store + "/" + bad + ": zero writes");
   if (memory) assert.equal(call("mem_save", save(next))?.block, true, store + "/" + bad + ": zero saves");
  }
 }
});


test("managed remediation acquires before spawn and finalizes failure without verifier success", async () => {
	const h = fakePi(), runtime = deps(), fixtureHome = join(root, "remediation-home");
	let retainedId: string;
	const spawn = runtime.deps.spawn;
	runtime.deps.spawn = (...args) => {
		const retained = JSON.parse(readFileSync(join(historyDir(fixtureHome), `${retainedId}.json`), "utf8")).task.sddRemediation;
		assert.equal(retained.token, "admitted-fixture"); assert.equal(retained.actorClaimed, true);
		const child = spawn(...args); child.pid = 123; return child; };
	runtime.deps.process = { platform: "win32", kill() {} };
	mkdirSync(join(fixtureHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(fixtureHome, ".pi", "agent", "agents", "sdd-remediate.md"), readFileSync("assets/agents/sdd-remediate.md"));
	const revision = `sha256:${"a".repeat(64)}`, calls = [];
	const nativeSdd = { sddStatus: async () => ({ schemaName: "gentle-ai.sdd-status", schemaVersion: 2, changeName: "alpha", artifactStore: "openspec", planningHome: { mode: "repo-local", path: join(cwd, "openspec") }, changeRoot: join(cwd, "openspec/changes/alpha"), actionContext: { mode: "repo-local", workspaceRoot: cwd, allowedEditRoots: [cwd] }, dependencies: Object.fromEntries(["proposal", "specs", "design", "tasks", "apply", "verify", "archive"].map(key => [key, "ready"])), phaseInstructions: { apply: [], verify: [], remediate: ["Correct evidence"], archive: [] }, blockedReasons: [], nextRecommended: "remediate", remediationState: { required: true, complete: false, failedEvidenceRevision: revision } }), sddAttemptAcquire: async input => { assert.equal(runtime.spawned.length, 0); const [saved] = await loadHistory(historyDir(fixtureHome)); retainedId = saved.task.id; assert.deepEqual(saved.task.sddRemediation.acquire, input); assert.equal(saved.task.sddRemediation.token, undefined); calls.push(input); return { state: "proceed", token: "admitted-fixture" }; }, sddAttemptSettle: async input => { calls.push(input); return { state: "proceed" as const }; } } as unknown as NativeReviewCli;
	gentleAgents(h.pi, {}, { ...runtime.deps, home: fixtureHome, nativeSdd });
	const { ctx } = fakeContext(); await h.fire("session_start", ctx);
	const result = await h.tools.get("subagent_run").execute("run", { agent: "sdd-remediate", task: "Correct alpha", context: PARENT_CONFIRMED_SDD_CONTEXT, mode: "background", sdd_change: { changeName: "alpha", workspaceRoot: cwd, phase: "remediate", failedEvidenceRevision: revision }, remediation: { attempt: { requestId: "one", workUnit: "correct", evidenceGoal: "Observed correction", maxAttempts: 1, maxChangedLines: 200 }, plan: { cwd, commands: ["pnpm test"], runtimeHarness: { naReason: "Not applicable because this fixture has no runtime boundary." }, rollback: { boundary: "Revert fixture bytes", command: "git diff --check" } } } }, undefined, undefined, ctx);
	await tick(); assert.equal(runtime.spawned.length, 1, result.content[0].text);
	assert.equal(calls[0].remediatesEvidenceRevision, revision);
	runtime.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "All tests passed, trust me" }], stopReason: "stop" }] });
	runtime.children[0].emit({ type: "agent_settled" });
	for (let n = 0; n < 30 && calls.length < 2; n++) await new Promise(resolve => setTimeout(resolve, 5));
	assert.equal(calls.length, 2); assert.equal(calls[1].outcome, "failed");
	const history = await loadHistory(historyDir(fixtureHome));
	assert.equal(history[0].task.sddRemediation.settle.token, "admitted-fixture");
	assert.equal(history[0].task.status, "failed", "prose-only completion cannot advertise successful correction");
	await h.fire("session_shutdown", ctx);
});


test("only remediation children with the retained exact plan override stock bash", async () => {
	for (const phase of ["apply", "remediate"]) {
		const h = fakePi(); h.pi.getFlag = () => JSON.stringify({ phase, workspaceRoot: cwd, changeName: "alpha", ...(phase === "remediate" ? { failedEvidenceRevision: `sha256:${"a".repeat(64)}` } : {}) });
		gentleAgents(h.pi, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_SDD_REMEDIATION_PLAN: JSON.stringify({ scope: { cwd, commands: ["pnpm test", "git diff --check"], editPaths: [], allowedEditRoots: [cwd] }, plan: { cwd, commands: ["pnpm test"], runtimeHarness: { naReason: "Not applicable because this fixture has no runtime boundary." }, rollback: { boundary: "Revert fixture bytes", command: "git diff --check" } } }) });
		await h.fire("session_start", { ...fakeContext().ctx, cwd });
		assert.equal(h.tools.has("bash"), phase === "remediate");
		assert.equal(h.tools.has("subagent_run"), false);
	}
});


test("managed remediation tools publish the typed exact evidence plan and bracket input", () => {
	const h = fakePi(); gentleAgents(h.pi, {}, deps().deps);
	for (const name of ["subagent_run", "subagent_continue"]) {
		const schema = h.tools.get(name)!.parameters.properties.remediation as unknown as { required: string[]; properties: { plan: { required: string[] }; attempt: { properties: { token: unknown } } } };
		assert.deepEqual(schema.required, ["plan", "attempt"]);
		assert.deepEqual(schema.properties.plan.required, ["cwd", "commands", "runtimeHarness", "rollback"]);
		assert.ok(schema.properties.attempt.properties.token);
	}
});


test("R1 malformed child grant denies tools even before/after failed session initialization", () => {
	const hooks = new Map(), registered = [];
	const pi = { on: (name, fn) => hooks.set(name, fn), registerTool: tool => registered.push(tool), getFlag: () => "{}" };
	gentleAgents(pi as never, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_SDD_REMEDIATION_PLAN: "malformed" });
	const denied = () => hooks.get("tool_call")?.({ toolName: "bash", input: { command: "touch outside" } }, { cwd })?.block;
	assert.equal(denied(), true);
	assert.doesNotThrow(() => hooks.get("session_start")({}, { cwd }));
	assert.equal(denied(), true); assert.equal(registered.length, 0);
});


test("public reconciliation replays retained authority, persists closure, and never exposes or starts the actor", async () => {
	const fixtureHome = join(root, "remediation-reconcile");
	const acquire = { workspaceRoot: cwd, changeName: "alpha", requestId: "retained-acquire", workUnit: "correct", evidenceGoal: "Observed correction", remediatesEvidenceRevision: `sha256:${"a".repeat(64)}` };
	await saveTask(historyDir(fixtureHome), { id: "retained", agent: "sdd-remediate", cwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireUncertain: true } } as never, emptyThread());
	const h = fakePi(), runtime = deps(), calls = [];
	gentleAgents(h.pi, {}, { ...runtime.deps, home: fixtureHome, nativeSdd: {
		sddAttemptAcquire: async input => { calls.push(["acquire", structuredClone(input)]); return { state: "proceed", token: "private-token" }; },
		sddAttemptSettle: async input => { calls.push(["settle", structuredClone(input)]); return { state: "complete" }; },
	} as unknown as NativeReviewCli });
	const { ctx } = fakeContext(); await h.fire("session_start", ctx);
	const output = await h.tools.get("subagent_reconcile").execute("reconcile", { task_id: "retained" }, undefined, undefined, ctx);
	assert.match(output.content[0].text, /reconciled/i);
	assert.equal(JSON.stringify(output).includes("private-token"), false);
	assert.deepEqual(calls[0], ["acquire", acquire]); assert.equal(calls[1][0], "settle");
	assert.equal(runtime.spawned.length, 0);
	const retained = (await loadHistory(historyDir(fixtureHome)))[0].task;
	assert.equal(retained.sddRemediation.acquireUncertain, undefined);
	assert.deepEqual(retained.sddRemediation.settlement, { state: "complete" });
});

test("durable reconciliation locks serialize independent extension instances sharing one tasksDir", async () => {
	const fixtureHome = join(root, "remediation-reconcile-independent");
	const id = "retained-independent";
	const acquire = { workspaceRoot: cwd, changeName: "alpha", requestId: id, workUnit: "correct", evidenceGoal: "Observed correction" };
	await saveTask(historyDir(fixtureHome), { id, agent: "sdd-remediate", cwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireUncertain: true } } as never, emptyThread());
	const first = fakePi(), second = fakePi(), runtime = deps();
	let calls = 0, release!: (result: { state: "blocked" }) => void;
	const pending = new Promise<{ state: "blocked" }>(resolve => { release = resolve; });
	const native = { sddAttemptAcquire: async () => { calls++; return calls === 1 ? pending : { state: "blocked" }; } } as unknown as NativeReviewCli;
	gentleAgents(first.pi, {}, { ...runtime.deps, home: fixtureHome, nativeSdd: native });
	gentleAgents(second.pi, {}, { ...runtime.deps, home: fixtureHome, nativeSdd: native });
	const firstContext = fakeContext(), secondContext = fakeContext();
	await first.fire("session_start", firstContext.ctx); await second.fire("session_start", secondContext.ctx);
	const running = first.tools.get("subagent_reconcile")!.execute("first", { task_id: id }, undefined, undefined, firstContext.ctx);
	await eventually(() => calls === 1, "the first instance must reach native acquire while holding the lock");
	await assert.rejects(second.tools.get("subagent_reconcile")!.execute("second", { task_id: id }, undefined, undefined, secondContext.ctx), /busy|active|already being reconciled/i);
	assert.equal(calls, 1, "a busy filesystem lock fails before native acquire");
	release({ state: "blocked" }); await running;
	await first.fire("session_shutdown", firstContext.ctx); await second.fire("session_shutdown", secondContext.ctx);
});

test("reconciliation reloads a stale local task and preserves the retained disk thread", async () => {
	const fixtureHome = join(root, "remediation-reconcile-reload");
	const id = "retained-reload";
	const oldAcquire = { workspaceRoot: cwd, changeName: "alpha", requestId: "old", workUnit: "old", evidenceGoal: "old" };
	const freshAcquire = { workspaceRoot: cwd, changeName: "alpha", requestId: "fresh", workUnit: "fresh", evidenceGoal: "fresh" };
	await saveTask(historyDir(fixtureHome), { id, agent: "sdd-remediate", cwd, status: "failed", createdAt: 1, sddRemediation: { acquire: oldAcquire, acquireUncertain: true } } as never, applyTaskEvent(emptyThread(), { type: TASK_EVENT.NOTE, text: "old thread" }));
	const h = fakePi(), runtime = deps(), seen: unknown[] = [];
	gentleAgents(h.pi, {}, { ...runtime.deps, home: fixtureHome, nativeSdd: { sddAttemptAcquire: async input => { seen.push(structuredClone(input)); return { state: "blocked" }; } } as unknown as NativeReviewCli });
	const { ctx } = fakeContext(); await h.fire("session_start", ctx);
	await h.tools.get("subagent_status")!.execute("status", { task_id: id }, undefined, undefined, ctx);
	const freshThread = applyTaskEvent(emptyThread(), { type: TASK_EVENT.NOTE, text: "fresh thread" });
	await saveTask(historyDir(fixtureHome), { id, agent: "sdd-remediate", cwd, status: "failed", createdAt: 1, sddRemediation: { acquire: freshAcquire, acquireUncertain: true } } as never, freshThread);
	await h.tools.get("subagent_reconcile")!.execute("reconcile", { task_id: id }, undefined, undefined, ctx);
	assert.deepEqual(seen, [freshAcquire], "native receives the force-reloaded retained request");
	const stored = (await loadHistory(historyDir(fixtureHome))).find(entry => entry.task.id === id)!;
	assert.deepEqual(stored.thread.items, freshThread.items, "persistence retains the exact disk thread, not the stale store thread");
	await h.fire("session_shutdown", ctx);
});

test("reconciliation releases the durable lock after native failure", async () => {
	const fixtureHome = join(root, "remediation-reconcile-failure");
	const id = "retained-failure";
	const acquire = { workspaceRoot: cwd, changeName: "alpha", requestId: id, workUnit: "correct", evidenceGoal: "Observed correction" };
	await saveTask(historyDir(fixtureHome), { id, agent: "sdd-remediate", cwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireUncertain: true } } as never, emptyThread());
	const h = fakePi(), runtime = deps(); let calls = 0;
	gentleAgents(h.pi, {}, { ...runtime.deps, home: fixtureHome, nativeSdd: { sddAttemptAcquire: async () => { calls++; if (calls === 1) throw new TypeError("native failure"); return { state: "blocked" }; } } as unknown as NativeReviewCli });
	const { ctx } = fakeContext(); await h.fire("session_start", ctx);
	await assert.rejects(h.tools.get("subagent_reconcile")!.execute("failed", { task_id: id }, undefined, undefined, ctx), /native failure/);
	const recovered = await h.tools.get("subagent_reconcile")!.execute("retry", { task_id: id }, undefined, undefined, ctx);
	assert.match(recovered.content[0].text, /reconciled/i);
	assert.equal(calls, 2, "the second attempt acquires after finally released the first lock");
	await h.fire("session_shutdown", ctx);
});

test("R3/R4 host reload refuses retained acquire/actor uncertainty without another launch", async () => {
	for (const actorClaimed of [false, true, "blocked", "complete"]) {
		const normal = typeof actorClaimed === "string";
		const h = fakePi(), runtime = deps(), fixtureHome = join(root, `remediation-reload-${actorClaimed}`);
		mkdirSync(join(fixtureHome, ".pi", "agent", "agents"), { recursive: true });
		writeFileSync(join(fixtureHome, ".pi", "agent", "agents", "sdd-remediate.md"), readFileSync("assets/agents/sdd-remediate.md"));
		const revision = `sha256:${"a".repeat(64)}`;
		const acquire = { workspaceRoot: cwd, changeName: "alpha", requestId: "retained", workUnit: "correct", evidenceGoal: "Observed correction", remediatesEvidenceRevision: revision };
		await saveTask(historyDir(fixtureHome), { id: "retained", agent: "sdd-remediate", cwd, status: "failed", createdAt: 1, sddRemediation: { acquire, acquireUncertain: normal ? false : !actorClaimed, actorClaimed: normal ? false : actorClaimed, ...(normal ? { acquireResult: { state: actorClaimed } } : actorClaimed ? { token: "retained-token" } : {}) } } as never, emptyThread());
		let acquisitions = 0, confirmations = 0;
		gentleAgents(h.pi, {}, { ...runtime.deps, home: fixtureHome, nativeSdd: { sddStatus: async () => { throw new Error("fresh status reached"); }, sddAttemptSettle: async () => ({ state: "proceed" as const }), sddAttemptAcquire: async () => { acquisitions++; return { state: "proceed", token: "unsafe" }; } } as unknown as NativeReviewCli });
		const { ctx } = fakeContext(fakeTui, async () => { confirmations++; return true; });
		await h.fire("session_start", ctx);
		await assert.rejects(h.tools.get("subagent_run").execute("again", { agent: "sdd-remediate", task: "Correct alpha", context: PARENT_CONFIRMED_SDD_CONTEXT, mode: "background", sdd_change: { changeName: "alpha", workspaceRoot: cwd, phase: "remediate", failedEvidenceRevision: revision }, remediation: { attempt: { ...acquire, requestId: "different" }, plan: { cwd, commands: ["pnpm test"], runtimeHarness: { naReason: "Not applicable because this fixture has no runtime boundary." }, rollback: { boundary: "Revert fixture", command: "git diff --check" } } } }, undefined, undefined, ctx), normal ? /fresh status reached/ : /reconcile exact history without actor replay/);
		assert.equal(acquisitions, 0); assert.equal(confirmations, 0); assert.equal(runtime.spawned.length, 0);
		assert.deepEqual((await loadHistory(historyDir(fixtureHome)))[0].task.sddRemediation.acquire, acquire);
		await h.fire("session_shutdown", ctx);
	}
});

test("R3/R4 a known native-blocked settlement lets native admission decide the next attempt; an uncertain one still refuses locally", async () => {
	for (const uncertain of [false, true]) {
		const h = fakePi(), runtime = deps(), fixtureHome = join(root, `remediation-settlement-${uncertain}`);
		mkdirSync(join(fixtureHome, ".pi", "agent", "agents"), { recursive: true });
		writeFileSync(join(fixtureHome, ".pi", "agent", "agents", "sdd-remediate.md"), readFileSync("assets/agents/sdd-remediate.md"));
		const revision = `sha256:${"a".repeat(64)}`;
		const acquire = { workspaceRoot: cwd, changeName: "alpha", requestId: "retained", workUnit: "correct", evidenceGoal: "Observed correction", remediatesEvidenceRevision: revision };
		await saveTask(historyDir(fixtureHome), { id: "retained", agent: "sdd-remediate", cwd, status: "failed", createdAt: 1, sddRemediation: uncertain
			? { acquire, settlementUncertain: true, settle: { requestId: "exact" } }
			: { acquire, settlement: { state: "blocked", reason: "maintainer_decision" } } } as never, emptyThread());
		let acquisitions = 0, confirmations = 0;
		gentleAgents(h.pi, {}, { ...runtime.deps, home: fixtureHome, nativeSdd: { sddStatus: async () => ({ schemaName: "gentle-ai.sdd-status", schemaVersion: 2, changeName: "alpha", artifactStore: "openspec", planningHome: { mode: "repo-local", path: join(cwd, "openspec") }, changeRoot: join(cwd, "openspec/changes/alpha"), actionContext: { mode: "repo-local", workspaceRoot: cwd, allowedEditRoots: [cwd] }, dependencies: Object.fromEntries(["proposal", "specs", "design", "tasks", "apply", "verify", "archive"].map(key => [key, "ready"])), phaseInstructions: { apply: [], verify: [], remediate: ["Correct evidence"], archive: [] }, blockedReasons: [], nextRecommended: "remediate", remediationState: { required: true, complete: false, failedEvidenceRevision: revision } }), sddAttemptSettle: async () => ({ state: "proceed" as const }), sddAttemptAcquire: async () => { acquisitions++; return { state: "blocked" }; } } as unknown as NativeReviewCli });
		const { ctx } = fakeContext(fakeTui, async () => { confirmations++; return true; });
		await h.fire("session_start", ctx);
		await assert.rejects(h.tools.get("subagent_run").execute("again", { agent: "sdd-remediate", task: "Correct alpha", context: PARENT_CONFIRMED_SDD_CONTEXT, mode: "background", sdd_change: { changeName: "alpha", workspaceRoot: cwd, phase: "remediate", failedEvidenceRevision: revision }, remediation: { attempt: { ...acquire, requestId: "different" }, plan: { cwd, commands: ["pnpm test"], runtimeHarness: { naReason: "Not applicable because this fixture has no runtime boundary." }, rollback: { boundary: "Revert fixture", command: "git diff --check" } } } }, undefined, undefined, ctx), uncertain ? /reconcile exact history without actor replay/ : /no actor started/);
		assert.equal(acquisitions, uncertain ? 0 : 1, "native admission is consulted once local unresolved history is not uncertain");
		assert.equal(confirmations, uncertain ? 0 : 1);
		assert.equal(runtime.spawned.length, 0);
		await h.fire("session_shutdown", ctx);
	}
});

test("remediation child registers the bash-result forwarder once across session_start replays", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "jero-rem-forwarder-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const handlers = new Map<string, Array<(payload: unknown, ctx: ExtensionContext) => unknown>>();
	const tools = new Map<string, { name: string }>();
	const pi = {
		on: (event: string, handler: (payload: unknown, ctx: ExtensionContext) => unknown) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
		registerTool: (tool: { name: string }) => { tools.set(tool.name, tool); },
	} as unknown as ExtensionAPI;
	const selection = { changeName: "fix-auth", workspaceRoot: dir, phase: "remediate", failedEvidenceRevision: `sha256:${"a".repeat(64)}` };
	const plan = { cwd: dir, commands: ["pytest -q"], rollback: { boundary: "git reset --hard", command: "git reset --hard" }, runtimeHarness: { command: "pytest -q" } };
	const scope = { commands: ["pytest -q", "pytest -q", "git reset --hard"], editPaths: [] };
	gentleAgents(pi, {
		JERO_PI_AGENTS_CHILD: "1",
		JERO_PI_SDD_REMEDIATION_PLAN: JSON.stringify({ selection, plan, scope }),
	});
	const ctx = { cwd: dir } as ExtensionContext;
	const starts = handlers.get("session_start") ?? [];
	assert.equal(starts.length, 1);
	await starts[0]({}, ctx);
	await starts[0]({}, ctx); // resume/reload replays the session boundary
	assert.equal(handlers.get("tool_result")?.length, 1, "the bash forwarder must not accumulate across session_start replays");
	assert.ok(tools.has("bash"), "the remediation bash tool is registered from the grant");
});

