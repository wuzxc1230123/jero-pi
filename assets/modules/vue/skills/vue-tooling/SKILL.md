---
name: vue-tooling
description: Vite 工具链：配置分层（vite.config/环境变量）、插件谱系（@vitejs/plugin-vue/自动导入/组件自动注册）、依赖预构建与别名、代理与构建产物形状。当配置或评审 Vite 工程面时使用。触发词：Vite、vite.config、插件、alias、环境变量、代理、预构建、构建。
---

# Vite 工具链（Vue 3）

Vite 是开发体验与产物形状的控制器：配置即代码、env 即契约、插件即管线——工程面的漂移都藏在"随手改了句配置"里。

> **相关技能：** 类型检查门 → `vue-typescript`；测试配置 → `vue-testing`；Nuxt 内建管线 → `vue-nuxt`；构建性能 → `vue-performance`。

## 何时使用

配置/评审 vite.config、处理环境变量与代理、排查预构建与产物问题时使用。

## 核心要点

- **配置分层**：`vite.config.ts` 单一入口；`defineConfig` + 类型推导；按环境分支走 `mode` 参数与 `.env.{mode}` 文件，不写 `process.env.NODE_ENV` 判断散装逻辑。
- **环境变量契约**：只有 `VITE_` 前缀暴露客户端（`import.meta.env.VITE_API_URL`）；`env.d.ts` 里 `ImportMetaEnv` 接口类型化每个变量——散读无类型键是漂移源；secrets 永不进 `VITE_` 面（客户端可见即公开）。
- **插件谱系**：`@vitejs/plugin-vue` 是地基；`unplugin-auto-import`（API 自动导入）与 `unplugin-vue-components`（组件自动注册）按需启用且生成 `auto-imports.d.ts`/`components.d.ts` 提交进仓（类型面完整）；`unplugin-vue-router` 文件路由（Nuxt 之外的约定路由）。
- **别名与导入**：`resolve.alias` 钉 `@` → `src/`——相对路径深渊的解药；导入序与未用导入归 ESLint。
- **开发代理**：`server.proxy` 转发 API（`/api` → 后端），CORS 问题在开发态用代理解不放宽后端；changeOrigin 按后端虚拟主机语义。
- **预构建与产物**：依赖预构建自动（CJS→ESM）；排除预构建的依赖显式 `optimizeDeps.exclude`；产物分包 `build.rollupOptions.manualChunks` 按稳定域切（vendor/图表/编辑器）；`build.outDir` 产物目录进 gitignore。

## 红线

- secrets 进 `VITE_` 环境变量（打进客户端 bundle）。
- 自动导入的类型声明文件不提交（他处类型假红/IDE 漂移）。
- 手改 `dist/` 或把产物提交进仓。

## 深读指路（references/）

工具链配置与产物形状全谱：`references/vite-toolchain.md`。
