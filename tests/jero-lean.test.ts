// 精益纪律（lean discipline）单元测试：模式解析、会话条目回放、
// 分档指令块、命令参数解析、停用短语，以及技能文件与 lib 指令块的
// 关键字对齐（防漂移，check-rule-copies 同款哲学）。
// 集成面只覆盖扩展的两条注入路径（命令处理器 + before_agent_start），
// 用最小 fake pi 主机驱动，不拉起真实会话。

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createJeroAiExtension } from "../extensions/jero-ai.ts";
import {
	getLeanInstructions, isLeanDeactivationText, isValidLeanMode, isValidLeanModeEntry,
	LEAN_DEFAULT_MODE, LEAN_MODE_ENTRY_TYPE, LEAN_MODE_ENV, LEAN_MODES,
	parseLeanCommand, resolveEffectiveLeanMode, resolveLeanModeFromBranch,
	renderLeanStatusLine, type LeanBranchEntry, leanModeFromEnv,
} from "../lib/jero-ai-lean.ts";

const repoRoot = join(import.meta.dirname, "..");

// ---------------------------------------------------------------------------
// 纯函数：模式与条目校验
// ---------------------------------------------------------------------------

test("isValidLeanMode accepts exactly the four runtime modes", () => {
	assert.deepEqual([...LEAN_MODES], ["off", "lite", "full", "ultra"]);
	for (const mode of LEAN_MODES) assert.equal(isValidLeanMode(mode), true);
	assert.equal(isValidLeanMode("review"), false);
	assert.equal(isValidLeanMode("FULL"), false);
	assert.equal(isValidLeanMode(""), false);
	assert.equal(isValidLeanMode(undefined), false);
	assert.equal(isValidLeanMode(42), false);
});

test("isValidLeanModeEntry enforces the exact single-key shape", () => {
	assert.equal(isValidLeanModeEntry({ mode: "full" }), true);
	assert.equal(isValidLeanModeEntry({ mode: "off" }), true);
	assert.equal(isValidLeanModeEntry({ mode: "bogus" }), false);
	// 未来字段演进必须换新条目类型；携带多余键的条目按畸形忽略。
	assert.equal(isValidLeanModeEntry({ mode: "full", source: "test" }), false);
	assert.equal(isValidLeanModeEntry({}), false);
	assert.equal(isValidLeanModeEntry(null), false);
	assert.equal(isValidLeanModeEntry("full"), false);
	assert.equal(isValidLeanModeEntry(["full"]), false);
});

// ---------------------------------------------------------------------------
// 纯函数：会话条目倒序回放与优先级
// ---------------------------------------------------------------------------

const entry = (mode: string, data: unknown = { mode }): LeanBranchEntry =>
	({ type: "custom", customType: LEAN_MODE_ENTRY_TYPE, data: data === undefined ? undefined : (typeof data === "string" ? { mode: data } : data) });

test("resolveLeanModeFromBranch returns undefined for an empty or lean-free branch", () => {
	assert.equal(resolveLeanModeFromBranch([]), undefined);
	assert.equal(
		resolveLeanModeFromBranch([
			{ type: "custom", customType: "jero.lean-mode/v0", data: { mode: "ultra" } },
			{ type: "message", data: {} },
		]),
		undefined,
	);
});

test("resolveLeanModeFromBranch: the latest valid entry wins; malformed entries are skipped", () => {
	const branch: LeanBranchEntry[] = [
		entry("lite"),
		{ type: "custom", customType: LEAN_MODE_ENTRY_TYPE, data: { mode: "bogus" } },
		{ type: "custom", customType: LEAN_MODE_ENTRY_TYPE, data: { mode: "ultra", extra: 1 } },
		entry("full"),
	];
	assert.equal(resolveLeanModeFromBranch(branch), "full");
});

test("resolveEffectiveLeanMode: session entry > env > default; invalid env fails closed to default", () => {
	const fullEnv: Record<string, string | undefined> = { [LEAN_MODE_ENV]: "ultra" };
	const invalidEnv: Record<string, string | undefined> = { [LEAN_MODE_ENV]: "maximum" };
	assert.equal(resolveEffectiveLeanMode([entry("lite")], fullEnv), "lite");
	assert.equal(resolveEffectiveLeanMode([], fullEnv), "ultra");
	assert.equal(resolveEffectiveLeanMode([], invalidEnv), LEAN_DEFAULT_MODE);
	assert.equal(resolveEffectiveLeanMode([], {}), LEAN_DEFAULT_MODE);
	assert.equal(resolveEffectiveLeanMode([]), LEAN_DEFAULT_MODE);
	assert.equal(LEAN_DEFAULT_MODE, "full");
	assert.equal(leanModeFromEnv(fullEnv), "ultra");
	assert.equal(leanModeFromEnv(invalidEnv), undefined);
});

// ---------------------------------------------------------------------------
// 纯函数：命令参数解析与停用短语
// ---------------------------------------------------------------------------

test("parseLeanCommand accepts empty/status/modes and rejects everything else", () => {
	assert.deepEqual(parseLeanCommand(""), { kind: "status" });
	assert.deepEqual(parseLeanCommand("  status \t"), { kind: "status" });
	assert.deepEqual(parseLeanCommand(" ULTRA "), { kind: "set", mode: "ultra" });
	assert.deepEqual(parseLeanCommand("off"), { kind: "set", mode: "off" });
	assert.deepEqual(parseLeanCommand("lite"), { kind: "set", mode: "lite" });
	assert.deepEqual(parseLeanCommand("full"), { kind: "set", mode: "full" });
	const invalid = parseLeanCommand("maximum");
	assert.equal(invalid.kind, "invalid");
	assert.match((invalid as { reason: string }).reason, /maximum/);
});

test("isLeanDeactivationText only matches the standalone 'stop lean' phrase", () => {
	assert.equal(isLeanDeactivationText("stop lean"), true);
	assert.equal(isLeanDeactivationText("  STOP LEAN! "), true);
	assert.equal(isLeanDeactivationText("Stop lean."), true);
	// 绝不做子串匹配：任务文本里提到停用短语绝不能关闭纪律。
	assert.equal(isLeanDeactivationText("please stop lean mode"), false);
	assert.equal(isLeanDeactivationText("add a stop lean toggle"), false);
	assert.equal(isLeanDeactivationText(""), false);
	assert.equal(isLeanDeactivationText("正常模式"), false);
});

test("renderLeanStatusLine mirrors the RDD status-line shape", () => {
	assert.equal(renderLeanStatusLine("full"), "Lean discipline: full");
	assert.equal(renderLeanStatusLine("off"), "Lean discipline: off");
});

// ---------------------------------------------------------------------------
// 分档指令块
// ---------------------------------------------------------------------------

test("getLeanInstructions('off') is empty so the extension injects nothing", () => {
	assert.equal(getLeanInstructions("off"), "");
});

const LADDER_PROBE = "停在第一个成立的横档上";
const NEVER_CUT_PROBE = "绝不简化掉";
// ultra 专属行（"删除优先于新增"本身是 full 规则的一部分，不能作探针）。
const ULTRA_PROBE = "YAGNI 极端主义";

test("full instructions carry the ladder, never-cut list, marker convention and budget orthogonality", () => {
	const full = getLeanInstructions("full");
	for (const probe of [LADDER_PROBE, NEVER_CUT_PROBE, "jero:", "ceiling:", "upgrade:", "YAGNI", "400 行评审预算正交", "skipped: X, add when Y"]) {
		assert.ok(full.includes(probe), `full instructions must mention ${probe}`);
	}
	assert.ok(!full.includes(ULTRA_PROBE), "full must not carry the ultra-only line");
	assert.ok(!full.includes("lean: lite"));
});

test("ultra adds the deletion-first line; lite stays minimal and never cuts", () => {
	const ultra = getLeanInstructions("ultra");
	assert.ok(ultra.includes(LADDER_PROBE));
	assert.ok(ultra.includes(ULTRA_PROBE));
	assert.ok(ultra.includes(NEVER_CUT_PROBE), "ultra keeps the never-cut guard");
	const lite = getLeanInstructions("lite");
	assert.ok(lite.includes("更精简的替代方案"));
	assert.ok(!lite.includes(LADDER_PROBE), "lite does not enforce the ladder");
	assert.ok(!lite.includes(ULTRA_PROBE));
});

// ---------------------------------------------------------------------------
// 扩展集成：/jero:lean 命令与 before_agent_start 注入
// ---------------------------------------------------------------------------

interface FakePi {
	handlers: Map<string, (event: any, ctx: any) => any>;
	commands: Map<string, { description: string; handler: (args: string, ctx: any) => void }>;
	branch: LeanBranchEntry[];
}

function makeFakePi(env: Record<string, string | undefined> = {}): FakePi {
	const fake: FakePi = { handlers: new Map(), commands: new Map(), branch: [] };
	const pi = {
		on(name: string, handler: (event: any, ctx: any) => any) {
			fake.handlers.set(name, handler);
		},
		registerCommand(name: string, options: { description: string; handler: (args: string, ctx: any) => void }) {
			fake.commands.set(name, options);
		},
		registerTool() {},
		registerFlag() {},
		appendEntry(customType: string, data: unknown) {
			fake.branch.push({ type: "custom", customType, data });
		},
		getActiveTools: () => [],
		getAllTools: () => [],
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null, processEnv: env })(pi);
	return fake;
}

function makeCtx(fake: FakePi, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		cwd: mkdtempSync(join(tmpdir(), "jero-lean-test-")),
		hasUI: false,
		mode: "interactive",
		sessionManager: { getBranch: () => fake.branch },
		...overrides,
	};
}

const scratchRoots: string[] = [];

after(() => {
	for (const dir of scratchRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function trackedCtx(fake: FakePi): Record<string, unknown> {
	const ctx = makeCtx(fake);
	scratchRoots.push(ctx.cwd as string);
	return ctx;
}

test("jero:lean command sets a session entry and reports status", () => {
	const fake = makeFakePi();
	const command = fake.commands.get("jero:lean");
	assert.ok(command, "jero:lean command must be registered");
	const ctx = trackedCtx(fake);
	const notifications: string[] = [];
	const ctxWithUi = { ...ctx, hasUI: true, ui: { notify: (text: string) => notifications.push(text) } };

	command.handler("ultra", ctxWithUi);
	assert.equal(fake.branch.at(-1)?.customType, LEAN_MODE_ENTRY_TYPE);
	assert.deepEqual(fake.branch.at(-1)?.data, { mode: "ultra" });
	assert.match(notifications.at(-1)!, /ultra/);

	command.handler("status", ctxWithUi);
	assert.match(notifications.at(-1)!, /Lean discipline: ultra/);

	command.handler("nonsense", ctxWithUi);
	assert.match(notifications.at(-1)!, /未知的 lean 档位/);
	assert.equal(fake.branch.length, 1, "invalid input must not write an entry");
});

test("before_agent_start injects the lean block for the main session and honours off", async () => {
	const fake = makeFakePi();
	const handler = fake.handlers.get("before_agent_start");
	assert.ok(handler, "before_agent_start handler must be registered");
	const ctx = trackedCtx(fake);

	// 默认档 full：注入梯子。
	const withDefault = await handler({ systemPrompt: "BASE" }, ctx);
	assert.ok(typeof withDefault?.systemPrompt === "string");
	assert.ok(withDefault.systemPrompt.startsWith("BASE"));
	assert.ok(withDefault.systemPrompt.includes(LADDER_PROBE), "default mode must inject the ladder");

	// off：不注入任何精益文本。会话条目 off 与 JERO_PI_LEAN_MODE=off
	// 的无条目基线逐字节一致（无悬挂空白，还原历史行为）。
	const envOffFake = makeFakePi({ [LEAN_MODE_ENV]: "off" });
	const envOffCtx = trackedCtx(envOffFake);
	const baseline = await envOffFake.handlers.get("before_agent_start")!({ systemPrompt: "BASE" }, envOffCtx);
	assert.ok(!baseline.systemPrompt.includes(LADDER_PROBE), "env-off baseline must not inject the ladder");
	fake.branch.push(entry("off"));
	const withOff = await handler({ systemPrompt: "BASE" }, ctx);
	assert.equal(withOff.systemPrompt, baseline.systemPrompt);
	assert.ok(!withOff.systemPrompt.includes("精益纪律"), "off must not inject the lean block");

	// 会话条目切换到 ultra：下次代理启动即生效，无需 /reload。
	fake.branch.push(entry("ultra"));
	const withUltra = await handler({ systemPrompt: "BASE" }, ctx);
	assert.ok(withUltra.systemPrompt.includes(ULTRA_PROBE));
});

test("before_agent_start never injects lean into named/SDD agents", async () => {
	const fake = makeFakePi();
	const handler = fake.handlers.get("before_agent_start")!;
	const ctx = trackedCtx(fake);
	const named = await handler({ systemPrompt: "BASE", agentName: "jero-worker" }, ctx);
	assert.equal(named.systemPrompt.includes(LADDER_PROBE), false);
});

test("input handler turns the standalone stop-lean phrase into an off entry and swallows the turn", async () => {
	const fake = makeFakePi();
	const input = fake.handlers.get("input");
	assert.ok(input, "input handler must be registered");
	const ctx = trackedCtx(fake);
	const notifications: string[] = [];
	const ctxWithUi = { ...ctx, hasUI: true, ui: { notify: (text: string) => notifications.push(text) } };

	assert.deepEqual(
		await input({ text: "  Stop lean. ", source: "interactive" }, ctxWithUi),
		{ action: "handled" },
	);
	assert.deepEqual(fake.branch.at(-1)?.data, { mode: "off" });
	assert.match(notifications.at(-1)!, /已关闭/);

	// 非停用文本原样放行，绝不写入条目（"/sdd" 归 SDD 预检所有，不在本测）。
	assert.deepEqual(await input({ text: "please stop lean mode" }, ctxWithUi), { action: "continue" });
	assert.deepEqual(await input({ text: "hello world" }, ctxWithUi), { action: "continue" });
	assert.equal(fake.branch.length, 1);
});

test("jero:status reports the effective lean mode", async () => {
	const fake = makeFakePi();
	const status = fake.commands.get("jero:status");
	assert.ok(status, "jero:status command must be registered");
	const ctx = trackedCtx(fake);
	const notifications: string[] = [];
	await status.handler("", { ...ctx, hasUI: true, ui: { notify: (text: string) => notifications.push(text) } });
	assert.match(notifications.at(-1)!, /Lean discipline: full .*\/jero:lean/);
});

test("jero:doctor reports the lean mode as an informational line", async () => {
	const fake = makeFakePi();
	const doctor = fake.commands.get("jero:doctor");
	assert.ok(doctor, "jero:doctor command must be registered");
	const ctx = trackedCtx(fake);
	const notifications: string[] = [];
	await doctor.handler("", { ...ctx, hasUI: true, ui: { notify: (text: string) => notifications.push(text) } });
	const report = notifications.at(-1)!;
	assert.match(report, /Lean discipline full/);
	// info 行不参与 doctor 的 pass/warn 告警级别判定。
	assert.ok(!report.includes("warn: Lean") && !report.includes("fail: Lean"));
});

// ---------------------------------------------------------------------------
// 技能文件与 lib 指令块的对齐（防漂移）
// ---------------------------------------------------------------------------

function readSkill(dir: string): string {
	return readFileSync(join(repoRoot, "skills", dir, "SKILL.md"), "utf8");
}

test("jero-lean skill keeps the ladder, never-cut list and marker convention aligned with the lib block", () => {
	const skill = readSkill("jero-lean");
	assert.match(skill, /^---\nname: jero-lean\n/);
	for (const probe of [LADDER_PROBE, NEVER_CUT_PROBE, "jero:", "ceiling:", "upgrade:", "YAGNI", "stop lean", "off", "lite", "full", "ultra"]) {
		assert.ok(skill.includes(probe), `skills/jero-lean must mention ${probe}`);
	}
});

test("jero-lean-review skill keeps the tag vocabulary and score line", () => {
	const skill = readSkill("jero-lean-review");
	assert.match(skill, /^---\nname: jero-lean-review\n/);
	for (const probe of ["delete:", "stdlib:", "native:", "yagni:", "shrink:", "net: -<N> lines possible.", "Lean already. Ship.", "jero_review"]) {
		assert.ok(skill.includes(probe), `skills/jero-lean-review must mention ${probe}`);
	}
});

test("jero-debt skill keeps the ledger format and no-trigger tag", () => {
	const skill = readSkill("jero-debt");
	assert.match(skill, /^---\nname: jero-debt\n/);
	for (const probe of ["jero:", "ceiling:", "upgrade:", "no-trigger", "JERO-DEBT.md"]) {
		assert.ok(skill.includes(probe), `skills/jero-debt must mention ${probe}`);
	}
});
