# 资源导入管线（Assets）

Godot 导入模型：源资产（PNG/WAV/glTF）不动，导入产物（`.godot/imported/`）生成——**`.import` 伴生文件与源文件成对入库**。

## 导入机制

- 源文件 + `.import` 元数据（导入选项）→ `.godot/imported/` 二进制产物（`.ctex/.sample` 等）；`.godot/` 本体 gitignore，`.import` 不 ignore。
- 首次克隆/CI 必跑 `godot --headless --path . --import`（验证回路第一道门，见 `verification.md`）——没有导入产物，`load()` 在导出包与 CI 里全失败而编辑器里"正常"（编辑器自动导入掩盖问题）。
- 改导入选项 = 改 `.import` 文件 → 重新导入（编辑器 Reimport 或 headless `--import`）；选项改动入版本控制可 diff。

## 纹理

| 用途 | 关键选项 |
|---|---|
| 精灵（2D 像素风） | Filter 关、Mipmaps 关、Compress 无（或 Lossless） |
| 3D 贴图 | VRAM Compressed（桌面 DXT/BC、移动 ASTC）、Mipmaps 开 |
| UI | Filter 按风格，Compress Lossless |

- 像素风全局开关：项目设置 `textures/canvas_textures/default_texture_filter = Nearest`——别逐纹理改。
- Atlas：大图集 + `AtlasTexture` region（数据驱动见 `resources-data.md`）优于海量小文件（导入开销与加载碎片）。
- 命名：`snake_case` 全小写下划线（Godot 资源名约定），中文/空格/大写混用在导出与脚本引用双踩坑。

## 音频

- WAV（短音效：零解码延迟，`loop` 选项在导入面板）vs OGG（长 BGM 流式）；MP3 折中。
- 总线架构在音频总线面板（Bus layout 资源入库）；音量调总线不逐播放器（见 `audio-animation.md` 音频节）。

## glTF / 场景资产

- 导入选项在 `.import`（动画烘焙/网格合并/材质策略），深入见 `3d-essentials.md` 导入节。
- 场景资产（`.tscn` 里嵌 `.glb`）：`Editable Children` 只做临检，正式拆解 = "Save Branch as Scene" 物化成项目场景再改。

## 字体

- TTF/OTF 一份 + `FontVariation` 派生（尺寸/字距）；系统字体兜底（`TextServer` fallback 链）覆盖 CJK。
- 主题字体统一在 Theme 资源（`ui-theming.md`），不逐 Control 挂。

## 纪律与坑

- `.import` 文件删除/不入库 = 团队成员与 CI 的导入选项全回默认（纹理过滤/压缩静默漂移）。
- 运行时生成文件写 `res://`（导出包只读，必炸）——运行时产物一律 `user://`（见 `save-systems.md`）。
- `load("res://...")` 路径硬编码散落：集中路径常量或 Def Resource 引用（重命名一次改）。
- 图集/纹理改尺寸不更新引用：region 是坐标，改图集布局 = 全部 region 复核（图集布局进数据表以便校验）。
- 二方资产（商店/CC0 包）入库前统一命名与导入选项，勿带原目录结构直接倾倒。
