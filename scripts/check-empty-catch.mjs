#!/usr/bin/env node
// 空 catch 卫生门：catch 块体内要么有语句、要么有说明注释。
// 本仓库对「吞掉异常」的态度必须是显式决策——类型化回退
// （catch { return undefined; }）与带 why 注释的 best-effort 清理都是
// 合法形状；唯一禁止的是既无语句也无注释的真空块，它让读者无法
// 区分「刻意吞掉」与「漏报」。逃逸阀：catch 行或块体内出现
// `// allow-empty-catch` 视为已声明意图。
// 局限（与 check-authority-boundary.mjs 的正则路线一致）：不解析语法，
// 字符串字面量里出现的 `catch {` 可能误报——遇到时用逃逸阀标注即可。
// 用法：node scripts/check-empty-catch.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
// fileURLToPath 对目录 URL 保留尾部分隔符，统一去掉以保证相对路径裁剪对齐。
const rootDir = root.endsWith("\\") || root.endsWith("/") ? root.slice(0, -1) : root;
const SCANNED = ["lib", "extensions", "tests", "scripts"];
const SKIPPED_DIRS = new Set(["node_modules", "runtime"]);
const CATCH = /catch(?:\s*\([^)]*\))?\s*\{/g;
// promise 形态的空回调：`.catch(() => {})` 与 try/catch 是同一种"吞掉异常"，
// 门必须同样看守，否则两句换写法就绕过（逃逸阀同用 allow-empty-catch）。
const PROMISE_CATCH = /\.catch\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}\s*\)/g;
const ALLOW = "allow-empty-catch";

function* walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) { if (!SKIPPED_DIRS.has(entry.name)) yield* walk(path); }
		else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs") || entry.name.endsWith(".cjs")) yield path;
	}
}

function lineOf(source, index) {
	return source.slice(0, index).split("\n").length;
}

const failures = [];
for (const base of SCANNED) {
	for (const path of walk(join(rootDir, base))) {
		const source = readFileSync(path, "utf8");
		CATCH.lastIndex = 0;
		let match;
		while ((match = CATCH.exec(source)) !== null) {
			let depth = 1;
			let i = match.index + match[0].length;
			while (i < source.length && depth > 0) {
				const ch = source[i];
				if (ch === "{") depth += 1;
				else if (ch === "}") depth -= 1;
				i += 1;
			}
			const body = source.slice(match.index + match[0].length, i - 1);
			if (body.includes(ALLOW)) continue;
			const bodyWithoutComments = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
			// 有语句：类型化回退等合法形状；只有注释：why 注释已声明意图。
			if (bodyWithoutComments.trim() !== "") continue;
			if (body.includes("//") || body.includes("/*")) continue;
			// 行内逃逸阀：整行声明意图（单行 catch 常见）。
			const lineStart = source.lastIndexOf("\n", match.index) + 1;
			const lineEnd = source.indexOf("\n", i);
			const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
			if (line.includes(ALLOW)) continue;
			failures.push(`${path.slice(rootDir.length + 1).split("\\").join("/")}:${lineOf(source, match.index)}: empty catch block without a why-comment`);
		}
		PROMISE_CATCH.lastIndex = 0;
		let promiseMatch;
		while ((promiseMatch = PROMISE_CATCH.exec(source)) !== null) {
			// `.catch(() => {})` 是真空回调：同行必须携带 allow 逃逸阀或
			// why 注释，否则与真空 try/catch 同罪。
			const lineStart = source.lastIndexOf("\n", promiseMatch.index) + 1;
			const lineEnd = source.indexOf("\n", promiseMatch.index + promiseMatch[0].length);
			const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
			if (line.includes(ALLOW) || line.includes("//")) continue;
			failures.push(`${path.slice(rootDir.length + 1).split("\\").join("/")}:${lineOf(source, promiseMatch.index)}: empty promise catch without a why-comment`);
		}
	}
}
if (failures.length > 0) {
	console.error(`check-empty-catch: ${failures.length} empty catch block(s) without a why-comment:`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log("check-empty-catch: every empty catch block states its intent.");
