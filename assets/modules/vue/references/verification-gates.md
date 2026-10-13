# 验证协议（verification-gates）

> 来源：本仓原创（对齐 golang/godot/dotnet 模块 verification-gates 协议，为 vue 域重铸）；权威级：项目纪律
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 原则

验证结论只认**退出码与落盘产物**："build 过了""我看着页面正常"
不构成证据。每道门留下可复查的命令 + 输出摘录 + 结论。

## 三道门（按序执行）

1. **类型检查**：`vue-tsc --noEmit`（或 `npm run typecheck`）
   - 记录退出码与诊断数；Vite 构建不查类型——类型门必须独立存在
     （typescript-integration 红线同源）。
   - 项目未配置类型检查时如实注明跳过原因（新项目应在脚手架期
     补上，不是验证期补）。
2. **构建**：`npm run build`（Vite/Nuxt 产物）
   - 记录退出码与产物体积摘要（chunk 异常膨胀是依赖面信号）；
     构建失败即止于 FAIL。
3. **测试**：`vitest run`（模块 `config.testCommand` 钉住值——
   Strict TDD 取值链第一级）
   - 记录退出码与通过/失败/跳过计数；watch 模式（`vitest` 裸跑）
     不算验证——必须 `vitest run` 单次收敛形态。
   - 收窄范围（`vitest run src/foo`）只在迭代中途；报告注明覆盖
     面，收窄跑过必须补全量。

## 证据形态（verification-report）

每道门：

```
命令：vitest run
环境：node 22.x / npm 10.x（lock 锁定）
退出码：0
关键输出：Test Files 24 passed (24); Tests 187 passed (187)
结论：PASS
```

结论三元：`PASS | FAIL | NOT VERIFIED`——工具链不可用（PATH 无
`node`/`npm`、依赖未装）时如实 `NOT VERIFIED` 附原因，**绝不伪装
通过**。

## 上下文纪律

- 包管理器与版本跟 lock 文件（`package-lock.json`/`pnpm-lock.yaml`
  提交态）；环境与 lock 不符是 NOT VERIFIED 的合法原因。
- monorepo 按包跑（受影响包三道门 + 依赖它的包测试面）；E2E 冒烟
  按变更面手动/按需补，不进本协议默认门。
- SSR 项目加跑生产形态冒烟（`npm run preview` 起本地产物过关键路
  径）——开发服务器绿不等于产物绿。

## 与模块机制的接线

- 模块 `config.testCommand` 钉住 `vitest run`——SDD Strict TDD 的
  取值链第一级（覆盖层 → config.yaml → 探测）；改测试命令改清单，
  不改脚本硬编码。
- `vue-tester` 角色是本协议的执行者（有界写者：只动测试与验证产
  物）；评审者消费报告但不重跑。
- `dist/`/生成物永远再生成：疑似脏产物污染时清空重构建并记录。

## 红线

- 无退出码引用的"通过"结论；用 watch 模式/部分覆盖宣布全绿。
- 只跑 vite build 当类型验证（假绿）。
- 在报告里替未跑的浏览器/设备代言（"Chrome 过了 Safari 应该也
  行"不是结论）。
