import assert from "node:assert/strict";
import test from "node:test";
import {
	type RemediationObservations,
	type RemediationPlan,
	parseRemediationPlan,
	plannedCommands,
	remediationEvidence,
	observeRemediationTool,
} from "../lib/agents-remediation.ts";

const CWD = "/repo";

function validPlan(): RemediationPlan {
	return {
		cwd: CWD,
		commands: ["echo one", "echo two"],
		runtimeHarness: { command: "node --test" },
		rollback: { boundary: "git HEAD", command: "git checkout -- ." },
	};
}

function freshState(): RemediationObservations {
	return {
		failedEvidenceRevision: `sha256:${"a".repeat(64)}`,
		plan: parseRemediationPlan(validPlan(), CWD),
		observations: [],
		pending: {},
		invalid: false,
	};
}

function endEvent(toolCallId: string, command: string, overrides: Record<string, unknown> = {}) {
	return {
		toolName: "bash",
		type: "tool_execution_end",
		toolCallId,
		isError: false,
		result: {
			content: [{ type: "text", text: "ok" }],
			details: { remediationCommand: { toolCallId, command, cwd: CWD, exitCode: 0 } },
		},
		...overrides,
	};
}

test("parseRemediationPlan validates shape and clones its input", () => {
	const raw = validPlan();
	const plan = parseRemediationPlan(raw, CWD);
	assert.deepEqual(plannedCommands(plan), ["echo one", "echo two", "node --test", "git checkout -- ."]);
	raw.commands.push("echo mutated");
	assert.equal(plan.commands.length, 2, "plan must be a structured clone");
});

test("parseRemediationPlan accepts a reasoned harness skip", () => {
	const plan = validPlan();
	plan.runtimeHarness = { command: undefined, naReason: "not_applicable because docs-only edits have no runnable harness" };
	assert.doesNotThrow(() => parseRemediationPlan(plan, CWD));
});

test("parseRemediationPlan rejects malformed plans", () => {
	const cases: Array<() => unknown> = [
		() => parseRemediationPlan({ ...validPlan(), cwd: "/elsewhere" }, CWD),
		() => parseRemediationPlan({ ...validPlan(), commands: [] }, CWD),
		() => parseRemediationPlan({ ...validPlan(), commands: [" padded"] }, CWD),
		() => parseRemediationPlan({ ...validPlan(), rollback: { boundary: "", command: "git checkout -- ." } }, CWD),
		() => parseRemediationPlan({ ...validPlan(), runtimeHarness: { command: "node --test", naReason: "why bother" } }, CWD),
		() => parseRemediationPlan({ ...validPlan(), runtimeHarness: { command: undefined, naReason: "too short" } }, CWD),
		() => parseRemediationPlan(null, CWD),
	];
	for (const run of cases) assert.throws(run, TypeError);
});

test("observation pairing yields signed evidence for the whole plan", () => {
	const state = freshState();
	const commands = plannedCommands(state.plan);
	for (const [index, id] of ["t1", "t2", "t3", "t4"].entries()) {
		observeRemediationTool(state, { toolName: "bash", type: "tool_execution_start", toolCallId: id, args: { command: commands[index] } });
	}
	for (const [index, id] of ["t1", "t2", "t3", "t4"].entries()) {
		observeRemediationTool(state, endEvent(id, commands[index]));
	}
	const evidence = remediationEvidence(state);
	assert.ok(evidence, "complete observation set must produce evidence");
	assert.equal(evidence!.schema, "jero.remediation-evidence/v1");
	assert.equal(evidence!.commands.length, 2);
	assert.equal(evidence!.runtime_harness.status, "passed");
	assert.match(evidence!.rollback.evidence, /^cwd \/repo; retained command observation sha256:[0-9a-f]{64}/);
});

test("unplanned commands are ignored, failures poison the evidence", () => {
	const state = freshState();
	observeRemediationTool(state, { toolName: "bash", type: "tool_execution_start", toolCallId: "x", args: { command: "rm -rf /" } });
	assert.equal(remediationEvidence(state), undefined, "open plan without observations has no evidence");

	const failing = freshState();
	const commands = plannedCommands(failing.plan);
	observeRemediationTool(failing, { toolName: "bash", type: "tool_execution_start", toolCallId: "t1", args: { command: commands[0] } });
	observeRemediationTool(failing, endEvent("t1", commands[0], { isError: true }));
	assert.equal(failing.invalid, true);
	assert.equal(remediationEvidence(failing), undefined);
});

test("evidence stays absent while observations are pending", () => {
	const state = freshState();
	const commands = plannedCommands(state.plan);
	observeRemediationTool(state, { toolName: "bash", type: "tool_execution_start", toolCallId: "t1", args: { command: commands[0] } });
	assert.equal(remediationEvidence(state), undefined, "pending command has not produced evidence yet");
	observeRemediationTool(state, endEvent("t1", commands[0]));
	assert.equal(remediationEvidence(state), undefined, "a single observed slot is not a complete plan");
	for (const [index, id] of [["t2", commands[1]], ["t3", commands[2]], ["t4", commands[3]]].entries()) {
		observeRemediationTool(state, { toolName: "bash", type: "tool_execution_start", toolCallId: id[0], args: { command: id[1] } });
		observeRemediationTool(state, endEvent(id[0], id[1]));
	}
	assert.ok(remediationEvidence(state));
});
