---
name: vue-upgrade
description: 升级与迁移：Vue 2→3 迁移面（Options API→组合式/过滤器移除/事件总线）、@vue/compat 兼容层、版本谱系（3.4 defineModel/3.5 响应式 props 解构/3.6 Vapor）、依赖链同步。当升 Vue 版本或迁移存量代码时使用。触发词：升级、迁移、Vue 2、Vue 3 迁移、compat、Vapor、版本。
---

# 升级与迁移（Vue）

升级是可编排的工程流程：迁移构建面 → 语义面 → 依赖链同步——跨版本大跳与混功能变更是两大反模式。

> **相关技能：** 组合式 API（迁移目标形态） → `vue-composition`；工具链同步 → `vue-tooling`；依赖治理 → `vue-project`。

## 何时使用

升 Vue/Nuxt/Vite 版本、Vue 2→3 存量迁移、处理弃用警告时使用。

## 核心要点

- **版本谱系锚点**：3.4 `defineModel` 稳定；3.5 响应式 props 解构 + `useTemplateRef`/`onWatcherCleanup`/`useId`；3.6 Vapor 模式（可选的无虚拟 DOM 编译策略——新代码可选用，存量迁移独立评估）。升版前读迁移小节（官方 migration 指南），逐条对照。
- **2→3 迁移面清单**：`@vue/compat` 兼容层先跑起来（双栈警告驱动）；过滤器（filter）移除→computed/方法；事件总线（`$on/$off`）移除→mitt/props-events/store；`slot-scope` 旧语法→`v-slot`；`v-model` 默认名改 `modelValue`；`functional` 组件→普通函数组件；全局 API 挂实例（`createApp(...).use(...)`）。
- **Options API 不强制重写**：选项式在 3.x 持续支持——迁移按"新代码组合式、旧代码按需改"推进；全量重写是独立项目不是升级附庸。
- **依赖链同步**：Vue 升级连带 `vue-router`/`pinia`/`@vue/test-utils`/`vite`/插件版本矩阵（peer 范围核对）；`npm outdated` 全清后再谈完成。
- **验证闭环**：每步 `vue-tsc` + `vitest run` + 构建 + 手动冒烟关键路径；迁移期 `@vue/compat` 警告清单归零再摘兼容层。
- **Vite 面迁移**：webpack/vue-cli → Vite 独立评估（代理/别名/环境变量/插件对应关系），与框架升级分 PR。

## 红线

- 跨大版本直跳不踩 compat 层（生产炸点不可审读）。
- 升级 PR 混入功能重构（diff 不可审）。
- 弃用警告批量压制当完成。

## 深读指路（references/）

迁移剧本与版本谱系表：`references/upgrade-migrations.md`。
