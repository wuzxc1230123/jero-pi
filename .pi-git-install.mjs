// git: 安装编排：pi 的 git 源安装（installGit）克隆后只在克隆根查
// package.json 决定是否执行依赖安装——本仓包本体在 jero-pi/ 子目录，
// 没有这层编排时子包的 9 个生产依赖（pi-lens/pi-web-access 等扩展件）
// 永远不会安装，扩展清单里的 node_modules/* 路径静默失配成半装载。
// 根 package.json 的 postinstall 调用本脚本，把依赖装进子包。
//
// 双包管理器：子包带 pnpm-lock.yaml 且 pnpm 可用时走 pnpm 生产安装
// （对齐 pi 的 pnpm 参数面），否则 npm。开发仓守卫：jero-pi/node_modules
// 已有宿主（pnpm 开发安装的形态）时跳过——防止在开发仓根误跑包管理器
// 时用 npm 布局污染 pnpm 的 node_modules。
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PKG = "jero-pi";
const HOST_MARKER = `${PKG}/node_modules/@earendil-works/pi-coding-agent`;

if (existsSync(HOST_MARKER)) {
	console.log(`[jero-pi git 安装] 检测到既有 ${PKG}/node_modules（开发仓或已安装）——跳过`);
	process.exit(0);
}

const usePnpm = existsSync(`${PKG}/pnpm-lock.yaml`)
	&& spawnSync("pnpm", ["--version"], { shell: process.platform === "win32" }).status === 0;
const plan = usePnpm
	? { cmd: "pnpm", args: ["install", "--prod", "--config.auto-install-peers=false", "--config.strict-peer-dependencies=false", "--config.strict-dep-builds=false"] }
	: { cmd: "npm", args: ["install", "--omit=dev", "--no-audit", "--no-fund", "--legacy-peer-deps"] };

console.log(`[jero-pi git 安装] ${plan.cmd} ${plan.args.join(" ")}（cwd=${PKG}）`);
const result = spawnSync(plan.cmd, plan.args, {
	cwd: PKG,
	stdio: "inherit",
	shell: process.platform === "win32",
});
if (result.status !== 0) {
	console.error(`[jero-pi git 安装] 依赖安装失败（退出码 ${result.status}）`);
	process.exit(result.status ?? 1);
}
for (const dep of ["pi-lens", "pi-web-access"]) {
	if (!existsSync(`${PKG}/node_modules/${dep}`)) {
		console.error(`[jero-pi git 安装] 装后校验失败：${PKG}/node_modules/${dep} 缺席`);
		process.exit(1);
	}
}
console.log("[jero-pi git 安装] 子包依赖就位");
