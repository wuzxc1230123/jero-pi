import { test } from "node:test";
import assert from "node:assert/strict";
import {
	bootstrapProfilesFile,
	createProfile,
	type AgentProfilesFile,
} from "../lib/agent-profiles.ts";
import { normalizeModelConfig } from "../lib/model-routing-authority.ts";
import { ProfilesPanel } from "../lib/jero-ai-profiles-panel.ts";
import type { OrchestratorSettingsReadResult } from "../lib/profiles-orchestrator.ts";

// jero-ai-profiles-panel 域测试：面板行为（构造器全依赖注入）——
// 结果回调、键路由、快照反馈、渲染外框与窄宽回退。
// 列表组件自身的行为由 native-choice-list.test.ts 钉住。

const config = normalizeModelConfig({ "jero-worker": "provider/small" }) ?? {};

function profilesFile(): AgentProfilesFile {
	let file = bootstrapProfilesFile(config);
	file = createProfile(file, "review-heavy", normalizeModelConfig({ "jero-worker": "provider/deep" }) ?? {});
	return file;
}

interface Captured {
	type: string;
	name?: string;
}

function makePanel(overrides: {
	file?: AgentProfilesFile;
	selectedName?: string;
	saveSnapshot?: (name: string) => AgentProfilesFile;
} = {}) {
	const results: Captured[] = [];
	let file = overrides.file ?? profilesFile();
	const renders: number[] = [];
	const panel = new ProfilesPanel(
		file,
		config,
		(result) => results.push(result as Captured),
		undefined,
		undefined,
		overrides.selectedName,
		() => 24,
		{ status: "missing" } as OrchestratorSettingsReadResult,
		(name) => {
			const saved = overrides.saveSnapshot
				? overrides.saveSnapshot(name)
				: createProfile(file, `snap-${name}`, config);
			file = saved;
			return saved;
		},
		() => renders.push(1),
	);
	return { panel, results, renders };
}

test("渲染：外框 + 两个 profile 在列，选中项可初选", () => {
	const { panel } = makePanel({ selectedName: "review-heavy" });
	const lines = panel.render(100);
	const joined = lines.join("\n");
	assert.ok(lines.length >= 10, `面板应有主体行，实际 ${lines.length}`);
	assert.match(joined, /current/);
	assert.match(joined, /review-heavy/);
	assert.match(joined, /enter apply/);
});

test("esc / ctrl+c → close", () => {
	const esc = makePanel();
	esc.panel.handleInput("\u001b");
	assert.deepEqual(esc.results, [{ type: "close" }]);

	const ctrlC = makePanel();
	ctrlC.panel.handleInput("\u0003");
	assert.deepEqual(ctrlC.results, [{ type: "close" }]);
});

test("enter → apply 当前选中；方向键移动后 apply 新选中", () => {
	const { panel, results } = makePanel({ selectedName: "current" });
	panel.handleInput("\r");
	assert.deepEqual(results, [{ type: "apply", name: "current" }]);

	const moved = makePanel({ selectedName: "current" });
	moved.panel.handleInput("\u001b[B");
	moved.panel.handleInput("\r");
	assert.deepEqual(moved.results, [{ type: "apply", name: "review-heavy" }]);
});

test("字母操作键路由：c/i 与 d/r/x/e 带选中名", () => {
	const create = makePanel();
	create.panel.handleInput("c");
	assert.deepEqual(create.results, [{ type: "create" }]);

	const importKeys = makePanel();
	importKeys.panel.handleInput("i");
	assert.deepEqual(importKeys.results, [{ type: "import" }]);

	for (const [key, type] of [["d", "duplicate"], ["r", "rename"], ["x", "delete"], ["e", "export"]] as const) {
		const panel = makePanel({ selectedName: "review-heavy" });
		panel.panel.handleInput(key);
		assert.deepEqual(panel.results, [{ type, name: "review-heavy" }]);
	}
});

test("s → 快照成功反馈并触发重渲染", () => {
	const { panel, renders } = makePanel({ selectedName: "current" });
	panel.handleInput("s");
	assert.equal(renders.length, 1);
	const lines = panel.render(100).join("\n");
	assert.match(lines, /Snapshot saved/);
	assert.match(lines, /"current"/);
});

test("s → 快照失败反馈（live routing unchanged）", () => {
	const { panel } = makePanel({
		selectedName: "current",
		saveSnapshot: () => {
			throw new Error("disk full");
		},
	});
	panel.handleInput("s");
	const lines = panel.render(200).join("\n");
	assert.match(lines, /Snapshot failed/);
	assert.match(lines, /disk full/);
});

test("j/k 滚动详情且不改变选中；再按 enter 仍 apply 原名", () => {
	const { panel, results } = makePanel({ selectedName: "review-heavy" });
	panel.handleInput("j");
	panel.handleInput("j");
	panel.handleInput("k");
	assert.deepEqual(results, []);
	panel.handleInput("\r");
	assert.deepEqual(results, [{ type: "apply", name: "review-heavy" }]);
});

test("窄宽回退：render 返回空且清掉指针布局，鼠标事件未布局时返回 undefined", () => {
	const { panel } = makePanel();
	assert.deepEqual(panel.render(10), []);
	// 未布局（或布局被清）时鼠标事件不处理。
	const handled = panel.handleMouse({ type: "wheel", x: 1, y: 1, wheelDelta: 1 } as never);
	assert.equal(handled, undefined);
});

test("invalidate 幂等且随后渲染正常", () => {
	const { panel } = makePanel();
	panel.render(120);
	panel.invalidate();
	panel.invalidate();
	const lines = panel.render(120);
	assert.ok(lines.length > 0);
});
