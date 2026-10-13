import { test } from "node:test";
import assert from "node:assert/strict";

// test-coverage 合并器纯函数测试：V8 profile 区间 → 行覆盖的归并语义。
// 脚本可被测试的先例是 docs-manifest（tests/docs-manifest.test.ts）——
// .mjs 无类型声明，经动态导入显式标注（与该先例同法）。
const coverageScriptSpecifier: string = "../scripts/test-coverage.mjs";
const {
	flattenRanges,
	innermostCovered,
	lineStartOffsets,
	mergeProfiles,
} = await import(coverageScriptSpecifier) as {
	flattenRanges: (functions: unknown[]) => { start: number; end: number; count: number }[];
	innermostCovered: (
		ranges: { start: number; end: number; count: number }[],
		offset: number,
	) => boolean | undefined;
	lineStartOffsets: (text: string) => number[];
	mergeProfiles: (
		profiles: {
			url: string;
			source: string;
			ranges: { start: number; end: number; count: number }[];
		}[],
	) => Map<string, { executable: Set<number>; covered: Set<number> }>;
};

test("flattenRanges 摊平函数区间树", () => {
	const ranges = flattenRanges([
		{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] },
		{
			isBlockCoverage: true,
			ranges: [
				{ startOffset: 20, endOffset: 30, count: 1 },
				{ startOffset: 22, endOffset: 25, count: 0 },
			],
		},
	]);
	assert.equal(ranges.length, 3);
	assert.deepEqual(ranges[2], { start: 22, end: 25, count: 0 });
});

test("innermostCovered 取最内层包含区间（未覆盖块压过外层已覆盖）", () => {
	const ranges = [
		{ start: 0, end: 100, count: 3 },
		{ start: 20, end: 30, count: 0 },
	];
	assert.equal(innermostCovered(ranges, 10), true);
	assert.equal(innermostCovered(ranges, 25), false);
	assert.equal(innermostCovered(ranges, 200), undefined);
});

test("lineStartOffsets 以换行定界，首行从 0 起", () => {
	assert.deepEqual(lineStartOffsets("ab\ncd\ne"), [0, 3, 6]);
	assert.deepEqual(lineStartOffsets("one-line"), [0]);
});

test("mergeProfiles：可执行行并集、覆盖跨 profile 并集", () => {
	const source = "function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\n";
	// 行起始 offset：[0,15,27,29,44,56]——函数 a 覆盖行1-3（0..28），b 覆盖行4-6（29..58）。
	// profile1：函数 a 已执行，函数 b 未执行。
	const p1 = {
		url: "file:///repo/lib/x.ts",
		source,
		ranges: [
			{ start: 0, end: 28, count: 2 },
			{ start: 29, end: 58, count: 0 },
		],
	};
	// profile2：函数 b 也被执行了。
	const p2 = {
		url: "file:///repo/lib/x.ts",
		source,
		ranges: [{ start: 29, end: 58, count: 1 }],
	};
	const merged = mergeProfiles([p1, p2]);
	const entry = merged.get("file:///repo/lib/x.ts");
	assert.ok(entry, "归并结果必须含该 url");
	assert.equal(entry.executable.size, 6);
	assert.equal(entry.covered.size, 6);

	const onlyP1 = mergeProfiles([p1]);
	const onlyP1Entry = onlyP1.get("file:///repo/lib/x.ts");
	assert.ok(onlyP1Entry);
	assert.equal(onlyP1Entry.covered.size, 3);
});

test("mergeProfiles：块级未覆盖区间把行判为未覆盖", () => {
	const source = "function a() {\n  hard();\n  easy();\n}\n";
	// 行起始：[0,15,26,36]；未覆盖块 15..22 覆住行2。
	const merged = mergeProfiles([
		{
			url: "file:///repo/lib/y.ts",
			source,
			ranges: [
				{ start: 0, end: source.length, count: 5 },
				{ start: 15, end: 22, count: 0 },
			],
		},
	]);
	const entry = merged.get("file:///repo/lib/y.ts");
	assert.ok(entry, "归并结果必须含该 url");
	// 行2 落在未覆盖块里，行1/3/4 被外层覆盖。
	assert.deepEqual([...entry.covered].sort(), [1, 3, 4]);
});

test("mergeProfiles：跨 profile 否决不成立——他者的未执行子块不得否决本 profile 的覆盖", () => {
	const source = "function a() {\n  hard();\n  easy();\n}\n";
	// profile1：整个函数执行（行1-4 覆盖）。
	const p1 = {
		url: "file:///repo/lib/y.ts",
		source,
		ranges: [{ start: 0, end: source.length, count: 3 }],
	};
	// profile2：同一文件只加载未调用，块级显示 hard() 块未执行。
	const p2 = {
		url: "file:///repo/lib/y.ts",
		source,
		ranges: [
			{ start: 0, end: source.length, count: 0 },
			{ start: 15, end: 22, count: 0 },
		],
	};
	const entry = mergeProfiles([p1, p2]).get("file:///repo/lib/y.ts");
	assert.ok(entry, "归并结果必须含该 url");
	// 任一 profile 判定覆盖即覆盖：行1-4 全覆盖。
	assert.deepEqual([...entry.covered].sort(), [1, 2, 3, 4]);
});
