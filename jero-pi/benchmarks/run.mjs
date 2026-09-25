// jero-pi 基准运行器（脚手架）。零依赖、离线：agent 命令由 --command 提供，
// 本脚本只负责工作区准备、臂环境变量、diff 度量与安全校验。
// 用法见 benchmarks/README.md。不在发布包内（package.json files 未含 benchmarks/）。

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ARMS = {
	baseline: { "JERO_PI_LEAN_MODE": "off" },
	"lean-lite": { "JERO_PI_LEAN_MODE": "lite" },
	"lean-full": { "JERO_PI_LEAN_MODE": "full" },
	"lean-ultra": { "JERO_PI_LEAN_MODE": "ultra" },
};

const TASKS_DIR = join(import.meta.dirname, "tasks");

function parseArgs(argv) {
	const args = { arms: [], tasks: [], out: undefined, dryRun: false, command: undefined, repo: undefined };
	for (let i = 0; i < argv.length; i += 1) {
		const key = argv[i];
		const value = argv[i + 1];
		if (key === "--list") { args.list = true; }
		else if (key === "--dry-run") { args.dryRun = true; }
		else if (key === "--repo") { args.repo = value; i += 1; }
		else if (key === "--command") { args.command = value; i += 1; }
		else if (key === "--out") { args.out = value; i += 1; }
		else if (key === "--arms") { args.arms = value.split(","); i += 1; }
		else if (key === "--tasks") { args.tasks = value.split(","); i += 1; }
		else { throw new Error(`unknown flag: ${key}`); }
	}
	return args;
}

// 任务文件格式：`key: value` 头部（tier/check 可选），空行后为工单正文。
// id 支持唯一前缀匹配（loc-01 → loc-01-date-field.md）。
function loadTask(id) {
	let file = join(TASKS_DIR, `${id}.md`);
	if (!statSync(TASKS_DIR, { throwIfNoEntry: false }) || !existsSync(file)) {
		const matches = listTaskIds().filter((taskId) => taskId.startsWith(id));
		if (matches.length !== 1) throw new Error(`task id "${id}" is ambiguous or unknown: ${matches.join(", ") || "no match"}`);
		file = join(TASKS_DIR, `${matches[0]}.md`);
	}
	const raw = readFileSync(file, "utf8");
	const [head, ...rest] = raw.split(/\n\n/u);
	const meta = {};
	for (const line of head.split("\n")) {
		const match = /^([a-z-]+): (.*)$/u.exec(line.trim());
		if (match) meta[match[1]] = match[2];
	}
	return { id, ...meta, ticket: rest.join("\n").trim() };
}

function listTaskIds() {
	return readdirSync(TASKS_DIR)
		.filter((name) => name.endsWith(".md"))
		.map((name) => name.replace(/\.md$/u, ""))
		.sort();
}

function git(workspace, ...args) {
	return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" });
}

// 新增行合计，剔除测试/lockfile/构建产物；测试行单独计入 wrote_tests。
// 先 git add -A（覆盖 agent 提交过、只改工作树、新建文件三种形态），
// 再对克隆时的基线 commit 取 numstat（覆盖 agent 自己 commit 过的形态）。
function measureDiff(workspace, baseCommit) {
	git(workspace, "add", "-A");
	const numstat = git(workspace, "diff", "--numstat", baseCommit).split("\n").filter(Boolean);
	let added = 0;
	let deleted = 0;
	let wroteTests = 0;
	for (const line of numstat) {
		const [add, del, path] = line.split("\t");
		const additions = add === "-" ? 0 : Number(add);
		const deletions = del === "-" ? 0 : Number(del);
		if (/^(tests?|spec)\//iu.test(path) || /\.test\.|\.spec\./iu.test(path) || /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/iu.test(path)) {
			wroteTests += additions;
			continue;
		}
		if (/^(dist|build|out|target)\//iu.test(path)) continue;
		added += additions;
		deleted += deletions;
	}
	return { added, deleted, wrote_tests: wroteTests };
}

function runSafetyCheck(workspace, check) {
	const resolved = check.replaceAll("{workspace}", workspace).replaceAll("{bench}", import.meta.dirname);
	const result = spawnSync(resolved, { shell: true, cwd: workspace, encoding: "utf8", timeout: 120_000 });
	if (result.error) return "error";
	return result.status === 0 ? "pass" : "fail";
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const taskIds = args.tasks.length > 0 ? args.tasks : listTaskIds();
	if (args.list || (args.dryRun && args.arms.length === 0 && args.tasks.length === 0)) {
		for (const id of taskIds) {
			const task = loadTask(id);
			console.log(`${id}\t${task.tier ?? "loc"}\t${task.check ? `check: ${task.check}` : "no check"}`);
		}
		return;
	}
	if (!args.repo || !args.command) throw new Error("--repo and --command are required (see benchmarks/README.md)");
	const arms = args.arms.length > 0 ? args.arms : Object.keys(ARMS);
	for (const arm of arms) if (!(arm in ARMS)) throw new Error(`unknown arm: ${arm}`);
	if (!statSync(args.repo).isDirectory()) throw new Error(`--repo is not a directory: ${args.repo}`);

	const startedAt = new Date().toISOString();
	const runs = [];
	const workspaces = [];
	for (const arm of arms) {
		for (const id of taskIds) {
			const task = loadTask(id);
			const workspace = mkdtempSync(join(tmpdir(), `jero-bench-${arm}-${id}-`));
			workspaces.push(workspace);
			const command = args.command.replaceAll("{ticket}", task.ticket).replaceAll("{workspace}", workspace);
			if (args.dryRun) {
				console.log(`[dry-run] ${arm} × ${id}: ${command}`);
				runs.push({ arm, task: id, skipped: "dry-run" });
				continue;
			}
			// --no-hardlinks：Windows 上跨盘 --local 硬链接会以
			// "Improper link" 失败；普通拷贝式克隆在所有平台可靠。
			execFileSync("git", ["clone", "--quiet", "--no-hardlinks", args.repo, workspace]);
			const baseCommit = git(workspace, "rev-parse", "HEAD").trim();
			const started = Date.now();
			const agent = spawnSync(command, {
				shell: true,
				cwd: workspace,
				encoding: "utf8",
				timeout: 30 * 60_000,
				env: { ...process.env, ...ARMS[arm] },
			});
			const wallMs = Date.now() - started;
			const diff = measureDiff(workspace, baseCommit);
			const run = {
				arm,
				task: id,
				tier: task.tier ?? "loc",
				wall_ms: wallMs,
				...diff,
				check: task.check ? runSafetyCheck(workspace, task.check) : undefined,
				agent_status: agent.status,
				stderr_tail: (agent.stderr ?? "").split("\n").slice(-5).join("\n"),
			};
			runs.push(run);
			console.log(`${arm} × ${id}: +${run.added}/-${run.deleted} lines, ${(wallMs / 1000).toFixed(1)}s${run.check ? `, check=${run.check}` : ""}`);
		}
	}
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
	if (args.dryRun) return;
	const report = { started_at: startedAt, finished_at: new Date().toISOString(), repo: args.repo, command: args.command, runs };
	if (args.out) {
		mkdirSync(dirname(args.out), { recursive: true });
		writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
		console.log(`results written: ${args.out}`);
	} else {
		console.log(JSON.stringify(report, null, 2));
	}
}

main();
