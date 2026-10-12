# 升级与迁移（upgrade-migrations）

> 来源：Vue 官方迁移指南（2→3/版本小节）+ Nuxt/Vite/Pinia 升级文档；权威级：建议
> 锚定版本：Vue 3.6 / Nuxt 4 / Vite 7（2026-10 谱系） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 版本谱系锚点（Vue 3.x）

| 版本 | 关键面 |
|---|---|
| 3.4 | `defineModel` 稳定；解析器与响应式性能重做 |
| 3.5 | 响应式 props 解构；`useTemplateRef`/`useId`/`onWatcherCleanup`；watch 句柄 `pause/resume` |
| 3.6 | Vapor 模式（可选无虚拟 DOM 编译策略）；按项目基准评估启用 |

配套矩阵：Nuxt 4 ↔ Vue 3.5+；Vite 7 ↔ Node 20.19+/22.12+；
Pinia 3 ↔ Vue 3.5+——升级前 peer 范围逐项核对。

## 单步升级剧本

1. **读迁移小节**：官方 migration 指南逐条对照（弃用/行为变化清
   单），不凭印象。
2. **依赖链同步**：`vue`/`vue-router`/`pinia`/`@vue/test-utils`/
   `vite`/插件版本矩阵一次对齐；`pnpm outdated` 清零。
3. **机械变更**：包管理器重装 + 配置面（vite.config/tsconfig 按
   新默认核对）——升级 PR 只含升级产物（diff 可审）。
4. **验证闭环**：`vue-tsc` + `vitest run` + 构建 + 关键路径冒烟
   （verification-gates）；弃用警告逐条处置（迁移或带工单的临时
   压制），批量压制当完成是自欺。

## Vue 2 → 3 存量迁移

- **@vue/compat 先行**：兼容层双栈运行，按警告清单逐域迁移——
  生产兼容层警告归零后再摘（`vue: compat build` 移除）。
- 语义迁移面：
  - 全局 API 挂实例：`new Vue()` → `createApp()`；插件/指令/
    混入逐实例注册。
  - 过滤器（`filters`）移除 → `computed`/方法/模块函数。
  - 事件总线（`$on/$off/$once`）移除 → mitt / props-events /
    store。
  - `slot-scope`/`slot` 旧语法 → `v-slot`；`key` 挂 template。
  - `v-model` 默认名 `value/input` → `modelValue/update:
    modelValue`（组件面逐一核）。
  - `functional` 组件 → 函数式/普通组件；异步组件
    `defineAsyncComponent`。
- **Options API 不强制重写**：选项式在 3.x 持续支持——"新代码组
  合式、旧代码按需改"按域推进；全量重写是独立项目。

## 构建面迁移（webpack/Vue CLI → Vite）

- 与框架升级**分 PR**：入口（`index.html` 进根）/别名/环境变量
  （`VUE_APP_` → `VITE_`）/代理配置对应关系逐项搬。
- 依赖 CJS 的老库核对 `optimizeDeps`；动态导入路径变量改静态可
  分析形态。

## Nuxt 面迁移

- Nuxt 3 → 4：`app/` 目录重组（官方迁移工具）；`compatibilityVersion`
  预演开关先行。
- 模块生态版本矩阵（`@pinia/nuxt` 等）随升；`.nuxt` 生成物不携
  带。

## 回归哨兵

- 升级前后产物体积对照（意外膨胀即依赖面异常）；快照测试对结构
  回归敏感——升级 PR 里快照 diff 是审读材料不是噪音。

## 红线

- 跨大版本直跳不踩兼容层；升级 PR 混功能重构。
- 弃用警告批量压制；锁文件不随升（peer 矩阵失配静默漂移）。
