import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const assetsAgentsDir = join(repoRoot, "assets", "agents");
const GENERIC_ROLE_TOOLS: Record<string, string[]> = {
	"jero-explore.md": ["read", "grep", "find", "fovea_focus", "fovea_sketch", "fovea_dwell"],
	"jero-worker.md": ["read", "grep", "find", "edit", "write", "bash", "mem_save"],
	"jero-verify.md": ["read", "grep", "find", "bash"],
};

function readFrontmatter(path: string): string {
	const text = readFileSync(path, "utf8");
	const match = text.match(/^---\n([\s\S]*?)\n---/);
	assert.ok(match, `${path} must have YAML frontmatter`);
	return match[1];
}

function readTools(path: string): string[] {
	const frontmatter = readFrontmatter(path);
	const lines = frontmatter.split("\n");
	const toolsIndex = lines.findIndex((line) => line === "tools:");
	assert.notEqual(toolsIndex, -1, `${path} must declare tools as a YAML array`);

	const scalarTools = lines.find((line) => /^tools:\s+/.test(line));
	assert.equal(scalarTools, undefined, `${path} must not declare scalar comma-separated tools`);

	const tools: string[] = [];
	for (const line of lines.slice(toolsIndex + 1)) {
		if (!line.startsWith("  - ")) break;
		tools.push(line.slice(4).trim());
	}
	assert.ok(tools.length > 0, `${path} must declare at least one tool`);
	return tools;
}

function assertGenericRoleBody(fileName: string, source: string): void {
	assert.match(source, /generic non-SDD work/);
	assert.match(source, /不(?:修复发现、不委托子代理|委托子代理、不提交)/);
	assert.match(source, /不编辑、不写入/);
	assert.match(source, /压缩的(?:交接|证据交接)/);
	assert.match(source, /支持性(?:路径|证据)/);
	assert.match(source, /不使用 SDD 阶段协议或评审视角。/);

	if (fileName === "jero-explore.md") {
		assert.match(source, /唯一被允许的变更/);
		assert.match(source, /所有已跟踪文件、源码文件和其他项目内容保持只读/);
		assert.match(source, /若 fovea 工具不可用或失败/);
		assert.match(source, /在它们不可用或失败之前不得使用该回退/);
	}

	if (fileName === "jero-verify.md") {
		assert.match(source, /只执行父会话显式授权的确切测试、构建或 lint 命令/);
		assert.match(source, /已授权命令只能产生父会话显式指明为预期的输出/);
		assert.match(source, /把每一个意外的变更视为阻塞项/);
		assert.match(source, /报告它，但不清理或修复它/);
	}
}

const requiredToolsByAgent: Record<string, string[]> = {
	"sdd-apply.md": ["read", "grep", "find", "edit", "write", "bash", "mem_search", "mem_read", "mem_save"],
	"sdd-archive.md": ["read", "grep", "find", "edit", "write", "bash", "mem_search", "mem_read", "mem_save"],
	"sdd-design.md": ["read", "grep", "find", "edit", "write", "mem_search", "mem_read", "mem_save"],
	"sdd-explore.md": ["read", "grep", "find", "edit", "write", "mem_save"],
	"sdd-init.md": ["read", "grep", "find", "edit", "write", "bash", "mem_search", "mem_read", "mem_save"],
	"sdd-onboard.md": ["read", "grep", "find", "edit", "write", "bash", "mem_search", "mem_read", "mem_save"],
	"sdd-proposal.md": ["read", "grep", "find", "edit", "write", "mem_search", "mem_read", "mem_save"],
	"sdd-research.md": ["read", "grep", "find", "edit", "write", "mem_search", "mem_read", "mem_save", "fetch_content", "web_search", "source_check", "get_search_content"],
	"sdd-spec.md": ["read", "grep", "find", "edit", "write", "mem_search", "mem_read", "mem_save"],
	"sdd-status.md": ["read", "grep", "find", "bash", "mem_search", "mem_read"],
	"sdd-sync.md": ["read", "grep", "find", "edit", "write", "bash", "mem_search", "mem_read", "mem_save"],
	"sdd-tasks.md": ["read", "grep", "find", "edit", "write", "mem_search", "mem_read", "mem_save"],
	"sdd-verify.md": ["read", "grep", "find", "edit", "write", "bash", "mem_search", "mem_read", "mem_save"],
};

test("SDD package agents declare role-appropriate tools as YAML arrays", () => {
	for (const [fileName, requiredTools] of Object.entries(requiredToolsByAgent)) {
		const path = join(assetsAgentsDir, fileName);
		assert.ok(existsSync(path), `${fileName} must exist`);
		const tools = readTools(path);
		for (const tool of requiredTools) {
			assert.ok(tools.includes(tool), `${fileName} must include ${tool}`);
		}
		for (const tool of tools) {
			assert.ok(!tool.startsWith("subagent_"), `${fileName} must not allow child subagent tool ${tool}`);
		}
	}
});

test("artifact-producing SDD agents can persist OpenSpec files while status remains read-only", () => {
	for (const fileName of Object.keys(requiredToolsByAgent).filter(
		(fileName) => fileName !== "sdd-status.md",
	)) {
		const tools = readTools(join(assetsAgentsDir, fileName));
		assert.ok(tools.includes("edit"), `${fileName} must include edit`);
		assert.ok(tools.includes("write"), `${fileName} must include write`);
	}

	const statusTools = readTools(join(assetsAgentsDir, "sdd-status.md"));
	assert.ok(!statusTools.includes("edit"), "sdd-status.md must remain read-only");
	assert.ok(!statusTools.includes("write"), "sdd-status.md must remain read-only");
});

test("research instructions require executed evidence rather than blanket denial", () => {
	const source = readFileSync(join(assetsAgentsDir, "sdd-research.md"), "utf8");
	assert.doesNotMatch(source, /documentation=\[\]; open-web=\[\]/);
	assert.match(source, /实际调用已批准的工具/);
	assert.match(source, /每条声明映射到来源 ID/);
	assert.match(source, /proposal_ready: false/);
	assert.ok(!readTools(join(assetsAgentsDir, "sdd-research.md")).includes("bash"));
});

test("project does not ship local SDD agent overrides", () => {
	for (const relativeDir of [join(".pi", "agents"), join(".pi", "subagents")]) {
		const dir = join(repoRoot, relativeDir);
		if (!existsSync(dir)) continue;
		const overrides = readdirSync(dir).filter((entry) => /^sdd-.*\.md$/i.test(entry));
		assert.deepEqual(overrides, [], `${relativeDir} must not shadow package SDD agents`);
	}
});

test("generic non-SDD agents declare exact role tool allowlists", () => {
	for (const [fileName, expectedTools] of Object.entries(GENERIC_ROLE_TOOLS)) {
		const path = join(assetsAgentsDir, fileName);
		assert.ok(existsSync(path), `${fileName} must exist`);
		assert.deepEqual(readTools(path), expectedTools);
		if (fileName !== "jero-worker.md") {
			assertGenericRoleBody(fileName, readFileSync(path, "utf8"));
		}
	}
});

test("sdd-verify phase text carries the verify-result envelope and validate-before-persist rule", () => {
	// gentle-pi#535 row 5: the phase must produce a natively admissible report
	// on its first persistence attempt without hunting the format elsewhere.
	const envelopeFields = [
		"schema: gentle-ai.verify-result/v1",
		"evidence_revision: sha256:",
		"verdict:",
		"blockers:",
		"critical_findings:",
		"requirements:",
		"scenarios:",
		"test_command:",
		"test_exit_code:",
		"test_output_hash: sha256:",
		"build_command:",
		"build_exit_code:",
		"build_output_hash: sha256:",
	];

	const agentSource = readFileSync(join(assetsAgentsDir, "sdd-verify.md"), "utf8");
	assert.match(agentSource, /```yaml\nschema: gentle-ai\.verify-result\/v1\n/);
	for (const field of envelopeFields) {
		assert.ok(agentSource.includes(field), `sdd-verify.md envelope must carry \`${field}\``);
	}
	assert.match(agentSource, /首个非空内容/);
	assert.match(
		agentSource,
		/进程内权威在每次结算附带该封套时对其进行严格解码/,
	);

	const chainSource = readFileSync(join(repoRoot, "assets", "chains", "sdd-verify.chain.md"), "utf8");
	assert.match(chainSource, /gentle-ai\.verify-result\/v1/);
	assert.match(chainSource, /对封套做字节检查/);
});

test("the retired Pi adversarial role agents are not packaged", () => {
	// gentle-pi#311 P5: the refuter and targeted validator verdicts execute
	// through Go-owned pi processes via provider-rendered self-contained
	// vectors; no Pi agent definition may reintroduce a Pi-authored verdict.
	for (const retired of ["review-refuter.md", "review-validator.md"]) {
		assert.ok(!existsSync(join(assetsAgentsDir, retired)), `${retired} must stay deleted`);
	}
});
