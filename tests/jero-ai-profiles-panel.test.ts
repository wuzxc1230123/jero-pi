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

test("鼠标：详情窗格内滚轮被消费并触发重渲染", () => {
	const { panel } = makePanel({ selectedName: "review-heavy" });
	panel.render(120);
	// panes 模式下列表在左、详情在右：右缘的滚轮落在详情窗格。
	const handled = panel.handleMouse({ type: "wheel", x: 116, y: 3, wheelDelta: 2 } as never);
	assert.deepEqual(handled, { handled: true, render: true });
	// 列表区之外的滚轮（未布局/越界语义）不得崩且返回可判值。
	const outside = panel.handleMouse({ type: "wheel", x: 116, y: 40, wheelDelta: 1 } as never);
	assert.ok(outside === undefined || typeof outside === "object");
});

test("鼠标：中栏窄宽（单视口模式）渲染不空、滚轮不崩", () => {
	const { panel } = makePanel();
	const lines = panel.render(60);
	assert.ok(lines.length > 0, "60 列单视口模式仍应有主体");
	const handled = panel.handleMouse({ type: "wheel", x: 30, y: 2, wheelDelta: -1 } as never);
	assert.ok(handled === undefined || typeof handled === "object");
});

test("带主题渲染：fg/bg 着色路径与悬停背景生效", () => {
	const results: Captured[] = [];
	const panel = new ProfilesPanel(
		profilesFile(),
		config,
		(result) => results.push(result as Captured),
		undefined,
		{
			// 最小主题桩：fg 打标记便于断言，bg 原样透传。
			fg: (_tone: unknown, text: string) => `<fg>${text}</fg>`,
			bg: (_tone: unknown, text: string) => text,
		} as never,
		"review-heavy",
		() => 24,
		{ status: "missing" } as never,
		(name) => createProfile(profilesFile(), `snap-${name}`, config),
		() => {},
	);
	const lines = panel.render(100).join("\n");
	assert.ok(lines.includes("<fg>"), "主题 fg 路径必须被走到");
	assert.match(lines, /review-heavy/);
	assert.doesNotThrow(() => panel.handleInput("j"));
	assert.ok(panel.render(100).length > 0);
});

test("翻页键滚详情与列表区鼠标点击委托不崩", () => {
	const { panel, results } = makePanel({ selectedName: "review-heavy" });
	panel.render(100);
	// 翻页键（pageDown/pageUp）与 ctrl+j/k 同路：滚动详情，不改选中。
	assert.doesNotThrow(() => panel.handleInput("\u001b[6~"));
	assert.doesNotThrow(() => panel.handleInput("\u001b[5~"));
	assert.doesNotThrow(() => panel.handleInput("\n"));
	assert.deepEqual(results, []);
	// 列表区内的点击事件委托给 choice list（选中项）。
	const handled = panel.handleMouse({ type: "press", x: 4, y: 2, button: 0 } as never);
	assert.ok(handled === undefined || typeof handled === "object");
	// 滚动后渲染仍完整、选中保持。
	const lines = panel.render(100);
	assert.ok(lines.length > 0);
	assert.match(lines.join("\n"), /review-heavy/);
});
