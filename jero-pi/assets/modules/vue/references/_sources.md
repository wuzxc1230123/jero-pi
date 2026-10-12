# 出处与授权账本（_sources）

> 本篇是 vue 模块的知识来源账本：逐篇登记派生源与授权。权威级分四级：
> **规范**（官方指南/语言规范级）· **建议**（工程最佳实践）·
> **历史语境**（旧版本背景）· **项目纪律**（本仓裁决）。

## 上游仓库

| 仓库 | 许可 | 用途 |
|---|---|---|
| github.com/serkodev/vueuse-skills（快照于本仓 `vue-skills-main/`，即 VueUse Skills） | MIT（© 2026 SerKo） | VueUse 面的主要来源：AUTO/EXTERNAL/EXPLICIT_ONLY 三档调用策略方法论、需求域→函数映射结构、高频函数模式（storage/事件/防抖节流 watch 族/虚拟列表）的蒸馏底稿 |
| Vue/Nuxt/Pinia/Vite 官方文档（vuejs.org·nuxt.com·pinia.vuejs.org·vite.dev，含版本迁移指南与官方风格指南） | 按各自文档许可（CC 类开放） | 语言/框架/工具链面的方法与事实核对（2026-10 核验） |
| skills-main 快照（github.com/dotnet/skills，.NET 团队技能库） | MIT | **经全库检索确证无 Vue 相关内容**（登记为查证事实：本模块未从其取材） |

本模块知识锚定 **Vue 3.5/3.6 + Nuxt 4 + Vite 7 + Pinia 3**（2026-10
谱系）。vueuse-skills 快照的价值在调用策略与函数谱系组织法——
本模块的 VueUse 两篇（vueuse-utilities/vueuse-patterns）按其分域
结构中文重蒸馏；其余语言/框架面为官方文档锚定的重蒸馏，非逐句
翻译。上游英文文案不是本模块内容——全部中文重写；MIT 允许派生，
登记出处即履行署名义务。

## 逐篇登记

| reference | 主要来源 | 权威级 |
|---|---|---|
| style-and-formatting | Vue 官方风格指南 + vueuse-skills 结构惯例 | 规范+建议 |
| naming-conventions | Vue 官方风格指南（组件/props/事件节） | 规范 |
| composition-api | Vue 官方指南（组合式/侦听器节） | 规范 |
| reactivity-deep | Vue 官方深入响应式系统 + FAQ | 规范 |
| component-contracts | Vue 官方指南（props/事件/插槽/v-model 节） | 规范 |
| provide-inject | Vue 官方指南 + VueUse `createInjectionState` 惯例 | 规范+建议 |
| composables-authoring | Vue 官方组合式函数 FAQ + VueUse 源码惯例派生 | 规范+建议 |
| vueuse-utilities | vueuse-skills 快照（调用策略三档 + 分域映射）+ @vueuse/core 文档 | 建议 |
| vueuse-patterns | vueuse-skills 快照函数参考谱系蒸馏（storage/事件/watch 族/滚动列表） | 建议 |
| pinia-state | Pinia 官方文档（组合式 store/SSR/测试节） | 规范 |
| routing-patterns | Vue Router 4 官方文档 | 规范 |
| typescript-integration | Vue 官方 TS 指南 + Volar/vue-tsc 文档 | 规范 |
| vite-toolchain | Vite 7 官方文档（配置/env/代理/构建节） | 规范+建议 |
| testing-practices | Vitest + Vue Test Utils 官方文档 | 建议 |
| nuxt-framework | Nuxt 4 官方文档（目录/数据获取/server 节） | 规范+建议 |
| performance-optimization | Vue 官方性能指南 + web.dev 指标方法 | 建议 |
| ssr-hydration | Vue 官方 SSR 指南 + Nuxt 水合文档 | 规范+建议 |
| forms-validation | Vue 官方表单绑定指南 + VeeValidate 惯例 | 建议 |
| transitions-animation | Vue 官方过渡指南 + Web 动画性能惯例 | 规范+建议 |
| directives-usage | Vue 官方模板语法参考（指令全集） | 规范 |
| project-structure | Vue 官方规模化指南 + create-vue 模板惯例 | 建议 |
| security-practices | Vue 官方安全指南 + OWASP 前端速查 | 规范+建议 |
| upgrade-migrations | Vue/Nuxt/Vite/Pinia 官方迁移指南 | 建议 |
| verification-gates | 本仓原创（对齐 golang/godot/dotnet 模块协议） | 项目纪律 |
| _sources | 本篇 | 项目纪律 |

## 引用上游时的红线

- 快照（vueuse-skills）的知识锚定 VueUse 当前谱系；本模块按
  Vue 3.5/3.6 配套核对（3.5 的响应式 props 解构/useTemplateRef、
  3.6 的 Vapor 语义以官方迁移指南为准——upgrade-migrations 的
  版本谱系表是勘误清单）。
- 上游 `vueuse/` 目录为未拉取的 vendored 源码（构建期
  `prepare:vueuse` 拉取）；本模块只蒸馏其已生成的
  `skills/vueuse-functions/references/`（230 篇逐函数参考），不
  依赖上游构建。
- VueUse 函数的调用档（AUTO/EXTERNAL/EXPLICIT_ONLY）沿用上游语义
  但缺省可被用户指令覆盖——策略是建议不是法律。
- 本账本随内容演进同步更新：新增 reference 必登记，来源变更必记
  版本与日期。
