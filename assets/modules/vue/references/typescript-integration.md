# TypeScript 集成（typescript-integration）

> 来源：Vue 官方 TS 指南（组合式 API 类型/tooling 节）+ Volar 文档；权威级：规范
> 锚定版本：Vue 3.5/3.6 + TS 5.x ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 编译宏类型面

```ts
const props = defineProps<{ id: number; title?: string; items: Order[] }>()
const emit = defineEmits<{ select: [id: number]; 'update:title': [v: string] }>()
const model = defineModel<string>('title')
const slot = useSlots()
const exposed = defineExpose<{ focus: () => void }>()
```

- 纯类型声明（编译器生成运行时校验）；导入接口直接引用（跨文件
  类型进 `types/`）。
- 默认值：`withDefaults(defineProps<T>(), { … })` 或 3.5+ 解构默认
  值（`const { title = 'x' } = defineProps<{ title?: string }>()`）。
- emits 具名元组语法：`{ select: [id: number] }`——载荷形状编译期
  钉死。

## ref 与派生类型

- 推导优先：`ref(0)` → `Ref<number>`；`computed(() => items.value.length)`。
- 显式标注场景：初值无法定形 `ref<Order | null>(null)`、空集合
  `ref<Order[]>([])`（避免 `never[]`）、浅层 `shallowRef<BigData>()`。
- 模板引用：`useTemplateRef<HTMLInputElement>('input')`（3.5+，
  名字字符串自动关联）；旧形态 `const el = ref<HTMLInputElement |
  null>(null)` + 同名 `ref="el"`。
- 组件实例类型：`InstanceType<typeof MyComp>`；第三方无类型组件
  声明模块扩展（`.d.ts` 里 `declare module`）。

## vue-tsc 独立门

- Vite 构建用 esbuild **不做类型检查**——"build 过了"不是"类型过
  了"；模板内表达式的类型只有 `vue-tsc --noEmit` 查（Volar 的命令
  行形态）。
- 工作流：`"typecheck": "vue-tsc --noEmit"` 脚本 + CI 独立步骤
  （verification-gates 门 1）；编辑器即时反馈是体验不是结论。

## 工程配置

- `tsconfig.app.json` 面向浏览器 + `tsconfig.node.json` 面向构建
  脚本（项目引用分治）；`"types": ["vite/client"]` 引入
  `import.meta.env` 面与资源模块声明。
- `env.d.ts`：

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_FEATURE_FLAG_X: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
```

  每个 `VITE_` 变量类型化——散读无类型键是漂移源
  （vite-toolchain 契约面）。

- 严格度：`strict: true` 全开；模板类型检查跟随（vue-tsc 用同一
  配置）。

## any 与豁免纪律

- 三方缺类型：局部 `declare module 'lib-x'` 收口；`as unknown as T`
  单点转换 + 注释说明。
- `@ts-ignore`/`@ts-expect-error` 只允许带原因注释；SFC 内散装
  压制是债。
- API 层类型从后端 schema 生成（openapi-typescript 谱系）优于手写
  镜像（漂移自动显形）。

## 红线

- 只跑 vite build 当类型验证（假绿）。
- `ref<any>`/props 运行时对象声明（放弃类型面的新代码）。
- env 变量不进 `ImportMetaEnv` 散读字符串键。
