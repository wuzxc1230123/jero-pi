---
name: godot-assets
description: 资源导入管线：源资产与 .import 伴生文件成对入库、.godot/ 产物不入库、导入选项进 .import、glTF/纹理/音频规约。当导入模型/贴图/音频、排查"资源丢失/导入后变色"或组织资产目录时使用。触发词：资源导入、素材、.import、glTF、纹理、贴图、模型、导入选项、资产目录、重导入。
---

# 资源导入管线（Godot 4.x）

管"源资产不动，产物生成"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 3D 模型比例与 glTF 选型 → `godot-3d`；音频格式 → `godot-audio`；gitignore 基线（`.godot/`）→ `godot-verify`。

## 何时使用

导入源资产（PNG/WAV/glTF）、调导入选项、排查导入异常、定资产目录规约时使用；运行时 Resource 数据组织归 `godot-resources` 管。

## 核心要点

- 导入模型：**源文件 + `.import` 元数据（导入选项）→ `.godot/imported/` 二进制产物**；`.godot/` 本体 gitignore，`.import` 伴生文件**成对入库**。
- 导入选项（过滤模式/压缩/生成 mipmap）记录在 `.import` 里——团队共享靠它入库，改一处全员一致。
- 目录规约立项定死（`assets/` 按类型或按系统二选一），命名小写下划线；后期搬家 = 全项目引用断裂。
- glTF 2.0 为 3D 交换首选；模型问题回 DCC 修（比例/轴向/命名），场景里硬补是债。

## 红线

- `.import` 伴生文件被 gitignore（换机器/CI 重导入选项漂移，产物不一致）。
- 手改 `.godot/imported/` 产物（下次导入即覆盖）。
- 源资产与生成物混放、或把 DCC 工程文件（.blend/.psd 源）当运行时资源直接引用。

## 深读指路（references/）

导入管线全文（机制/选项规约/目录组织）：`references/asset-pipeline.md`。
