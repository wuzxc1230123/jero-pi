import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	guardReportLines,
	guardTemplateLines,
	resolveGuardrailsStatus,
} from "../lib/jero-ai-guard-report.ts";

// jero-ai-guard-report 域测试：护栏配置报告的来源链解析与渲染。
// 配置根全部经 options 注入临时目录，不碰真实 home。

function makeDirs(): { cwd: string; configHome: string } {
	const cwd = mkdtempSync(join(tmpdir(), "jero-guard-report-cwd-"));
	const configHome = mkdtempSync(join(tmpdir(), "jero-guard-report-home-"));
	return { cwd, configHome };
}

function projectGuardFile(cwd: string): string {
	return join(cwd, ".pi", "jero", "runtime-guardrails.json");
}

function globalGuardFile(configHome: string): string {
	return join(configHome, "runtime-guardrails.json");
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(value), "utf8");
}

function cleanup(...dirs: string[]): void {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

test("无任何配置：默认非自主模式，全部镜像确认来源", () => {
	const { cwd, configHome } = makeDirs();
	try {
		const status = resolveGuardrailsStatus(cwd, { jeroPiConfigHome: configHome, env: {} });
		assert.equal(status.autonomousMode, false);
		assert.equal(status.modeSource, "default");
		assert.equal(status.globalFileExists, false);
		assert.equal(status.projectFileExists, false);
		assert.equal(status.parseError, undefined);
		assert.equal(status.commands.length, 5);
		for (const command of status.commands) {
			assert.equal(command.action, "mirror-confirm");
			assert.equal(command.source, "non-autonomous-mirror");
		}
	} finally {
		cleanup(cwd, configHome);
	}
});

test("全局配置开自主模式：默认动作来自 autonomous-default", () => {
	const { cwd, configHome } = makeDirs();
	try {
		writeJson(globalGuardFile(configHome), {
			schema: "jero.authority.runtime-guardrails/v1",
			autonomousMode: true,
			guardedCommands: {},
		});
		const status = resolveGuardrailsStatus(cwd, { jeroPiConfigHome: configHome, env: {} });
		assert.equal(status.autonomousMode, true);
		assert.equal(status.modeSource, "global");
		assert.equal(status.globalFileExists, true);
		for (const command of status.commands) {
			assert.equal(command.source, "autonomous-default");
			assert.notEqual(command.action, "mirror-confirm");
		}
	} finally {
		cleanup(cwd, configHome);
	}
});

test("项目配置覆盖全局：modeSource=project，覆盖键带 project 来源", () => {
	const { cwd, configHome } = makeDirs();
	try {
		writeJson(globalGuardFile(configHome), {
			autonomousMode: false,
			guardedCommands: { gitPush: "confirm" },
		});
		writeJson(projectGuardFile(cwd), {
			autonomousMode: true,
			guardedCommands: { gitPush: "block", npmPublish: "allow" },
		});
		const status = resolveGuardrailsStatus(cwd, { jeroPiConfigHome: configHome, env: {} });
		assert.equal(status.autonomousMode, true);
		assert.equal(status.modeSource, "project");
		const push = status.commands.find((command) => command.key === "gitPush");
		assert.equal(push?.action, "block");
		assert.equal(push?.source, "project");
		const publish = status.commands.find((command) => command.key === "npmPublish");
		assert.equal(publish?.action, "allow");
		assert.equal(publish?.source, "project");
		// 未覆盖键在自主模式下回落 autonomous-default。
		const rebase = status.commands.find((command) => command.key === "gitRebase");
		assert.equal(rebase?.source, "autonomous-default");
	} finally {
		cleanup(cwd, configHome);
	}
});

test("环境变量强制自主模式：优先级最高，文件不解析", () => {
	const { cwd, configHome } = makeDirs();
	try {
		writeJson(globalGuardFile(configHome), { autonomousMode: false, guardedCommands: {} });
		const status = resolveGuardrailsStatus(cwd, {
			jeroPiConfigHome: configHome,
			env: { JERO_PI_AUTONOMOUS_MODE: "1" },
		});
		assert.equal(status.autonomousMode, true);
		assert.equal(status.modeSource, "env");
		for (const command of status.commands) {
			assert.equal(command.source, "autonomous-default");
		}
	} finally {
		cleanup(cwd, configHome);
	}
});

test("坏配置文件：parseError 报告并保守回退默认", () => {
	const { cwd, configHome } = makeDirs();
	try {
		mkdirSync(join(globalGuardFile(configHome), ".."), { recursive: true });
		writeFileSync(globalGuardFile(configHome), "{ 坏掉", "utf8");
		const status = resolveGuardrailsStatus(cwd, { jeroPiConfigHome: configHome, env: {} });
		assert.match(status.parseError ?? "", /全局配置不是合法的 runtime-guardrails\.json/);
		assert.equal(status.autonomousMode, false);
		assert.equal(status.modeSource, "default");
	} finally {
		cleanup(cwd, configHome);
	}
});

test("guardReportLines：状态行、命令行、硬拒绝与模板段齐全", () => {
	const { cwd, configHome } = makeDirs();
	try {
		const lines = guardReportLines(cwd, { jeroPiConfigHome: configHome, env: {} });
		const report = lines.join("\n");
		assert.match(report, /el Jero guard —— 防护配置总览/);
		assert.match(report, /autonomousMode: off（来源：default）/);
		assert.match(report, /全局配置文件: .+（不存在，可创建）/);
		assert.match(report, /项目配置文件: .+（不存在，可创建）/);
		assert.match(report, /confirm（默认镜像确认）（来源：non-autonomous-mirror）/);
		assert.match(report, /永远硬拒绝（不可配置，共 \d+ 类）/);
		assert.match(report, /敏感路径护栏/);
		assert.match(report, /后台子代理：/);
		assert.match(report, /照抄模板/);
		assert.match(report, /JERO_PI_AUTONOMOUS_MODE=1/);
	} finally {
		cleanup(cwd, configHome);
	}
});

test("guardReportLines：parseError 以 warn 行呈现", () => {
	const { cwd, configHome } = makeDirs();
	try {
		mkdirSync(join(projectGuardFile(cwd), ".."), { recursive: true });
		writeFileSync(projectGuardFile(cwd), "not-json", "utf8");
		const report = guardReportLines(cwd, { jeroPiConfigHome: configHome, env: {} }).join("\n");
		assert.match(report, /warn: 项目配置不是合法的 runtime-guardrails\.json/);
	} finally {
		cleanup(cwd, configHome);
	}
});

test("guardTemplateLines：五键模板 + 指引行", () => {
	const lines = guardTemplateLines("/repo/.pi/jero/runtime-guardrails.json");
	const template = lines.join("\n");
	assert.match(template, /```json/);
	assert.match(template, /"autonomousMode": true/);
	for (const key of ["gitPush", "gitRebase", "gitBranchDeleteForce", "npmPublish", "piRemove"]) {
		assert.match(template, new RegExp(`"${key}": `));
	}
	assert.match(template, /allow \| confirm \| block/);
	assert.match(template, /\/repo\/\.pi\/jero\/runtime-guardrails\.json/);
	assert.match(template, /jero\.background-subagents\/v1/);
});
