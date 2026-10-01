import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../extensions/module-verify.ts";

// module-verify 扩展壳测试：管线逻辑在 lib（module-verify-pipeline.test.ts），
// 这里测生命周期装配——命令注册、session_start 的延后刷新与陈旧覆盖层清理、
// 汇总文案。宿主以最小假 API 注入。

type Handler = (event: unknown, ctx: unknown) => void | Promise<void>;

function fakePi() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, { description: string; handler: Handler }>();
	const pi = {
		on(name: string, callback: Handler) {
			handlers.set(name, callback);
			return pi;
		},
		registerCommand(name: string, definition: { description: string; handler: Handler }) {
			commands.set(name, definition);
			return pi;
		},
	};
	return { pi: pi as unknown as Parameters<typeof extension>[0], handlers, commands };
}

function fakeCtx(cwd: string) {
	const notifications: { message: string; level: string }[] = [];
	const ctx = {
		cwd,
		hasUI: true,
		ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
	};
	return { ctx: ctx as unknown as Parameters<Handler>[1], notifications };
}

const flushAsyncWork = async (): Promise<void> => {
	for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

function writeModule(root: string, token: string): void {
	mkdirSync(join(root, token, "knowledge"), { recursive: true });
	writeFileSync(
		join(root, token, "module.json"),
		JSON.stringify({
			schema: "jero.module-contract/v1",
			token,
			version: "1.0.0",
			triggers: { files: ["go.mod"], intents: [] },
			knowledge: { entry: "knowledge/SKILL.md", references: [] },
			roles: [],
			bindings: { worker: { inject: "manifest-only" } },
			routing: [],
		}),
	);
	writeFileSync(join(root, token, "knowledge", "SKILL.md"), "---\nname: x\ndescription: d\n---\n\nbody\n");
}

function makeProject(): string {
	return mkdtempSync(join(tmpdir(), "jero-module-verify-ext-"));
}

// 扩展去重守卫是进程级：同一 import.meta.url 第二次 default() 会被跳过。
// 因此整个文件只装配一次，全部用例共享同一套注册面。
const assembly = fakePi();
extension(assembly.pi);

test("装配面：注册 shutdown/startup 钩子与 jero-module-verify / 安装 / 列表三命令", () => {
	assert.equal(assembly.handlers.size, 2);
	assert.equal(assembly.commands.size, 3);
	assert.ok(assembly.handlers.has("session_shutdown"));
	assert.ok(assembly.handlers.has("session_start"));
	assert.ok(assembly.commands.has("jero-module-verify"));
	assert.ok(assembly.commands.get("jero-module-verify")!.description.length > 0);
	assert.ok(assembly.commands.has("jero:install-module"));
	assert.ok(assembly.commands.has("jero:module-list"));
});

test("命令·无模块：提示 legacy 路径，info 级", async () => {
	const cwd = makeProject();
	try {
		const { ctx, notifications } = fakeCtx(cwd);
		await assembly.commands.get("jero-module-verify")!.handler({}, ctx);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].message, /未发现能力模块/);
		assert.match(notifications[0].message, /legacy 路径/);
		assert.equal(notifications[0].level, "info");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("命令·正常模块：绿项汇总 + 覆盖层落盘", async () => {
	const cwd = makeProject();
	try {
		writeModule(join(cwd, ".pi", "modules"), "gogame");
		writeFileSync(join(cwd, "go.mod"), "");
		const { ctx, notifications } = fakeCtx(cwd);
		await assembly.commands.get("jero-module-verify")!.handler({}, ctx);
		const message = notifications.map((item) => item.message).join("\n");
		assert.match(message, /✓ gogame：\d+ 项通过/);
		assert.match(message, /覆盖层已写入/);
		const overlay = readFileSync(join(cwd, ".atl", "module-overlay.md"), "utf8");
		assert.match(overlay, /gogame/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("命令·坏清单：warning 级 + 解析失败行", async () => {
	const cwd = makeProject();
	try {
		mkdirSync(join(cwd, ".pi", "modules", "broken"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "modules", "broken", "module.json"), "{ 坏掉");
		const { ctx, notifications } = fakeCtx(cwd);
		await assembly.commands.get("jero-module-verify")!.handler({}, ctx);
		assert.equal(notifications[0].level, "warning");
		assert.match(notifications[0].message, /✗ broken：清单解析失败/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("session_start·无模块根 + 残留覆盖层：延后清理", async () => {
	const cwd = makeProject();
	mkdirSync(join(cwd, ".atl"), { recursive: true });
	writeFileSync(join(cwd, ".atl", "module-overlay.md"), "# 陈旧接线");
	try {
		const { ctx } = fakeCtx(cwd);
		await assembly.handlers.get("session_start")!({}, ctx);
		// 重活在 setImmediate 里：刷新事件循环后覆盖层必须已被清掉。
		await flushAsyncWork();
		assert.equal(existsSync(join(cwd, ".atl", "module-overlay.md")), false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("session_start·有模块根：延后重写覆盖层，shutdown 不抛", async () => {
	const cwd = makeProject();
	try {
		writeModule(join(cwd, ".pi", "modules"), "gogame");
		writeFileSync(join(cwd, "go.mod"), "");
		mkdirSync(join(cwd, ".atl"), { recursive: true });
		writeFileSync(join(cwd, ".atl", "module-overlay.md"), "# 陈旧接线");

		const { ctx } = fakeCtx(cwd);
		await assembly.handlers.get("session_start")!({}, ctx);
		await flushAsyncWork();
		const overlay = readFileSync(join(cwd, ".atl", "module-overlay.md"), "utf8");
		assert.doesNotMatch(overlay, /陈旧接线/);
		assert.match(overlay, /gogame/);

		assert.doesNotThrow(() => assembly.handlers.get("session_shutdown")!({}, fakeCtx(cwd).ctx));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("session_start·覆盖层缺失（首次运行）：同步编译，await 返回时已落盘", async () => {
	const cwd = makeProject();
	try {
		writeModule(join(cwd, ".pi", "modules"), "gogame");
		writeFileSync(join(cwd, "go.mod"), "");
		// 不预置覆盖层——首次运行走同步路径，启动后第一次委托无空档。

		const { ctx } = fakeCtx(cwd);
		await assembly.handlers.get("session_start")!({}, ctx);
		// 不 flush：同步路径意味着 handler 返回时覆盖层必须已在磁盘上。
		const overlay = readFileSync(join(cwd, ".atl", "module-overlay.md"), "utf8");
		assert.match(overlay, /gogame/);
		assert.doesNotThrow(() => assembly.handlers.get("session_shutdown")!({}, fakeCtx(cwd).ctx));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("命令·install-module 无参数：用法提示，warning 级", async () => {
	const cwd = makeProject();
	try {
		const { ctx, notifications } = fakeCtx(cwd);
		await assembly.commands.get("jero:install-module")!.handler({}, ctx);
		assert.equal(notifications[0].level, "warning");
		assert.match(notifications[0].message, /用法：\/jero:install-module/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("命令·install-module 未知词元：响亮失败并列出可装词元", async () => {
	const cwd = makeProject();
	try {
		const { ctx, notifications } = fakeCtx(cwd);
		await assembly.commands.get("jero:install-module")!.handler("no-such-module", ctx);
		assert.equal(notifications[0].level, "warning");
		assert.match(notifications[0].message, /未知模块词元：no-such-module/);
		assert.match(notifications[0].message, /godot/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("命令·install-module godot：真实包内束装进项目 + 验证管线联动 + MCP 档自动并入", async () => {
	const cwd = makeProject();
	// MCP 档合并目标隔离：束声明了 godot-ai 档，安装会写 agent mcp.json——
	// 绝不碰真实 home，指到临时 agent home。
	const agentHome = mkdtempSync(join(tmpdir(), "jero-agent-home-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	process.env.JERO_PI_AGENT_HOME = agentHome;
	try {
		// 触发命中样本：godot 束的静态触发器需要仓库里有 project.godot。
		writeFileSync(join(cwd, "project.godot"), "");
		const { ctx, notifications } = fakeCtx(cwd);
		await assembly.commands.get("jero:install-module")!.handler("godot", ctx);
		const message = notifications.map((item) => item.message).join("\n");
		assert.match(message, /\+ 已安装 godot@/);
		// 三类落盘面：模块本体 / 代理 / 技能 + 安装记录。
		assert.ok(existsSync(join(cwd, ".pi", "modules", "godot", "module.json")));
		assert.ok(existsSync(join(cwd, ".pi", "agents", "godot-reviewer.md")));
		assert.ok(existsSync(join(cwd, ".pi", "agents", "godot-tester.md")));
		assert.ok(existsSync(join(cwd, ".pi", "skills", "godot-verify", "SKILL.md")));
		assert.ok(existsSync(join(cwd, ".pi", "module-installs.json")));
		// MCP 档自动并入：godot-ai 档写入隔离的 agent mcp.json。
		assert.match(message, /MCP 档 godot-ai 已并入/);
		const mcpJson = JSON.parse(readFileSync(join(agentHome, "mcp.json"), "utf8"));
		assert.deepEqual(mcpJson.mcpServers["godot-ai"], {
			command: "uvx",
			args: ["--from", "godot-ai", "godot-ai", "attach"],
		});
		// 安装后验证管线跑过：覆盖层含 godot 且八查汇总绿。
		const overlay = readFileSync(join(cwd, ".atl", "module-overlay.md"), "utf8");
		assert.match(overlay, /godot/);
		assert.match(message, /✓ godot：\d+ 项通过/);
		// 幂等：再装一次同版本 → 跳过（MCP 档一致，同样幂等）。
		const again = fakeCtx(cwd);
		await assembly.commands.get("jero:install-module")!.handler("godot", again.ctx);
		assert.match(again.notifications.map((item) => item.message).join("\n"), /= godot：已装同版本/);
	} finally {
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test("命令·module-list：列出包内束与安装状态", async () => {
	const cwd = makeProject();
	try {
		const { ctx, notifications } = fakeCtx(cwd);
		await assembly.commands.get("jero:module-list")!.handler({}, ctx);
		const message = notifications[0].message;
		assert.match(message, /可安装模块/);
		assert.match(message, /godot@/);
		assert.match(message, /未安装/);
		assert.match(message, /依赖：无/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
