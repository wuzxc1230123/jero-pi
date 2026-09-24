#!/usr/bin/env node
// 一次性测量工具：按 node --test 相同的文件级并发（availableParallelism）直接
// 执行每个测试文件，输出每文件串行 wall 时间表，用于定位拖慢整套件下限的
// 串行长链。语义与 node --test 一致（test() 文件可直接执行，失败即非零退出），
// 但只保留计时——pass/fail 以退出码聚合。
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const root = process.cwd();

const files = [];
for (const dir of ["tests", join("tests", "authority"), join("tests", "authority", "conformance")]) {
	for (const name of readdirSync(join(root, dir))) {
		const p = join(root, dir, name);
		if (statSync(p).isFile() && /\.test\.ts$/.test(name)) files.push(p);
	}
}

const concurrency = Math.max(1, availableParallelism());
const results = [];
let index = 0;
let failures = 0;

function lane() {
	return new Promise((resolve) => {
		const next = () => {
			if (index >= files.length) return resolve();
			const file = files[index++];
			const started = Date.now();
			let code = 0;
			try {
				execFileSync(process.execPath, ["--experimental-strip-types", file], { cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout: 300_000, killSignal: "SIGKILL" });
			} catch (error) {
				code = error.status ?? (error.killed ? 124 : 1);
			}
			const seconds = (Date.now() - started) / 1000;
			results.push({ file: file.slice(root.length + 1), seconds, code });
			if (code !== 0) failures++;
			console.error(`done ${seconds.toFixed(1).padStart(7)}s exit=${code} ${file.slice(root.length + 1)}`);
			next();
		};
		next();
	});
}

const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, lane));
const wall = (Date.now() - started) / 1000;

results.sort((a, b) => b.seconds - a.seconds);
const aggregate = results.reduce((sum, r) => sum + r.seconds, 0);
console.log(`文件 ${results.length} · 聚合 ${aggregate.toFixed(0)}s · 12核理论下限 ${(aggregate / concurrency).toFixed(0)}s · 实测 wall ${wall.toFixed(0)}s · 失败文件 ${failures}`);
for (const r of results.slice(0, 30)) console.log(`${r.seconds.toFixed(1).padStart(7)}s  exit=${r.code}  ${r.file}`);
