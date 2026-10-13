# 导出与发布（export / Steam / itch）

导出是验证回路的最后一道门（见 `verification.md`）：**能 import ≠ 能导出能跑**，发布前必须真实导出并启动一次产物。

## Export Presets 基线

- 编辑器装匹配版本的 Export Templates（版本错位 = 导出即失败，先 `--version` 对齐）。
- 每平台一份 preset：命名 `{platform}-{channel}`（windows-release / web-itch）；`export_path` 进 `builds/`（gitignore）。
- 主场景、图标、窗口设置（拉伸模式/分辨率）在项目设置钉住；导出过滤器（Include Filter）按需打包 `*.json` 等非资源文件。
- 版本号：`config/version` 项目设置 + CI 注入；产物文件名带版本与 commit（`mygame-windows-1.2.3+a1b2c3.zip`）。

## 命令行导出（CI 主干）

```bash
godot --headless --import .                 # 先导入资源（见 asset-pipeline.md）
godot --headless --export-release "windows-release" builds/win/game.exe
godot --headless --export-pack "linux-release" builds/server/game.pck   # 只出内容包
```

- `--export-release`/`--export-debug` + preset 名 + 产物路径；退出码即门槛（非 0 = 发布阻断）。
- CI 全平台矩阵跑导出 + 冒烟（产物启动 10s 截图/退出码），别只导不跑。
- 专用服务器：Linux preset 勾 `dedicated server`（无渲染依赖），配 `--server` 运行（多人架构见 `multiplayer.md`）。

## 平台要点

| 平台 | 关键项 |
|---|---|
| Windows | 代码签名（EV/OV 证书，未签名 SmartScreen 拦）；`console_wrapper` 开发版 |
| macOS | 签名 + notarize（`codesign` + `xcrun notarytool`，CI Mac runner）；`.dmg` 打包 |
| Linux | 权限位（`chmod +x`）；AppImage 或裸 tar |
| Web | `Cross-Origin-Isolation` 头（SharedArrayBuffer 需 `COEP/COOP`）；itch 自动配，自托管要设头 |
| Android | keystore 签名（`export_presets.cfg` 引用，密钥绝不入库）；AAID 版本号递增 |
| iOS | 证书/provisioning，Mac 环境 |

- `export_presets.cfg` 入版本控制（无密钥），密钥走 CI secret 注入环境变量。
- 首次出包在**干净虚拟机**跑一遍（缺 DLL/字体/权限的显形地）。

## Steam 发布

- Steamworks SDK 集成：GodotSteam（伴生依赖，评审其许可与退出预案）或轻量 `steam_api` GDExtension 包装。
- 上传：`steamcmd` + app build 脚本（`app_build_XXXX.vdf`）CI 化；`ContentBuilder` 目录结构 = depot 布局。
- Steam Cloud 目录对准 `user://`（存档策略见 `save-systems.md`）；成就/库存走 Steamworks API 回调异步，失败降级本地。
- 分支（default/beta/demo）用 depots 与密码分支管理，同一构建管线多出口。

## itch 发布

- `butler` CLI：`butler push builds/win myuser/mygame:windows`（通道 = 平台标签，itch 页面自动识别）。
- Butler 增量上传 + 并发；`butler status` 查 diff；版本命名 = Git tag。
- HTML5 通道零配置（itch 自动配 COI 头）；桌面通道勾"简陋但能用"的 installers 由 itch 处理。
- Devlog/页面素材不属于发布管线，勿耦合进脚本。

## 发布清单（每次出包）

1. `--import` → 测试全绿（`testing.md`）→ 版本号提升。
2. 全平台 `--export-release`，逐产物启动冒烟（截图 + 退出码留证）。
3. 干净环境抽查一平台（无开发依赖的机器/虚拟机）。
4. 上传（butler/steamcmd）+ 渠道页版本说明。
5. 打 tag：发布即快照，可复现 = 同 commit 重导出逐字节等价（模板版本钉住）。
