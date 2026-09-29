import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearRepoWalkCache,
	compileDispatchOverlay,
	discoverModules,
	renderOverlayMarkdown,
	repoWalkCacheStats,
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
	assert.ok(markdown.includes("module_resolution.delegation"));
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
