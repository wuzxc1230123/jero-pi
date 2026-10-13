---
name: vue-provide-inject
description: 依赖注入：provide/inject 跨层传值、InjectionKey 类型化、响应式注入面、默认值与缺席守卫、与组合式状态的关系。当组件深层传参或评审注入用法时使用。触发词：provide、inject、依赖注入、InjectionKey、跨组件传值。
---

# 依赖注入（provide/inject）

props 逐层透传（prop drilling）的解药是注入：祖先供、后代取，中间层零感知——但注入是隐式契约，类型化与缺席守卫是它的安全带。

> **相关技能：** 组件显式契约 → `vue-components`；全局状态该进 store 时 → `vue-pinia`；注入式 composable → `vue-composables`。

## 何时使用

深层组件树传配置/主题/上下文、设计插件级 API（如消息服务的上下文）、评审 inject 用法时使用。

## 核心要点

- **何时用**：横切上下文（主题/本地化/表单注册）与插件向深层的服务暴露；一对一父子还是 props——注入不是 props 的默认替代。
- **类型化注入键**：`const ThemeKey: InjectionKey<Theme> = Symbol('theme')`——provide/inject 两侧共享同一 key（独立模块导出），类型断裂在编译期暴露。
- **注入响应式面**：provide ref/computed 本体（不是 `.value` 快照）——保持后代响应；注入方 `computed(() => injected.value.x)` 派生。
- **缺席守卫**：`inject(key, default)` 默认值或 `inject(key, null)` + 显式判空——无守卫的 `inject` 非空断言是运行时炸弹（`!` 压制要注释豁免，纪律同 `vue-typescript`）。
- **只读面**：提供给后代的可变状态要收窄——provide `readonly(state)` 或只暴露方法（后代不该反向改祖先状态——单向流在注入域同样成立）。
- **与 VueUse 的组合**：`createInjectionState`（组合式封装 provide/inject，含缺席守卫）是"注入式 composable"的标准件（见 `vue-vueuse`）。

## 红线

- 字符串 key 无类型地散装 provide/inject（两侧漂移无编译器兜底）。
- 深层注入业务数据绕过 store（注入管上下文，store 管域状态——错位双源）。
- 后代直接改注入的可变对象（单向流破坏）。

## 深读指路（references/）

注入模式与类型化全谱：`references/provide-inject.md`。
