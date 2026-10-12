# 性能优化（performance-optimization）

> 来源：Vue 官方性能指南（虚拟列表/依赖浅层/开销面）+ web.dev 核心指标方法；权威级：建议
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 方法论序

测量（三面板定位域）→ 单变量优化 → 复测对照 → 端到端确认
（核心指标）。跳步的优化是占卜。

| 面板 | 管 | 典型发现 |
|---|---|---|
| Vue DevTools 组件 | 重渲染 | 高亮组件 + "为什么重渲染"依赖列表 |
| Performance | 脚本/渲染长任务 | 长任务（long task）、GC 压力、布局抖动 |
| Network | 加载 | 瀑布、bundle 体积、缓存失效 |

## 渲染面

- **列表**：千行级虚拟化（`useVirtualList`/组件库虚拟滚动）或分页
  /无限滚动；万行全量 `v-for` 是 BLOCKER 级。
- **渲染控制**：`v-if` 真移除 vs `v-show` display（切换频繁用
  show）；`v-memo="[item.id, item.selected]"` 钉住大列表行（依赖
  不变跳过 diff）；静态子树 `v-once`。
- **组件粒度**：重渲染以组件为界——把高频变化的部分隔离成小组件
  （输入框独立），避免整页跟着重渲染；computed 保持纯派生才享缓存。
- **响应式开销**：大数据集 `shallowRef` + 整体替换；深层 watch
  收窄到属性路径（reactivity-deep 性能节）。

## 加载面

- **代码分割**：路由级 `() => import()`；重组件交互触发二次加载
  （`defineAsyncComponent` + loading/error 骨架）；`manualChunks`
  按稳定域切 vendor（vite-toolchain）。
- **首屏指标**：LCP（关键资源——首图预载/关键 CSS 内联/字体
  swap）、CLS（骨架屏占位尺寸稳定）、INP（交互响应——长任务
  切片/worker）。
- **资源**：图片 `loading="lazy"` + 尺寸声明 + 现代格式
  （webp/avif）；字体子集与 `font-display`；预取视口内链接
  （`router` 预取/`speculationrules` 谱系）。
- **缓存**：产物文件名带内容哈希 + 长缓存头；vendor 与业务 chunk
  分离（业务频繁变不连坐 vendor）。

## 运行时面

- **长任务**：重计算进 Web Worker（`useWebWorkerFn`）；大列表
  过滤/排序节流（`refDebounced`/`watchDebounced`）。
- **内存**：keep-alive `:max` 封顶；全局事件/订阅清理（泄漏排查
  见 DevTools 内存面板快照对比）。
- **动画**：只动 `transform`/`opacity`（合成器路径）；大量元素
  动画用 `v-memo` 或分层 canvas（transitions-animation 纪律）。

## Vapor 面（3.6+）

- Vapor 模式是无虚拟 DOM 的编译策略（可选启用）：模板编译为直接
  DOM 操作，内存占用与创建开销下降——**按项目基准测量后启用**，
  非默认迁移项；与既有生态（JSX/渲染函数/HMR）的兼容面逐项核对
  （upgrade-migrations 版本谱系）。

## 度量闭环

- 优化前后同条件采样（DevTools 记录/Lighthouse 分数/真实用户
  监控——observability 域的核心指标采集）；数字说话，"感觉快了"
  不是结论。
- 预算化：路由 chunk 体积阈值、长任务阈值进 CI 提示（软门）。

## 红线

- 无测量定位就重写；万行列表全量渲染；keep-alive 无上限。
- 把可读性写没了的微优化（维护成本也是成本）。
- 首屏塞满同步三方脚本（分析/字体/AB 框架全阻塞）。
