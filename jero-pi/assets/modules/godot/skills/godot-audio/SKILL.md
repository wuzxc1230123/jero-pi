---
name: godot-audio
description: 音频系统：三类 AudioStreamPlayer 分工、总线布局、音量单位、BGM/音效组织。当加音效/BGM、配总线、调音量或排查"没声音/音量失衡"时使用。触发词：音频、音效、BGM、音乐、AudioStreamPlayer、AudioStreamPlayer2D、总线、bus、mixer、音量、衰减。
---

# 音频系统（Godot 4.x）

管"怎么响、怎么混"：播放器分工与总线思维。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 动画与演出 → `godot-animation`；手感反馈层的音画同步 → `godot-game-feel`；资源导入（WAV/OGG）→ `godot-assets`。

## 何时使用

加音效/BGM、搭总线、调音量平衡、配空间衰减时使用；导入格式与伴生文件问题归 `godot-assets` 管。

## 核心要点

- 三类播放器各司其职：`AudioStreamPlayer`（全局/UI/BGM）、`AudioStreamPlayer2D/3D`（空间定位）；**不用 2D 播 UI 音、不用全局播放放空间音**。
- 总线思维：Master 之下按用途分轨（Music/SFX/UI/Ambience），音量与效果挂在总线上，逐个播放器调音量是债。
- 音量单位是 dB 不是线性 0–1；人耳感知对数——用 `linear_to_db()` 换算，别手拍数值。
- BGM 用 `AudioStreamPlayer`（循环选项在导入/流上钉住）；一次性音效池化或用 `polyphony`，不每帧 new 播放器。

## 红线

- 每次播放 `add_child` 新建 AudioStreamPlayer（节点垃圾——池化或 polyphony）。
- 全部声音挤 Master 一条总线（后期无法分级调音/静音）。
- 音量魔法数散落各场景（进总线与 Resource 配置）。

## 深读指路（references/）

音频全文（总线配方/三类播放器/空间衰减）：`references/audio-animation.md` 音频节。
