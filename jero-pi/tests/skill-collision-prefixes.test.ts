import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { __testing } from "../extensions/skill-registry.ts";

const repoRoot = join(import.meta.dirname, "..");

function readSkillName(dir: string): string | undefined {
	const source = readFileSync(join(repoRoot, "skills", dir, "SKILL.md"), "utf8");
	return __testing.parseFrontmatter(source).name;
}

const PREFIXED_NAMES: Record<string, string> = {
	"branch-pr": "jero-branch-pr",
	"chained-pr": "jero-chained-pr",
	"cognitive-doc-design": "jero-cognitive-doc-design",
	"comment-writer": "jero-comment-writer",
	"issue-creation": "jero-issue-creation",
	"judgment-day": "jero-judgment-day",
	"rdd-defect-workflow": "jero-rdd-defect-workflow",
	"skill-creator": "jero-skill-creator",
	"skill-improver": "jero-skill-improver",
	"skill-registry": "jero-skill-registry",
	"work-unit-commits": "jero-work-unit-commits",
};

const UNPREFIXED_DIRS = ["jero-ai", "release"];

for (const [dir, expectedName] of Object.entries(PREFIXED_NAMES)) {
	test(`skills/${dir}/SKILL.md frontmatter name is prefixed`, () => {
		assert.equal(readSkillName(dir), expectedName);
	});
}

for (const dir of UNPREFIXED_DIRS) {
	test(`skills/${dir}/SKILL.md frontmatter name carries no jero- prefix`, () => {
		const name = readSkillName(dir);
		assert.ok(name, `expected a name for ${dir}`);
		assert.ok(!name?.startsWith("jero-"), `${dir} should not be prefixed, got ${name}`);
	});
}
