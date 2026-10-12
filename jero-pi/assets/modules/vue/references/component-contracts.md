# 组件契约（component-contracts）

> 来源：Vue 官方指南（组件基础/props/事件/插槽/组件 v-model 节）；权威级：规范
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 契约三通道

```
父 → 子：props（只读单向）
子 → 父：emits 事件（报告发生了什么）
父定制子结构：插槽（默认/具名/作用域）
双向糖：v-model（props + 事件的宏封装）
```

## props

```ts
const props = defineProps<{
  title: string
  count?: number
  items: Order[]
}>()
// 默认值（3.5+ 解构默认值）：
const { count = 10, title } = defineProps<{ title: string; count?: number }>()
```

- 纯类型声明优先（编译器生成运行时校验）；必填项不给默认。
- **props 只读**：改 props（含深层属性变异）破坏单向流——本地可变
  派生用 `computed(() => props.x)` 或 `ref` 拷贝 + watch 同步。
- prop 命名 camelCase 声明、kebab-case 传入；布尔 prop 单名直传
  （`<Btn disabled />`）。

## emits

```ts
const emit = defineEmits<{
  select: [id: number]
  'update:title': [value: string]
}>()
emit('select', 42)
```

- 具名元组语法类型化载荷；未声明的 emits 走 attrs 透传（DOM 落
  原生事件）——显式声明是契约文档。
- 事件语义"报告"不"命令"：`item-removed` 而非 `refresh-list`。
- `v-model` 的更新事件 `update:x` 由 `defineModel` 代管，手写对
  只在无宏环境。

## defineModel（3.4+）

```ts
const title = defineModel<string>('title', { default: '' })
title.value = 'x'   // 自动 emit('update:title') + 本地立即可用
```

- 取代 `modelValue` prop + `update:modelValue` 手写样板；多 v-model
  各命名（`v-model:title`/`v-model:page`）。
- 修饰符链：`const [model, mods] = defineModel` 取修饰符（自定义
  修饰符传递给子）。
- 双绑仍守单向心法：`defineModel` 是"父保留所有权"的双向语法——
  子不把它当"自己的状态"深层变异。

## 插槽

- 默认插槽管主体内容；`<slot name="header" />` 具名分区。
- 作用域插槽回传数据：`<slot :item="row" :index="i" />` → 父
  `<template #default="{ item, index }">`——列表项渲染权交父定制。
- 插槽内容编译在**父作用域**——插槽里访问的是父的数据/方法，不
  是子的（经典误解）。
- 动态插槽名 `<template #[name]>` 按需；渲染函数域
  `useSlots()`。

## 透传（attrs）

- 未声明为 props/emits 的属性落 `$attrs`，自动挂根元素（单根）；
  `class`/`style` 合并。
- 多根组件不自动透传——显式 `v-bind="$attrs"` 指定落点。
- 包装组件（封装原生元素）显式承接：`inheritAttrs: false` +
  `v-bind="$attrs"` 转发到内部输入框。

## 组合边界

- 展示组件（props 进事件出，无外部依赖）与容器组件（接 store/
  路由）分层（vue-architect 判定面）。
- 组件间直接 import 实例互相操作是反模式——状态上移或事件总线
  场景改 store。
- `defineExpose` 收窄公共面：暴露的方法/属性是显式契约（模板 ref
  从父调用）。

## 红线

- 子改 props（任何深度）；未声明 emits 散触发。
- 插槽内期待子的作用域；多根无显式 `$attrs` 落点。
- `defineExpose` 全量裸奔（等于没有封装边界）。
