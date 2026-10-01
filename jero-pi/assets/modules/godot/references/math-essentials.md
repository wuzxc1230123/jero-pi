# 数学基础（向量 / 插值 / 角度 / 变换）

日常游戏数学的"哪个 API 干哪件事"清单——多数坑不是数学不会，是
**手写了引擎已有的方法**、或**在错误的空间/单位里做运算**。

## 向量常用面

- 朝向与夹角：`a.dot(b) > 0` 同向半边（AI 视野判定、攻击朝向）；
  夹角 `a.angle_to(b)`（带符号与否要确认语义再用于转向）。
- 左右侧判定（2D）：`Vector2.UP.cross(to_target) > 0`——叉乘 z 分量
  的符号即左右；追击/走位常用。
- 距离与方向：`distance_to` / `direction_to`（注意 `direction_to` 对
  零向量的行为——除零得零向量，速度叠加前判长度）。
- 归一化只在"要方向"时做：`position += dir.normalized() * speed * delta`
  才有意义；已归一化的向量别二次归一（误差累积）。

## 插值家族（帧率无关是红线）

| API | 干什么 | 帧率语义 |
| --- | --- | --- |
| `lerp(a, b, t)` | 线性插值 | t 是比例**不是速度** |
| `lerp_angle(a, b, t)` | 角度插值（跨 ±π 不跳变） | 同上 |
| `move_toward(a, b, d)` | 定速趋近 | d 是步长，配 delta |
| `smoothstep(a, b, x)` | 平滑过渡（边缘 easing） | — |

- **角度插值必须 `lerp_angle`**：`lerp` 跨 ±π 时会绕远路（359°→1°
  转一整圈）。
- 帧率无关的指数趋近：`lerp(a, b, 1.0 - exp(-k * delta))`——每帧
  `lerp(a, b, 0.1)` 是帧率绑定写法（高帧率收得快），手感调参会因
  机器而异（`game-feel.md` 的参数纪律同样适用）。

## 角度与单位

- Godot 全局**弧度制**：`deg_to_rad`/`rad_to_deg` 换算，别在字段里
  混存度数。
- 角度环绕：比较/累积用 `wrapf(angle, -PI, PI)` 收区间；朝向差的
  符号判定前先 wrap。
- `rotation`（局部）vs `global_rotation`（全局）：跨层级比较/赋值前
  想清楚在哪个空间；混用是"有时对有时错"类 bug 的头名。
- 2D 前向约定：节点的"前方"是 **-Y（旋转 0 朝上）**，`transform.y`
  是"后方"——AI 视野锥、炮口方向都先统一前向约定再写。

## 变换（Transform2D/3D）

- 变换 = 原点 + 基（旋转/缩放）一体：`global_transform * local_point`
  做空间换算，不手拆 `position + rotated(...)` 拼装。
- `look_at(target)` 让 -Z 对准目标（3D）；配合前向约定取 `-transform.basis.z`。
- 父链有缩放时世界矩阵合成有剪切风险——非均匀缩放尽量不进层级
  （`3d-essentials.md` 比例纪律）。

## 随机

- `randf_range`/`randi_range` 全局便捷；**可复现场景一律注入
  `RandomNumberGenerator` 定 seed**（`procedural-gen.md` 种子纪律、
  `testing.md` 可测性）。

## NEVER

- **NEVER 手写 atan2 求角差不 wrap**——±π 跳变让转向逻辑反向。
- **NEVER 角度用 `lerp`**——用 `lerp_angle`。
- **NEVER 每帧 `lerp(a, b, 固定t)` 冒充帧率无关**——用
  `1 - exp(-k*delta)` 或 `move_toward(v, d*delta)`。
- **NEVER 手拼引擎已有的向量/变换运算**（逐分量加旋转偏移等）——
  `Transform` 乘法、`dot/cross` 就是为此存在的。
