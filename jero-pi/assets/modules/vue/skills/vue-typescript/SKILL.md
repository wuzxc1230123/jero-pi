---
name: vue-typescript
description: Vue + TypeScript：defineProps 泛型与类型化 emits、模板类型检查（vue-tsc）、ref 类型推导与显式标注、组件类型提取（InstanceType）、宽松 any 的豁免纪律。当写类型化 SFC 或评审 TS 用法时使用。触发词：TypeScript、vue-tsc、defineProps 类型、类型检查、InstanceType。
---

# TypeScript 集成（Vue 3）

类型在 SFC 三段里各有形态：script 是 TS 主场，模板经 `vue-tsc` 检查——"IDE 不报错"不等于"类型通过"，独立类型门是纪律。

> **相关技能：** 响应式类型（ref 推导） → `vue-reactivity`；验证协议（vue-tsc 门） → `vue-tester`；工具链配置 → `vue-tooling`。

## 何时使用

编写类型化组件/composable、配置类型检查工作流、评审 TS 严格度时使用。

## 核心要点

- **defineProps 纯类型**：`defineProps<{ id: number; title?: string }>()` 替代运行时对象声明（编译器生成校验）；默认值 `withDefaults` 或 3.5+ 解构默认值；导入的接口类型可直接用（编译宏处理）。
- **emits 类型化签名**：`defineEmits<{ select: [id: number]; change: [value: string] }>()`（具名元组语法）——载荷类型错在编译期暴露。
- **ref 标注**：默认推导（`ref(0)` → `Ref<number>`）；初值无法定形时显式 `ref<Item[] | null>(null)`；`shallowRef<T>` 大数据集；避免 `ref<any>`。
- **vue-tsc 独立门**：模板表达式类型检查靠 `vue-tsc --noEmit`（Volar 语言服务配套）——进 `typecheck` 脚本与 CI，别依赖编辑器即时反馈当结论（`vue-tester` 门 1）。
- **组件类型提取**：第三方组件实例 `InstanceType<typeof Comp>`；模板 ref 3.5+ 用 `useTemplateRef('el')` 自动推导；暴露面 `defineExpose` 收窄公共类型。
- **any 豁免纪律**：三方库缺类型处 `as unknown as X` 收口并注释；`@ts-ignore` 只允许带原因注释——同后端纪律，宽松点集中管理不散装。

## 红线

- 只跑构建不跑 `vue-tsc`（esbuild/vite 构建不查类型——假绿）。
- props 用运行时对象声明放弃类型面（新代码）。
- 模板内隐式 any 链（`item.xxx` 无类型的数据流）。

## 深读指路（references/）

TS 集成与类型工作流全谱：`references/typescript-integration.md`。
