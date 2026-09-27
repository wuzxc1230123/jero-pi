#!/usr/bin/env node
// jero-pi authority 模块边界门（设计 §9.1）：lib/authority/ 是进程内评审
// 权威——其信任边界靠结构强制，而非约定。本脚本以 CI 门取代逐次评审的
// 人工 grep：
//   1. 任何 import 不得触及 extensions/（权威不得依赖展示层，控制流的
//      两个方向都不行）；
//   2. 不得读 process.env（权威只收 typed 入参——环境是调用方的事）；
//   3. 不得用 domainHashV1（上游 gentle-ai 身份命名空间——jero 身份
//      一律用 canonical.ts 的 jeroDomainHash）。
// 对源文本直接用朴素正则：模块虽是 TypeScript，但被禁模式足够简单，
// 引入解析器只会多一个依赖而不增加安全性。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "lib", "authority");
const files = readdirSync(root).filter((name) => name.endsWith(".ts")).sort();

const rules = [
	// 静态与动态 import 都算：经 `await import("../extensions/x")` 夹带的
	// 展示层依赖是同一种越界。
	{ pattern: /(?:from\s+"(?:\.\.\/)*extensions\/|import\(\s*["'](?:\.\.\/)*extensions\/)/, message: "imports extensions/ (presentation layer)" },
	{ pattern: /\bprocess\.env\b/, message: "reads process.env" },
	{ pattern: /\bdomainHashV1\b/, message: "uses upstream domainHashV1 (gentle-ai identity namespace)" },
];

const violations = [];
for (const file of files) {
	// 纯注释行是文档（"不要用 domainHashV1"），不是使用。行内块注释在行
	// 过滤之前就被剥除，因此同行形式 `/* note */ const v = process.env.X;`
	// 仍会被检查——该行不能再躲在 `/*` 前缀后面。
	const code = readFileSync(join(root, file), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.split("\n")
		.filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
		.join("\n");
	for (const rule of rules) {
		if (rule.pattern.test(code)) violations.push(`${file}: ${rule.message}`);
	}
}

if (violations.length > 0) {
	console.error("lib/authority/ boundary violations (design §9.1):");
	for (const violation of violations) console.error(`- ${violation}`);
	process.exit(1);
}

console.log(`lib/authority/ boundary clean (${files.length} modules checked).`);
