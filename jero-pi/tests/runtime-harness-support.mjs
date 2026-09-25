// runtime-harness 共享常量与助手：自 runtime-harness.mjs 机械平移（语义零改动）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { domainHashV1 } from "../lib/review-canonical.ts";
import { canonicalHash } from "../lib/review-transaction.ts";


export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const { createJeroAiExtension } = await import(pathToFileURL(join(ROOT, "extensions/jero-ai.ts")).href);
export const EXTENSIONS = [
	"extensions/jero-ai.ts",
	"extensions/skill-registry.ts",
	"extensions/sdd-init.ts",
	"extensions/startup-banner.ts",
];

export const EXPECTED_BANNER_COMMANDS = [
	"jero:banner",
	"jero:toggle-rose",
	"jero:toggle-text-logo",
	"jero:banner-color",
];

export const EXPECTED_COMMANDS = [
	"jero:install-delegation",
	"jero:install-review",
	"jero:install-sdd",
	"jero:sdd-preflight",
	"jero-sdd-status",
	"jero-sdd-continue",
	"jero:models",
	"jero:persona",
	"jero:status",
	"jero:doctor",
	"jero:guard",
	"jero:lean",
	"jero-sdd-init",
	"skill-registry:refresh",
	...EXPECTED_BANNER_COMMANDS,
];

export const FORBIDDEN_COMPAT_COMMANDS = [
	"gentle:install-assets",
	// The SDD entry points carry the jero- prefix so they read identically in
	// Claude Code and Pi. The bare names are retired without an alias.
	"sdd-init",
	"sdd-continue",
	"sdd-status",
	"gentle:telemetry",
	"gentle:dev-binary",
	"gentle-ai:install-sdd",
	"gentle-ai:sdd-preflight",
	"gentle-ai:sdd-status",
	"gentle-ai:sdd-continue",
	"gentle-ai:models",
	"gentleman:models",
	"gentle-ai:persona",
	"gentleman:persona",
	"gentle-ai:status",
	"gentle-ai:doctor",
	"gentle-ai:banner",
	"gentle-ai:toggle-rose",
	"gentle-ai:toggle-text-logo",
	"gentle-ai:banner-color",
	// The retired gentle-era entry points stay unregistered too: the identity
	// pass was a one-time switch with no compat alias (design §2.2).
	"gentle:install-delegation",
	"gentle:install-review",
	"gentle:install-sdd",
	"gentle:sdd-preflight",
	"gentle-sdd-status",
	"gentle-sdd-continue",
	"gentle:models",
	"gentle:persona",
	"gentle:status",
	"gentle:doctor",
	"gentle-sdd-init",
	"gentle:banner",
	"gentle:toggle-rose",
	"gentle:toggle-text-logo",
	"gentle:banner-color",
];

export function createPi() {
	const hooks = new Map();
	const commands = new Map();
	const flags = new Map();
	const tools = new Map();
	const eventHandlers = new Map();
	const emittedEvents = [];
	const sessionEntries = [];
	const flagValues = new Map([["no-skill-registry", true]]);
	const events = {
		emit(channel, data) {
			emittedEvents.push({ channel, data });
			for (const handler of eventHandlers.get(channel) ?? []) handler(data);
		},
		on(channel, handler) {
			const handlers = eventHandlers.get(channel) ?? new Set();
			handlers.add(handler);
			eventHandlers.set(channel, handlers);
			return () => {
				handlers.delete(handler);
				if (handlers.size === 0) eventHandlers.delete(channel);
			};
		},
	};
	let activeTools = ["read", "bash", "edit", "write"];

	const pi = {
		events,
		on(name, handler) {
			const list = hooks.get(name) ?? [];
			list.push(handler);
			hooks.set(name, list);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerFlag(name, definition) {
			flags.set(name, definition);
		},
		registerTool(definition) {
			tools.set(definition.name, definition);
		},
		getFlag(name) {
			return flagValues.get(name) ?? false;
		},
		setFlag(name, value) {
			flagValues.set(name, value);
		},
		getCommands() {
			return Array.from(commands, ([name, definition]) => ({ name, ...definition }));
		},
		getActiveTools() {
			return activeTools;
		},
		setActiveTools(value) {
			activeTools = value;
		},
		getAllTools() {
			return [
				{ name: "read" },
				{ name: "bash" },
				{ name: "edit" },
				{ name: "write" },
				{ name: "mem_save" },
			];
		},
		// 会话条目持久化（不进 LLM 上下文）：精益模式等自定义条目经此
		// 落入会话分支，与真实宿主的 getBranch 回放形态一致。
		appendEntry(customType, data) {
			sessionEntries.push({ type: "custom", customType, data });
		},
	};

	return { pi, hooks, commands, flags, tools, emittedEvents, sessionEntries };
}

export function createUi() {
	const notifications = [];
	const selections = [];
	return {
		notifications,
		selections,
		notify(message, level = "info") {
			notifications.push({ message, level });
		},
		async confirm() {
			return false;
		},
		async select(label, options) {
			selections.push({ label, options });
			return options[0];
		},
		async input(_label, placeholder) {
			return placeholder;
		},
		custom() {
			return Promise.resolve({ type: "cancel" });
		},
	};
}

export function createCtx(cwd, hasUI = false, sessionId = "session-1") {
	return {
		cwd,
		hasUI,
		ui: createUi(),
		sessionManager: {
			getSessionFile() {
				return join(cwd, `${sessionId}.jsonl`);
			},
			getSessionId() {
				return sessionId;
			},
		},
		modelRegistry: {
			async getAvailable() {
				return [];
			},
		},
	};
}

export function readAgentDefinition(source) {
	const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];
	assert.ok(frontmatter, "agent must have frontmatter");
	const name = frontmatter.match(/^name:\s*(\S+)$/m)?.[1];
	assert.ok(name, "agent must declare its identity");
	const tools = [...frontmatter.matchAll(/^ {2}- ([\w-]+)$/gm)].map(
		(match) => match[1],
	);
	return { name, tools };
}

export function sha256(content) {
	return createHash("sha256").update(content).digest("hex");
}

export function gitSync(cwd, ...arguments_) {
	return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

export async function tempWorkspace() {
	return mkdtemp(join(tmpdir(), "gentle-pi-runtime-"));
}

export function restoreWorkspaceWritePermissions(cwd) {
	if (process.platform === "win32") return;
	try {
		execFileSync("chmod", ["-R", "u+w", cwd], { stdio: "ignore" });
	} catch {
		// A prior candidate-view cleanup may already have removed the workspace.
	}
}

export async function loadExtensions(pi) {
	for (const [index, rel] of EXTENSIONS.entries()) {
		const mod = await import(`${pathToFileURL(join(ROOT, rel)).href}?runtime-harness=${index}`);
		assert.equal(typeof mod.default, "function", `${rel} must export a default function`);
		mod.default(pi);
	}
}

