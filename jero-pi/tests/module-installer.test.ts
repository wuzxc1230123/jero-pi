import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MODULE_INSTALLS_REL_PATH,
	bundleModulesRoot,
	discoverBundles,
	installBundle,
	moduleMcpDoctorLines,
	readModuleInstalls,
	resolveInstallPlan,
	writeModuleInstalls,
	type BundleModule,
	type ModuleInstallsFile,
} from "../lib/module-installer.ts";

// module-installer 域测试：依赖闭包解析（线性/菱形/环/缺失/自依赖/未知）、
// 安装的幂等与用户改动保护、安装记录、多资产拷贝（模块本体/agents/skills）。
// 全部夹具走 mkdtemp 临时目录，不碰真实 home，不设任何 GIT_* 环境变量。

function makeDir(): string {
	return mkdtempSync(join(tmpdir(), "jero-installer-"));
}

function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

// 造一个束目录：module.json（v2）+ knowledge + references + 可选 agents/skills。
function makeBundle(
	root: string,
	token: string,
	options: {
		version?: string;
		dependencies?: string[];
		withAgents?: boolean;
		withSkills?: boolean;
		mcpServers?: { name: string; command: string; args?: string[] }[];
	} = {},
): BundleModule {
	const dir = join(root, token);
	mkdirSync(join(dir, "knowledge"), { recursive: true });
	mkdirSync(join(dir, "references"), { recursive: true });
	writeFileSync(
		join(dir, "module.json"),
		JSON.stringify({
			schema: "jero.module-contract/v2",
			token,
			version: options.version ?? "1.0.0",
			dependencies: options.dependencies ?? [],
			...(options.mcpServers !== undefined ? { mcp: { servers: options.mcpServers } } : {}),
			triggers: { files: ["marker.md"], intents: [] },
			knowledge: { entry: "knowledge/SKILL.md", references: ["references/*.md"] },
			roles: options.withAgents === false ? [] : [
				{
					name: `${token}-reviewer`,
					isolation: ["adversarial-eyes"],
					permission: "read-only",
					model: "balanced",
					output: "findings-report",
				},
			],
			bindings: { worker: { inject: "manifest-only" } },
			routing: [],
		}),
	);
	writeFileSync(join(dir, "knowledge", "SKILL.md"), `---\nname: ${token}\ndescription: d\n---\n\nbody\n`);
	writeFileSync(join(dir, "references", "deep.md"), `# ${token} 深知识\n`);
	if (options.withAgents !== false) {
		mkdirSync(join(dir, "agents"), { recursive: true });
		writeFileSync(join(dir, "agents", `${token}-reviewer.md`), `---\nname: ${token}-reviewer\ndescription: 评审\n---\n\n正文\n`);
	}
	if (options.withSkills) {
		mkdirSync(join(dir, "skills", `${token}-verify`), { recursive: true });
		writeFileSync(join(dir, "skills", `${token}-verify`, "SKILL.md"), `---\nname: ${token}-verify\ndescription: d\n---\n\nbody\n`);
	}
	const { bundles } = discoverBundles(root);
	const bundle = bundles.find((item) => item.token === token);
	assert.ok(bundle !== undefined, `束 ${token} 必须可发现`);
	return bundle;
}

test("发现：束目录解析 + 坏清单进 broken，无 module.json 的目录跳过", () => {
	const root = makeDir();
	try {
		makeBundle(root, "alpha-mod");
		mkdirSync(join(root, "not-a-bundle"), { recursive: true });
		mkdirSync(join(root, "broken-mod"), { recursive: true });
		writeFileSync(join(root, "broken-mod", "module.json"), "{ 坏掉");

		const { bundles, broken } = discoverBundles(root);
		assert.deepEqual(bundles.map((item) => item.token), ["alpha-mod"]);
		assert.equal(broken.length, 1);
		assert.equal(broken[0].dirName, "broken-mod");
	} finally {
		cleanup(root);
	}
});

test("闭包解析：线性依赖后序（依赖先装）+ alreadyInstalled 标记", () => {
	const root = makeDir();
	try {
		makeBundle(root, "base-mod");
		makeBundle(root, "mid-mod", { dependencies: ["base-mod"] });
		makeBundle(root, "top-mod", { dependencies: ["mid-mod"] });

		const { bundles } = discoverBundles(root);
		const plan = resolveInstallPlan(bundles, ["top-mod"], new Map([["base-mod", "1.0.0"]]));
		assert.equal(plan.ok, true);
		if (plan.ok) {
			assert.deepEqual(
				plan.steps.map((step) => step.token),
				["base-mod", "mid-mod", "top-mod"],
			);
			assert.deepEqual(
				plan.steps.map((step) => step.alreadyInstalled),
				[true, false, false],
			);
		}
	} finally {
		cleanup(root);
	}
});

test("闭包解析：菱形依赖去重；未知词元与缺依赖响亮失败", () => {
	const root = makeDir();
	try {
		makeBundle(root, "base-mod");
		makeBundle(root, "left-mod", { dependencies: ["base-mod"] });
		makeBundle(root, "right-mod", { dependencies: ["base-mod"] });
		makeBundle(root, "app-mod", { dependencies: ["left-mod", "right-mod"] });

		const { bundles } = discoverBundles(root);
		const diamond = resolveInstallPlan(bundles, ["app-mod"], new Map());
		if (diamond.ok) {
			assert.deepEqual(
				diamond.steps.map((step) => step.token),
				["base-mod", "left-mod", "right-mod", "app-mod"],
			);
		} else {
			assert.fail("菱形闭包应成功");
		}

		const unknown = resolveInstallPlan(bundles, ["nope-mod"], new Map());
		assert.equal(unknown.ok, false);
		if (!unknown.ok) {
			assert.equal(unknown.reason, "unknown-token");
			assert.match(unknown.detail, /未知模块词元：nope-mod/);
			assert.match(unknown.detail, /base-mod/);
		}

		const missing = resolveInstallPlan(bundles, ["left-mod", "ghost-dep"], new Map());
		assert.equal(missing.ok, false);
		if (!missing.ok) assert.equal(missing.reason, "unknown-token");

		// 真正的缺依赖：束声明了库内不存在的词元。
		makeBundle(root, "hungry-mod", { dependencies: ["ghost-dep"] });
		const { bundles: withHungry } = discoverBundles(root);
		const hungry = resolveInstallPlan(withHungry, ["hungry-mod"], new Map());
		assert.equal(hungry.ok, false);
		if (!hungry.ok) {
			assert.equal(hungry.reason, "missing-dependency");
			assert.match(hungry.detail, /依赖缺失：hungry-mod 依赖 ghost-dep/);
		}
	} finally {
		cleanup(root);
	}
});

test("闭包解析：成环响亮失败", () => {
	const root = makeDir();
	try {
		makeBundle(root, "aa-mod", { dependencies: ["bb-mod"] });
		makeBundle(root, "bb-mod", { dependencies: ["aa-mod"] });

		const { bundles } = discoverBundles(root);
		const plan = resolveInstallPlan(bundles, ["aa-mod"], new Map());
		assert.equal(plan.ok, false);
		if (!plan.ok) {
			assert.equal(plan.reason, "dependency-cycle");
			assert.match(plan.detail, /依赖成环：aa-mod → bb-mod → aa-mod/);
		}
	} finally {
		cleanup(root);
	}
});

test("安装：三类落盘面 + 安装记录；幂等跳过同版本", () => {
	const root = makeDir();
	const project = makeDir();
	try {
		const bundle = makeBundle(root, "alpha-mod", { withSkills: true });
		const outcome = installBundle(project, bundle);
		assert.equal(outcome.kind, "installed");
		assert.match(outcome.detail, /模块本体 3 文件/);
		assert.ok(existsSync(join(project, ".pi", "modules", "alpha-mod", "module.json")));
		assert.ok(existsSync(join(project, ".pi", "modules", "alpha-mod", "references", "deep.md")));
		assert.ok(existsSync(join(project, ".pi", "agents", "alpha-mod-reviewer.md")));
		assert.ok(existsSync(join(project, ".pi", "skills", "alpha-mod-verify", "SKILL.md")));

		const installs = readModuleInstalls(project);
		assert.equal(installs.modules["alpha-mod"]?.version, "1.0.0");
		assert.equal(installs.modules["alpha-mod"]?.files.length, 5);

		const again = installBundle(project, bundle);
		assert.equal(again.kind, "skipped-up-to-date");
		assert.match(again.detail, /已装同版本 1\.0\.0/);
	} finally {
		cleanup(root);
		cleanup(project);
	}
});

test("安装：用户改动保护——改动记录内文件即跳过，force 覆盖", () => {
	const root = makeDir();
	const project = makeDir();
	try {
		const bundle = makeBundle(root, "alpha-mod");
		assert.equal(installBundle(project, bundle).kind, "installed");

		writeFileSync(join(project, ".pi", "modules", "alpha-mod", "knowledge", "SKILL.md"), "---\nname: alpha-mod\ndescription: 用户改过\n---\n\n改动\n");
		const protectedOutcome = installBundle(project, bundle);
		assert.equal(protectedOutcome.kind, "skipped-user-modified");
		assert.match(protectedOutcome.detail, /内容已改动/);

		const forced = installBundle(project, bundle, { force: true });
		assert.equal(forced.kind, "installed");
		assert.match(
			readFileSync(join(project, ".pi", "modules", "alpha-mod", "knowledge", "SKILL.md"), "utf8"),
			/description: d/,
		);
	} finally {
		cleanup(root);
		cleanup(project);
	}
});

test("安装：无记录的既有目录视为未托管，跳过；force 接管", () => {
	const root = makeDir();
	const project = makeDir();
	try {
		const bundle = makeBundle(root, "alpha-mod");
		// 手工/创建器先装了一份（无安装记录）。
		mkdirSync(join(project, ".pi", "modules", "alpha-mod", "knowledge"), { recursive: true });
		writeFileSync(join(project, ".pi", "modules", "alpha-mod", "module.json"), "手工版");

		const skipped = installBundle(project, bundle);
		assert.equal(skipped.kind, "skipped-unmanaged");
		assert.match(skipped.detail, /无安装记录/);
		assert.equal(readFileSync(join(project, ".pi", "modules", "alpha-mod", "module.json"), "utf8"), "手工版");

		const forced = installBundle(project, bundle, { force: true });
		assert.equal(forced.kind, "installed");
		assert.match(readFileSync(join(project, ".pi", "modules", "alpha-mod", "module.json"), "utf8"), /"token":\s*"alpha-mod"/);
	} finally {
		cleanup(root);
		cleanup(project);
	}
});

test("安装：版本升级重装并更新记录", () => {
	const root = makeDir();
	const project = makeDir();
	try {
		const v1 = makeBundle(root, "alpha-mod", { version: "1.0.0" });
		assert.equal(installBundle(project, v1).kind, "installed");

		// 包内升版：同束目录换 2.0.0 清单。
		const manifest = JSON.parse(readFileSync(join(root, "alpha-mod", "module.json"), "utf8"));
		manifest.version = "2.0.0";
		writeFileSync(join(root, "alpha-mod", "module.json"), JSON.stringify(manifest));
		const { bundles } = discoverBundles(root);
		const v2 = bundles.find((item) => item.token === "alpha-mod")!;

		const upgraded = installBundle(project, v2);
		assert.equal(upgraded.kind, "installed");
		assert.match(upgraded.detail, /alpha-mod@2\.0\.0/);
		assert.equal(readModuleInstalls(project).modules["alpha-mod"]?.version, "2.0.0");
	} finally {
		cleanup(root);
		cleanup(project);
	}
});

test("安装记录：损坏 JSON 按空记录处理，重装即重建", () => {
	const project = makeDir();
	try {
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(join(project, MODULE_INSTALLS_REL_PATH), "{ 坏掉");
		const installs: ModuleInstallsFile = readModuleInstalls(project);
		assert.deepEqual(installs.modules, {});
	} finally {
		cleanup(project);
	}
});

// —— MCP 档合并：声明的 MCP 服务器并入 agent mcp.json（三律：幂等/同名不覆盖/畸形保命） ——

test("mcp 合并：并入 → 幂等一致跳过 → 同名用户档保留未覆盖", () => {
	const root = makeDir();
	const project = makeDir();
	const agentMcp = join(root, "mcp.json");
	try {
		const bundle = makeBundle(root, "alpha-mcp", {
			mcpServers: [{ name: "tool-x", command: "uvx", args: ["tool-x", "attach"] }],
		});
		const first = installBundle(project, bundle, { agentMcpJson: agentMcp });
		assert.equal(first.kind, "installed");
		assert.match(first.detail, /MCP 档 tool-x 已并入/);
		assert.deepEqual(JSON.parse(readFileSync(agentMcp, "utf8")).mcpServers["tool-x"], {
			command: "uvx",
			args: ["tool-x", "attach"],
		});

		// 幂等：同版本再装走 up-to-date 跳过路径，档一致 → 跳过且文件不动；账本不重复累计。
		const second = installBundle(project, bundle, { agentMcpJson: agentMcp });
		assert.equal(second.kind, "skipped-up-to-date");
		assert.match(second.detail, /MCP 档 tool-x 已存在且一致，跳过/);
		assert.equal(readModuleInstalls(project).modules["alpha-mcp"]?.mcpWritten?.length, 1, "幂等跳过不新增账本条目");

		// 同名不同内容：用户改动优先，模块声明显影但不覆盖。
		const userFile = JSON.parse(readFileSync(agentMcp, "utf8"));
		userFile.mcpServers["tool-x"] = { command: "other" };
		writeFileSync(agentMcp, JSON.stringify(userFile, null, "\t"));
		const third = installBundle(project, bundle, { force: true, agentMcpJson: agentMcp });
		assert.equal(third.kind, "installed");
		assert.match(third.detail, /同名但内容不同——保留用户配置未覆盖/);
		assert.deepEqual(JSON.parse(readFileSync(agentMcp, "utf8")).mcpServers["tool-x"], { command: "other" });
	} finally {
		cleanup(root);
		cleanup(project);
	}
});

test("mcp 合并：既有 mcp.json 不可解析 → 保命不动 + 逐台显影；超 1MiB 拒绝解析", () => {
	const root = makeDir();
	const project = makeDir();
	const agentMcp = join(root, "mcp.json");
	try {
		writeFileSync(agentMcp, "{not json");
		const bundle = makeBundle(root, "beta-mcp", { mcpServers: [{ name: "tool-y", command: "uvx" }] });
		const outcome = installBundle(project, bundle, { agentMcpJson: agentMcp });
		assert.equal(outcome.kind, "installed");
		assert.match(outcome.detail, /MCP 档 tool-y 未写入：.*不是可解析的 mcpServers 配置/);
		assert.equal(readFileSync(agentMcp, "utf8"), "{not json", "畸形用户文件必须原样保留");

		// 巨型配置（>1MiB）：拒绝解析，逐台显影，文件不动。
		const oversize = "x".repeat(1_048_576 + 1);
		writeFileSync(agentMcp, oversize);
		const oversizeOutcome = installBundle(project, bundle, { force: true, agentMcpJson: agentMcp });
		assert.equal(oversizeOutcome.kind, "installed");
		assert.match(oversizeOutcome.detail, /超过 1048576B 上限——拒绝解析巨型配置/);
		assert.equal(readFileSync(agentMcp, "utf8"), oversize, "巨型用户文件必须原样保留");
	} finally {
		cleanup(root);
		cleanup(project);
	}
});

test("mcp：真实 godot 束声明 godot-ai 档，安装并入 + doctor 在档/缺席显影", () => {
	const project = makeDir();
	const agentHome = makeDir();
	const agentMcp = join(agentHome, "mcp.json");
	try {
		const { bundles } = discoverBundles(bundleModulesRoot());
		const godot = bundles.find((item) => item.token === "godot");
		assert.ok(godot !== undefined, "包内模块库必须含 godot 束");
		assert.deepEqual(godot.manifest.mcp?.servers.map((server) => server.name), ["godot-ai"]);

		const outcome = installBundle(project, godot, { agentMcpJson: agentMcp });
		assert.equal(outcome.kind, "installed");
		assert.match(outcome.detail, /MCP 档 godot-ai 已并入/);
		assert.deepEqual(JSON.parse(readFileSync(agentMcp, "utf8")).mcpServers["godot-ai"], {
			command: "uvx",
			args: ["--from", "godot-ai@4.2.3", "godot-ai", "attach"],
		});
		// 来源账本：安装记录含实际写入的档。
		const record = readModuleInstalls(project).modules["godot"];
		assert.equal(record?.mcpWritten?.length, 1);
		assert.equal(record?.mcpWritten?.[0]?.name, "godot-ai");
		assert.deepEqual(record?.mcpWritten?.[0]?.entry, { command: "uvx", args: ["--from", "godot-ai@4.2.3", "godot-ai", "attach"] });

		const present = moduleMcpDoctorLines(project, agentMcp);
		assert.ok(present.some((line) => line.startsWith("pass:") && line.includes("godot-ai") && line.includes("module-written")));

		rmSync(agentMcp);
		const missing = moduleMcpDoctorLines(project, agentMcp);
		assert.ok(missing.some((line) => line.startsWith("warn:") && line.includes("godot-ai") && line.includes("missing")));
	} finally {
		cleanup(project);
		cleanup(agentHome);
	}
});

test("mcp 账本：doctor 归因（改写显影）+ 无账本旧装的同版本回填补账（真实 godot 束）", () => {
	const project = makeDir();
	const agentHome = makeDir();
	const agentMcp = join(agentHome, "mcp.json");
	try {
		const { bundles } = discoverBundles(bundleModulesRoot());
		const godot = bundles.find((item) => item.token === "godot");
		assert.ok(godot !== undefined, "包内模块库必须含 godot 束");
		installBundle(project, godot, { agentMcpJson: agentMcp });

		// 用户改写已写入的档 → doctor 确定式归因（账本比对，非内容猜测）。
		const userFile = JSON.parse(readFileSync(agentMcp, "utf8"));
		userFile.mcpServers["godot-ai"] = { command: "other" };
		writeFileSync(agentMcp, JSON.stringify(userFile, null, "\t"));
		const modified = moduleMcpDoctorLines(project, agentMcp);
		assert.ok(modified.some((line) => line.startsWith("info:") && line.includes("godot-ai") && line.includes("user-modified since install")));

		// 模拟无账本的旧装：抹掉记录里的 mcpWritten 并删档，同版本重装走回填路径
		// → 档写回 + 账本追加。
		const installs = readModuleInstalls(project);
		const legacy = installs.modules["godot"];
		assert.ok(legacy !== undefined);
		writeModuleInstalls(project, {
			schema: installs.schema,
			modules: { ...installs.modules, godot: { version: legacy.version, files: legacy.files } },
		});
		rmSync(agentMcp);
		const backfill = installBundle(project, godot, { agentMcpJson: agentMcp });
		assert.equal(backfill.kind, "skipped-up-to-date");
		assert.match(backfill.detail, /MCP 档 godot-ai 已并入/);
		assert.equal(readModuleInstalls(project).modules["godot"]?.mcpWritten?.length, 1, "回填路径要追加来源账本");
		const backfilled = moduleMcpDoctorLines(project, agentMcp);
		assert.ok(backfilled.some((line) => line.startsWith("pass:") && line.includes("godot-ai") && line.includes("module-written")));
	} finally {
		cleanup(project);
		cleanup(agentHome);
	}
});
