# 注入与密码学红线（security-injection-crypto）

> 来源：cc-skills-golang security 篇（MIT，12 篇蒸馏；部分源自 Bearer SAST checklist）；权威级：规范
> 最低 Go 版本：1.24（os.Root）｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 注入三防

### SQL/查询注入

```go
// 红线：拼接
q := fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name)

// 正解：参数化
db.QueryRowContext(ctx, "SELECT id FROM users WHERE name = $1", name)

// 动态结构（可选列/排序）用白名单，不是拼接点
allowed := map[string]bool{"name": true, "created": true}
```

### 命令注入

```go
// 正解：参数化 argv，不经 shell
exec.CommandContext(ctx, "convert", inPath, "-resize", "100x", outPath)
// 红线：fmt.Sprintf 拼命令 + sh -c；用户值进任意 argv 位（如文件名
// 以 - 开头会被当 flag——前置 ./ 或 -- 分隔）
```

### 路径穿越

```go
// 1.24+ 锚定根：
root, _ := os.Root.Open(uploadDir)
f, err := root.Open(userPath)      // 拒绝 ../ 与绝对路径（Root 语义）

// 兼容路径：清洗 + 前缀断言
clean := filepath.Clean(userPath)
if !strings.HasPrefix(clean, "assets/") { return ErrForbidden }
```

符号链接绕过：`filepath.EvalSymlinks` 后再断言；解压 zip 看住
zip-slip（条目路径清洗后再落盘）。

## 密码学选型

| 需求 | 用 | 绝不用 |
|---|---|---|
| 随机 token/盐/密钥 | `crypto/rand` | `math/rand`（可预测） |
| 密码存储 | `x/crypto/bcrypt`/`argon2id` + 独立盐 | MD5/SHA1/SHA256 裸哈希 |
| 对称加密 | `crypto/aes` GCM（`cipher.NewGCM`） | ECB；自造模式 |
| 哈希完整性 | `crypto/sha256` | MD5/SHA1 |
| HMAC | `crypto/hmac` | 自拼 hash(k||m) |
| 时间安全比较 | `subtle.ConstantTimeCompare` | `==`/`bytes.Equal`（时序侧信道） |

- AES-GCM nonce 绝不复用（同 key 同 nonce = 密钥泄漏级事故）；
  大数据流式加密走分块 nonce 计数。
- `crypto/rand.Read` 的 err 必须处理（读失败即中止，不降级）。

## TLS

- 默认 `tls.Config` 已是最小 TLS1.2+（1.22 起默认）；不显式降
  MinVersion。
- `InsecureSkipVerify: true` 只允许出现在测试/显式注释的内部抓包，
  出现即评审 BLOCKER。
- 证书钉扎（CustomVerifyPeerCertificate）需注释说明钉扎策略与轮换。

## SSRF

用户提供 URL 的服务端抓取：

```go
u, err := url.Parse(raw)
if u.Scheme != "http" && u.Scheme != "https" { return ErrForbidden }
ips, _ := net.LookupIP(u.Hostname())
for _, ip := range ips {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return ErrForbidden            // 内网段拒绝
	}
}
// 重定向逐跳复检（http.Client CheckRedirect 里重跑上述逻辑）
// 自定义 Dialer 里复查实际连接 IP（DNS rebinding 防）
```

## secrets 纪律

- 不进源码（含测试夹具里的真实值——用占位符）、不进日志（脱敏面见
  logging-slog）、不进错误信息与 panic 栈、不进构建产物。
- 密钥注入走环境/挂载文件；`.env*`、`*.pem`、`*.key` 进 gitignore。
- 发现泄漏即轮换（撤销优先于删除提交——git 历史已是公开态）。

## 输入校验

- 边界处校验一次（长度/类型/范围/字符集），内部信任已校验值——
  层层重复校验是性能税与漂移源。
- `text/template` 渲染 HTML 场景用 `html/template`（上下文转义）；
  `text/template` 渲染进 HTML = XSS 面。
- 反序列化（gob/json 到接口类型）限定类型集，防类型污染。
