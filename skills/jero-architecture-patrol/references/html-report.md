# 巡检可视化报告（自包含 HTML）

把巡检发现渲染成单个自包含 HTML 文件，写到系统临时目录（`%TEMP%` / `$TMPDIR` / `/tmp`，文件名 `architecture-patrol-<时间戳>.html`，不落仓库），用系统命令打开并告知绝对路径。Tailwind 与 Mermaid 走 CDN；除这两个脚本外报告全静态。

## 骨架

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>架构巡检：<仓库名></title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>仓库名、日期、图例（实线框=模块、虚线=接缝、红箭头=泄漏、深色粗框=深模块）</header>
      <section id="findings" class="space-y-10"></section>
      <section id="top-recommendation"></section>
    </main>
  </body>
</html>
```

头部不放引言段，图例之后直接进发现卡片。

## 发现卡片（每条一个 `<article>`）

- **标题**：短，点名腐化本身（如"收拢订单接入管线"）。
- **徽章行**：巡检轴（六轴之一）+ 建议强度 `Strong`（翡翠）/ `Worth exploring`（琥珀）/ `Speculative`（石板灰）。
- **位置**：等宽字体文件清单。
- **前/后对比图**：卡片的核心，两栏并排（见下图模式）。
- **症状**：一句话，什么在疼。
- **建议**：一句话，改什么。
- **收益**：子弹点，每条 ≤6 词。
- **SDD 切入点**：候选提案标题。

图需要一段话才能看懂就重画图，不补散文。收益用结构词汇说（"接口收缩，实现吸并"），不写"更易维护"这类无锚词。

## 图模式（按发现形状混用，别每张都长一样）

| 发现形状 | 图模式 | 画法 |
|---|---|---|
| 浅模块 | 质量图 | 每模块两个矩形：接口面 vs 实现体。前：接口矩形几乎和实现一样高（浅）；后：接口矮、实现高（深） |
| 信息隐藏违反 / 依赖乱麻 | Mermaid flowchart | `A --> B --> C`，泄漏边 `-.leak.->` 标红（`classDef leak stroke:#dc2626`），深模块 `classDef deep` 加粗深底 |
| 分层违规 | 横截面 | 水平条带（`h-12 border-l-4`）叠放一次调用穿过的层。前：六条薄层各自无所事事；后：一条厚带写明合并后的职责 |
| 重复 | 调用图坍缩 | 前：嵌套盒子的调用树；后：同一棵树坍缩成一个盒子，now-internal 的调用淡化显示 |
| 命名漂移 | 对照表 | 概念 × 名字分叉的简单表格，不作图 |

手绘盒箭（`<div>` 边框 + 绝对定位的内联 SVG 箭头）在 Mermaid 布局不听话时顶上——"后"图要那种一框深色厚边、内部灰化的重量感，Mermaid 给不出来。

## 风格

- 编辑部风，非仪表盘风：慷慨留白，标题可用衬线（`font-serif` 配 stone/slate）。
- 颜色克制：一个强调色（翡翠或靛蓝）+ 红标泄漏 + 琥珀标警示。
- 图高约 320px，前后两栏并排不滚屏。
- 模块标签用 `text-xs uppercase tracking-wider`，读作示意图而非 UI。

## 顶部建议节

一张更大的卡片：发现名、一句话理由、锚链接到它的卡片。仅此而已。

## 词汇纪律

名词动词直接用巡检轴与深模块词汇：模块、接口、实现、深、浅、接缝、泄漏、坍缩、收拢。**禁**用：组件、服务、单元（代模块）、API/签名（代接口）、边界（代接缝）、包装器。措辞范例："订单接入模块浅：接口几乎与实现等宽""定价跨接缝泄漏""加深：一处接口，一处测试"。

## 生成后自检

打开之前过三道断言，任一失败即修再开，不带病交付：

1. **节点可解析**：`<article>` 发现卡片数等于发现条数，`id="findings"` 与 `id="top-recommendation"` 两节齐在；
2. **引用自包含**：除 Tailwind 与 Mermaid 两个 CDN 脚本外无任何外部脚本/样式/图片引用——`data:` 内联与内联 SVG 之外的一切外链都算违反自包含；
3. **锚点可达**：顶部建议节的锚链接逐一命中对应发现卡片的 `id`。

自检结论一句话随路径一并告知用户（如"自检：3 卡片、节点齐、零外链、锚点命中"）；自检失败时说明缺什么、改了什么再交付。
