#!/usr/bin/env node
// Packed-package E2E: npm pack → 隔离安装 → 零二进制姿态与生成 runtime 模块的
// 独立可用性冒烟。jero-pi 不捆绑 provider 二进制（gentle-pi 时代的
// test-packed-runner 二进制驱动随零二进制姿态一并退役，见
// scripts/verify-package-files.mjs forbiddenPaths）。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "jero-pi-packed-runner-"));
const packDirectory = join(temporary, "pack");
const installDirectory = join(temporary, "install");
// 每个子进程只继承一次性 agent home，绝不触碰操作者的真实设置。
const agentHome = join(temporary, "agent");
const piAgentHome = join(temporary, "pi-agent");
const isolatedEnv = { ...process.env, JERO_PI_AGENT_HOME: agentHome, PI_CODING_AGENT_DIR: piAgentHome };

function windowsNpmInvocation() {
	const candidates = [];
	if (process.env.npm_execpath !== undefined && /[\\/]npm[\\/]bin[\\/]npm-cli\.js$/i.test(process.env.npm_execpath)) candidates.push(process.env.npm_execpath);
	for (const executable of new Set([process.execPath, realpathSync(process.execPath)])) candidates.push(join(dirname(executable), "node_modules", "npm", "bin", "npm-cli.js"));
	const installedCli = candidates.find((path) => existsSync(path));
	if (installedCli !== undefined) return { file: process.execPath, prefix: [installedCli] };
	let commandPaths = [];
	try { commandPaths = execFileSync("where.exe", ["npm"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).filter(Boolean); }
	catch { /* fall through to the explicit resolution error */ }
	for (const path of commandPaths) {
		if (basename(path).toLowerCase() === "npm.exe") return { file: path, prefix: [] };
		const cli = join(dirname(path), "node_modules", "npm", "bin", "npm-cli.js");
		if (existsSync(cli)) return { file: process.execPath, prefix: [cli] };
	}
	throw new Error("could not resolve npm-cli.js without a command shell");
}

function runNpm(arguments_, options) {
	const invocation = process.platform === "win32" ? windowsNpmInvocation() : { file: "npm", prefix: [] };
	return execFileSync(invocation.file, [...invocation.prefix, ...arguments_], { ...options, env: isolatedEnv });
}

try {
	mkdirSync(packDirectory);
	mkdirSync(installDirectory);
	mkdirSync(agentHome);
	mkdirSync(piAgentHome);
	const originalSettings = '{ "tuiMode": "regular", "theme": "packed-fixture" }\n';
	writeFileSync(join(agentHome, "settings.json"), originalSettings);
	const packed = JSON.parse(runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	}));
	if (packed.length !== 1 || typeof packed[0]?.filename !== "string") throw new Error("npm pack did not return one tarball");
	const entry = packed[0];
	// 零二进制姿态必须在打包产物层面成立：tarball 里不得出现任何可执行构件。
	assert.ok(Array.isArray(entry.files) && entry.files.length > 0, "npm pack did not report the tarball file list");
	const forbiddenSuffix = /\.(exe|dll|bin|node|wasm)$/i;
	for (const file of entry.files) {
		assert.doesNotMatch(file.path, forbiddenSuffix, `packed package must not ship executable artifacts: ${file.path}`);
	}
	// 斜杠指令模板必须随包发布：pi 从安装树的 pi.prompts 目录加载它们。
	const packedPaths = new Set(entry.files.map((file) => file.path));
	for (const prompt of ["prompts/agents-init.md", "prompts/skill-creation.md"]) {
		assert.ok(packedPaths.has(prompt), `packed package must ship the prompt template: ${prompt}`);
	}
	const tarball = join(packDirectory, entry.filename);
	writeFileSync(join(installDirectory, "package.json"), JSON.stringify({ name: "jero-pi-packed-runner-test", private: true }), "utf8");
	runNpm(["install", "--ignore-scripts=false", "--no-audit", "--no-fund", "--package-lock=false", "--omit=dev", "--legacy-peer-deps", tarball], {
		cwd: installDirectory,
		stdio: "inherit",
	});
	// 这是一个普通 npm 消费者，不是 Pi 托管的全局目录：postinstall 必须
	// 识别出非自有安装位并保持空转，操作者设置原样保留。
	assert.equal(readFileSync(join(agentHome, "settings.json"), "utf8"), originalSettings);
	assert.deepEqual(readdirSync(agentHome), ["settings.json"]);
	assert.deepEqual(readdirSync(piAgentHome), []);
	assert.equal(existsSync(join(installDirectory, ".pi", "settings.json")), false);
	const packageRoot = join(installDirectory, "node_modules", "jero-pi");
	assert.ok(existsSync(join(packageRoot, "scripts", "install-tui-mode-setting.mjs")));
	// 生成的 runtime 模块必须能从打包树里独立加载：打包后的消费者
	// 用随包解码器读取随包契约，而不是依赖仓库内源码。
	const contract = await import(pathToFileURL(join(packageRoot, "runtime", "client-contract.mjs")).href);
	assert.deepEqual(contract.NATIVE_RISK_LEVEL, ["low", "medium", "high"]);
	const assessment = await import(pathToFileURL(join(packageRoot, "runtime", "review-risk-assessment.mjs")).href);
	assert.ok(typeof assessment === "object" && assessment !== null && Object.keys(assessment).length > 0);
	const packageManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	assert.ok(typeof packageManifest.version === "string" && packageManifest.version.length > 0);
	process.stdout.write(`packed package E2E passed (jero-pi ${packageManifest.version}; ${entry.files.length} packed files)\n`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
