import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseChildFrame } from "../lib/agents-messaging.ts";
import { QUERY_REJECTION_ERRORS } from "../lib/agents-runner-core.ts";

// 契约一致性巡检：横跨多份文档/代码维护的同源契约，在这里用文本级
// 与行为级断言钉住，改一处漏一处时先在这里失败，而不是静默漂移。

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const read = (relative: string): string => readFileSync(join(root, relative), "utf8");

test("Judgment Day 双盲契约在技能、共享正典与法官代理三处措辞一致", () => {
	const sources: Record<string, string> = {
		"skills/judgment-day/SKILL.md": read("skills/judgment-day/SKILL.md"),
		"skills/_shared/review-ledger-contract.md": read("skills/_shared/review-ledger-contract.md"),
	};
	const invariants: [string, RegExp][] = [
		["双盲起点", /exactly two blind judges and zero refuters/],
		["至多两轮", /at most two rounds/],
		["轮次标记", /Round: 1 of 2\./],
	];
	for (const [label, pattern] of invariants) {
		for (const [file, text] of Object.entries(sources)) {
			assert.match(text, pattern, `${file} 缺少 JD 契约「${label}」`);
		}
	}
	assert.match(read("assets/agents/jd-judge-a.md"), /最多两轮/, "法官代理缺少轮次上限措辞");
});

test("委托触发规则在 jero 技能与 orchestrator 提示两处数值一致", () => {
	const skill = read("skills/jero-ai/SKILL.md");
	const orchestrator = read("assets/orchestrator.md");
	const numbers: [string, RegExp][] = [
		["4 文件规则", /4\+ 个文件/],
		["长会话工具调用", /20 次工具调用/],
		["探索性读取", /5 次探索性读取/],
		["非机械编辑", /2 次非机械编辑/],
	];
	for (const [label, pattern] of numbers) {
		assert.match(skill, pattern, `jero 技能缺少「${label}」数值`);
		assert.match(orchestrator, pattern, `orchestrator 提示缺少「${label}」数值（改一处必须同步另一处）`);
	}
});

test("parseChildFrame 的每条拒绝原因都在 QUERY_REJECTION_ERRORS 白名单内", () => {
	const malformed: unknown[] = [
		"not-a-frame",
		42,
		null,
		{},
		{ id: "n1", kind: "notification" },
		{ id: "n1", kind: "notification", message: "hi", extra: 1 },
		{ kind: "notification", message: "hi" },
		{ id: "n1", kind: "other", message: "hi" },
		{ id: "n1", kind: "notification", message: "" },
	];
	const observed = new Set<string>();
	for (const value of malformed) {
		const parsed = parseChildFrame(value);
		if (parsed.error !== undefined) observed.add(parsed.error);
	}
	assert.ok(observed.size >= 3, "巡检输入应覆盖至少三类拒绝路径");
	for (const error of observed) {
		assert.ok(QUERY_REJECTION_ERRORS.has(error), `拒绝原因 "${error}" 不在归一白名单内——父侧会把它泛化成 parent rejected query`);
	}
});
