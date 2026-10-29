#!/bin/sh
# 验收快照：把当前工作区提交为一个版本点，并推送到远程。
#
# 用法：
#   bash scripts/snapshot.sh "feat: 任务描述支持 Markdown"
#   bash scripts/snapshot.sh --no-push "chore: 仅本地提交"
#   npm run snapshot -- "feat: 任务描述支持 Markdown"
#
# 约定：每次功能验收通过后执行一次；提交信息用 feat/fix/docs/chore/refactor + 中文说明，
#   脚本会自动带上当前版本号，并在提交成功后推送到 origin 的同名分支。
#   推送失败（无网络 / 无权限）只提示，不会回滚本地提交。

set -e
cd "$(dirname "$0")/.."

push=1
if [ "${1:-}" = "--no-push" ]; then
  push=0
  shift
fi

msg="${1:-chore: 验收快照}"
ver=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")
branch=$(git rev-parse --abbrev-ref HEAD)

if [ -z "$(git status --porcelain)" ]; then
  echo "工作区干净，没有需要提交的改动（当前版本 v$ver）"
  exit 0
fi

git add -A
git commit -m "$msg (v$ver)"
echo

if [ "$push" -eq 1 ]; then
  if git remote get-url origin >/dev/null 2>&1; then
    if git push origin "$branch" --follow-tags; then
      echo "已推送到 origin/$branch"
    else
      echo "⚠️ 推送失败（网络或权限），提交已保存在本地，稍后可手动 git push"
    fi
  else
    echo "未配置 origin，跳过推送"
  fi
fi

git --no-pager log --oneline -3
