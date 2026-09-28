#!/usr/bin/env node
// 真实宿主启动冒烟：单测与 runtime harness 在假宿主上装配扩展，覆盖不到
// 「宿主按 pi.extensions 顺序加载全部伴生插件」这一层——2026-09-28 的
// pi-pretty × pi-hashline-edit-pro read/grep 撞名正是从这层漏过（见
// lib/pretty-disable-tools.ts）。本脚本在一次性隔离 Pi home 里 pi install
// 本包并裸启动 `pi -p`：扩展层加载成功时进程应走到 provider 鉴权（隔离
// 环境无凭证，输出 "No API key"）；任何 "Failed to load extension" 或
// "Tool ... conflicts" 都判失败。剥离 API key 环境变量并用 --offline，
// 保证 CI 上不发生真实网络回合。
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "jero-pi-boot-smoke-"));
const piAgentHome = join(temporary, "pi-agent");
const jeroAgentHome = join(temporary, "jero-agent");
const scratch = join(temporary, "scratch");

function piCli() {
	const packageRoot = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
	const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	const binField = manifest.bin ?? {};
	const entry = typeof binField === "string" ? binField : (binField.pi ?? Object.values(binField)[0]);
	if (typeof entry !== "string" || entry === "") throw new Error("pi-coding-agent bin entry not found");
	return join(packageRoot, entry);
}

// 隔离环境：一次性 home；撞名门必须自己生效（剥离操作者的
// PRETTY_DISABLE_TOOLS）；剥掉一切形如 <PROVIDER>_API_KEY 的凭证，让无凭证
// 的 provider 鉴权成为确定的终点。
const keyEnvNames = Object.keys(process.env).filter(name => /^[A-Z0-9]+_API_KEY$/.test(name));
const env = { ...process.env, PI_CODING_AGENT_DIR: piAgentHome, JERO_PI_AGENT_HOME: jeroAgentHome };
delete env.PRETTY_DISABLE_TOOLS;
for (const name of keyEnvNames) delete env[name];

try {
	mkdirSync(piAgentHome, { recursive: true });
	mkdirSync(jeroAgentHome, { recursive: true });
	mkdirSync(scratch, { recursive: true });
	const cli = piCli();
	execFileSync(process.execPath, [cli, "install", root], { cwd: scratch, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "inherit"] });
	// 无凭证时 pi 以非零退出但输出 "No API key"——这恰是扩展层全部加载成功
	// 的证据，故用 spawnSync 捕获输出而不让非零退出直接抛错。
	const boot = spawnSync(process.execPath, [cli, "-p", "boot smoke", "--offline", "--no-session"], { cwd: scratch, env, encoding: "utf8", timeout: 120_000 });
	const combined = `${boot.stdout ?? ""}\n${boot.stderr ?? ""}`;
	const conflict = /Failed to load extension|Tool "[^"]+" conflicts/.exec(combined);
	if (conflict !== null) throw new Error(`host boot smoke: extension layer failed: ${conflict[0]}`);
	if (!/No API key/.test(combined)) throw new Error(`host boot smoke: expected provider-auth terminus without credentials, got: ${JSON.stringify(combined.slice(0, 300))}`);
	process.stdout.write("host boot smoke passed (extension layer loaded; reached provider auth without credentials)\n");
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
