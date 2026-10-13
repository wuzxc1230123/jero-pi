# Vite 工具链（vite-toolchain）

> 来源：Vite 官方文档（配置/env/服务端代理/构建节，Vite 7 形态）+ Vue 官方构建指南；权威级：规范+建议
> 锚定版本：Vite 7（Vue 3.5/3.6 配套） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 配置分层

```ts
// vite.config.ts
export default defineConfig(({ mode }) => ({
  plugins: [vue(), AutoImport({ dts: 'src/auto-imports.d.ts' }),
            Components({ dts: 'src/components.d.ts' })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } } },
  build: { rollupOptions: { output: { manualChunks: {
    vendor: ['vue', 'vue-router', 'pinia'], charts: ['echarts'] } } } },
}))
```

- 单入口 `defineConfig`；按 `mode`（dev/build/preview）分支；
  环境差异走 `.env.{mode}` 文件不写散装 `process.env` 判断。
- 插件是管线：`@vitejs/plugin-vue` 地基；`unplugin-auto-import` +
  `unplugin-vue-components` 按需（**生成的 d.ts 提交进仓**——类型
  完整与评审可读）；`unplugin-vue-router` 文件路由（Nuxt 外的约定
  路由形态）。

## 环境变量契约

- 只有 `VITE_` 前缀暴露客户端：`import.meta.env.VITE_API_BASE_URL`；
  `loadEnv(mode, root)` 在配置内读（不混客户端面）。
- **secrets 永不进 `VITE_`**（打进 bundle 即公开——security-
  practices）；服务端/构建期密钥走 `.env.local`（gitignore）与
  CI secret。
- `.env` 分层提交：`.env`（公开默认）✓、`.env.production` ✓、
  `.env.local` ✗；`ImportMetaEnv` 接口逐变量类型化
  （typescript-integration）。

## 开发服务器

- 代理 `server.proxy`：开发态 API 转发（CORS 在代理解，不放宽后端
  CORS 策略）；WebSocket 代理 `ws: true`。
- 端口/自动打开/HTTPS 按需；`server.watch` 忽略面调优（大仓 HMR
  稳定性）。
- 预构建：CJS 依赖自动 ESM 化（`optimizeDeps`）；发现新依赖时
  re-optimize 的重启是正常行为——频繁出现则显式 `include` 预热。

## 构建产物

- `build.outDir`（默认 `dist`）进 gitignore；`emptyOutDir` 语义
  确认。
- 分包策略：`manualChunks` 按**稳定域**切（vendor/图表/编辑器）——
  按路由切与路由懒加载冲突；chunk 环形依赖告警要解不是压。
- 体积预算：`build.chunkSizeWarningLimit` 设阈值不是关警告；产物
  分析（rollup-plugin-visualizer）进排查流程（performance-
  optimization）。
- `target` 与 browserslist 面对齐；legacy 插件按需（@vitejs/plugin-
  legacy 双构建成本）。

## 库模式与其他

- 组件库/工具库发布走 `build.lib`（external peer deps + 多格式产
  物）；vue 外部化（`external: ['vue']`）防双实例。
- Worker（`new Worker(new URL('./w.ts', import.meta.url), { type:
  'module' })`）、Wasm、静态资源 `new URL('./x.png', import.meta.
  url).href` 惯例。
- Vitest 复用 `vite.config`（`test` 字段或独立 vitest.config——
  测试专属插件隔离时独立）。

## 排障速查

- 依赖寻址怪异（CJS/双实例）→ `optimizeDeps.include` + 检查双
  vue 实例（`import.meta.env` 下不同 vue）。
- HMR 失效/整页刷新 → 组件副作用链（模块级可变态）+ watch 忽略面。
- 代理 404 → `changeOrigin` 与后端虚拟主机；路径重写 `rewrite`。

## 红线

- secrets 进 `VITE_` 变量；auto-import 生成 d.ts 不提交。
- 手改 `dist/`；产物进仓。
- `manualChunks` 把高频变动业务代码并进 vendor（缓存全失效）。
