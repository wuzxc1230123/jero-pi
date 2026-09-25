import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const ASSETS = join(ROOT, "assets");
const BOUNDARY =
	"本包启动时把镜像的提供方捆绑评审执行契约注入本会话系统提示；Jero 不向 Pi 系统提示写入任何内容，本包拥有此处其余一切。缺少该镜像契约时，本包不发明生命周期指令。";

function read(relativePath: string): string {
	return readFileSync(join(ROOT, relativePath), "utf8");
}

const core = read("assets/orchestrator.md");
const delegation = read("assets/orchestrator-delegation.md");
const staticPrompts = `${core}\n${delegation}`;

test("static prompts omit stale native RDD lifecycle mirrors", () => {
	for (const marker of [
		"Authority-First Terminal Procedure",
		"reconcile-terminal-mirrors",
		"Native Bounded Review Orchestration",
		"Continue after a stop reason code",
		"gentle-ai review status",
		"next_transition",
		"start -> finalize -> validate",
		"review.capture-result",
		"review.validate",
		"reviewGate.result",
	]) {
		assert.ok(!staticPrompts.includes(marker), `stale RDD marker remains: ${marker}`);
	}
});

test("lossless blocking prompts keep strict closed envelopes off the free-text questionnaire tool", () => {
	for (const clause of [
		"jero-pi 不内置封闭单选问卷工具",
		"外部所有的 `ask_user_question` 总会追加自己的自由文本哨兵行，因此严格封闭的封套永远无法经由它精确表达",
		"绝不将它用于提供方所有的同意提示、维护授权或任何精确的不透明令牌决策",
		"绝不把其自由文本答案送入不透明令牌映射",
		"所选延续仍是精确捕获的提供方所有选择调用",
		"绝不把该宿主动作追加到已解码或已中继的提供方封套",
		"若运行时返回未裁决封套，上述原始双选择回退不变适用",
	]) {
		assert.ok(delegation.includes(clause), `lossless prompt is missing: ${clause}`);
	}
});

test("static prompts declare one dynamic Jero RDD ownership boundary", () => {
	assert.equal(staticPrompts.split(BOUNDARY).length - 1, 1, "expected one dynamic RDD ownership boundary");
	assert.ok(core.includes(BOUNDARY), "the Pi parent prompt owns the single boundary");
	assert.ok(!delegation.includes(BOUNDARY), "generic delegation detail must not gain RDD text");
});

test("rendered parent prompt keeps the RDD boundary while omitting lifecycle mirrors", async () => {
	const { __testing } = await import("../extensions/jero-ai.ts");
	const rendered = __testing.getOrchestratorPrompt();
	assert.ok(rendered.includes(BOUNDARY));
	for (const marker of ["Authority-First Terminal Procedure", "reconcile-terminal-mirrors", "next_transition"]) {
		assert.ok(!rendered.includes(marker), `rendered parent prompt leaked: ${marker}`);
	}
	// gentle-pi#661: getOrchestratorPrompt()'s no-argument default renders the
	// "unknown (native status unavailable)" RDD status line -- the longest of
	// the three renderable forms -- so this IS the worst-case render the 8 KiB
	// budget below must cover, not a smaller placeholder production later
	// exceeds.
	assert.ok(
		rendered.includes("Receipt-driven development: unknown (native status unavailable)"),
		"the default render must include the worst-case RDD status line",
	);
	assert.ok(Buffer.byteLength(rendered, "utf8") <= 8192, "the rendered parent prompt must stay below the reduced 8 KiB budget");
});

test("static prompts retain normal SDD and delegated-work guidance", () => {
	for (const heading of ["## SDD 工作流（懒加载）", "## 记忆契约"]) {
		assert.ok(core.includes(heading), `core lost ${heading}`);
	}
	for (const heading of [
		"### 委托规则",
		"#### Background Subagent Policy",
		"#### Allowed edit surfaces (MANDATORY)",
		"### 3. SDD（可选）",
	]) {
		assert.ok(delegation.includes(heading), `delegation lost ${heading}`);
	}
});

test("always-on parent prompt requires a narrow writer edit surface before launch", () => {
	assert.match(core, /启动有界写者/);
	assert.match(core, /`jero-worker`/);
	assert.match(core, /`worker`/);
	assert.match(core, /## Allowed edit surfaces/);
	assert.match(core, /仓库相对路径/);
	assert.match(core, /绝不使用 `\.`、裸仓库根/);
	assert.match(core, /不要让人类撰写路径或 glob/);
});

