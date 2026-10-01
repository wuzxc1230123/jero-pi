import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearRepoWalkCache,
	compileDispatchOverlay,
	discoverModules,
	effectiveSurfaceRoles,
	renderOverlayMarkdown,
	repoWalkCacheStats,
	validateModuleResolutionReport,
	walkRepoFiles,
} from "../lib/module-trigger-compiler.ts";
import {
	parseModuleManifest,
	type ModuleManifest,
} from "../lib/module-contract.ts";

// module-trigger-compiler 域测试：静态触发编译、覆盖层渲染、目录发现。
// tmpdir 夹具用完即删；不设置任何 GIT_* 环境变量（仓库铁律）。

function manifestFrom(raw: string): ModuleManifest {
	const parsed = parseModuleManifest(raw);
	assert.ok(parsed.manifest !== undefined, `测试清单必须解析成功：${JSON.stringify(parsed.issues)}`);
	return parsed.manifest;
}

function goModuleJson(token = "gogame"): string {
	return JSON.stringify({
		schema: "jero.module-contract/v1",
		token,
		version: "1.0.0",
		triggers: { files: ["go.mod", "**/*.go"], intents: ["goroutine"] },
		knowledge: { entry: "knowledge/SKILL.md", references: ["references/*.md"] },
		roles: [
			{
				name: `${token}-reviewer`,
				isolation: ["adversarial-eyes"],
				permission: "read-only",
				model: "balanced",
				output: "findings-report",
			},
		],
		bindings: {
			explore: { inject: "manifest-only" },
			worker: { inject: "entry" },
			review: { inject: "entry", appendRoles: [`${token}-reviewer`] },
		},
		routing: [
			{ when: { surface: "review" }, action: "delegate-role", target: `${token}-reviewer` },
		],
		config: { testCommand: "go test ./...", gitignore: [] },
	});
}

test("walkRepoFiles：正斜杠相对路径、忽略 node_modules/.git", () => {
	const dir = mkdtempSync(join(tmpdir(), "jero-module-walk-"));
	try {
		writeFileSync(join(dir, "go.mod"), "");
		mkdirSync(join(dir, "cmd"));
		writeFileSync(join(dir, "cmd", "main.go"), "");
		mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
		writeFileSync(join(dir, "node_modules", "dep", "x.go"), "");
		mkdirSync(join(dir, ".git"));
		writeFileSync(join(dir, ".git", "config"), "");

		const walked = walkRepoFiles(dir);
		assert.deepEqual([...walked.files].sort(), ["cmd/main.go", "go.mod"]);
		assert.equal(walked.truncated, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("compileDispatchOverlay：活动/未触发分流与各面计划", () => {
	const active = manifestFrom(goModuleJson());
	const dormant = manifestFrom(
		JSON.stringify({
			...JSON.parse(goModuleJson("unitygame")),
			triggers: { files: ["ProjectSettings/ProjectVersion.txt"], intents: ["Unity"] },
			roles: [],
			routing: [],
			config: undefined,
		}),
	);
	const overlay = compileDispatchOverlay([active, dormant], ["go.mod", "main.go"]);

	assert.deepEqual(overlay.activeModules.map((module) => module.token), ["gogame"]);
	assert.deepEqual(overlay.inactiveTokens, ["unitygame"]);
	assert.deepEqual(overlay.strictTdd, { command: "go test ./...", fromToken: "gogame", conflicts: [] });

	const worker = overlay.surfaces.find((surface) => surface.surface === "worker");
	assert.equal(worker?.entries.length, 1);
	assert.equal(worker?.entries[0].inject, "entry");

	const explore = overlay.surfaces.find((surface) => surface.surface === "explore");
	assert.equal(explore?.entries[0].inject, "manifest-only");

	const review = overlay.surfaces.find((surface) => surface.surface === "review");
	assert.deepEqual(review?.entries[0].appendRoles, ["gogame-reviewer"]);

	// 未声明接线的面（inline/verify/...）不应出现在计划里。
	assert.equal(overlay.surfaces.some((surface) => surface.surface === "inline"), false);
});

test("compileDispatchOverlay：多模块钉不同测试命令记冲突", () => {
	const first = manifestFrom(goModuleJson());
	const secondRaw = JSON.parse(goModuleJson("gotools"));
	secondRaw.triggers = { files: ["Makefile"], intents: [] };
	secondRaw.config = { testCommand: "make test", gitignore: [] };
	const second = manifestFrom(JSON.stringify(secondRaw));

	const overlay = compileDispatchOverlay([first, second], ["go.mod", "Makefile"]);
	assert.equal(overlay.activeModules.length, 2);
	assert.equal(overlay.strictTdd.command, "go test ./...");
	assert.deepEqual(overlay.strictTdd.conflicts, ["gotools"]);
	assert.ok(overlay.issues.some((message) => message.includes("gotools")));
});

test("compileDispatchOverlay：appendRoles 引用未声明角色记编译告警", () => {
	const raw = JSON.parse(goModuleJson());
	raw.bindings.review.appendRoles = ["ghost-role"];
	const overlay = compileDispatchOverlay([manifestFrom(JSON.stringify(raw))], ["go.mod"]);
	assert.ok(overlay.issues.some((message) => message.includes("ghost-role")));
});

test("renderOverlayMarkdown：关键段落与表格行齐全", () => {
	const overlay = compileDispatchOverlay([manifestFrom(goModuleJson())], ["go.mod"]);
	const markdown = renderOverlayMarkdown(overlay);

	assert.ok(markdown.includes("jero.module-overlay/v1"));
	assert.ok(markdown.includes("`gogame`：命中 `go.mod`"));
	assert.ok(markdown.includes("| review | gogame | entry | gogame-reviewer |"));
	assert.ok(markdown.includes("go test ./..."));
	assert.ok(markdown.includes("delegate-role"));
	assert.ok(markdown.includes("module_resolution"));
});

test("renderOverlayMarkdown：无活动模块时的空态提示", () => {
	const overlay = compileDispatchOverlay([], []);
	const markdown = renderOverlayMarkdown(overlay);
	assert.ok(markdown.includes("无——本仓库没有命中任何模块"));
});

test("renderOverlayMarkdown：单元格管道符转义与截断警示", () => {
	const raw = JSON.parse(goModuleJson());
	raw.triggers = { files: ["a|b.go"], intents: [] };
	const overlay = compileDispatchOverlay([manifestFrom(JSON.stringify(raw))], ["a|b.go"]);
	const markdown = renderOverlayMarkdown(overlay, { repoFilesTruncated: true });

	assert.match(markdown, /扫描已触及上限截断/);
	assert.match(markdown, /假阴性/);
	// 命中行的管道符必须转义，否则撕开列表/表格结构。
	assert.match(markdown, /`a\\\|b\.go`/);
	assert.doesNotMatch(markdown, /[^\\]\|b\.go`：/);
});

test("discoverModules：合法/坏清单/无清单目录三分", () => {
	const dir = mkdtempSync(join(tmpdir(), "jero-module-discover-"));
	try {
		mkdirSync(join(dir, "gogame", "knowledge"), { recursive: true });
		writeFileSync(join(dir, "gogame", "module.json"), goModuleJson());

		mkdirSync(join(dir, "broken"));
		writeFileSync(join(dir, "broken", "module.json"), "{ 坏掉");

		mkdirSync(join(dir, "just-references"));

		const discovered = discoverModules(dir);
		assert.equal(discovered.length, 2);

		const good = discovered.find((item) => item.dirName === "gogame");
		assert.equal(good?.manifest?.token, "gogame");
		assert.deepEqual(good?.issues, []);

		const bad = discovered.find((item) => item.dirName === "broken");
		assert.equal(bad?.manifest, undefined);
		assert.ok(bad?.issues.length !== undefined && bad.issues.length > 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("discoverModules：目录不存在返回空数组", () => {
	assert.deepEqual(discoverModules(join(tmpdir(), "jero-module-nope-404")), []);
});

test("discoverModules：多根合并（项目 + 全局形态）", () => {
	const projectRoot = mkdtempSync(join(tmpdir(), "jero-module-roots-p-"));
	const globalRoot = mkdtempSync(join(tmpdir(), "jero-module-roots-g-"));
	try {
		mkdirSync(join(projectRoot, "gogame"), { recursive: true });
		writeFileSync(join(projectRoot, "gogame", "module.json"), goModuleJson());
		mkdirSync(join(globalRoot, "webapi"), { recursive: true });
		writeFileSync(join(globalRoot, "webapi", "module.json"), goModuleJson("webapi"));

		const discovered = discoverModules([projectRoot, globalRoot]);
		assert.deepEqual(
			discovered.map((item) => item.manifest?.token).sort(),
			["gogame", "webapi"],
		);
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
		rmSync(globalRoot, { recursive: true, force: true });
	}
});

test("仓库扫描 TTL 缓存：同 cwd 复用，清空后重扫", () => {
	const dir = mkdtempSync(join(tmpdir(), "jero-module-cache-"));
	try {
		const before = repoWalkCacheStats();
		clearRepoWalkCache();
		walkRepoFiles(dir);
		walkRepoFiles(dir);
		const afterSecond = repoWalkCacheStats();
		assert.equal(afterSecond.misses, before.misses + 1);
		assert.equal(afterSecond.hits, before.hits + 1);

		clearRepoWalkCache();
		walkRepoFiles(dir);
		const afterClear = repoWalkCacheStats();
		assert.equal(afterClear.misses, before.misses + 2);
		assert.equal(afterClear.hits, before.hits + 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		clearRepoWalkCache();
	}
});

test("compileDispatchOverlay + 渲染：C 级硬门声明的响亮缺席", () => {
	const raw = JSON.parse(goModuleJson());
	raw.pipeline = { gate: "sdd-full" };
	const overlay = compileDispatchOverlay([manifestFrom(JSON.stringify(raw))], ["go.mod"]);
	assert.deepEqual(overlay.declaredGates, [{ token: "gogame", gate: "sdd-full" }]);

	const markdown = renderOverlayMarkdown(overlay);
	assert.match(markdown, /## 硬门声明（C 级）/)
	assert.match(markdown, /sdd-full/);
	assert.match(markdown, /不得静默跳过/);

	const noGate = compileDispatchOverlay([manifestFrom(goModuleJson())], ["go.mod"]);
	assert.deepEqual(noGate.declaredGates, []);
	assert.doesNotMatch(renderOverlayMarkdown(noGate), /硬门声明/);
});

// 双模块夹具：同触发文件都激活，各带 delegate 路由与同名追加角色，
// 用于优先序/冲突检测/验证器测试。
function secondModuleJson(): string {
	return JSON.stringify({
		schema: "jero.module-contract/v1",
		token: "webapi",
		version: "1.0.0",
		triggers: { files: ["go.mod"], intents: [] },
		knowledge: { entry: "knowledge/SKILL.md", references: [] },
		roles: [
			{
				name: "webapi-reviewer",
				isolation: ["adversarial-eyes"],
				permission: "read-only",
				model: "balanced",
				output: "findings-report",
			},
			{
				name: "shared-reviewer",
				isolation: ["least-privilege"],
				permission: "scan",
				model: "fast",
				output: "findings-report",
			},
		],
		bindings: { review: { inject: "manifest-only", appendRoles: ["shared-reviewer"] } },
		routing: [
			{ when: { surface: "review" }, action: "delegate-role", target: "webapi-reviewer" },
		],
	});
}

function sharedRoleModuleJson(): string {
	const raw = JSON.parse(goModuleJson());
	raw.roles.push({
		name: "shared-reviewer",
		isolation: ["least-privilege"],
		permission: "scan",
		model: "fast",
		output: "findings-report",
	});
	raw.bindings.review.appendRoles.push("shared-reviewer");
	return JSON.stringify(raw);
}

test("多模块：路由表稳定 ID、delegate 冲突检测与追加角色去重", () => {
	const overlay = compileDispatchOverlay(
		[manifestFrom(sharedRoleModuleJson()), manifestFrom(secondModuleJson())],
		["go.mod"],
	);

	// 稳定规则 ID：token#manifest 序号。
	assert.deepEqual(
		overlay.routingTable.map((row) => row.id),
		["gogame#0", "webapi#0"],
	);

	// 同面不同目标的 delegate 规则 → 冲突告警，先见者（gogame）胜。
	assert.ok(
		overlay.issues.some((message) => message.includes("delegate 规则冲突") && message.includes("gogame") && message.includes("webapi")),
		`应有 delegate 冲突告警，实际：${JSON.stringify(overlay.issues)}`,
	);

	// 同名追加角色跨模块去重：生效列表只一份，冲突入告警。
	assert.deepEqual(effectiveSurfaceRoles(overlay, "review"), ["gogame-reviewer", "shared-reviewer"]);
	assert.ok(overlay.issues.some((message) => message.includes("同时追加") && message.includes("shared-reviewer")));

	// 渲染带规则 ID 列与优先序说明。
	const markdown = renderOverlayMarkdown(overlay);
	assert.match(markdown, /\| 规则 ID \| 模块 \| 条件 \| 动作 \| 目标角色 \|/);
	assert.match(markdown, /gogame#0/);
	assert.match(markdown, /webapi#0/);
	assert.match(markdown, /模块根内按 token 字典序/);
});

test("验证器：module_resolution 报告的机器校验全分支", () => {
	const overlay = compileDispatchOverlay(
		[manifestFrom(sharedRoleModuleJson()), manifestFrom(secondModuleJson())],
		["go.mod"],
	);

	assert.deepEqual(validateModuleResolutionReport("none", overlay), { ok: true, kind: "none", detail: "无活动模块或该面未接线" });
	assert.equal(validateModuleResolutionReport("paths-injected", overlay).ok, true);
	assert.equal(validateModuleResolutionReport("skipped:review surface not wired", overlay).kind, "skipped");

	// 带规则 ID：角色与目标一致 → 通过。
	const withRule = validateModuleResolutionReport("delegated:gogame-reviewer@gogame#0", overlay);
	assert.equal(withRule.ok, true);
	assert.equal(withRule.kind, "delegated");
	assert.match(withRule.detail, /规则 gogame#0/);

	// 不带规则 ID：角色存在即通过（宽松档，兼容提示层回报）。
	assert.equal(validateModuleResolutionReport("delegated:webapi-reviewer", overlay).ok, true);

	// 规则 ID 的目标与报告角色不一致 → 拒绝。
	const mismatch = validateModuleResolutionReport("delegated:webapi-reviewer@gogame#0", overlay);
	assert.equal(mismatch.ok, false);
	assert.match(mismatch.detail, /目标是 gogame-reviewer/);

	// 未知规则 ID / 未知角色 / 垃圾格式 / 编排缺口。
	assert.equal(validateModuleResolutionReport("delegated:gogame-reviewer@ghost#9", overlay).ok, false);
	assert.equal(validateModuleResolutionReport("delegated:no-such-role", overlay).ok, false);
	assert.equal(validateModuleResolutionReport("随便写", overlay).kind, "invalid");
	const unresolved = validateModuleResolutionReport("name-unresolved", overlay);
	assert.equal(unresolved.ok, false);
	assert.equal(unresolved.kind, "name-unresolved");
});
