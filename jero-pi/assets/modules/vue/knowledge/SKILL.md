---
name: vue
description: Vue 3 前端领域知识入口：组合式 API 与响应式纪律、组件契约、工具链与测试验证主干、领域评审关注点的指路与硬约束。当仓库含 .vue 文件或 nuxt/vue 配置、任务涉及 Vue/Nuxt/Pinia/Vite 开发时使用。触发词：Vue、vue3、SFC、组合式 API、Nuxt、Pinia、Vite、VueUse、script setup。
---

# Vue 3 前端开发（模块知识入口，L1）

本文件是 vue 模块的知识入口：注册表与派发覆盖层消费的都是它。深度
知识一律住 references（L2，按需读），本入口只做指路与硬约束。

## 知识指路（L2，references/ 按需读）

- 语言与响应式：`style-and-formatting`（SFC 结构与风格）、`naming-conventions`（命名决策树）、`composition-api`（组合式 API 核心）、`reactivity-deep`（响应式原理与陷阱）、`typescript-integration`（TS 集成面）
- 组件与复用：`component-contracts`（props/emits/插槽/v-model）、`provide-inject`（依赖注入）、`composables-authoring`（自写 composable 纪律）、`vueuse-utilities`（VueUse 全谱与调用策略）、`vueuse-patterns`（VueUse 高频模式）
- 状态与路由：`pinia-state`（Pinia store 设计）、`routing-patterns`（Vue Router 守卫与数据预取）
- 工程与验证：`vite-toolchain`（Vite 配置与插件）、`testing-practices`（Vitest + Vue Test Utils）、`verification-gates`（三道门协议）、`project-structure`（src 布局与 auto-import）
- 应用与专题：`nuxt-framework`（Nuxt 4 约定与数据获取）、`performance-optimization`（虚拟列表/懒加载/keep-alive）、`ssr-hydration`（SSR 与水合）、`forms-validation`（表单与校验）、`transitions-animation`（过渡动画）、`directives-usage`（内置与自定义指令）、`security-practices`（XSS/注入红线）、`upgrade-migrations`（2→3 与版本谱系）、`_sources`（出处账本）

## 硬约束

- `node_modules/`、`dist/` 及构建产物必须 gitignore（评审走 git 对象，忽略后天然干净）。
- 验证走 CLI 退出码：`vitest run` 是模块钉住的测试命令（SDD Strict TDD 取值链
  第一级）；"构建通过"不等于"测得过"，类型检查（`vue-tsc`）独立于测试单独跑。
- 响应式断链（解构丢失/reactive 替换整对象/props 直接改）是评审 BLOCKER 级
  关注面（判定依据见 `reactivity-deep`）。

## 委派路由

- 评审 Vue/SFC/组合式 API 变更：追加委派 `vue-reviewer`（只读，报告发现不修复）。
- 验证执行（build/typecheck/test/脚手架）：委派 `vue-tester`（有界写者，产验证报告）。
- 组件架构/状态边界/技术选型设计：建议 `vue-architect` 产出设计提案。
- 执行实现：直接使用 `jero-worker`——本入口注入的惯例随之生效，
  禁止另做与 `jero-worker` 同角色的语言执行代理（孤儿代理）。
