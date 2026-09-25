import assert from "node:assert/strict";
import test from "node:test";
import { PATH_GUARDED_TOOL_NAMES, PATH_INPUT_KEYS, SENSITIVE_PATH_PATTERNS } from "../lib/jero-ai-path-guard.ts";

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
