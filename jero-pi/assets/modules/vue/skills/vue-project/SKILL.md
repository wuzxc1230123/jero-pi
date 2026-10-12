---
name: vue-project
description: 项目结构：src 按域分层（components/composables/stores/router/api）、auto-import 声明文件提交、别名纪律、monorepo 面与 UI 库选型放置。当新建/重组 Vue 项目或评审目录布局时使用。触发词：项目结构、目录、src、布局、monorepo、别名、auto-import。
---

# 项目结构（Vue 3）

结构是依赖方向的物化：读者从目录就能读出架构——`components/` 万能桶与跨域乱 import 是结构腐化的两个起点。

> **相关技能：** 工具链配置（别名/自动导入） → `vue-tooling`；组件分层设计 → `vue-architect`；状态目录 → `vue-pinia`。

## 何时使用

新建/重组项目目录、评审 import 路径与归属、决定 monorepo 拆分时使用。

## 核心要点

- **src 按域分层**：`components/{域}/`（按业务域分组）、`composables/`（`useXxx` 复用逻辑）、`stores/`（Pinia 按域切 store）、`router/`（路由表与守卫）、`api/` 或 `services/`（请求层封装——fetch/axios 包装、类型化端点）、`types/`（共享类型）、`assets/` 与 `styles/`（资源与全局样式）。
- **api 层必有一层**：组件不直接散写 fetch/axios 调用——端点、类型、错误归一收进 `api/`（mock 与替换也只动这一层）。
- **auto-import 声明提交**：`auto-imports.d.ts`/`components.d.ts` 生成物**提交进仓**（类型面与评审可读性）；`.gitignore` 只忽略 `node_modules/dist`——生成物纪律与 runtime 区分（这两类 d.ts 是契约面）。
- **别名纪律**：`@/` 钉根，深层相对路径（`../../..`）是坏味道；跨域 import 只从域的公共出口（`index.ts`）进，不深挖内部文件。
- **UI 组件库选型**：`package.json` 钉版本；主题定制走库的 token 面（CSS 变量）不大面积覆写组件内部样式；按需导入（unplugin 或 tree-shaking）控制体积。
- **monorepo 面**：pnpm workspace 按包分域（`apps/*` + `packages/ui`/`shared`）——共享组件包显式导出面（package.json exports）；跨应用复用先抽包不复制文件。

## 红线

- `components/common/`/`utils/` 万能桶堆积（归属不清先问域）。
- 组件内散写 fetch 调用（绕过 api 层）。
- auto-import 声明文件被 gitignore（他处类型漂移）。

## 深读指路（references/）

布局决策树与 monorepo 面：`references/project-structure.md`。
