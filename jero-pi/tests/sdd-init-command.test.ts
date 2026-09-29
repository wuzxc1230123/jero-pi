import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../extensions/sdd-init.ts";
import {
	runSddInitCommand,
	type SddInitCtx,
	type SddInitPrefs,
} from "../lib/sdd-init-command.ts";

// sdd-init-command 域测试：预检注入后的编排分支——写盘、非 openspec 短路、
// 已存在拒绝覆写、无 UI 静默。探测引擎语义由 sdd-project-detect.test.ts 钉住。

function makeProject(withPackage = true): string {
	const cwd = mkdtempSync(join(tmpdir(), "jero-sdd-init-cmd-"));
	if (withPackage) {
		mkdirSync(join(cwd, "tests"), { recursive: true });
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({ name: "demo", scripts: { test: "node --test" } }),
		);
	}
	return cwd;
}

function fakeCtx(cwd: string, hasUI = true): { ctx: SddInitCtx; notifications: { message: string; level: string }[] } {
	const notifications: { message: string; level: string }[] = [];
	return {
		ctx: {
			cwd,
			hasUI,
			ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
		},
		notifications,
	};
}

const preflight = (artifactStore: SddInitPrefs["artifactStore"]) => async (): Promise<SddInitPrefs> => ({
	artifactStore,
});

test("openspec 存储：写 openspec/config.yaml，通知含探测摘要", async () => {
	const cwd = makeProject();
	try {
		const { ctx, notifications } = fakeCtx(cwd);
		await runSddInitCommand(ctx, { ensureSddPreflight: preflight("openspec") });
		const config = readFileSync(join(cwd, "openspec", "config.yaml"), "utf8");
		assert.match(config, /Node\.js/);
		assert.match(config, /npm test/);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].message, /Wrote openspec\/config\.yaml/);
		assert.match(notifications[0].message, /strict TDD enabled with `npm test`/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("hybrid 存储：同样写 config", async () => {
	const cwd = makeProject();
	try {
		const { ctx } = fakeCtx(cwd);
		await runSddInitCommand(ctx, { ensureSddPreflight: preflight("hybrid") });
		assert.ok(existsSync(join(cwd, "openspec", "config.yaml")));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("engram/none 存储：不写 config，按存储短路通知", async () => {
	for (const store of ["engram", "none"] as const) {
		const cwd = makeProject();
		try {
			const { ctx, notifications } = fakeCtx(cwd);
			await runSddInitCommand(ctx, { ensureSddPreflight: preflight(store) });
			assert.equal(existsSync(join(cwd, "openspec", "config.yaml")), false);
			assert.equal(notifications.length, 1);
			assert.match(notifications[0].message, new RegExp(`SDD initialized for ${store}`));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}
});

test("config 已存在：拒绝覆写并给 warning", async () => {
	const cwd = makeProject();
	try {
		const configPath = join(cwd, "openspec", "config.yaml");
		mkdirSync(join(cwd, "openspec"), { recursive: true });
		writeFileSync(configPath, "# 手工维护\n");
		const { ctx, notifications } = fakeCtx(cwd);
		await runSddInitCommand(ctx, { ensureSddPreflight: preflight("openspec") });
		assert.equal(readFileSync(configPath, "utf8"), "# 手工维护\n");
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "warning");
		assert.match(notifications[0].message, /already exists/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("无 UI 静默：写盘照常、零通知", async () => {
	const cwd = makeProject();
	try {
		const { ctx, notifications } = fakeCtx(cwd, false);
		await runSddInitCommand(ctx, { ensureSddPreflight: preflight("openspec") });
		assert.ok(existsSync(join(cwd, "openspec", "config.yaml")));
		assert.equal(notifications.length, 0);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("无测试命令的项目：strict TDD disabled 摘要", async () => {
	const cwd = makeProject(false);
	writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "bare" }));
	try {
		const { ctx, notifications } = fakeCtx(cwd);
		await runSddInitCommand(ctx, { ensureSddPreflight: preflight("openspec") });
		assert.match(notifications[0].message, /strict TDD disabled because no test runner was detected/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("扩展装配：注册命令；真预检走沙箱 HOME 确认后写盘", async () => {
	const project = mkdtempSync(join(tmpdir(), "jero-sdd-init-ext2-"));
	const agentHome = mkdtempSync(join(tmpdir(), "jero-sdd-init-agent2-"));
	const configHome = mkdtempSync(join(tmpdir(), "jero-sdd-init-config2-"));
	const home = mkdtempSync(join(tmpdir(), "jero-sdd-init-home2-"));
	const saved = {
		JERO_PI_AGENT_HOME: process.env.JERO_PI_AGENT_HOME,
		JERO_PI_CONFIG_HOME: process.env.JERO_PI_CONFIG_HOME,
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
	};
	process.env.JERO_PI_AGENT_HOME = agentHome;
	process.env.JERO_PI_CONFIG_HOME = configHome;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		mkdirSync(join(project, "tests"), { recursive: true });
		writeFileSync(join(project, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node --test" } }));

		const commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => Promise<void> }>();
		const fakePi = {
			registerCommand(name: string, def: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) {
				commands.set(name, def);
				return fakePi;
			},
		};
		extension(fakePi as never);
		assert.ok(commands.has("jero-sdd-init"));

		const notifications: string[] = [];
		const selections: string[] = [];
		const ctx = {
			cwd: project,
			hasUI: true,
			ui: {
				// 会话预检的确认仪式：确认选择"Confirm"，其余问询取首项。
				select: async (title: string, options: readonly string[]) => {
					selections.push(title);
					return options.includes("Confirm") ? "Confirm" : options[0];
				},
				input: async () => "",
				notify: (message: string) => notifications.push(message),
			},
		};
		await commands.get("jero-sdd-init")!.handler("", ctx);

		// 预检确认发生过，且命令主体完成了写盘与通知。
		assert.ok(selections.some((title) => title.includes("preflight")), `应触发预检确认，实际：${JSON.stringify(selections)}`);
		assert.ok(existsSync(join(project, "openspec", "config.yaml")));
		assert.ok(notifications.some((message) => message.includes("Wrote openspec/config.yaml")));
		assert.ok(notifications.some((message) => message.includes("strict TDD enabled with `npm test`")));
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(project, { recursive: true, force: true });
		rmSync(agentHome, { recursive: true, force: true });
		rmSync(configHome, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});
