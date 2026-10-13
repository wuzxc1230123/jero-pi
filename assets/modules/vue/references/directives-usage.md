# 指令（directives-usage）

> 来源：Vue 官方模板语法参考（指令全集/自定义指令节）；权威级：规范
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 内置指令速查

| 指令 | 语义 | 要点 |
|---|---|---|
| `v-bind`（`:`） | 单向绑定 | `.prop` 强制属性；class/style 特殊合并 |
| `v-on`（`@`） | 事件 | 修饰符 `.stop/.prevent/.self/.once/.passive/.capture`；按键 `.enter/.esc`、组合 `.ctrl.enter` |
| `v-if/v-else-if/v-else` | 条件渲染（真销毁） | 惰性；同标签与 `v-for` 冲突（求值序） |
| `v-show` | display 切换 | 频繁切换省销毁成本 |
| `v-for` | 列表 | **必带 key**（稳定业务 id）；`v-memo` 配合跳过 diff |
| `v-model` | 双绑糖 | 修饰符 `.lazy/.number/.trim`；组件面 `defineModel` |
| `v-html` | 原始 HTML | **安全红线**：仅可信/sanitize 后（security-practices） |
| `v-text`/`v-pre`/`v-once`/`v-cloak` | 边角 | `v-once` 静态钉住；`v-cloak` 首屏闪动 |

## 修饰符语义

- 修饰符让模板**自述意图**（`.prevent` 一眼见阻止默认行为），
  代替处理器内手写 `e.preventDefault()` 散装。
- 自定义指令接收修饰符（`binding.modifiers`）——语义化参数面。

## 自定义指令：窄面

**只有必须直操作底层 DOM 的场景才写指令**：

- 聚焦管理（`v-focus` 挂载即聚焦）
- 权限元素移除（`v-can` 无权时 el.remove()）
- 点击外部/进入视口绑定（与 VueUse 组合时多半不必自写）
- 第三方 DOM 库桥接（tooltip/popover 挂载初始化）

**不该进指令的**：业务逻辑、状态管理、组件通信、可组合的响应式
逻辑——那是 composable（`vue-composables`）与组件
（`vue-components`）的职责。指令里藏逻辑是黑洞（不可测、不可组
合、无类型推导）。

## 形态与钩子

```ts
// <script setup> 内命名 vXxx 自动注册
const vFocus: Directive<HTMLInputElement, boolean | void> = {
  mounted(el, { value }) { if (value !== false) el.focus() },
}
```

- 钩子：`created/beforeMount/mounted/beforeUpdate/updated/
  beforeUnmount/unmounted`——多数只写 `mounted` + `updated` 或直接
  用函数简写（mounted/updated 同逻辑）。
- `binding`：`value`（传值）、`oldValue`、`arg`（`v-x:arg`）、
  `modifiers`（`v-x.a.b`）、`instance`（宿主组件）。
- 全局注册走 `app.directive()`（插件库形态）；对象字面量传参
  `v-x="{ delay: 300 }"`（`value` 收对象）。

## 等价替代优先序

1. 组件（结构 + 行为封装）——默认。
2. composable（逻辑复用）——无 DOM 结构诉求。
3. 指令——仅余的 DOM 直操作残部。

例：`v-loading` 指令 vs `<Spinner>` 组件——组件可插任何结构、可
过渡、可测试；指令只在"给既有元素加遮罩"这类不便换结构的场景。

## 红线

- 指令内做状态管理/组件通信；`v-for` 无 key、`v-if`+`v-for` 同
  标签。
- 不可信内容进 `v-html` 无 sanitize。
- 通用逻辑硬写成指令绕过类型与测试面。
