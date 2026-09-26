# 发布 runbook：命令序列与幂等校验

`release` 技能的逐步命令。正文只保留硬规则与流程概览。

## 1. 检查状态

```bash
git status --short
git fetch origin main --tags
git log --oneline --decorate --max-count=5 origin/main
```

## 2. 准备发布提交

- 只应用有意的变更。
- 把 `package.json` 提升到下一个 semver 版本。
- 除非依赖解析确实发生变化，否则不要夹带 lockfile 变更。

## 3. 本地验证

```bash
pnpm test
node scripts/verify-package-files.mjs
npm pack --dry-run
```

`npm pack --dry-run` 在不进入发布路径的情况下验证包内容与生命周期脚本。

## 4. 提交并推送

```bash
git add <intended-files>
git commit -m "<type(scope): release-ready change>"
git push origin HEAD:main
git fetch origin main --tags
```

## 5. 创建并验证精确的版本标签

```bash
version="$(node -p "require('./package.json').version")"
tag="v${version}"
release_sha="$(git rev-parse 'origin/main^{commit}')"

test "$(git rev-parse 'HEAD^{commit}')" = "${release_sha}"
test -z "$(git ls-remote --tags origin "refs/tags/${tag}")"

git tag -a "${tag}" "${release_sha}" -m "jero-pi ${tag}"
test "$(git rev-parse "${tag}^{commit}")" = "${release_sha}"

git fetch origin main
test "$(git rev-parse 'origin/main^{commit}')" = "${release_sha}"
git push origin "refs/tags/${tag}"

git fetch --no-tags origin "refs/tags/${tag}"
test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "${release_sha}"

gh release create "${tag}" \
  --repo jero-pi/jero-pi \
  --verify-tag \
  --title "jero-pi ${tag}" \
  --notes "<release notes>"
```

不要重打或覆盖既有版本。标签目标来自新拉取的不可变 `origin/main` 提交，而非当前所在的本地分支。

## 6. 通过 GitHub Actions 发布 npm

```bash
version="$(node -p "require('./package.json').version")"
tag="v${version}"
gh workflow run publish.yml \
  --repo jero-pi/jero-pi \
  --ref main \
  -f tag="${tag}"
```

工作流定义始终来自受保护的默认 `main`。它只接受一个精确的 `vSemVer` 标签，拉取远端附注标签与当前远端 `main`，并要求剥离后的标签提交、派发/main 工作流提交、checkout 与 `package.json` 版本全部一致。它在 npm 发布前立即重新查询远端标签与 `main`，在内部推导 dist-tag，并使用 trusted OIDC with provenance（可信 OIDC 与溯源）。

观察运行过程，失败则宣告发布失败：

```bash
gh run list --repo jero-pi/jero-pi --workflow publish.yml --limit 3
gh run watch <run-id> --repo jero-pi/jero-pi --exit-status
```

## 7. 验证 npm

```bash
npm view jero-pi@<version> version --registry=https://registry.npmjs.org/
npm dist-tag ls jero-pi --registry=https://registry.npmjs.org/
```

## 失败处理

- 发布失败按普通仓库策略处理。它不重开也不更改评审谱系。
- 绝不在本地尝试或重试 `npm publish`。仅当同一标签仍指向当前远端 `main`、且失败仅限于发布本身时，才从受信任的 `main` 重新派发。
- 若远端 `main` 前进，不要移动或重建既有标签。准备新的发布提交/版本并创建新的附注版本标签。
- 若工作流失败，用以下命令查看日志：

  ```bash
  gh run view <run-id> --repo jero-pi/jero-pi --log
  ```

- 若工作流成功后 npm 验证短暂滞后，先检查确切版本（`npm view jero-pi@<version> version`），再假定发布失败。
