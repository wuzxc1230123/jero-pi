// 测试进程环境预载：由 package.json 的 test 脚本经 --require 注入。
// 只做无语义的提速：为所有 node --test 子进程启用 V8 编译缓存
// （类型剥离与解析结果跨进程复用，180 个测试文件各自的启动成本显著下降）。
// 注意：不得在此设置任何 GIT_* 变量——审查权威夹具把继承的 GIT_* 覆盖
// 视为环境篡改并故意失败关闭（REVIEW_GIT_ENV_UNSAFE）。
const { enableCompileCache } = require("node:module");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const cacheDir = join(tmpdir(), "jero-pi-compile-cache");
process.env.NODE_COMPILE_CACHE = cacheDir;
try { enableCompileCache(cacheDir); } catch { /* 缓存不可用仅影响速度，不影响正确性 */ }
