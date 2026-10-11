import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paths = [
	"assets/sdd-orchestrator-workflow.md",
	"assets/support/sdd-status-contract.md",
];
const documents = paths.map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

function routingContract(document: string): string {
	const section = document.match(/## 有界规划路由\n([\s\S]*?)(?=\n## |$)/);
	assert.ok(section, "explicit bounded planning routing contract is required");
	return section[1].trim();
}

for (const [index, path] of paths.entries()) {
	test(`${path}: native planning tokens are the only automatic routes`, () => {
		const contract = routingContract(documents[index]);
		for (const [token, phase] of [["propose", "sdd-proposal"], ["spec", "sdd-spec"], ["design", "sdd-design"], ["tasks", "sdd-tasks"]]) {
			assert.ok(contract.includes(`| \`${token}\` | \`${phase}\` |`));
		}
		assert.match(contract, /仅有的自动规划路由/);
		assert.doesNotMatch(contract, /^\| `sdd-(?:propose|spec|design|tasks)`/m);
	});

	test(`${path}: planning preserves native blocker and edit-root guards`, () => {
		const contract = routingContract(documents[index]);
		for (const guard of [
			"对歧义的变更选择、未解析的会话预检或不安全的动作上下文停止",
			"证明计划的写入位于权威工作区或允许编辑根之内",
			"无允许编辑根的 workspace-planning 保持只读",
			"规划不绕过 init 守卫、提案前门或阶段批准要求",
			"绝不从散文推断路由",
			"真正的阻塞项保持在 `blockedReasons`、非阻塞诊断保持在 `notes`，绝不放进 `nextRecommended`",
			"绝不为了凑出一条路由而丢弃它们",
		]) {
			assert.ok(contract.includes(guard), `missing guard: ${guard}`);
		}
	});
}

test("workflow and support contract agree on bounded planning routing", () => {
	assert.equal(routingContract(documents[0]), routingContract(documents[1]));
});
