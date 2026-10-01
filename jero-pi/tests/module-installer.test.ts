import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MODULE_INSTALLS_REL_PATH,
	discoverBundles,
	installBundle,
	readModuleInstalls,
	resolveInstallPlan,
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
	options: { version?: string; dependencies?: string[]; withAgents?: boolean; withSkills?: boolean } = {},
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
