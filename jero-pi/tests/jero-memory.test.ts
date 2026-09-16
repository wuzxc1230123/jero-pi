import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import jeroMemory, { memoryEnabled } from "../extensions/jero-memory.ts";
import {
	deleteMemory,
	isValidMemoryTopic,
	listMemory,
	MAX_MEMORY_CONTENT_BYTES,
	readMemory,
	resolveMemoryRoot,
	rebuildMemoryIndex,
	saveMemory,
	searchMemory,
} from "../lib/memory.ts";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "jero-memory-"));
}

test("memory topic validation accepts hierarchy and rejects escapes", () => {
	assert.equal(isValidMemoryTopic("sdd/auth-layout/proposal"), true);
	assert.equal(isValidMemoryTopic("decisions.auth_v2"), true);
	assert.equal(isValidMemoryTopic(""), false);
	assert.equal(isValidMemoryTopic("has space"), false);
	assert.equal(isValidMemoryTopic("a/"), false);
	assert.equal(isValidMemoryTopic("../escape"), false);
	assert.equal(isValidMemoryTopic("a/../b"), false);
	assert.equal(isValidMemoryTopic("x".repeat(129)), false);
});

test("save and read roundtrip through frontmatter", () => {
	const root = tempRoot();
	try {
		const saved = saveMemory(root, "sdd/change/proposal", "# Proposal\n\nKeep the delta flow.\n", { tags: ["sdd"], agent: "parent" });
		assert.equal(saved.created, true);
		const record = readMemory(root, "sdd/change/proposal");
		assert.notEqual(record, undefined);
		assert.equal(record!.content, "# Proposal\n\nKeep the delta flow.");
		assert.deepEqual(record!.tags, ["sdd"]);
		assert.equal(record!.agent, "parent");
		const raw = readFileSync(join(root, "entries", "sdd", "change", "proposal.md"), "utf8");
		assert.match(raw, /^---\n/);
		assert.match(raw, /tags: sdd\n/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("save rejects empty and oversized content and bad tags", () => {
	const root = tempRoot();
	try {
		assert.throws(() => saveMemory(root, "t/empty", ""), /not be empty/);
		assert.throws(() => saveMemory(root, "t/big", "x".repeat(MAX_MEMORY_CONTENT_BYTES + 1)), /limit is/);
		assert.throws(() => saveMemory(root, "t/tags", "body", { tags: ["bad tag"] }), /invalid memory tag/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("saving the same topic replaces the entry and reports it", () => {
	const root = tempRoot();
	try {
		assert.equal(saveMemory(root, "notes/one", "first").created, true);
		assert.equal(saveMemory(root, "notes/one", "second").created, false);
		assert.equal(readMemory(root, "notes/one")!.content, "second");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("list filters by prefix and tag with a deterministic order", () => {
	const root = tempRoot();
	try {
		saveMemory(root, "sdd/a/proposal", "alpha proposal", { tags: ["sdd"] });
		saveMemory(root, "sdd/b/design", "beta design", { tags: ["sdd", "arch"] });
		saveMemory(root, "decisions/one", "unrelated decision", { tags: ["decision"] });
		const all = listMemory(root);
		assert.deepEqual(all.map((entry) => entry.topic), ["decisions/one", "sdd/a/proposal", "sdd/b/design"]);
		assert.deepEqual(listMemory(root, { prefix: "sdd/" }).map((entry) => entry.topic), ["sdd/a/proposal", "sdd/b/design"]);
		assert.deepEqual(listMemory(root, { tag: "arch" }).map((entry) => entry.topic), ["sdd/b/design"]);
		assert.equal(listMemory(root, { limit: 1 }).length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("search requires every term and reports the matching line", () => {
	const root = tempRoot();
	try {
		saveMemory(root, "fixes/token-refresh", "The token refresh raced the scheduler.\nFixed by serializing refreshes.");
		saveMemory(root, "fixes/other", "Unrelated note about logging.");
		const hits = searchMemory(root, "token refresh");
		assert.equal(hits.length, 1);
		assert.equal(hits[0]!.topic, "fixes/token-refresh");
		assert.match(hits[0]!.line, /token refresh raced/i);
		assert.deepEqual(searchMemory(root, "token nonexistent"), []);
		assert.deepEqual(searchMemory(root, "   "), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a missing or corrupt index is rebuilt from the entries directory", () => {
	const root = tempRoot();
	try {
		saveMemory(root, "a/one", "first body");
		saveMemory(root, "a/two", "second body");
		rmSync(join(root, "index.json"));
		assert.deepEqual(listMemory(root).map((entry) => entry.topic), ["a/one", "a/two"]);
		writeFileSync(join(root, "index.json"), "{ not json", "utf8");
		assert.equal(rebuildMemoryIndex(root), 2);
		assert.deepEqual(listMemory(root, { prefix: "a/" }).length, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("delete removes the entry and keeps the index in sync", () => {
	const root = tempRoot();
	try {
		saveMemory(root, "gone/soon", "temporary");
		assert.equal(deleteMemory(root, "gone/soon"), true);
		assert.equal(readMemory(root, "gone/soon"), undefined);
		assert.deepEqual(listMemory(root, { prefix: "gone/" }), []);
		assert.equal(deleteMemory(root, "gone/soon"), false);
		assert.equal(existsSync(join(root, "entries", "gone")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("project memory root wins when it exists, otherwise the config home", () => {
	const base = tempRoot();
	const project = join(base, "proj");
	const configHome = join(base, "config");
	mkdirSync(join(project, ".jero", "memory"), { recursive: true });
	try {
		const env = { JERO_PI_CONFIG_HOME: configHome };
		assert.equal(resolveMemoryRoot(project, env), join(project, ".jero", "memory"));
		const bare = join(base, "bare");
		mkdirSync(bare, { recursive: true });
		assert.equal(resolveMemoryRoot(bare, env), join(configHome, "memory"));
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("memoryEnabled honors the JERO_PI_MEMORY opt-out", () => {
	assert.equal(memoryEnabled({}), true);
	assert.equal(memoryEnabled({ JERO_PI_MEMORY: "0" }), false);
	assert.equal(memoryEnabled({ JERO_PI_MEMORY: "off" }), false);
	assert.equal(memoryEnabled({ JERO_PI_MEMORY: "1" }), true);
});

interface RegisteredTool {
	name: string;
	execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; details?: Record<string, unknown> }>;
}

function fakePi(): { tools: Map<string, RegisteredTool> } {
	const tools = new Map<string, RegisteredTool>();
	const pi = {
		registerTool(definition: RegisteredTool) {
			tools.set(definition.name, definition);
		},
		on() {},
		registerShortcut() {},
		registerCommand() {},
		registerFlag() {},
	};
	jeroMemory(pi as never, {});
	return { tools };
}

test("the extension registers the four mem tools and they roundtrip through the project root", async () => {
	const base = tempRoot();
	const project = join(base, "proj");
	mkdirSync(join(project, ".jero", "memory"), { recursive: true });
	try {
		const { tools } = fakePi();
		assert.deepEqual([...tools.keys()].sort(), ["mem_list", "mem_read", "mem_save", "mem_search"]);
		const ctx = { cwd: project, sessionManager: { getSessionId: () => "session-1" } };
		const saved = await tools.get("mem_save")!.execute("id-1", { topic: "sdd/x/spec", content: "spec body", tags: ["sdd"] }, undefined, undefined, ctx);
		assert.match(saved.content[0]!.text, /saved sdd\/x\/spec/);
		const read = await tools.get("mem_read")!.execute("id-2", { topic: "sdd/x/spec" }, undefined, undefined, ctx);
		assert.match(read.content[0]!.text, /spec body/);
		const listed = await tools.get("mem_list")!.execute("id-3", { prefix: "sdd/" }, undefined, undefined, ctx);
		assert.match(listed.content[0]!.text, /sdd\/x\/spec/);
		const found = await tools.get("mem_search")!.execute("id-4", { query: "spec body" }, undefined, undefined, ctx);
		assert.match(found.content[0]!.text, /sdd\/x\/spec/);
		const missing = await tools.get("mem_read")!.execute("id-5", { topic: "no/such" }, undefined, undefined, ctx);
		assert.match(missing.content[0]!.text, /no entry/);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("mem_save reports invalid arguments without writing", async () => {
	const base = tempRoot();
	const project = join(base, "proj");
	mkdirSync(project, { recursive: true });
	try {
		const { tools } = fakePi();
		const ctx = { cwd: project };
		const result = await tools.get("mem_save")!.execute("id-1", { topic: "", content: "body" }, undefined, undefined, ctx);
		assert.equal(result.details!.error, "invalid-arguments");
		assert.equal(existsSync(join(project, ".jero")), false);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});
