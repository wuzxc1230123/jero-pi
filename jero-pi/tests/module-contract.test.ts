import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BUILTIN_AGENT_NAMES,
	MAX_ENTRY_LINES,
	expandPermissionPreset,
	globToRegExp,
	parseModuleManifest,
	verifyModule,
	type ModuleManifest,
} from "../lib/module-contract.ts";

// module-contract 域测试：解析结构校验 + 安装验证七查 + glob 语义。
// 金样与 skills/jero-module-creator/assets/module-manifest.template.json 同形。

function goldenManifestJson(): string {
	return JSON.stringify({
		schema: "jero.module-contract/v1",
		token: "godot",
		version: "1.0.0",
		triggers: { files: ["project.godot", "**/*.tscn"], intents: ["场景"] },
		knowledge: { entry: "knowledge/SKILL.md", references: ["references/*.md"] },
		roles: [
			{
				name: "godot-reviewer",
				isolation: ["adversarial-eyes", "least-privilege"],
				permission: "read-only",
				model: "balanced",
				output: "findings-report",
			},
		],
		bindings: {
			worker: { inject: "entry" },
			review: { inject: "entry", appendRoles: ["godot-reviewer"] },
		},
		routing: [
			{ when: { surface: "review" }, action: "delegate-role", target: "godot-reviewer" },
		],
		config: { testCommand: "dotnet test", gitignore: [".godot/"] },
	});
}

function goldenManifest(): ModuleManifest {
	const parsed = parseModuleManifest(goldenManifestJson());
	assert.ok(parsed.manifest !== undefined, "金样必须解析成功");
	return parsed.manifest;
}

function mutateGolden(mutate: (data: Record<string, unknown>) => void): string {
	const data = JSON.parse(goldenManifestJson()) as Record<string, unknown>;
	mutate(data);
	return JSON.stringify(data);
}

test("金样清单解析零问题", () => {
	const parsed = parseModuleManifest(goldenManifestJson());
	assert.deepEqual(parsed.issues, []);
	assert.equal(parsed.manifest?.token, "godot");
	assert.equal(parsed.manifest?.roles.length, 1);
});

test("坏 JSON 与非对象顶层被拒", () => {
	const broken = parseModuleManifest("{not json");
	assert.equal(broken.manifest, undefined);
	assert.ok(broken.issues.some((item) => item.code === "json"));
	const scalar = parseModuleManifest("[]");
	assert.equal(scalar.manifest, undefined);
	assert.ok(scalar.issues.some((item) => item.code === "type"));
});

test("契约串、token、version 的格式门", () => {
	const wrongSchema = parseModuleManifest(mutateGolden((data) => {
		data.schema = "someone-elses/v9";
	}));
	assert.ok(wrongSchema.issues.some((item) => item.path === "$.schema"));

	const badToken = parseModuleManifest(mutateGolden((data) => {
		data.token = "Godot";
	}));
	assert.ok(badToken.issues.some((item) => item.path === "$.token"));

	const badVersion = parseModuleManifest(mutateGolden((data) => {
		data.version = "one";
	}));
	assert.ok(badVersion.issues.some((item) => item.path === "$.version"));
});

test("未知字段被拒（契约封闭）", () => {
	const withExtra = parseModuleManifest(mutateGolden((data) => {
		(data as Record<string, unknown> & { surprise: boolean }).surprise = true;
	}));
	assert.ok(withExtra.issues.some((item) => item.code === "unknown-key" && item.path === "$.surprise"));
});

test("静态触发器空数组是结构失败——语义 intents 不能独活", () => {
	const emptyFiles = parseModuleManifest(mutateGolden((data) => {
		(data.triggers as Record<string, unknown>).files = [];
	}));
	assert.ok(emptyFiles.issues.some((item) => item.code === "empty" && item.path === "$.triggers.files"));
});

test("未知编排面与未知绑定字段被拒", () => {
	const badSurface = parseModuleManifest(mutateGolden((data) => {
		const bindings = data.bindings as Record<string, unknown>;
		bindings.telepathy = { inject: "entry" };
	}));
	assert.ok(badSurface.issues.some((item) => item.code === "enum" && item.path === "$.bindings.telepathy"));

	const badInject = parseModuleManifest(mutateGolden((data) => {
		const bindings = data.bindings as Record<string, Record<string, unknown>>;
		bindings.worker.inject = "everything";
	}));
	assert.ok(badInject.issues.some((item) => item.code === "enum" && item.path === "$.bindings.worker.inject"));
});

test("路由 when 必须恰含 surface 或 slip 之一", () => {
	const both = parseModuleManifest(mutateGolden((data) => {
		(data.routing as unknown[])[0] = {
			when: { surface: "review", slip: { utteranceType: "review" } },
			action: "delegate-role",
			target: "godot-reviewer",
		};
	}));
	assert.ok(both.issues.some((item) => item.code === "exclusive"));

	const neither = parseModuleManifest(mutateGolden((data) => {
		(data.routing as unknown[])[0] = { when: {}, action: "delegate-role", target: "godot-reviewer" };
	}));
	assert.ok(neither.issues.some((item) => item.code === "exclusive"));
});

test("slip 条件字段的枚举与布尔校验", () => {
	const badSlip = parseModuleManifest(mutateGolden((data) => {
		(data.routing as unknown[])[0] = {
			when: { slip: { utteranceType: "vibes", crossModule: "yes" } },
			action: "suggest-role",
			target: "godot-reviewer",
		};
	}));
	assert.ok(badSlip.issues.some((item) => item.path === "$.routing[0].when.slip.utteranceType"));
	assert.ok(badSlip.issues.some((item) => item.path === "$.routing[0].when.slip.crossModule"));
});

test("entry 路径必须是模块相对 .md", () => {
	const badEntry = parseModuleManifest(mutateGolden((data) => {
		(data.knowledge as Record<string, unknown>).entry = "../escape.txt";
	}));
	assert.ok(badEntry.issues.some((item) => item.path === "$.knowledge.entry"));
});

test("config 的 testCommand 不接受空白串", () => {
	const blank = parseModuleManifest(mutateGolden((data) => {
		(data.config as Record<string, unknown>).testCommand = "   ";
	}));
	assert.ok(blank.issues.some((item) => item.path === "$.config.testCommand"));
});

test("权限预设展开", () => {
	assert.deepEqual(expandPermissionPreset("read-only"), ["read", "grep", "find"]);
	assert.deepEqual(expandPermissionPreset("scan"), ["read", "grep"]);
	assert.deepEqual(expandPermissionPreset("write-bounded"), ["read", "grep", "find", "edit", "write", "bash"]);
});

test("verifyModule：金样全绿", () => {
	const report = verifyModule({
		manifest: goldenManifest(),
		entryText: "# 短入口\n",
		repoFiles: ["project.godot", "scenes/main.tscn"],
		otherTokens: ["webapi"],
	});
	assert.equal(report.ok, true);
	assert.equal(report.checks.filter((item) => item.status === "fail").length, 0);
});

test("verifyModule：token 与松散技能重名失败（双轨漂移防护）", () => {
	const duplicate = verifyModule({
		manifest: goldenManifest(),
		repoFiles: ["project.godot"],
		looseSkillTokens: ["webapi", "godot"],
	});
	const checkResult = duplicate.checks.find((item) => item.id === "no-loose-duplicate");
	assert.equal(checkResult?.status, "fail");
	assert.ok(checkResult?.detail.includes("godot"));

	const clean = verifyModule({
		manifest: goldenManifest(),
		repoFiles: ["project.godot"],
		looseSkillTokens: ["webapi"],
	});
	assert.equal(clean.checks.find((item) => item.id === "no-loose-duplicate")?.status, "pass");

	const skipped = verifyModule({ manifest: goldenManifest() });
	assert.equal(skipped.checks.find((item) => item.id === "no-loose-duplicate")?.status, "skip");
});

test("pipeline 硬门：解析、非法拒绝与验证语义（响亮的缺席）", () => {
	const withGate = parseModuleManifest(mutateGolden((data) => {
		(data as Record<string, unknown> & { pipeline: unknown }).pipeline = { gate: "sdd-full" };
	}));
	assert.deepEqual(withGate.issues, []);
	assert.deepEqual(withGate.manifest?.pipeline, { gate: "sdd-full" });

	const badGate = parseModuleManifest(mutateGolden((data) => {
		(data as Record<string, unknown> & { pipeline: unknown }).pipeline = { gate: "  " };
	}));
	assert.ok(badGate.issues.some((item) => item.path === "$.pipeline.gate"));

	const unknownExtra = parseModuleManifest(mutateGolden((data) => {
		(data as Record<string, unknown> & { pipeline: unknown }).pipeline = { gate: "x", bonus: true };
	}));
	assert.ok(unknownExtra.issues.some((item) => item.code === "unknown-key"));

	if (withGate.manifest === undefined) return;
	const declared = verifyModule({ manifest: withGate.manifest, repoFiles: ["project.godot"] });
	const gateCheck = declared.checks.find((item) => item.id === "pipeline-gate-loud");
	assert.equal(gateCheck?.status, "pass");
	assert.ok(gateCheck?.detail.includes("sdd-full"));
	assert.ok(gateCheck?.detail.includes("进包加链"));

	const absent = verifyModule({ manifest: goldenManifest(), repoFiles: ["project.godot"] });
	assert.equal(absent.checks.find((item) => item.id === "pipeline-gate-loud")?.status, "skip");
});

test("编排器资产接线钉住：覆盖层协议、Strict TDD 取值链与路由单", () => {
	const assets = join(import.meta.dirname, "..", "assets");
	const workflow = readFileSync(join(assets, "sdd-orchestrator-workflow.md"), "utf8");
	const skills = readFileSync(join(assets, "orchestrator-skills.md"), "utf8");
	const delegation = readFileSync(join(assets, "orchestrator-delegation.md"), "utf8");

	assert.match(workflow, /module-overlay\.md` 的 Strict TDD 命令（能力模块 `config\.testCommand` 的编译产物）→ `openspec\/config\.yaml`/);
	assert.match(workflow, /module_resolution/);
	assert.match(workflow, /name-unresolved/);
	assert.match(skills, /manifest-only` 面只提示模块存在与触发词/);
	assert.match(skills, /module_resolution/);
	assert.match(delegation, /#### 自然语言路由单（RoutingSlip）/);
	assert.match(delegation, /R3 SDD-suggest ⇔ 重大歧义 ∧/);
	assert.match(delegation, /风险、规模、文件数永不进入 R3 的条件/);
});

test("verifyModule：token 撞包内前缀族失败", () => {
	const manifest = goldenManifest();
	(manifest as { token: string }).token = "jero-godot";
	const report = verifyModule({ manifest });
	const tokenCheck = report.checks.find((item) => item.id === "token-valid");
	assert.equal(tokenCheck?.status, "fail");
});

test("verifyModule：token 与其他模块重复失败", () => {
	const report = verifyModule({ manifest: goldenManifest(), otherTokens: ["godot"] });
	assert.equal(report.checks.find((item) => item.id === "token-unique")?.status, "fail");
});

test("verifyModule：角色遮蔽包内代理失败", () => {
	const manifest = goldenManifest();
	// 直接构造而非改 readonly：用解析路径生成违规形态。
	const raw = mutateGolden((data) => {
		(data.roles as Record<string, unknown>[])[0].name = "jero-worker";
	});
	const parsed = parseModuleManifest(raw);
	assert.ok(parsed.manifest !== undefined);
	const report = verifyModule({ manifest: parsed.manifest, repoFiles: ["project.godot"] });
	assert.equal(report.checks.find((item) => item.id === "no-shadow")?.status, "fail");
	assert.ok(BUILTIN_AGENT_NAMES.includes("jero-worker"));
	// manifest 变量仅供断言金样未受污染。
	assert.equal(manifest.roles[0].name, "godot-reviewer");
});

test("verifyModule：角色名不带本模块词元前缀失败", () => {
	const raw = mutateGolden((data) => {
		(data.roles as Record<string, unknown>[])[0].name = "scene-cop";
		(data.bindings as Record<string, Record<string, unknown>>).review.appendRoles = ["scene-cop"];
		(data.routing as unknown[])[0] = { when: { surface: "review" }, action: "delegate-role", target: "scene-cop" };
	});
	const parsed = parseModuleManifest(raw);
	assert.ok(parsed.manifest !== undefined);
	const report = verifyModule({ manifest: parsed.manifest, repoFiles: ["project.godot"] });
	assert.equal(report.checks.find((item) => item.id === "no-shadow")?.status, "fail");
});

test("verifyModule：静态触发器零命中失败，未提供样本跳过", () => {
	const miss = verifyModule({ manifest: goldenManifest(), repoFiles: ["package.json"] });
	assert.equal(miss.checks.find((item) => item.id === "triggers-hit")?.status, "fail");

	const skipped = verifyModule({ manifest: goldenManifest() });
	assert.equal(skipped.checks.find((item) => item.id === "triggers-hit")?.status, "skip");
});

test("verifyModule：路由目标不可解析失败（含 appendRoles）", () => {
	const raw = mutateGolden((data) => {
		(data.routing as unknown[])[0] = { when: { surface: "review" }, action: "delegate-role", target: "who" };
	});
	const parsed = parseModuleManifest(raw);
	assert.ok(parsed.manifest !== undefined);
	const report = verifyModule({ manifest: parsed.manifest, repoFiles: ["project.godot"] });
	assert.equal(report.checks.find((item) => item.id === "routing-resolves")?.status, "fail");

	const rawAppend = mutateGolden((data) => {
		(data.bindings as Record<string, Record<string, unknown>>).review.appendRoles = ["ghost"];
	});
	const parsedAppend = parseModuleManifest(rawAppend);
	assert.ok(parsedAppend.manifest !== undefined);
	const appendReport = verifyModule({ manifest: parsedAppend.manifest, repoFiles: ["project.godot"] });
	assert.equal(appendReport.checks.find((item) => item.id === "append-roles-resolve")?.status, "fail");
});

test("verifyModule：零隔离正当性的角色失败（孤儿代理源头灭绝）", () => {
	const raw = mutateGolden((data) => {
		(data.roles as Record<string, unknown>[])[0].isolation = [];
	});
	const parsed = parseModuleManifest(raw);
	assert.ok(parsed.manifest !== undefined);
	const report = verifyModule({ manifest: parsed.manifest, repoFiles: ["project.godot"] });
	const isolation = report.checks.find((item) => item.id === "isolation-justified");
	assert.equal(isolation?.status, "fail");
	assert.ok(isolation?.detail.includes("godot-reviewer"));
});

test("verifyModule：entry 超行失败、缺文本失败、无 entry 档跳过", () => {
	const long = Array.from({ length: MAX_ENTRY_LINES + 1 }, (_, i) => `line ${i}`).join("\n");
	const over = verifyModule({ manifest: goldenManifest(), entryText: long });
	assert.equal(over.checks.find((item) => item.id === "entry-size")?.status, "fail");

	const missing = verifyModule({ manifest: goldenManifest() });
	assert.equal(missing.checks.find((item) => item.id === "entry-size")?.status, "fail");

	const raw = mutateGolden((data) => {
		const bindings = data.bindings as Record<string, Record<string, unknown>>;
		bindings.worker.inject = "manifest-only";
		bindings.review.inject = "manifest-only";
	});
	const parsed = parseModuleManifest(raw);
	assert.ok(parsed.manifest !== undefined);
	const skipped = verifyModule({ manifest: parsed.manifest });
	assert.equal(skipped.checks.find((item) => item.id === "entry-size")?.status, "skip");
});

test("glob 语义：* 不跨目录、** 跨目录、? 单字符、字面量转义", () => {
	assert.equal(globToRegExp("project.godot").test("project.godot"), true);
	assert.equal(globToRegExp("project.godot").test("src/project.godot"), false);

	assert.equal(globToRegExp("**/*.tscn").test("main.tscn"), true);
	assert.equal(globToRegExp("**/*.tscn").test("scenes/ui/main.tscn"), true);
	assert.equal(globToRegExp("**/*.tscn").test("main.tscn.bak"), false);

	assert.equal(globToRegExp("src/*.go").test("src/main.go"), true);
	assert.equal(globToRegExp("src/*.go").test("src/cmd/main.go"), false);

	assert.equal(globToRegExp("a?c.md").test("abc.md"), true);
	assert.equal(globToRegExp("a?c.md").test("ac.md"), false);

	assert.equal(globToRegExp("v1.0.txt").test("v1x0.txt"), false);
});
