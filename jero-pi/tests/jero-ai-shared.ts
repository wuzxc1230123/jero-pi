// jero-ai 测试共享夹具与助手：自 jero-ai.test.ts 机械平移（语义零改动）。

import { default as assert } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { default as test } from "node:test";
import { gzipSync } from "node:zlib";
import { type ExtensionAPI, type ExtensionContext, initTheme, keyHint, type Theme, type ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { __testing, applyModelConfig, applyModelConfigAsync, createJeroAiExtension } from "../extensions/jero-ai.ts";
import { PROFILES_KIND, PROFILES_VERSION } from "../lib/agent-profiles.ts";
import { NATIVE_REVIEW_ERROR_CODE, type NativeReviewCli, NativeReviewCliError } from "../lib/authority/client-contract.ts";
import { CandidateViewError, type CandidateViewRegistry, CANONICAL_GZIP_OPTIONS } from "../lib/review-candidate-view.ts";
import { installPackageAssets } from "../lib/sdd-preflight.ts";
import { type ReviewCollectInputV3, type ReviewStatusV3 } from "../lib/authority/wire-contract.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { cardBody, cardHint, cardTitle, cardTone } from "./gentle-card-text.ts";


initTheme("dark");

export function writeMarkdown(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

export const lifecycleTheme = {
	bold(value: string): string {
		return value;
	},
	fg(color: string, value: string): string {
		return `<${color}>${value}</${color}>`;
	},
};

export function renderComponent(component: { render(width: number): string[] }): string {
	return component.render(120).map((line) => line.replace(/[ \t]+$/g, "")).join("\n");
}

export function registeredGentleTools(): Map<string, any> {
	const tools = new Map<string, any>();
	const pi = {
		on() {},
		registerCommand() {},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null })(pi);
	return tools;
}

export function lifecycleContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		executionStarted: false,
		isPartial: true,
		isError: false,
		lastComponent: undefined,
		...overrides,
	};
}

// gentle-pi#874: the provider's fresh_target_ready offer. The argument order
// mirrors the live selectorless STATUS a clean, fully committed worktree
// receives: it names the merge-base it wants so a plain START can adopt it.
export function offeredCommittedRangeStatus(baseRef: string, baseTree: string, candidateTree: string, paths: readonly string[] = ["app.ts"]): ReviewStatusV3 {
	const targetIdentity = `sha256:${"a".repeat(64)}`;
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "unrelated",
		action: "start",
		replayability: "not_replayable",
		targetIdentity,
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1",
			kind: "base-diff",
			projection: "workspace",
			baseTree,
			initialReviewTree: candidateTree,
			currentCandidateTree: candidateTree,
			pathsDigest: `sha256:${"b".repeat(64)}`,
			paths: [...paths],
			intendedUntracked: [],
			intendedUntrackedProof: `sha256:${"c".repeat(64)}`,
			initialSnapshotIdentity: `sha256:${"d".repeat(64)}`,
			currentSnapshotIdentity: `sha256:${"d".repeat(64)}`,
		},
		candidates: [],
		nextTransition: {
			kind: "execute",
			reasonCode: "fresh_target_ready",
			execute: {
				operation: "review.start",
				arguments: [
					{ name: "target", value: targetIdentity, token: `--target=${targetIdentity}` },
					{ name: "target-evidence", value: `v1:base-diff:workspace:${baseTree}:${candidateTree}:sha256:${"e".repeat(64)}`, token: `--target-evidence=v1:base-diff:workspace:${baseTree}:${candidateTree}:sha256:${"e".repeat(64)}` },
					{ name: "projection", value: "workspace", token: "--projection=workspace" },
					{ name: "base-ref", value: baseRef, token: `--base-ref=${baseRef}` },
					{ name: "committed-only", value: "true", token: "--committed-only=true" },
					{ name: "lineage", value: "review-offered", token: "--lineage=review-offered" },
					{ name: "agent", value: "pi", token: "--agent=pi" },
					{ name: "consent", value: "relay", token: "--consent=relay" },
				],
				preconditions: [],
				binding: { targetIdentity },
			},
		},
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
}

// The clean, fully committed worktree STATUS with no committed-range offer:
// the current-changes candidate view a plain START builds today.
export function cleanWorkspaceStatus(headTree: string, nextTransition?: ReviewStatusV3["nextTransition"]): ReviewStatusV3 {
	const targetIdentity = `sha256:${"a".repeat(64)}`;
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "unrelated",
		action: "start",
		replayability: "not_replayable",
		targetIdentity,
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: headTree,
			initialReviewTree: headTree,
			currentCandidateTree: headTree,
			pathsDigest: `sha256:${"b".repeat(64)}`,
			paths: [],
			intendedUntracked: [],
			intendedUntrackedProof: `sha256:${"c".repeat(64)}`,
			initialSnapshotIdentity: `sha256:${"d".repeat(64)}`,
			currentSnapshotIdentity: `sha256:${"d".repeat(64)}`,
		},
		candidates: [],
		...(nextTransition === undefined ? {} : { nextTransition }),
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
}

export function startedReviewResult(): Record<string, unknown> {
	return { lineageId: "adopted-range", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [], raw: {} };
}

export interface ReviewStartRepository {
	cwd: string;
	baseCommit: string;
	baseTree: string;
	headTree: string;
}

// A hermetic two-commit repository whose candidate range is a real committed
// change, so both the adopted and explicit base-ref paths resolve through the
// real candidate-view guard.
export function reviewRepository(t: test.TestContext): ReviewStartRepository {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-review-start-")));
	t.after(() => {
		try { execFileSync("chmod", ["-R", "u+w", cwd], { stdio: "ignore" }); } catch { /* best effort */ }
		rmSync(cwd, { recursive: true, force: true });
	});
	execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "app.ts"], { cwd, stdio: "ignore" });
	execFileSync("git", ["-c", "user.name=Review Test", "-c", "user.email=review@example.invalid", "commit", "-m", "base"], { cwd, stdio: "ignore" });
	const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	execFileSync("git", ["add", "app.ts"], { cwd, stdio: "ignore" });
	execFileSync("git", ["-c", "user.name=Review Test", "-c", "user.email=review@example.invalid", "commit", "-m", "candidate"], { cwd, stdio: "ignore" });
	return {
		cwd,
		baseCommit,
		baseTree: execFileSync("git", ["rev-parse", `${baseCommit}^{tree}`], { cwd, encoding: "utf8" }).trim(),
		headTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd, encoding: "utf8" }).trim(),
	};
}

// 助手统一住 shared：分片互相 import 会令被导入分片的顶层 test() 注册在
// 导入方进程里重跑一遍，整个家族的用例被成倍执行。
export interface RoutingConsumerPanel {
	render(width: number): string[];
	handleInput(data: string): void;
}

export function routingConsumerFixture(t: test.TestContext, agents = ["worker"]) {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-routing-consumers-"));
	const configHome = join(root, "global");
	const agentHome = join(root, "agent-home");
	const projectPath = join(root, ".pi", "jero", "models.json");
	const globalPath = join(configHome, "models.json");
	const exportPath = join(configHome, "models.export.json");
	for (const dir of [dirname(projectPath), join(root, "agents"), join(agentHome, "agents"), join(agentHome, "subagents")]) {
		mkdirSync(dir, { recursive: true });
	}
	for (const name of agents) {
		writeMarkdown(join(root, ".pi", "agents", `${name}.md`), `---\nname: ${name}\ndescription: Worker\n---\nbody\n`);
	}
	const previousConfigHome = process.env.JERO_PI_CONFIG_HOME;
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const isolatedHome = join(root, "home");
	mkdirSync(isolatedHome, { recursive: true });
	// Isolate homedir-based discovery on POSIX and Windows.
	// Package-sibling legacy agents remain subject to discovery assertions.
	process.env.HOME = isolatedHome;
	process.env.USERPROFILE = isolatedHome;
	process.env.JERO_PI_CONFIG_HOME = configHome;
	process.env.JERO_PI_AGENT_HOME = agentHome;
	t.after(() => {
		if (previousConfigHome === undefined) delete process.env.JERO_PI_CONFIG_HOME;
		else process.env.JERO_PI_CONFIG_HOME = previousConfigHome;
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		rmSync(root, { recursive: true, force: true });
	});
	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	createJeroAiExtension({ nativeReviewCli: null })({
		on() {},
		registerTool() {},
		registerCommand(name, command) { commands.set(name, command); },
	} as unknown as ExtensionAPI);
	const notifications: Array<{ message: string; severity: string }> = [];
	// The profiles panel reads the terminal rows to size its full-screen frame, so
	// the fake UI hands every factory a TUI-shaped stand-in with a mutable height.
	const fixtureTui = { terminal: { rows: 24 }, requestRender() {} };
	let panelVisits = 0;
	const panels: string[] = [];
	let onPanel = () => ({ type: "cancel", config: {} });
	let onInput: ((panel: RoutingConsumerPanel) => void) | undefined;
	const ctx = {
		cwd: root,
		hasUI: true,
		modelRegistry: { getAvailable: async () => [
			{ provider: "openai", id: "alpha" },
			{ provider: "openai", id: "beta" },
		] },
		ui: {
			notify(message: string, severity: string) { notifications.push({ message, severity }); },
			custom: async (factory: (tui: unknown, theme: Theme, keybindings: unknown, done: (result: unknown) => void) => RoutingConsumerPanel) => {
				let result: unknown;
				const panel = factory(fixtureTui, { fg: (_color: string, text: string) => text } as unknown as Theme, undefined, (value) => { result = value; });
				panels.push(stripAnsi(renderComponent(panel)));
				panelVisits += 1;
				if (onInput) {
					onInput(panel);
					assert.notEqual(result, undefined, "panel input must finish the interaction");
					return result;
				}
				return onPanel();
			},
		},
	} as unknown as Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];
	return {
		root, agentHome, configHome, projectPath, globalPath, exportPath, notifications, panels,
		tui: fixtureTui as { terminal: { rows: number } },
		panelVisits: () => panelVisits,
		onPanel(action: typeof onPanel) { onPanel = action; },
		onInput(action: (panel: RoutingConsumerPanel) => void) { onInput = action; },
		run: (name: string) => commands.get(name)!.handler("", ctx),
	};
}
