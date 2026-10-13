# 依赖注入（provide-inject）

> 来源：Vue 官方指南（provide/inject 节）+ VueUse `createInjectionState` 惯例；权威级：规范+建议
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 定位

props 逐层透传（prop drilling）与全局状态的中间档：

| 通道 | 适用 |
|---|---|
| props/emits | 父子直连（默认） |
| provide/inject | 祖先→深层后代 的上下文（主题/配置/域服务） |
| Pinia store | 跨树全局域状态 |

注入管"上下文"，store 管"域状态"——错位使用产生隐式全局。

## 基本形态

```ts
// 键：类型化 Symbol（独立模块导出，两侧共享）
export const ThemeKey: InjectionKey<Ref<Theme>> = Symbol('theme')

// 祖先
provide(ThemeKey, ref('dark'))
// 后代（任意深度）
const theme = inject(ThemeKey, ref('light'))   // 带默认值
```

- provide 值保持**响应式本体**（ref/computed），不拍 `.value` 快照。
- 后代读注入只读消费；要改走祖先暴露的方法（单向流注入域同样成立）。
- `readonly(state)` 包只读面（深层只读代理），写操作警告。

## 类型化键

- `InjectionKey<T>` 是带类型的 Symbol——provide/inject 两侧类型
  必须同源（key 模块单一导出）。
- 字符串 key 无类型联动（两侧手写类型漂移无编译器兜底）——存量
  代码可存量，新代码 Symbol。

## 缺席守卫

- `inject(key, default)` 默认值兜底；服务类注入（可为 null）显式
  `inject(key, null)` + 判空使用——`!` 非空断言要注释豁免
  （typescript-integration 同款纪律）。
- "必须存在于祖先"的强契约用工厂：`const ctx =
  useRequiredContext()`（内部 inject 无值即 throw 带指引信息）。

## 注入式 composable（VueUse 惯例）

```ts
// 提供侧（App 根调用一次）
const [useProvideUser, useUser] = createInjectionState(useUserService)
// 后代任意层
const user = useUser()   // 未提供时 undefined——守卫后用
```

- `createInjectionState(composable)` 把"提供 + 类型化取用 + 缺席
  undefined"封装成对——服务型上下文的标准件（vueuse-utilities）。
- 应用级单例服务（消息/确认框/分析上报）走此形：根 provide、树内
  inject、测试替身换根。

## 测试面

- 挂载时 `global.provide: { [ThemeKey as symbol]: ref('dark') }`
  注入替身。
- 注入式 composable 的测试从提供侧工厂进入（整链可用性一起验）。

## 红线

- 字符串 key 散装无类型；provide 拍快照断响应。
- 后代直改注入可变对象（破坏单向流）。
- 深层注入业务数据绕过 store（上下文/域状态错位双源）。
