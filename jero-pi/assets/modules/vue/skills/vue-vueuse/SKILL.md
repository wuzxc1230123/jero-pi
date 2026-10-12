---
name: vue-vueuse
description: VueUse 工具库选型：按需求域映射函数（状态/元素/浏览器/传感器/watch 族）、三档调用策略（AUTO/EXTERNAL/EXPLICIT_ONLY）、按需加载与覆盖规则。当想"手写一个常见能力"或评审自造轮子时使用。触发词：VueUse、useLocalStorage、useEventListener、useMouse、watchDebounced、工具库。
---

# VueUse 选型（Vue 3）

手写常见能力之前先查 VueUse：230+ 组合式工具覆盖状态/元素/传感器/watch 族——库内有的不重造，重造的只有业务语义本身。

> **相关技能：** 自写纪律（库内没有时） → `vue-composables`；高频模式精读 → 本技能两篇 references；SSR 兼容 → `vue-ssr`。

## 何时使用

实现浏览器/传感器/存储/防抖节流/watch 变体等常见能力前选型；评审"手写轮子"是否该换库时使用。

## 核心要点

- **调用策略三档**（沿用上游语义）：`AUTO`——匹配需求即用（`useLocalStorage`/`useEventListener`/`useClipboard`）；`EXTERNAL`——依赖三方包（RxJS/fuse.js 谱系），项目已装才用，未装先问；`EXPLICIT_ONLY`——用户点名才上（低频重器）。用户指令与 `AGENTS.md` 可覆盖默认档。
- **需求域速查**：状态与存储 → `useStorage` 族/`useAsyncState`/`createGlobalState`；元素与交互 → `useEventListener`/`useDraggable`/`useElementSize`/`useIntersectionObserver`；传感器与环境 → `useMouse`/`useMediaQuery`/`useDark`/`useOnline`；watch 变体 → `watchDebounced`/`watchThrottled`/`watchOnce`/`whenever`；工具算子 → `refDebounced`/`syncRef`/`until`。
- **按需引入**：`import { useLocalStorage } from '@vueuse/core'`——tree-shaking 生效；不整库副作用导入。
- **SSR 兼容性**：核心函数 SSR 安全（服务端不触窗口 API）；浏览器态函数在 Nuxt 里配 `@vueuse/nuxt` 模块或客户端守卫。
- **替代判定**：三行以内且无边界情况（防抖一个输入）手写可；含清理/SSR/边界（事件监听卸载、storage 序列化）用库——库的价值在边角不在主路径。

## 红线

- 重造库内已有且带清理语义的能力（手写 `addEventListener` 忘 `removeEventListener`）。
- 未装三方依赖直接用 `EXTERNAL` 档函数（构建期炸）。
- 整库导入破坏按需加载。

## 深读指路（references/）

全谱与调用策略：`references/vueuse-utilities.md`；高频模式（storage/事件/防抖节流 watch/虚拟列表）：`references/vueuse-patterns.md`。
