#!/usr/bin/env node
// 真机冒烟 harness（手动/按需运行，不进 pnpm test 与 prepack）：
// 用仓库本地的 Pi 宿主 + 包本体，在一次性沙箱仓库里把只有真机能抓的
// 集成缝过一遍——扩展装载、命令分发、SDD 强制初始化（首次会话自动
// 脚手架）、模块安装全链（库内四束齐装 +
// godot 束 v2 MCP 档合并面）、静态触发编译（四束触发文件齐射）、
// 记忆四工具（经真实模型调用）、小候选评审全生命周期（同意→START→
// 捕获→结算→回执）。三缺陷修复批（mode 写读漂移/捕获路由蛇形/中继
// 容器）正是全部单测+七门全绿下只有这层能抓的，故把它脚本化。
//
// 用法（包目录内）：
//   JERO_PI_SMOKE_PROVIDER=cc-switch-zhipu-glm JERO_PI_SMOKE_MODEL=GLM-5.3 \
//     pnpm run smoke:pi
// 两个环境变量缺省时，依赖模型的六个面逐面记跳过（装载面仍跑），汇总
// 与退出码如实反映"跑了几个面"。沙箱在系统临时目录创建，结束即删。
// GIT_* 环境全剥（继承的 GIT_DIR 等会毒化沙箱 git 与权威存储的身份
// 解析——与测试纪律同向）；沙箱必须先落根提交——评审权威要求仓库根
// 提交锚定身份（真机教训）。

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

// 环境消毒：剥掉继承的 GIT_*——沙箱 git 与权威存储的仓库身份解析都不
// 受宿主残留 GIT_DIR/GIT_WORK_TREE 等影响（测试进程同款纪律）。
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

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
		env: { ...cleanEnv, ...extraEnv },
	});
}

const sandbox = mkdtempSync(join(tmpdir(), "jero-pi-smoke-"));
let crashed = false;
try {
	// —— 沙箱仓库：根提交是评审权威的身份前提（零提交仓会被 fail-closed 拒绝）。
	// .gitignore 先行排除伴生扩展的运行时扰动（pi-lens 探针日志每轮工具调用
	// 都在追加——真机实证：这类漂移会让 START 后的工作区目标身份持续变化，
	// 控制器判谱系 unrelated、不下发收集槽位，捕获无从发生）。
	const git = (...args) => spawnSync("git", ["-c", "user.name=smoke", "-c", "user.email=smoke@smoke", ...args], { cwd: sandbox, encoding: "utf8", env: cleanEnv, timeout: 60_000 });
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
			const reason = "JERO_PI_SMOKE_PROVIDER/MODEL 未设";
			for (const name of ["模型回复探针", "SDD 强制初始化（首次会话自动落 openspec/config.yaml）", "install-module 四束全链落盘（含 godot-ai 与 playwright 双 MCP 档合并）", "触发编译命中（种 go.mod/global.json/project.godot/App.vue → 覆盖层四束齐射）", "记忆四工具（写/读/列/搜）", "评审·同意与 START（谱系建成 reviewing）", "评审·捕获与结算（capture→终局→回执）"]) {
			record(name, undefined, `${reason}，跳过模型相关面`);
		}
	} else {
		const baseArgs = ["-p", "-a", "--no-session", "--provider", provider, "--model", model];

		// —— 面二：模型就绪（后续一切模型面的前置）+ SDD 强制初始化。
		// 探针是沙箱首次会话——session_start 钩子应自动落 SDD 脚手架
		// （openspec/config.yaml）；预检资产落点用 JERO_PI_AGENT_HOME 隔离
		// 进沙箱，防写真实 agent home。
		const probe = runPi([...baseArgs, "回复两个字：就绪"], sandbox, { JERO_PI_AGENT_HOME: join(sandbox, "jero-agent-home") });
		record("模型回复探针", probe.status === 0 && (probe.stdout ?? "").includes("就绪"), probe.status === 0 ? undefined : `退出码 ${probe.status}`);
		const sddScaffold = existsSync(join(sandbox, "openspec", "config.yaml"));
		record("SDD 强制初始化（首次会话自动落 openspec/config.yaml）", sddScaffold, sddScaffold ? undefined : "脚手架未落——session_start 强制初始化未生效（JERO_PI_SDD_AUTOINIT 未设应为开）");

		// —— 面三：模块安装全链（命令分发 + 四束落盘 + v2 MCP 档合并面）。
		// 库内四束一次装齐：多 token 命令 + 依赖闭包（四束零依赖直装）+
		// godot 束的 v2 特性面——声明的 godot-ai 档被幂等合并进项目级
		// .pi/mcp.json（安装器只写配置不启动服务；真机连接属宿主首用
		// 信任确认域，不在本面断言——uvx 缺席时连接快速失败非挂死）。
		const installModule = runPi([...baseArgs, "/jero:install-module godot golang dotnet vue"], sandbox);
		const bundleLanded = (token) => existsSync(join(sandbox, ".pi", "modules", token, "module.json"));
		const moduleLanded = bundleLanded("godot") && bundleLanded("golang") && bundleLanded("dotnet") && bundleLanded("vue")
			&& existsSync(join(sandbox, ".pi", "agents", "golang-reviewer.md"))
			&& existsSync(join(sandbox, ".pi", "agents", "dotnet-reviewer.md"))
			&& existsSync(join(sandbox, ".pi", "agents", "vue-reviewer.md"))
			&& existsSync(join(sandbox, ".pi", "skills", "golang-testing", "SKILL.md"))
			&& existsSync(join(sandbox, ".pi", "skills", "dotnet-testing", "SKILL.md"))
			&& existsSync(join(sandbox, ".pi", "skills", "vue-testing", "SKILL.md"))
			&& existsSync(join(sandbox, ".pi", "skills", "godot-verify", "SKILL.md"))
			&& existsSync(join(sandbox, ".pi", "module-installs.json"));
		let mcpMerged = false;
		try {
			const servers = JSON.parse(readFileSync(join(sandbox, ".pi", "mcp.json"), "utf8"))?.mcpServers;
			// 双档并存：godot-ai（uvx）与 vue 束的 playwright（npx 钉版）都合并落盘。
			mcpMerged = servers?.["godot-ai"]?.command === "uvx"
				&& servers?.["playwright"]?.command === "npx"
				&& JSON.stringify(servers?.["playwright"]?.args).includes("@playwright/mcp@");
		} catch {
			mcpMerged = false;
		}
		record("install-module 四束全链落盘（含 godot-ai 与 playwright 双 MCP 档合并）", installModule.status === 0 && moduleLanded && mcpMerged, moduleLanded && mcpMerged ? undefined : `落盘=${moduleLanded} mcp合并=${mcpMerged} 退出码=${installModule.status} stderr尾:${(installModule.stderr ?? "").slice(-300)}`);

			// —— 面四：静态触发编译（每束种一个触发文件，覆盖层逐一命中）。
		writeFileSync(join(sandbox, "go.mod"), "module example.com/smoke\n\ngo 1.26\n");
		writeFileSync(join(sandbox, "global.json"), "{\n\t\"sdk\": { \"version\": \"10.0.100\", \"rollForward\": \"latestPatch\" }\n}\n");
		writeFileSync(join(sandbox, "project.godot"), "; Engine configuration file.\n[application]\nconfig/name=\"smoke\"\n");
		writeFileSync(join(sandbox, "src", "App.vue"), "<script setup lang=\"ts\">\nconst msg = $ref('smoke');\n</script>\n\n<template>\n\t<div>{{ msg }}</div>\n</template>\n");
		const verify = runPi([...baseArgs, "/jero-module-verify"], sandbox);
		// 覆盖层读取带守卫：verify 在写覆盖层之前就失败时，这里抛
		// ENOENT 会击穿整个 harness（汇总不打印、KEEP 留不住现场）。
		let overlay = "";
		let overlayReadable = true;
		try {
			overlay = readFileSync(join(sandbox, ".atl", "module-overlay.md"), "utf8");
		} catch {
			overlayReadable = false;
		}
		const expectedHits = ["命中 `go.mod`", "命中 `global.json`", "命中 `project.godot`", "命中 `**/*.vue`"];
		const overlayHit = verify.status === 0 && overlayReadable && expectedHits.every((needle) => overlay.includes(needle));
		record("触发编译命中（种 go.mod/global.json/project.godot/App.vue → 覆盖层四束齐射）", overlayHit, overlayHit ? undefined : `退出码 ${verify.status} 覆盖层可读=${overlayReadable} 缺失:${expectedHits.filter((needle) => !overlay.includes(needle)).join("/") || "无"} stderr尾:${(verify.stderr ?? "").slice(-300)}`);

		// —— 面五：记忆四工具（隔离记忆根，经真实模型调用）。
		const memoryRoot = join(sandbox, "memroot");
		const memory = runPi([...baseArgs, "请依次使用记忆工具:1) mem_save 保存 topic=smoke-test,content='真机冒烟第一条:记忆链路验证';2) mem_read 读回 topic=smoke-test;3) mem_list 列出;4) mem_search 搜'冒烟'。逐步汇报每个工具的原始返回,最后一行总结四步成败。"], sandbox, { JERO_PI_MEMORY_ROOT: memoryRoot });
			const memoryLanded = existsSync(join(memoryRoot, "entries", "smoke-test.md")) && existsSync(join(memoryRoot, "index.json"));
			// 盘面真相优先：落盘 + 索引含该主题 + 零退出即过——模型汇报措辞
			// 有方差，信文本不信盘面只会制造假红（真机实证）。索引行把证明
			// 面从"写发生了"收紧到"写被索引"；读/列/搜是纯读零盘面足迹，
			// 只能经模型汇报覆盖，不做退出码级断言。
			let indexHasTopic = false;
			try {
				indexHasTopic = JSON.parse(readFileSync(join(memoryRoot, "index.json"), "utf8"))?.entries?.["smoke-test"] !== undefined;
			} catch {
				indexHasTopic = false;
			}
			const memoryOk = memory.status === 0 && memoryLanded && indexHasTopic;
			record("记忆四工具（写/读/列/搜）", memoryOk, memoryOk ? undefined : `退出码 ${memory.status} 落盘=${memoryLanded} 索引含主题=${indexHasTopic} 输出=${(memory.stdout ?? "").length} 字节;尾部:${(memory.stdout ?? "").slice(-300)}`);

		// —— 面六：小候选评审全生命周期（本层存在的理由——单测+门测不到的缝）。
		// 两段式镜像真实 TUI 用法（跨回合续跑）：单发 mega-prompt 在 START 后的
		// 编排阶段会被 pi 一次性吞掉（真机实证两次），分两段各自稳定。
		// 评审面跑在零模块激活态：触发验证面完成后移除四种子触发文件——
		// 覆盖层随评审会话的 session_start 重编译为零命中，不再钉住任何
		// testCommand。真机实证（2026-10）：四束齐射令字典序第一的 dotnet 束
		// 钉住 `dotnet test`，结算段模型幻视发现触发纠正路径后，定向验证的
		// 原生执行 spawn 缺席的 dotnet → native-operation-failed ×2，谱系卡
		// fix_validating 无回执。评审候选是 6 行 TS diff，本就不属任何域——
		// 移除触发既修工具链缺席卡死，也去四域注入对评审面的噪音。
		rmSync(join(sandbox, "go.mod"));
		rmSync(join(sandbox, "global.json"));
		rmSync(join(sandbox, "project.godot"));
		rmSync(join(sandbox, "src", "App.vue"));
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
			record("评审·同意与 START（谱系建成 reviewing）", reviewing !== undefined, reviewing === undefined ? `终态=${readLineageStates().map((s) => s.state?.state).join(",") || "无"} / 退出码 ${startPhase.status} / 输出=${(startPhase.stdout ?? "").length} 字节;尾部:${(startPhase.stdout ?? "").slice(-300)}` : `谱系 ${reviewing.state?.lineage_id?.slice(0, 24)}…(pi 退出码 ${startPhase.status})`);
			if (reviewing !== undefined) {
				const settlePhase = runPi([...baseArgs, `评审谱系 ${reviewing.state?.lineage_id} 处于 reviewing。请续走完成捕获与结算:1) jero_review {"operation":"inspect"} 取最新 STATUS;2) 按 STATUS 下发的收集槽位完成该透镜评审并用 jero_review_capture 提交(collectBinding 从 STATUS 原文精确取用);3) 结算谱系。完成后一行总结:capture 成败、谱系终态、回执状态。任何权威拒绝原样贴出。`], sandbox, {}, 900_000);
				// 终局判据是"目标谱系的生命周期正确闭合"，且必须锚定 START 段
				// 建成的那条谱系——零透镜 START 创建即 approved（start 零透镜
				// 低风险闭合），结算段模型若跑偏另起谱系，扫全谱系的 find 会被
				// 新生 approved 假绿放行（真谱系仍卡 reviewing、捕获路径全程
				// 未被行使）。approved 与 escalated 都是契约合法终态（评审者对
				// 不确定严重度的发现按台账契约升级，系统行为正确——真机三轮
				// 实证三种结局全部是模型产物方差，不是系统故障）；两个终态
				// 都必须落回执（回执只从终局状态签发）。
				const targetLineageId = reviewing.state?.lineage_id;
				const finalState = readLineageStates().find((state) => state.state?.lineage_id === targetLineageId)?.state?.state;
				const receiptLanded = targetLineageId !== undefined && existsSync(join(sandbox, ".git", "jero-review", "lineages", targetLineageId, "review-receipt.json"));
				const terminalOk = (finalState === "approved" || finalState === "escalated") && receiptLanded;
				if (!terminalOk) {
					console.error(`--- 结算段失败,pi 输出尾部 ---\n${(settlePhase.stdout ?? "").slice(-2400)}\n--- stderr 尾部 ---\n${(settlePhase.stderr ?? "").slice(-600)}`);
				}
				record("评审·捕获与结算（capture→终局→回执）", terminalOk, terminalOk ? `谱系 ${String(targetLineageId).slice(0, 24)}… ${finalState}` : `谱系 ${targetLineageId} 终态=${finalState ?? "无"} 回执=${receiptLanded} 全谱系=${readLineageStates().map((s) => `${String(s.state?.lineage_id).slice(0, 8)}:${s.state?.state}`).join(",") || "无"}`);
			}
	}
} catch (error) {
	// 崩溃路径也要让 KEEP 有据可依：异常逃逸时 results 里可能还没有
	// 任何失败面，只按失败面判断会把现场删掉。
	crashed = true;
	throw error;
} finally {
	// JERO_PI_SMOKE_KEEP=1 且有失败面（或异常逃逸）时保留现场，供排障后手动清理。
	if (process.env.JERO_PI_SMOKE_KEEP === "1" && (crashed || results.some((result) => result.ok === false))) {
		console.error(`现场保留：${sandbox}`);
	} else {
		try {
			rmSync(sandbox, { recursive: true, force: true });
		} catch (error) {
			// Windows 残留句柄（pi 子进程/AV 扫描）可能 EBUSY/EPERM——汇总比清理重要，失败只提示手动删，不许吞掉汇总输出。
			console.error(`沙箱清理失败，请手动删除：${sandbox}（${error instanceof Error ? error.message : String(error)}）`);
		}
	}
}

const failed = results.filter((result) => result.ok === false);
console.log(`\n冒烟结果：${results.filter((r) => r.ok === true).length} 过 / ${failed.length} 败 / ${results.filter((r) => r.ok === undefined).length} 跳过`);
if (failed.length > 0) {
	for (const failure of failed) console.error(`✗ ${failure.name}——${failure.detail ?? ""}`);
	process.exit(1);
}
