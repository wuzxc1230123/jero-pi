# 命名（naming-conventions）

> 来源：Vue 官方风格指南（组件/props/事件命名节）；权威级：规范
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 决策树

```
命名什么？
├─ 组件 → 多词 PascalCase（TodoList.vue；文件名 = 组件名）
├─ 组合式函数 → useXxx（useCart、useMousePosition）
├─ 纯工具函数 → 动词短语，不带 use 前缀（formatPrice）
├─ props/emit 载荷字段 → camelCase（searchQuery）
├─ 模板传入的 prop/事件 → kebab-case（search-query、@update-title）
├─ 事件名 → 动词/动词过去式（select、change、submitted）
├─ store（Pinia）→ useXxxStore；action 动词开头；getter 名词
├─ 常量 → SCREAMING_SNAKE 且收在模块内（不进全局）
├─ 类型/接口 → PascalCase；Props 后缀（OrderCardProps）
└─ CSS class → kebab-case 或 BEM；scoped 内可短
```

## 组件细则

- **多词是硬规则**：`Menu`/`Item`/`Header` 与原生及未来 HTML 元素
  撞名（Web Components 演进持续新增标签）。
- 基础组件（无业务语义的封装）加前缀域：`BaseButton`/`AppModal`/
  `TheHeader`（单例布局）——前缀表角色，团队二选一钉死。
- 单文件组件组件名 = 文件名；目录按域 `components/orders/`，
  禁 `common/`/`misc/` 万能桶。

## composable 细则

- `useXxx` 只给"返回响应式/绑定生命周期"的函数——不返回响应式的
  纯函数带 use 是误导（调用方以为要解构 ref）。
- 名字描述返回的能力不描述内部实现：`useDraftAutosave` 优于
  `useIntervalAndWatch`。
- ref 变量名去冗余：`useTitle()` 返回 `title` 不返回 `titleRef`
  （`.value` 已表明形态）。

## 事件与 v-model

- 事件名表"发生了什么"（`submitted`/`item-removed`），不表"去做
  什么"（`submit-it`）——父决定响应。
- `defineModel` 的参数名即 v-model 面名：`defineModel('title')` 对
  应 `v-model:title`；双绑语义成对命名。
- 输入组件值更新事件统一 `update:x` 形态（编译宏代管）。

## store 与模块

- Pinia：`useCartStore`；state 字段名词（`items`/`filter`）、
  action 动词（`addItem`/`fetchOrders`）、getter 派生名词
  （`totalPrice`/`activeItems`）。
- 路由命名：路由 `name` PascalCase 页面名（`OrderDetail`）；路径
  kebab-case 动态段（`/orders/:orderId`）。
- 环境变量 `VITE_` 后 PascalCase（`VITE_API_BASE_URL`）。

## 红线

- 单词组件名；`use` 前缀的纯函数。
- 同一概念两种拼法并存（`orderList` 与 `orders-list`）。
- 缩写不统一（`btn` 与 `button` 混用——钉一种）。
