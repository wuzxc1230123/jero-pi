---
name: vue-performance
description: 性能优化：先测量（DevTools/性能面板）、虚拟列表与分页、路由级懒加载与 chunk 策略、keep-alive 封顶、v-memo 与浅层响应、v-if/v-show 取舍。当优化渲染性能或评审列表/懒加载方案时使用。触发词：性能、优化、卡顿、虚拟列表、懒加载、keep-alive、chunk、首屏。
---

# 性能优化（Vue 3）

先测量后优化：DevTools 组件面板看重渲染热点、性能面板看长任务——确认瓶颈再动手，微优化在错误的层面是白费。

> **相关技能：** 响应式开销形状 → `vue-reactivity`；工具链分包 → `vue-tooling`；虚拟列表现成件 → `vue-vueuse`；验证三道门 → `vue-testing`。

## 何时使用

优化首屏/交互卡顿/长列表渲染，评审懒加载与缓存方案时使用。

## 核心要点

- **测量序**：Vue DevTools 组件重渲染高亮 → 性能面板长任务 → 网络瀑布——三个面板各管一类瓶颈（渲染/脚本/加载），先定位域再改代码。
- **长列表**：千行级列表虚拟化（`useVirtualList`（VueUse）/组件库虚拟滚动）或分页/无限滚动（`useInfiniteScroll`）；`v-for` 全量渲染万行是 BLOCKER 级反模式。
- **代码分割**：路由级 `() => import()`（`vue-router`）；重组件（图表/编辑器）按需异步（`defineAsyncComponent`）；`manualChunks` 按稳定域切 vendor——首屏 JS 体积是硬指标。
- **渲染控制**：`v-if`（真移除）与 `v-show`（display 切换）按切换频率选；`v-memo` 带依赖数组钉住大列表行（依赖不变跳过整行 vnode diff）；静态内容提 `v-once`。
- **keep-alive 封顶**：`<KeepAlive :max="n">` 缓存实例上限——无封顶缓存路由组件 = 内存缓慢增长；include/exclude 显式列出缓存面。
- **响应式开销**：大数据集 `shallowRef` + 整体替换；深层 watch 收窄到具体属性路径；computed 保持纯派生才可缓存。
- **加载体验**：骨架屏（CLS 友好）优于空白等待；图片懒加载（`loading="lazy"`/`useIntersectionObserver`）；字体与关键 CSS 内联按 LCP 面取舍。

## 红线

- 无测量证据的重写（"感觉慢"不是定位）。
- 万行列表全量 `v-for`；keep-alive 无上限缓存。
- 把性能优化写成不可读的技巧堆砌（可维护性也是指标）。

## 深读指路（references/）

优化谱系与测量工作流：`references/performance-optimization.md`。
