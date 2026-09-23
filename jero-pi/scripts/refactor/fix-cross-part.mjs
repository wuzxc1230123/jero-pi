// 跨分片导入修复器：以 tsc 诊断为输入（TS2304 Cannot find name 'X'），
// 在报错文件中补上 X 的具名导入（X 的宿主按 parts/shared 中的导出声明定位）。
// 用法：node fix-cross-part.mjs "<tsc 输出>"
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const testsDir = join(here, "..", "..", "tests");
const output = process.argv[2] || "";
const re = /^(tests[/\\][\w.-]+\.test\.ts)\(\d+,\d+\): error TS2304: Cannot find name '([A-Za-z_$][\w$]*)'/gm;
const needed = new Map(); // file -> Set<symbol>
let m;
while ((m = re.exec(output)) !== null) {
	const file = m[1].split("\\").join("/");
	if (!needed.has(file)) needed.set(file, new Set());
	needed.get(file).add(m[2]);
}
if (needed.size === 0) {
	process.stdout.write("no cross-part TS2304 to fix\n");
	process.exit(0);
}
// 符号宿主定位：在 tests 下找 "export <decl> sym" 的分片/共享文件
const files = readdirSync(testsDir).filter((f) => f.endsWith(".ts"));
const hostOf = (symbol) => {
	const declRe = new RegExp(`^export (?:async )?(?:function|const|let|class) ${symbol}\\b`, "m");
	for (const f of files) {
		const text = readFileSync(join(testsDir, f), "utf8");
		if (declRe.test(text)) return f;
	}
	return undefined;
};
for (const [file, symbols] of needed) {
	const path = join(here, "..", "..", file);
	let text = readFileSync(path, "utf8");
	const byHost = new Map();
	for (const symbol of symbols) {
		const host = hostOf(symbol);
		if (!host) {
			process.stderr.write(`未找到宿主：${symbol}\n`);
			continue;
		}
		if (!byHost.has(host)) byHost.set(host, new Set());
		byHost.get(host).add(symbol);
	}
	const imports = [];
	for (const [host, syms] of byHost) {
		imports.push(`import { ${[...syms].sort().join(", ")} } from "./${host.replace(/\.ts$/, "")}.ts";`);
	}
	text = `${imports.join("\n")}\n${text}`;
	writeFileSync(path, text, "utf8");
	process.stdout.write(`${file}: +${imports.length} import(s)\n`);
}
