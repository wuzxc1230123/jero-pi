---
name: vue-transitions
description: 过渡与动画：Transition 单元素/列表 TransitionGroup、CSS 类时间线（enter/leave 六态）、模式与初始渲染、动画性能纪律（transform/opacity）、 reduced-motion 可达性。当实现或评审过渡动画时使用。触发词：过渡、动画、Transition、TransitionGroup、transition-group、动效、CSS 动画。
---

# 过渡与动画（Vue 3）

过渡是状态变化的可视化反馈：`<Transition>` 管单元素进出、`<TransitionGroup>` 管列表重排——类名时间线是机制，性能与可达性是纪律。

> **相关技能：** 列表渲染与 key → `vue-components`；性能预算 → `vue-performance`；主题变量 → `vue-tooling`。

## 何时使用

实现/评审元素与列表过渡、路由切换动画、动画性能与可达性时使用。

## 核心要点

- **单元素 `<Transition>`**：`v-if`/`v-show` 切换的进场/离场/模式切换动画；同一时刻多元素需 `mode="out-in"`/`in-out` 显式声明；初始渲染 `appear` 才播。
- **类名时间线**：`v-enter-from/active/to` 与 `v-leave-from/active/to` 六态——`-active` 定过渡属性与时长，`-from/-to` 定起止态；`name` 属性换前缀避免冲突。
- **列表 `<TransitionGroup>`**：子项必带 `key`；`v-move` 类平滑重排（FLIP 动画内建）；新入/移出项与移动项动画分离控制。
- **性能纪律**：只动 `transform` 与 `opacity`（合成器路径，不触 layout/paint）；`animation` 复杂序列走 CSS keyframes 或 GSAP 谱系（JS 动画用 `@starting-style`/钩子配合）；高频动效 60fps 预算内。
- **状态驱动画风**：`<style scoped>` 的 class 切换 + CSS 变量（`--x`/`--dur`）参数化——状态归 Vue、绘制归 CSS，不把关键帧写进 JS 拼字符串。
- **可达性**：`prefers-reduced-motion` 媒体查询降级（大幅动画关停）；过渡承载语义（反馈/引导）不当装饰堆砌。

## 红线

- 过渡属性写 `all`（波及布局属性的意外动画）。
- `<Transition>` 包多同级元素无 `mode`（行为未定义告警）。
- 动画触发 layout 属性（top/left/width）致掉帧。

## 深读指路（references/）

过渡机制与动画纪律全谱：`references/transitions-animation.md`。
