import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	OVERLAY_REL_PATH,
	looseSkillTokens,
	runModuleVerifyPipeline,
} from "../lib/module-verify-pipeline.ts";

// module-verify-pipeline 域测试：陈旧覆盖层纪律（零清单写空态/无根删残留）、
// 双根发现、坏清单报告、双轨查集成。根全部注入临时目录，不碰真实 home。

function makeProject(): string {
	return mkdtempSync(join(tmpdir(), "jero-pipeline-"));
}

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

function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

test("无模块根 + 残留覆盖层 → 删除，绝不留过期接线", () => {
	const cwd = makeProject();
	const rootsRoot = makeProject();
	mkdirSync(join(cwd, ".atl"), { recursive: true });
	writeFileSync(join(cwd, OVERLAY_REL_PATH), "# 陈旧内容");
	try {
		const result = runModuleVerifyPipeline(cwd, { roots: [join(rootsRoot, "none")] });
		assert.equal(result.overlayRemoved, true);
		assert.equal(result.overlayWritten, false);
		assert.equal(existsSync(join(cwd, OVERLAY_REL_PATH)), false);
	} finally {
		cleanup(cwd);
		cleanup(rootsRoot);
	}
});

test("无模块根且无残留 → 空结果短路，不扫仓库", () => {
	const cwd = makeProject();
	try {
		const result = runModuleVerifyPipeline(cwd, { roots: [join(cwd, "nope")] });
		assert.deepEqual(result.reports, []);
		assert.equal(result.overlayRemoved, false);
		assert.equal(result.overlayWritten, false);
	} finally {
		cleanup(cwd);
	}
});

test("有根零模块 → 写空态覆盖层（不是不写）", () => {
	const cwd = makeProject();
	const root = makeProject();
	try {
		mkdirSync(root, { recursive: true });
		const result = runModuleVerifyPipeline(cwd, { roots: [root] });
		assert.equal(result.overlayWritten, true);
		const overlay = readFileSync(join(cwd, OVERLAY_REL_PATH), "utf8");
		assert.match(overlay, /无——本仓库没有命中任何模块的静态触发器/);
	} finally {
		cleanup(cwd);
		cleanup(root);
	}
});

test("坏清单模块 → 报告解析失败，覆盖层仍重写（不残留旧接线）", () => {
	const cwd = makeProject();
	const root = makeProject();
	try {
		mkdirSync(join(root, "broken"), { recursive: true });
		writeFileSync(join(root, "broken", "module.json"), "{ 坏掉");
		// 预置陈旧覆盖层：坏清单出现后必须被空态覆盖替换。
		mkdirSync(join(cwd, ".atl"), { recursive: true });
		writeFileSync(join(cwd, OVERLAY_REL_PATH), "# 陈旧接线");

		const result = runModuleVerifyPipeline(cwd, { roots: [root] });
		assert.equal(result.brokenModules.length, 1);
		assert.equal(result.brokenModules[0].dirName, "broken");
		assert.equal(result.overlayWritten, true);
		const overlay = readFileSync(join(cwd, OVERLAY_REL_PATH), "utf8");
		assert.doesNotMatch(overlay, /陈旧接线/);
		assert.match(overlay, /无——本仓库没有命中任何模块的静态触发器/);
	} finally {
		cleanup(cwd);
		cleanup(root);
	}
});

test("正常模块 → 报告 + 覆盖层写入；触发命中走仓库文件树", () => {
	const cwd = makeProject();
	const root = makeProject();
	try {
		writeModule(root, "gogame");
		writeFileSync(join(cwd, "go.mod"), "");

		const result = runModuleVerifyPipeline(cwd, { roots: [root] });
		assert.equal(result.reports.length, 1);
		assert.equal(result.reports[0].token, "gogame");
		assert.equal(result.reports[0].ok, true);
		const overlay = readFileSync(join(cwd, OVERLAY_REL_PATH), "utf8");
		assert.match(overlay, /`gogame`：命中 `go\.mod`/);
	} finally {
		cleanup(cwd);
		cleanup(root);
	}
});

test("双轨查集成：token 与 .pi/skills/ 松散技能重名 → no-loose-duplicate 失败", () => {
	const cwd = makeProject();
	const root = makeProject();
	try {
		writeModule(root, "gogame");
		writeFileSync(join(cwd, "go.mod"), "");
		mkdirSync(join(cwd, ".pi", "skills", "gogame"), { recursive: true });

		const result = runModuleVerifyPipeline(cwd, { roots: [root] });
		assert.equal(result.reports[0].ok, false);
		const duplicate = result.reports[0].checks.find((item) => item.id === "no-loose-duplicate");
		assert.equal(duplicate?.status, "fail");
	} finally {
		cleanup(cwd);
		cleanup(root);
	}
});

test("entry 读取走模块根：entry 缺失时 entry-size 失败", () => {
	const cwd = makeProject();
	const root = makeProject();
	try {
		mkdirSync(join(root, "ghost-entry", "knowledge"), { recursive: true });
		writeFileSync(
			join(root, "ghost-entry", "module.json"),
			JSON.stringify({
				schema: "jero.module-contract/v1",
				token: "ghost-entry",
				version: "1.0.0",
				triggers: { files: ["go.mod"], intents: [] },
				knowledge: { entry: "knowledge/SKILL.md", references: [] },
				roles: [],
				bindings: { worker: { inject: "entry" } },
				routing: [],
			}),
		);
		writeFileSync(join(cwd, "go.mod"), "");

		const result = runModuleVerifyPipeline(cwd, { roots: [root] });
		const entryCheck = result.reports[0].checks.find((item) => item.id === "entry-size");
		assert.equal(entryCheck?.status, "fail");
	} finally {
		cleanup(cwd);
		cleanup(root);
	}
});

test("根内字典序：多模块报告顺序稳定（覆盖层优先序契约）", () => {
	const cwd = makeProject();
	const root = makeProject();
	try {
		writeModule(root, "zeta-tool");
		writeModule(root, "alpha-tool");
		writeFileSync(join(cwd, "go.mod"), "");

		const result = runModuleVerifyPipeline(cwd, { roots: [root] });
		assert.deepEqual(
			result.reports.map((report) => report.token),
			["alpha-tool", "zeta-tool"],
		);
	} finally {
		cleanup(cwd);
		cleanup(root);
	}
});

test("looseSkillTokens：全局根注入——用户级同名松散技能也入双轨查名单", () => {
	const cwd = makeProject();
	const globalRoot = mkdtempSync(join(tmpdir(), "jero-global-skills-"));
	try {
		mkdirSync(join(cwd, ".pi", "skills", "project-skill"), { recursive: true });
		mkdirSync(join(globalRoot, "gogame"), { recursive: true });

		const tokens = looseSkillTokens(cwd, globalRoot);
		assert.ok(tokens !== undefined);
		assert.deepEqual([...tokens].sort(), ["gogame", "project-skill"]);

		// 两根皆缺 → undefined（检查以 skip 呈现）。
		assert.equal(looseSkillTokens(makeProject(), join(globalRoot, "nope")), undefined);
	} finally {
		cleanup(cwd);
		rmSync(globalRoot, { recursive: true, force: true });
	}
});
