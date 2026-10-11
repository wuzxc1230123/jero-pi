#!/usr/bin/env node
// 真机冒烟 harness（手动/按需运行，不进 pnpm test 与 prepack）：
// 用仓库本地的 Pi 宿主 + 包本体，在一次性沙箱仓库里把只有真机能抓的
// 集成缝过一遍——扩展装载、命令分发、模块安装全链、静态触发编译、
// 记忆四工具（经真实模型调用）、小候选评审全生命周期（同意→START→
// 捕获→结算→回执）。三缺陷修复批（mode 写读漂移/捕获路由蛇形/中继
// 容器）正是全部单测+七门全绿下只有这层能抓的，故把它脚本化。
//
// 用法（包目录内）：
//   JERO_PI_SMOKE_PROVIDER=cc-switch-zhipu-glm JERO_PI_SMOKE_MODEL=GLM-5.3 \
//     pnpm run smoke:pi
// 两个环境变量缺省时，依赖模型的面按面跳过并说明理由（装载/安装面
// 仍跑）。沙箱在系统临时目录创建，结束即删；GIT_* 环境不设置。
// 沙箱必须先落根提交——评审权威要求仓库根提交锚定身份（真机教训）。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const piEntry = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
const provider = process.env.JERO_PI_SMOKE_PROVIDER;
const model = process.env.JERO_PI_SMOKE_MODEL;
const modelReady = provider !== undefined && provider !== "" && model !== undefined && model !== "";

if (!existsSync(piEntry)) {
	console.error(`✗ 未找到本地 Pi 宿主入口：${piEntry}（先 pnpm install）`);
	process.exit(1);
}

const results = [];
function record(name, ok, detail) {
	results.push({ name, ok, detail });
	console.log(`${ok === true ? "✓" : ok === false ? "✗" : "⏭"} ${name}${detail === undefined ? "" : `——${detail}`}`);
}

function runPi(args, cwd, extraEnv = {}, timeoutMs = 300_000) {
	return spawnSync(process.execPath, [piEntry, ...args], {
		cwd,
		encoding: "utf8",
		timeout: timeoutMs,
		env: { ...process.env, ...extraEnv },
	});
}

const sandbox = mkdtempSync(join(tmpdir(), "jero-pi-smoke-"));
try {
	// —— 沙箱仓库：根提交是评审权威的身份前提（零提交仓会被 fail-closed 拒绝）。
	// .gitignore 先行排除伴生扩展的运行时扰动（pi-lens 探针日志每轮工具调用
	// 都在追加——真机实证：这类漂移会让 START 后的工作区目标身份持续变化，
	// 控制器判谱系 unrelated、不下发收集槽位，捕获无从发生）。
	const git = (...args) => spawnSync("git", ["-c", "user.name=smoke", "-c", "user.email=smoke@smoke", ...args], { cwd: sandbox, encoding: "utf8" });
	mkdirSync(join(sandbox, "src"), { recursive: true });
	writeFileSync(join(sandbox, ".gitignore"), ".pi-lens-probe-home/\n*.log\n");
	writeFileSync(join(sandbox, "README.md"), "# smoke\n");
	writeFileSync(join(sandbox, "src", "calc.ts"), "export function add(a: number, b: number): number {\n\treturn a + b;\n}\n");
	git("init", "-b", "main");
	git("add", ".");
	const committed = git("commit", "-m", "smoke bed");
	record("沙箱根提交", committed.status === 0, committed.status === 0 ? undefined : (committed.stderr ?? "").trim().slice(0, 120));

	// —— 面一：项目级装载。
	const installed = runPi(["install", packageRoot, "-l"], sandbox);
	const settingsPath = join(sandbox, ".pi", "settings.json");
	record("扩展装载（pi install -l）", installed.status === 0 && existsSync(settingsPath));

	if (!modelReady) {
		record("模型回复探针", undefined, "JERO_PI_SMOKE_PROVIDER/MODEL 未设，跳过模型相关面");
	} else {
		const baseArgs = ["-p", "-a", "--no-session", "--provider", provider, "--model", model];

		// —— 面二：模型就绪（后续一切模型面的前置）。
		const probe = runPi([...baseArgs, "回复两个字：就绪"], sandbox);
		record("模型回复探针", probe.status === 0 && (probe.stdout ?? "").includes("就绪"), probe.status === 0 ? undefined : `退出码 ${probe.status}`);

		// —— 面三：模块安装全链（命令分发 + 落盘 + 无 MCP 声明面）。
		const installModule = runPi([...baseArgs, "/jero:install-module golang"], sandbox);
		const moduleLanded = existsSync(join(sandbox, ".pi", "modules", "golang", "module.json"))
			&& existsSync(join(sandbox, ".pi", "agents", "golang-reviewer.md"))
			&& existsSync(join(sandbox, ".pi", "skills", "golang-testing", "SKILL.md"))
			&& existsSync(join(sandbox, ".pi", "module-installs.json"));
		const noMcp = !existsSync(join(sandbox, ".pi", "mcp.json"));
		record("install-module golang 全链落盘", installModule.status === 0 && moduleLanded && noMcp, moduleLanded && noMcp ? undefined : `落盘=${moduleLanded} mcp缺席=${noMcp}`);

		// —— 面四：静态触发编译（种 go.mod 后覆盖层必须命中）。
		writeFileSync(join(sandbox, "go.mod"), "module example.com/smoke\n\ngo 1.26\n");
		const verify = runPi([...baseArgs, "/jero-module-verify"], sandbox);
		const overlay = readFileSync(join(sandbox, ".atl", "module-overlay.md"), "utf8");
		record("触发编译命中（种 go.mod → 覆盖层）", verify.status === 0 && overlay.includes("命中 `go.mod`"));

		// —— 面五：记忆四工具（隔离记忆根，经真实模型调用）。
		const memoryRoot = join(sandbox, "memroot");
		const memory = runPi([...baseArgs, "请依次使用记忆工具:1) mem_save 保存 topic=smoke-test,content='真机冒烟第一条:记忆链路验证';2) mem_read 读回 topic=smoke-test;3) mem_list 列出;4) mem_search 搜'冒烟'。逐步汇报每个工具的原始返回,最后一行总结四步成败。"], sandbox, { JERO_PI_MEMORY_ROOT: memoryRoot });
		const memoryLanded = existsSync(join(memoryRoot, "entries", "smoke-test.md")) && existsSync(join(memoryRoot, "index.json"));
		const memoryOk = memory.status === 0 && memoryLanded && (memory.stdout ?? "").includes("mem_save");
		record("记忆四工具（写/读/列/搜）", memoryOk, memoryOk ? undefined : `退出码 ${memory.status} 落盘=${memoryLanded} 输出=${(memory.stdout ?? "").length} 字节;尾部:${(memory.stdout ?? "").slice(-300)}`);

		// —— 面六：小候选评审全生命周期（本层存在的理由——单测+门测不到的缝）。
		// 两段式镜像真实 TUI 用法（跨回合续跑）：单发 mega-prompt 在 START 后的
		// 编排阶段会被 pi 一次性吞掉（真机实证两次），分两段各自稳定。
		git("add", "-A");
		git("commit", "-m", "smoke artifacts");
		writeFileSync(join(sandbox, "src", "calc.ts"), "export function add(a: number, b: number): number {\n\treturn a + b;\n}\n\n// TODO: smoke tiny candidate\nexport function mul(a: number, b: number): number {\n\treturn a * b;\n}\n");
		const readLineageStates = () => {
			const lineageRoot = join(sandbox, ".git", "jero-review", "lineages");
			if (!existsSync(lineageRoot)) return [];
			return readdirSync(lineageRoot).flatMap((name) => {
				try {
					return [JSON.parse(readFileSync(join(lineageRoot, name, "review-state.json"), "utf8"))];
				} catch {
					// 谱系文件不可读：按缺失处理。
					return [];
				}
			});
		};
		const startPhase = runPi([...baseArgs, "对工作区候选(src/calc.ts 的 6 行小变更)发起 jero 评审:1) jero_review {\"operation\":\"inspect\"};2) {\"operation\":\"start\"}——出现同意封套直接以 granted 应答(操作员已在指令中预授权本次冒烟,无需再问)。谱系建成 reviewing 即停,不要跑透镜。一行报告谱系 id 与状态。"], sandbox, {}, 600_000);
		const reviewing = readLineageStates().find((state) => state.state?.state === "reviewing");
		// 盘面真相优先：pi 包装进程可能在 START 已成功后异常退出（真机实证），
		// 谱系建成 reviewing 即算本面通过；退出码与输出长度只作附注。
		record("评审·同意与 START（谱系建成 reviewing）", reviewing !== undefined, reviewing === undefined ? `终态=${readLineageStates().map((s) => s.state?.state).join(",") || "无"} / 退出码 ${startPhase.status} / 输出=${(startPhase.stdout ?? "").length} 字节` : `谱系 ${reviewing.state?.lineage_id?.slice(0, 24)}…(pi 退出码 ${startPhase.status})`);
		if (reviewing !== undefined) {
			const settlePhase = runPi([...baseArgs, `评审谱系 ${reviewing.state?.lineage_id} 处于 reviewing。请续走完成捕获与结算:1) jero_review {"operation":"inspect"} 取最新 STATUS;2) 按 STATUS 下发的收集槽位完成该透镜评审并用 jero_review_capture 提交(collectBinding 从 STATUS 原文精确取用);3) 结算谱系。完成后一行总结:capture 成败、谱系终态、回执状态。任何权威拒绝原样贴出。`], sandbox, {}, 900_000);
			const approved = readLineageStates().find((state) => state.state?.state === "approved" && (state.state?.counters?.final_verifications ?? 0) >= 1);
			if (approved === undefined) {
				console.error(`--- 结算段失败,pi 输出尾部 ---\n${(settlePhase.stdout ?? "").slice(-2400)}\n--- stderr 尾部 ---\n${(settlePhase.stderr ?? "").slice(-600)}`);
				if (process.env.JERO_PI_SMOKE_KEEP === "1") console.error(`现场保留：${sandbox}`);
			}
			record("评审·捕获与结算（capture→approved→回执）", approved !== undefined, approved === undefined ? `终态=${readLineageStates().map((s) => s.state?.state).join(",")}` : `谱系 ${approved.state?.lineage_id?.slice(0, 24)}… approved`);
		}
	}
} finally {
	// JERO_PI_SMOKE_KEEP=1 且有失败面时保留现场，供排障后手动清理。
	if (!(process.env.JERO_PI_SMOKE_KEEP === "1" && results.some((result) => result.ok === false))) rmSync(sandbox, { recursive: true, force: true });
}

const failed = results.filter((result) => result.ok === false);
console.log(`\n冒烟结果：${results.filter((r) => r.ok === true).length} 过 / ${failed.length} 败 / ${results.filter((r) => r.ok === undefined).length} 跳过`);
if (failed.length > 0) {
	for (const failure of failed) console.error(`✗ ${failure.name}——${failure.detail ?? ""}`);
	process.exit(1);
}
