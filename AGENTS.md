# AGENTS.md — jero-pi 仓库导航（给 AI 编码代理）

本文件是后续编码代理的最小缓存：布局、铁律、标准验证回路。细节以 `docs/jero-reference.md`（机器钉住的单一参考）为准。

## 布局

- 仓库根 = npm 包本体（本文件与 `package.json` 同级，所有命令直接在仓库根执行）。`pi install git:` 在安装根直接解析根 `package.json`（即 pi 清单）并装依赖——仓库扁平化后无编排壳、无子目录。
- `JERO-PI-DESIGN.md`：项目设计文档（决策记录与演化终态；v2.0 起按现行代码重建——"为什么这样设计"在此，"现在是什么"在 `docs/jero-reference.md`）。`_tools/`（实现期分析文档，lib 注释仍引用其路径）与 `benchmarks/`（基准工具）为**本地目录、不入库**——git 里没有它们，克隆后 lib 注释中的 `_tools/*.md` 引用按历史事实理解即可。
- 包根：`extensions/`（Pi 注册层，9 文件）· `lib/`（领域层；`lib/module-contract.ts` + `lib/module-bundle-content.ts`（束内内容机检判定体） + `lib/module-trigger-compiler.ts` + `lib/module-verify-pipeline.ts` + `lib/module-installer.ts` 是能力模块契约 v2 的执行面——模块仅项目内、`/jero:install-module` 指令安装、依赖自动先装）· `lib/authority/`（进程内评审权威，信任边界核心）· `assets/`（24 代理 + 4 链 + orchestrator 文档，被安装/转录/渲染的活资产；`assets/modules/` 为包内模块库——安装器注册表，现有 godot、golang、dotnet、vue 四束全中文模块）· `skills/` · `prompts/` · `docs/` · `schemas/`（含 `module.schema.json`，与 lib 常量由门钉零漂移）· `scripts/`（质量门）· `tests/` · `runtime/`（生成物）。

## 三条铁律

1. **新评审域代码进 `lib/authority/`**（纯域：不 import extensions、不读 `process.env`、typed 入参/判别联合出参；`scripts/check-authority-boundary.mjs` 结构性强制）。外围前缀 `lib/review-*` 与 `lib/jero-ai-review-*` 是分阶段移植的化石，命名棘轮（`check:review-naming` + `review-naming-baseline.json`）只降不升——改动到这两个前缀的文件时顺手迁入 `authority/` 并 `--update` 基线。**身份层三件是永久宿主侧，不是迁移欠债**：`lib/review-canonical.ts`（上游 `domainHashV1` 的定义点）、`lib/review-lock.ts` 与 `lib/review-repository.ts`（其消费者，`repository_id`/`authority_id` 的铸造点）——边界门第三条规则刻意把上游身份命名空间挡在 authority 之外，authority 只消费它们铸好的身份值，勿尝试迁入。
2. **测试夹具必须放 `<base>-shared.ts`**。`*.z2/z3/z4.test.ts` 是超长测试文件的机械分片（node:test 只在文件间并行，重文件需重平衡）；**分片之间禁止互相 import**——否则被导入分片的顶层 `test()` 注册会在导入方进程重跑，整套件成倍膨胀。跨多个被测文件共享的纯助手文件（如 `tests/review-test-fixtures.ts`、`tests/agents-fake-child.ts`）不属分片夹具、命名自由，但**顶层同样不得注册 `test()`**（同一条膨胀纪律）。新测试文件 ≤1000 行。
3. **`runtime/*.mjs` 是生成物，勿手改**。源清单（`lib/authority/wire-contract*`、`lib/authority/client-contract*` 等 13 个）变更后必须 `pnpm run build:runtime-modules`；漂移由 `--check`、import 存在性后校验与打包门三重拦截。

## 标准验证回路（按改动域选）

- 任何改动：`pnpm typecheck`（诊断棘轮，基线为 0——保持编译干净即免维护）。
- `lib/authority/**`：`pnpm run test:authority:full`（runtime 再生成 → authority 域测试 → 一致性 → 边界检查）。
- 编排/子代理：`pnpm run test:agents`；评审外围：`pnpm run test:review`；SDD：`pnpm run test:sdd`。
- 新增/改名斜杠命令、工具、技能后：`pnpm run fix:docs-manifest`（再生成 `docs/jero-reference.md` 的 manifest 块）。
- 全量：`pnpm test`（全部测试文件并发 12 + 顺序 harness）。慢文件定位：`pnpm run test:timed`（单文件预算 300s）。
- 质量门（被 `prepack` 串联，可单独跑）：`check:test-quality`（5 条反模式，含分片互 import + `// allow-test-rule:<name>` 逃逸阀）· `check:empty-catch`（空 catch 必须带注释或语句，`// allow-empty-catch` 逃逸阀）· `check:authority-boundary` · `check:docs-manifest` · `check:review-naming` · `check:module-contract`（模块 schema 与 lib 常量零漂移 + 创建器金样绿灯）· `verify-package-files.mjs`（必需文件 + 68 个黄金向量字节钉住）。
- 局部快速回路（迭代用，不替代全量）：`pnpm run test:fast`——按改动路径映射最小相关测试集（保守过选），prepack 前仍须全量。
- 真机冒烟（手动/按需，不进 prepack）：`JERO_PI_SMOKE_PROVIDER=<provider> JERO_PI_SMOKE_MODEL=<model> pnpm run smoke:pi`——本地 Pi 宿主 + 包本体在一次性沙箱仓库过六面（装载/模型/模块安装/触发编译/记忆/评审全生命周期）；单测+门全测不到的集成缝只有这层能抓（三缺陷修复批为实证）。

## 已知约束

- 测试进程**不得设置任何 `GIT_*` 环境变量**——权威夹具把继承的 `GIT_*` 视为环境篡改并 fail-closed（`scripts/test-env.cjs` 只做 V8 编译缓存预载）。
- Windows：ACL 权威（PowerShell/icacls）默认进程级打桩，仅专属端到端用例走真栈；spawn 类 spawnSync 一律带 timeout。
- `gentle-` 残留与 `gentle-ai` 原生二进制依赖已于 2026-09-27 全部清退（评审为进程内权威 `jero-authority-cli`，wire 身份/存储/调用词自化为 `jero-ai.*`，迁移期旧名只读回退）；现存 gentle-ai 字样**仅为守卫对象或历史事实**（外来存储守卫/上游工单引用/harness 禁用清单，见 `docs/jero-reference.md` 兼容白名单节）——**绝不顺手清理**。
- 评审切片预算默认 400 行（`/jero:lean` 档位与之正交：预算管工作切片，梯子管必要性）。

## 约定

- 代码：TypeScript + tabs + `.ts` 扩展直接 import（`--experimental-strip-types`）；注释与提交信息用简体中文；提交信息格式 `<type>(<scope>): <摘要>`（如 `fix+test:` / `refactor+test:`）。
- 测试：`node:test` + `node:assert/strict`，文件名 = 被测模块名。
- 环境变量全部 `JERO_PI_*` 前缀，清单见 jero-reference.md「契约与环境」。

## 入口文档链

`README.md` → `docs/jero-reference.md`（架构/命令/工具/生命周期总表）→ `docs/tutorial-first-review.md`（第一次评审最小闭环）· `docs/how-to-choose-discipline.md`（评审/SDD/精益选档）· `docs/extension-guide.md`（零代码扩展：技能/子代理/语言包，自动创建走 `/module-creation` `/agent-creation`；机器验证的契约化模块见 `docs/module-contract.md` + `/jero-module-verify`）· `docs/dependency-exit-plan.md`（9 个伴生依赖退出预案）。运行时技能路由表：`skills/jero-skills/SKILL.md`。
