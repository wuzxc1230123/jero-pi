// sdd-init 命令编排——栈探测与写盘的业务逻辑，从扩展下沉至此以便测试：
// 预检经 deps 注入（真宿主装真实现，测试装 stub），与 module-verify-pipeline
// 同法。探测引擎本体在 lib/sdd-project-detect.ts。

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_REL_PATH, detectProject, ensureOpenSpecDirs, renderConfig } from "./sdd-project-detect.ts";

export interface SddInitCtx {
	readonly cwd: string;
	readonly hasUI: boolean;
	readonly ui: { notify: (message: string, level: "info" | "warning") => void };
}

export interface SddInitPrefs {
	readonly artifactStore: "openspec" | "engram" | "hybrid" | "none";
}

export interface SddInitDeps {
	/** 会话预检（真宿主实现：资产安装 + 模型应用 + 确认仪式）。 */
	readonly ensureSddPreflight: (ctx: SddInitCtx) => Promise<SddInitPrefs>;
}

/**
 * 命令主体。RPC/headless 宿主（hasUI=false）只做检测与写盘，绝不对
 * noOp ui 发通知。
 */
export async function runSddInitCommand(ctx: SddInitCtx, deps: SddInitDeps): Promise<void> {
	const notify = (message: string, level: "info" | "warning"): void => {
		if (ctx.hasUI) ctx.ui.notify(message, level);
	};
	const prefs = await deps.ensureSddPreflight(ctx);

	const detection = detectProject(ctx.cwd);
	const testSummary = detection.testCommand
		? `strict TDD enabled with \`${detection.testCommand}\``
		: "strict TDD disabled because no test runner was detected";
	const layerSummary = `unit: ${detection.commands.unit.length}, integration: ${detection.commands.integration.length}, e2e: ${detection.commands.e2e.length}`;

	const shouldCreateOpenSpec =
		prefs.artifactStore === "openspec" ||
		prefs.artifactStore === "hybrid";
	if (!shouldCreateOpenSpec) {
		notify(
			`SDD initialized for ${prefs.artifactStore}: detected ${detection.stack.join(", ") || "project"}; ${testSummary}; tests found: ${layerSummary}.`,
			"info",
		);
		return;
	}

	const configPath = join(ctx.cwd, CONFIG_REL_PATH);
	if (existsSync(configPath)) {
		notify(
			`${CONFIG_REL_PATH} already exists. Edit it manually or remove it before re-running /jero-sdd-init.`,
			"warning",
		);
		return;
	}

	ensureOpenSpecDirs(ctx.cwd);
	mkdirSync(dirname(configPath), { recursive: true });
	// `wx` 排他创建：existsSync 与写入之间的窗口里并发会话/用户手工创建的
	// 配置不被覆盖（失败 = 有人先到，按已存在处理）。
	try {
		writeFileSync(configPath, renderConfig(detection), { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			notify(`${CONFIG_REL_PATH} already exists; leaving it untouched.`, "warning");
			return;
		}
		throw error;
	}

	notify(
		`Wrote ${CONFIG_REL_PATH}: detected ${detection.stack.join(", ") || "project"}; ${testSummary}; tests found: ${layerSummary}.`,
		"info",
	);
}

/**
 * 会话启动的 SDD 强制初始化（脚手架专用面）：openspec/config.yaml 缺席
 * 时探测技术栈并落项目脚手架，已就位时零成本跳过。**只动项目侧文件**——
 * SDD 管理资产（代理/链/支撑）保持懒加载不变量（新会话不预装，首次
 * SDD 使用经预检安装——asset-installation-runtime 测试钉住的行为），
 * 故本函数不触碰会话 ctx 的生命周期面（可在 session_start 同步 await，
 * 无 stale-ctx 风险）。偏好存储为 engram/none 时尊重用户显式选择不落
 * 脚手架（持久化偏好经 deps 注入读取——本模块不读盘不读环境）。
 */
export interface SddAutoInitDeps {
	/** 读持久化的工件存储偏好（无记录时调用方决定缺省，通常 openspec）。 */
	readonly readArtifactStore: (cwd: string) => SddInitPrefs["artifactStore"];
}

export async function runSddAutoInit(ctx: SddInitCtx, deps: SddAutoInitDeps, enabled: boolean): Promise<boolean> {
	if (!enabled) return false;
	const configPath = join(ctx.cwd, CONFIG_REL_PATH);
	if (existsSync(configPath)) return false;
	const store = deps.readArtifactStore(ctx.cwd);
	if (store !== "openspec" && store !== "hybrid") return false;
	const detection = detectProject(ctx.cwd);
	ensureOpenSpecDirs(ctx.cwd);
	mkdirSync(dirname(configPath), { recursive: true });
	// `wx` 排他创建天然幂等：并发会话启动双写只有一个成功，失败方零成本
	// 跳过（内容除日期外相同，良性竞争）。
	try {
		writeFileSync(configPath, renderConfig(detection), { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
	if (ctx.hasUI) {
		ctx.ui.notify(
			`Wrote ${CONFIG_REL_PATH}: detected ${detection.stack.join(", ") || "project"}; strict TDD ${detection.testCommand ? `enabled with \`${detection.testCommand}\`` : "disabled because no test runner was detected"}.`,
			"info",
		);
	}
	return true;
}
