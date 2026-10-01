# 性能预算与反模式

性能是预算管理，不是事后优化。先给预算，再花预算，花超了看 profiler。

## 预算起点（60 FPS 帧 = 16.6ms）

- 逻辑（_process/_physics_process 全体）：≤ 4ms
- 物理步进：默认 60Hz 固定； `_physics_process` 单帧全体 ≤ 3ms
- 渲染：余量归渲染（2D 中端机 ≤ 8ms 是安全线）
- 内存：纹理是大头——2048² RGBA8 ≈ 16MB；图集打包（Import 模式
  Atlas），散图是大户
- 对象数预算：同屏活动实体（敌人/投射物）钉常数上限（如 64），
  超限回收最旧——"无限生成"是移动端杀手

## 每帧成本反模式（评审按此核查）

- **每帧 instantiate/queue_free**：生成改成对象池（预实例化 + 显示/
  隐藏 + `active=false`），回收延迟批量处理。
- **每帧 get_node/find_child/get_children().size()**：`_ready` 缓存引用；
  计数维护成员变量。
- **每帧字符串操作**（格式化日志、拼接）：日志限频（`if Engine.
  get_frames_drawn() % 60 == 0`）或只在 debug 构建（`OS.is_debug_build()`）。
- **重 _process**：把"偶尔才需要"的逻辑改成信号/计时器驱动；空转的
  `_process` 里首行 `set_process(false)` 自己关。
- **未类型化调用的动态派发热点**：热点路径显式类型（typed 数组 +
  typed 参数），动态调用（字符串方法名、`call()`）滚出热路径。
- **await 链造成协程泄漏**：长循环里反复 `await` 计时器的模式，节点
  销毁后协程还在跑——用节点内计时器或生命周期守卫
  （`if not is_inside_tree(): return`）。

## 渲染侧

- 2D：` batching` 由引擎处理；手动的活是**减 draw call 源**：合并
  图集、少用 `BackBufferCopy`、粒子总量设限（见 shaders-visuals.md）。
- 光照：`PointLight2D` 数量×阴影开销大；静态光照烘进贴图，动态光
  限个位数。
- 3D：阴影是最大单项——`directional_shadow` 尺寸降档、静态物
  `lightmap`/烘焙，GI 用 LightmapGI 而非实时 SDFGI（中端机）。
- MSAA/超采样：移动端默认关，桌面按需——放进项目设置注释里钉决策。

## 测量工具（先测后改）

- 编辑器 Profiler（时间线：函数级耗时）；Monitor（FPS/物体数/显存）。
- headless 基线：`godot --headless --path . --quit-after 300` 跑 5 秒
  看退出前 stdout 的性能行——可进 CI 做预算回归（超阈值 exit 非 0
  的包装脚本）。
- **绝不凭感觉优化**：报告里写"改了什么、测到多少、预算剩多少"，
  没数字的优化是装饰。

## NEVER

- **绝不为性能牺牲确定性先于设计**：先正确（可测试），再快（有
  profiler 证据）；两者冲突时回到预算表重新分配。
- **绝不在物理回调里做重活**（`_physics_process` 里的 instantiate、
  文件 IO）——排队到 `_process` 或 deferred call。
- **绝不信任"我机器上很流畅"**：以最低目标机/CI 基线为准。
