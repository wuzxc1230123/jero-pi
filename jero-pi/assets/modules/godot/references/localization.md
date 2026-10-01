# 本地化（Localization / tr / 翻译）

基线：**用户可见文本一律 `tr()` 包裹，译文住翻译 CSV，代码不认识任何
具体语言**。本地化是立项纪律不是发布前工序——第一句文案就该走 tr()，
发布前再补 = 全仓捡字符串。

## 翻译链路

- 译文文件：`res://translations/<名>.csv`，首列是**键**（或源语言原文），
  之后每列一个 locale（`zh_CN,en,ja…`）；Godot 导入为 Translation 资源，
  自动按项目设置合并进 `TranslationServer`。
- 取数：`tr("PLAY_AGAIN")` → 当前 locale 列的译文；无命中回退 fallback
  locale，再回退键本身（所以键名可读是红利）。
- 带参文本用格式化，**不拼接**：`tr("GAIN_X").format({"x": str(n)})` 或
  `tr("%s gained %d") % [name, n]`——语序因语言而异，拼接锁死语序。

## locale 管理

- 切换：`TranslationServer.set_locale("zh_CN")`（显式设置优先）；项目
  设置 `internationalization/locale/fallback` 定回退链。
- 侦探（按系统语言自动选）vs 显式设置（玩家在设置里选）——游戏通常
  两者都要：首启侦探，设置页可改并持久化（`save-systems.md`）。
- locale 是语言_地区：`zh_CN` 与 `zh_TW` 译文、用词、排版都不同；
  只备 `zh`/`en` 泛语言列时 Godot 会做语言级回退。

## 字体与排版（CJK 项目的第一坑）

- 默认字体不含 CJK：换字体或配 **fallback 字体链**（主字体缺字自动
  落到备选）；缺失表现为"方块/问号"，不是报错。
- 排版差异预留：德语词长（UI 溢出）、阿语 RTL（镜像布局）、日期数字
  格式——UI 容器（`ui-theming.md`）留弹性宽度，别按中文宽高硬钉。
- 动态字体 `DynamicFont` 系（4.x FontFile）+ subpixel/oversampling 按
  平台调；静态烘焙字库大。

## 内容与资产

- 图片/音频本地化：locale 命名的资源（`icon_zh_CN.png`）+ 代码分派，
  或按 locale 拆目录——选一种并保持全仓一致。
- 数值/单位本地化（货币、日期）：格式化函数收口，不散写。
- 对话文本量大：数据层走 `dialogue-narrative.md` 的 Resource 结构，
  文案键集中在数据层便于翻译导表。

## NEVER

- **NEVER 用户可见文本硬编码不 tr()**——发布前全仓捡字符串是最贵的
  还债方式。
- **NEVER 运行时拼接翻译键**（`tr("ITEM_" + name)`）：键空间碎片化，
  译者拿到的是代码不是文案表；用完整键 + 参数格式化。
- **NEVER 假设 locale=语言**：zh_CN/zh_TW 是两个世界；测试至少跑
  fallback + 最长语言（德语）两档。
- **NEVER 译文进代码分支**（`if locale == "en": ...`）：语言差异住
  翻译表与资产，不住逻辑。
