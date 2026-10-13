# 表单与校验（forms-validation）

> 来源：Vue 官方表单输入绑定指南 + VeeValidate/Nuxt 表单惯例；权威级：建议
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## v-model 基础面

```vue
<input v-model.trim="name" />
<input v-model.number="age" />
<select v-model="status"> …
<CustomInput v-model:title="draft.title" />
```

- 修饰符：`.lazy`（change 才同步）、`.number`（数值归一——空输入
  变空串而非 0，边界留意）、`.trim`（去空白）——按语义选不是全加。
- 复选框数组/单选/多选的绑定形态按控件类型走；组件双绑用
  `defineModel`（component-contracts）。

## 表单状态组织

- 表单草稿是组件本地态（`reactive` 成组对象或 `ref` 包模型）——
  **不实时灌 store**（中间态入库是双源红线，pinia-state 同源）；
  提交成功后再入全局。
- 回填：编辑表单从 props/数据源拷贝初值（`structuredClone` 或字段
  拷贝），不做引用直连（改草稿污染源数据）。
- 脏检查：`JSON.stringify` 对比初值或字段级 touch 集——离开拦截
  （`onBeforeRouteLeave`）与重置按钮的依据。

## 校验分层

| 层 | 职责 | 手段 |
|---|---|---|
| 客户端 | 即时反馈/必填提示/格式预判 | VeeValidate/自写规则 |
| 服务端 | **权威校验**（一切重验） | 端点 schema 校验（zod 谱系） |

- 服务端返回错误结构映射回字段：`{ errors: { email: ['已占用'] } }`
  → 表单字段错误位渲染——两侧错误形态对齐设计。
- 校验时机：失焦（首错提示）/变更（已错字段即时修正）/提交（整体
  级）三档按字段语义选；提交后整体校验显示全部。

## 异步校验与竞态

- 用户名查重类：`watchDebounced`（300ms）+ AbortController 取消
  在途——慢响应覆盖快响应是经典错判。
- 异步校验状态进字段级 loading；失败（网络错）与"不通过"分开呈
  现。

## 动态表单

- schema 驱动：字段配置数组（类型/标签/规则/联动）渲染——手写
  条件模板在字段 >10 时失控。
- 嵌套字段名与提交结构对齐（`v-model="form.address.city"` 直映
  API 形态）；平铺 ↔ 嵌套转换收一处工具函数。
- 字段联动（省→市）：watch 源字段重置下游；key 变更强制重挂控制
  件残留态。

## 提交纪律

- 提交中禁用 + loading（防双击双单）；成功/失败态可清理可重试。
- 提交走 api 层（project-structure）；错误归一（网络错/校验错/
  冲突码）进表单呈现面。
- 离开未保存：`onBeforeRouteLeave` + `beforeunload`（原生确认）
  双面。

## 可达性

- label 与控件关联（`for`/`id` 或包裹）；错误 `aria-describedby`
  关联；提交后焦点进首个错误字段——表单可达性是正确性的一部分。

## 红线

- 只信客户端校验（直打 API 即穿）。
- 提交无防重复；异步校验无取消。
- 表单草稿实时入 store；错误形态客户端/服务端两套不映射。
