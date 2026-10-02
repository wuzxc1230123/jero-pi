import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectProject, renderConfig } from "../lib/sdd-project-detect.ts";

// 栈探测引擎自 extensions/sdd-init.ts 下沉后首次获得直接覆盖：
// 钉住三族代表性探测与 config.yaml 渲染形状，防止后续改动静默漂移。

test("detectProject maps a Node package to stack, package manager and test command", () => {
	const base = mkdtempSync(join(tmpdir(), "jero-sdd-detect-"));
	try {
		writeFileSync(join(base, "package.json"), JSON.stringify({ name: "demo-app", type: "module", scripts: { test: "node --test" }, devDependencies: { vitest: "^3" } }));
		writeFileSync(join(base, "pnpm-lock.yaml"), "");
		const detection = detectProject(base);
		assert.equal(detection.projectName, "demo-app");
		assert.ok(detection.stack.includes("Node.js/TypeScript ESM"));
		assert.ok(detection.packageManagers.includes("pnpm"));
		assert.ok(detection.testCommand?.includes("test"));
		const config = renderConfig(detection);
		assert.match(config, /^strict_tdd: true\n/);
		assert.match(config, /context: \|/);
		assert.match(config, /unit:\n\s+- scope: "\."/);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("detectProject disables strict TDD when no test runner is found", () => {
	const base = mkdtempSync(join(tmpdir(), "jero-sdd-detect-empty-"));
	try {
		mkdirSync(join(base, "docs"), { recursive: true });
		writeFileSync(join(base, "docs", "note.md"), "plain docs");
		const detection = detectProject(base);
		assert.equal(detection.testCommand, undefined);
		assert.match(renderConfig(detection), /^strict_tdd: false\n/);
		assert.ok(detection.stack.includes("Unclassified software project"));
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("detectProject honors a generic manifest hint alongside Makefile preference", () => {
	const base = mkdtempSync(join(tmpdir(), "jero-sdd-detect-hint-"));
	try {
		writeFileSync(join(base, "pom.xml"), "<project/>");
		writeFileSync(join(base, "Makefile"), "test:\n\tmvn test\n");
		const detection = detectProject(base);
		assert.ok(detection.stack.includes("Java/Maven"));
		// Makefile 的 test: 目标优先于通用清单提示（prefer=true）。
		assert.equal(detection.testCommand, "make test");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("detectProject refuses shell-metacharacter scope names instead of building cd commands", () => {
	const base = mkdtempSync(join(tmpdir(), "jero-sdd-evil-"));
	try {
		const evil = join(base, "x; curl evil");
		mkdirSync(evil, { recursive: true });
		writeFileSync(join(evil, "package.json"), JSON.stringify({ name: "evil", scripts: { test: "echo hi" } }));
		const detection = detectProject(base);
		const commands = [
			...detection.commands.unit,
			...detection.commands.integration,
			...detection.commands.e2e,
			...detection.commands.coverage,
			...detection.commands.lint,
			...detection.commands.typecheck,
			...detection.commands.format,
		];
		for (const command of commands) {
			assert.ok(!command.command.includes("cd x;"), `危险目录名不得生成可执行 cd 命令：${command.command}`);
			assert.ok(command.command.includes("scope skipped") || !command.command.startsWith("cd "), `元字符 scope 只能是跳过通知：${command.command}`);
		}
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});
