#!/bin/sh
# 验收快照：把当前工作区提交为一个版本点。
#
# 用法：
#   bash scripts/snapshot.sh "feat: 任务描述支持 Markdown"
#   bash scripts/snapshot.sh                 # 不写说明时用默认文案
#
# 约定：每次功能验收通过后执行一次；提交信息建议用
#   feat/fix/refactor/docs/chore + 中文说明，脚本会自动带上当前版本号。

set -e
cd "$(dirname "$0")/.."

msg="${1:-chore: 验收快照}"
ver=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")

if [ -z "$(git status --porcelain)" ]; then
  echo "工作区干净，没有需要提交的改动（当前版本 v$ver）"
  exit 0
fi

git add -A
git commit -m "$msg (v$ver)"
echo
git --no-pager log --oneline -3
