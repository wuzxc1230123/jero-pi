import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PATH_GUARDED_TOOL_NAMES, PATH_INPUT_KEYS, SENSITIVE_PATH_PATTERNS } from "../lib/jero-ai-path-guard.ts";
import { isSensitivePath } from "../lib/jero-ai-sdd-startup.ts";

// 敏感路径模式是纯数据（正则表），这里把每个模式的命中/放行语义钉住，
// 防止后续"顺手放宽"让凭据路径滑出护栏。
function sensitiveMatch(path: string): RegExp | undefined {
	return SENSITIVE_PATH_PATTERNS.find((pattern) => pattern.test(path));
}

test("path guard matches credential-bearing paths", () => {
	for (const path of [
		"/home/u/.ssh/id_rsa",
		"/home/u/.ssh/",
		"~/.credentials/tokens.json",
		"library/keychains/login.keychain-db",
		"/Users/u/.aws/credentials",
		"/Users/u/.config/gh/hosts.yml",
		"/Users/u/.config/gh/hosts.yaml",
		"repo/secrets/key",
		"secrets",
		".env",
		"project/.env.local",
		"project/.env.production",
		"certs/server.pem",
		"certs/server.key",
		"certs/keystore.p12",
		"certs/keystore.pfx",
	]) {
		assert.ok(sensitiveMatch(path), `expected sensitive match: ${path}`);
	}
});

test("path guard lets ordinary paths through", () => {
	for (const path of [
		"src/index.ts",
		"env.ts",
		"docs/env-guide.md",
		"research/secrets-v2/README.md",
		"notes.pem.txt",
		"certs/server.pem.bak.asc",
		"lib/.envexample/README.md",
	]) {
		assert.equal(sensitiveMatch(path), undefined, `expected ordinary path: ${path}`);
	}
});

test("path guard registries stay minimal", () => {
	assert.deepEqual([...PATH_GUARDED_TOOL_NAMES].sort(), ["edit", "read", "write"]);
	assert.deepEqual([...PATH_INPUT_KEYS].sort(), ["file", "filePath", "filePaths", "files", "path", "paths"]);
});

test("isSensitivePath rejects Windows-equivalent spellings (trailing dots/spaces per segment)", () => {
	assert.ok(isSensitivePath("/home/u/.ssh./id_rsa"), "段尾点：Win32 解析等价 .ssh/");
	assert.ok(isSensitivePath("/home/u/.ssh /id_rsa"), "段尾空格：同上");
	assert.ok(isSensitivePath("/home/u/keys/server.pem."), "扩展名段尾点");
	assert.ok(isSensitivePath("/repo/.env."), ".env 段尾点");
	assert.ok(!isSensitivePath("/repo/src/plain.ts"), "非敏感路径不误伤");
});

test("isSensitivePath resolves the nearest existing ancestor (case-fold and real spellings)", () => {
	const base = mkdtempSync(join(tmpdir(), "jero-guard-"));
	try {
		mkdirSync(join(base, ".ssh"), { recursive: true });
		assert.ok(isSensitivePath(join(base, ".ssh", "id_rsa")), "真实 .ssh 目录命中");
		assert.ok(!isSensitivePath(join(base, "notes", "plain.txt")), "真实非敏感路径不误伤");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("isSensitivePath rejects Windows 8.3 short-name spellings when the volume generates them", () => {
	if (process.platform !== "win32") return;
	const base = mkdtempSync(join(tmpdir(), "jero-guard83-"));
	try {
		const sshDir = join(base, ".ssh");
		mkdirSync(sshDir, { recursive: true });
		const out = spawnSync("cmd", ["/d", "/c", `for %I in ("${sshDir}") do @echo %~sI`], { encoding: "utf8", timeout: 10_000 });
		const short = (out.stdout ?? "").trim().split(/\r?\n/).pop() ?? "";
		if (!short.includes("~")) return; // 该卷 8.3 别名未启用：自跳过（不可测面显式放弃）
		assert.ok(isSensitivePath(join(short, "id_rsa")), `短名拼写 ${short} 必须被守卫命中`);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});
