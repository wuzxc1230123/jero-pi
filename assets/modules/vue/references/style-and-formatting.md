# SFC 风格与结构（style-and-formatting）

> 来源：Vue 官方风格指南（优先级 D 特性归类）+ VueUse Skills 快照的结构惯例；权威级：规范+建议
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## SFC 三段序

```
<script setup lang="ts">   ← 逻辑（TS 主场）
<template>                 ← 结构（轻薄映射）
<style scoped>             ← 样式（作用域默认）
```

- `<script setup>` 是默认形态：编译宏（`defineProps` 等）免导入、
  顶层绑定直接进模板、类型推导最优。
- 选项式（`export default`）只在存量与特殊需求（命名导出复用/混入
  兼容层）出现——新代码不写。

## script setup 组织序

自上而下按"声明 → 派生 → 副作用 → 方法 → 生命周期"分组：

```vue
<script setup lang="ts">
// ① 编译宏与 props/emits 声明
const props = defineProps<{ id: number }>()
const emit = defineEmits<{ select: [id: number] }>()
// ② 状态（ref/reactive）
const query = ref('')
// ③ 派生（computed）
const filtered = computed(() => items.value.filter(i => i.name.includes(query.value)))
// ④ 侦听（watch/watchEffect）
watch(() => props.id, load, { immediate: true })
// ⑤ 方法（含暴露给模板的事件处理器）
function submit() { emit('select', props.id) }
// ⑥ 生命周期与清理
onMounted(fetchList)
onUnmounted(stopPolling)
</script>
```

分组间空行；组内按依赖序。评审者按此序扫读，越位即气味。

## 模板轻薄

- 表达式 ≤ 约 3 个运算符；方法调用链、格式化、多步条件提
  `computed` 或方法。
- 条件渲染用 `v-if`/`v-else-if`/`v-else` 链；超过三分支的枚举判定
  考虑映射表或组件化。
- `v-for` 必带 `key`，key 用稳定业务 id——可变列表用 index 作 key
  是状态错位之源（输入焦点/动画/复用错乱）。
- `v-if` 与 `v-for` 不同标签（Vue 3 中 `v-if` 优先于 `v-for` 求值，
  过滤需求提 `computed`）。

## 属性排序惯例

单标签属性序：指令（`v-for`/`v-if`/`v-model`）→ `ref` → 普通
props（按重要性）→ 事件（`@`）→ 插槽（`v-slot`）。超过约 7 个属性
多行排（每行一个）并考虑拆组件。

## 样式纪律

- `<style scoped>` 默认；穿透 `:deep()` 只用于样式化子组件根元素，
  不当通用后门。
- 全局样式集中 `styles/` 入口（变量/重置/主题）；CSS 变量走 token 面。
- 动态样式用 class 切换 + CSS，不用内联 `:style` 拼对象（除真正
  动态数值）。

## 红线

- 模板内副作用与复杂表达式；无 scoped 的全局样式污染。
- 被注释掉的模板块/死代码留存。
- 单 SFC 三职责以上（取数 + 交互 + 展示面团）——拆分信号。
