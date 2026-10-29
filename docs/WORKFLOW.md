# 开发工作流

> 仓库：<https://github.com/Shmming-86/pulse> ｜ 主分支：`main` ｜ 许可：Apache-2.0

本项目采用「一功能一工作树」的开发方式：`main` 始终保持可发布状态，任何改动都在独立 worktree 中完成，
验收通过后合并回 `main` 并自动提交、推送。

## 1. 分支与目录约定

| 项 | 约定 |
|---|---|
| 主分支 | `main`，始终可部署；禁止直接在 `main` 上开发 |
| 分支命名 | `feat/<slug>`、`fix/<slug>`、`chore/<slug>`、`refactor/<slug>`、`docs/<slug>` |
| 工作树位置 | 仓库同级的 `pulse-worktrees/<branch-slug>`（如 `../pulse-worktrees/feat-task-templates`） |
| 提交信息 | `<type>: <中文说明> (v<版本>)`，`type` 取 feat/fix/docs/chore/refactor |
| 版本号 | `package.json`、`server/config.js`、`docs/DEPLOYMENT.md` 三处同步，改完 `npm run package` |

## 2. 标准流程

```bash
# ① 新建工作树（从最新 main 切出）
bash scripts/worktree.sh start feat/task-templates
cd ../pulse-worktrees/feat-task-templates

# ② 开发 + 自测（语法检查、启动冒烟、界面截图）
npm start                     # 临时数据：DATA_DIR=.tmp-dev PORT=4199 npm start

# ③ 提交到功能分支并推送（验收前也可先提交，方便备份）
npm run snapshot -- "feat: 任务模板"      # 提交 + 推送 origin/feat/task-templates

# ④ 验收通过后合并回 main：合并 + 推送 + 清理工作树
cd /d/work/kanban
bash scripts/worktree.sh finish feat/task-templates "feat: 任务模板 (v1.8.0)"

# ⑤ 需要发布点时打标签
git tag -a v1.8.0 -m "Pulse 看板 v1.8.0：任务模板"
git push origin v1.8.0
```

`finish` 会做四件事，任何一步不满足都会中止并提示原因：

1. 校验功能分支与主工作区都**没有未提交改动**
2. `git merge --no-ff` 合并到 `main`（保留功能分支的提交历史）
3. `git push origin main --follow-tags`
4. 删除工作树与已合并的分支

## 3. 验收标准

合并前必须完成（详见 [README「代码质量与 CI」](../README.md#代码质量与-ci)）：

- `git ls-files '*.js' '*.mjs' | while read f; do node --check "$f"; done` 全部通过
- 以隔离数据目录启动服务，`/api/health`、`/api/bootstrap` 正常
- 涉及界面的改动：无头浏览器截图核对（截图不入库，需要长期保留的放 `docs/assets/`）
- 涉及接口的改动：curl 覆盖正常路径与校验失败路径

GitHub Actions 会在推送后重跑同样的检查。

## 4. 例外情况

| 场景 | 处理 |
|---|---|
| 初始化仓库、CI 卡死等紧急修复 | 允许直接在 `main` 提交，提交信息加 `hotfix:` 前缀，事后补说明 |
| 只改文档里的错别字 | 仍建议走 worktree，成本只有两条命令 |
| 工作树被误删 | `git worktree prune` 清理登记，再 `git branch -D <branch>` 删除残留分支 |

## 5. 常用命令速查

```bash
bash scripts/worktree.sh list        # 查看所有工作树
git worktree list                    # 同上（原生命令）
git branch -vv                       # 分支与上游跟踪关系
git log --oneline --graph -10        # 提交图
git push origin --tags               # 补推所有标签
```
