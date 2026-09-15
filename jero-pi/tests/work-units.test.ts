import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseWorkUnits, validateWorkUnitGraph } from "../lib/sdd/work-units.ts";

const VALID_TASKS = `# Tasks

## Review Workload Forecast

| Field | Value |
|-------|-------|

### Work unit: parser

Files:
- lib/parser.ts
- tests/parser.test.ts

Spec:
- REQ-1
- REQ-2

Depends: none

- [ ] Implement the parser. <!-- sdd-owner: implementation -->

### Work unit: cli

Files:
- src\\cli.ts

Spec:
- REQ-3

Depends: parser

### Work unit: docs

Files:
- ./docs/cli.md

Spec:
- REQ-3

Depends: parser
`;

test("parseWorkUnits reads units, normalizes paths, and keeps declaration order", () => {
	const { units, issues } = parseWorkUnits(VALID_TASKS);
	assert.deepEqual(issues, []);
	assert.equal(units.length, 3);
	assert.equal(units[0].label, "parser");
	assert.deepEqual(units[0].files, ["lib/parser.ts", "tests/parser.test.ts"]);
	assert.deepEqual(units[0].spec, ["REQ-1", "REQ-2"]);
	assert.deepEqual(units[0].depends, []);
	assert.deepEqual(units[1].files, ["src/cli.ts"], "backslash paths normalize to forward slashes");
	assert.deepEqual(units[1].depends, ["parser"]);
	assert.deepEqual(units[2].files, ["docs/cli.md"], "leading ./ is stripped");
});

test("validateWorkUnitGraph: disjoint acyclic graph is ok with a deterministic order", () => {
	const { units } = parseWorkUnits(VALID_TASKS);
	const validation = validateWorkUnitGraph(units);
	assert.equal(validation.ok, true);
	assert.deepEqual(validation.issues, []);
	assert.deepEqual(validation.order, ["parser", "cli", "docs"]);
	// Stability: same input, same order on repeat.
	assert.deepEqual(validateWorkUnitGraph(parseWorkUnits(VALID_TASKS).units).order, validation.order);
});

test("validateWorkUnitGraph: shared file between independent units fails closed", () => {
	const markdown = `
### Work unit: a

Files:
- lib/shared.ts

Spec:
- REQ-1

Depends: none

### Work unit: b

Files:
- lib/shared.ts

Spec:
- REQ-2

Depends: none
`;
	const validation = validateWorkUnitGraph(parseWorkUnits(markdown).units);
	assert.equal(validation.ok, false);
	assert.deepEqual(validation.order, []);
	assert.deepEqual(validation.issues, [{ code: "file-overlap", file: "lib/shared.ts", labels: ["a", "b"] }]);
});

test("validateWorkUnitGraph: shared file between dependent units stays ok", () => {
	const markdown = `
### Work unit: base

Files:
- lib/shared.ts

Spec:
- REQ-1

Depends: none

### Work unit: layered

Files:
- lib/shared.ts

Spec:
- REQ-2

Depends: base
`;
	const validation = validateWorkUnitGraph(parseWorkUnits(markdown).units);
	assert.equal(validation.ok, true);
	assert.deepEqual(validation.order, ["base", "layered"]);
});

test("validateWorkUnitGraph: dependency cycles fail closed naming the path", () => {
	const markdown = `
### Work unit: a

Files:
- lib/a.ts

Spec:
- REQ-1

Depends: b

### Work unit: b

Files:
- lib/b.ts

Spec:
- REQ-2

Depends: c

### Work unit: c

Files:
- lib/c.ts

Spec:
- REQ-3

Depends: a
`;
	const validation = validateWorkUnitGraph(parseWorkUnits(markdown).units);
	assert.equal(validation.ok, false);
	assert.deepEqual(validation.order, []);
	assert.equal(validation.issues.length, 1);
	assert.equal(validation.issues[0].code, "cycle");
	assert.deepEqual(validation.issues[0].code === "cycle" ? validation.issues[0].labels : [], ["a", "b", "c", "a"]);
});

test("parseWorkUnits and validation reject malformed units", () => {
	const markdown = `
### Work unit: one

Files:
- lib/one.ts

Spec:
- REQ-1

Depends: one

### Work unit: one

Files:

Spec:

Depends: missing-label, ,

### Work unit:

Files:
- lib/x.ts

Spec:
- REQ-9

Depends: none
`;
	const { units, issues } = parseWorkUnits(markdown);
	const codes = issues.map((issue) => issue.code).sort();
	assert.deepEqual(codes, ["empty-files", "empty-label", "empty-spec", "malformed-depends", "malformed-depends"]);
	const validation = validateWorkUnitGraph(units);
	assert.equal(validation.ok, false);
	// Parse issues and graph issues are separate surfaces: the command layer
	// must aggregate both. Self-dependency also surfaces as a DFS cycle.
	const validationCodes = validation.issues.map((issue) => issue.code).sort();
	assert.deepEqual(validationCodes, ["cycle", "duplicate-label", "self-dependency", "unknown-dependency"]);
});

test("empty input parses to zero units and validates ok", () => {
	const parsed = parseWorkUnits("# Tasks\n\n- [ ] Loose task without units\n");
	assert.deepEqual(parsed.units, []);
	const validation = validateWorkUnitGraph(parsed.units);
	assert.equal(validation.ok, true);
	assert.deepEqual(validation.order, []);
});

test("the command surface and the orchestrator gate stay wired", () => {
	// jero-pi P1-B (conservative): the graph check must stay a registered
	// deterministic command and a gated workflow step, not prompt prose.
	const extension = readFileSync(join(import.meta.dirname, "..", "extensions", "jero-ai.ts"), "utf8");
	assert.match(extension, /registerCommand\("jero:sdd-units"/);
	assert.match(extension, /parseWorkUnits\(readFileSync\(tasksPath/);
	const workflow = readFileSync(join(import.meta.dirname, "..", "assets", "sdd-orchestrator-workflow.md"), "utf8");
	assert.match(workflow, /### Work-Unit Graph Gate/);
	assert.match(workflow, /\/jero:sdd-units \{change\}/);
	assert.match(workflow, /parallel launches remain out of scope/);
});
