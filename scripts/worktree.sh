#!/bin/sh
# 一功能一 worktree：在独立工作树开发，验收后合并回 main 并推送。
#
# 用法：
#   bash scripts/worktree.sh start feat/task-templates     # 创建 worktree + 分支
#   bash scripts/worktree.sh list                          # 查看所有工作树
#   bash scripts/worktree.sh finish feat/task-templates    # 合并到 main、推送、清理
#   bash scripts/worktree.sh finish feat/x "feat: 说明"    # 指定合并提交信息
#
# 约定：
#   - worktree 放在仓库同级的 pulse-worktrees/ 下，避免污染仓库目录
#   - 分支命名用 feat/ fix/ chore/ refactor/ docs/ 前缀
#   - finish 只接受「分支已全部提交」的状态；未提交会明确报错

set -eu

# 主工作树（克隆目录）与当前工作树可能不同：路径与合并都要以主工作树为基准
MAIN_WT=$(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10); exit}')
ROOT=$MAIN_WT
cd "$ROOT"

WT_BASE=${WT_BASE:-"$(dirname "$MAIN_WT")/pulse-worktrees"}
MAIN_BRANCH=${MAIN_BRANCH:-main}

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

# 找出分支对应的工作树目录
worktree_of() {
  git worktree list --porcelain | awk -v b="refs/heads/$1" '
    /^worktree / { dir = substr($0, 10) }
    /^branch /   { if (substr($0, 8) == b) { print dir; exit } }
  '
}

case "${1:-}" in
  start)
    branch=${2:-}
    base=${3:-$MAIN_BRANCH}
    [ -n "$branch" ] || usage
    case "$branch" in
      refs/*) echo "分支名不要带 refs/ 前缀"; exit 1 ;;
      "$MAIN_BRANCH") echo "不能拿主分支开工作树"; exit 1 ;;
    esac
    slug=$(printf '%s' "$branch" | tr '/' '-')
    dir="$WT_BASE/$slug"
    if [ -e "$dir" ]; then
      echo "目录已存在：$dir"
      exit 1
    fi
    git fetch -q origin 2>/dev/null || true
    mkdir -p "$WT_BASE"
    git worktree add -b "$branch" "$dir" "$base"
    echo
    echo "worktree: $dir"
    echo "分支:     $branch（基于 $base）"
    echo "下一步:   cd \"$dir\" 开发 → bash scripts/worktree.sh finish $branch"
    ;;

  list)
    git worktree list
    ;;

  finish)
    branch=${2:-}
    message=${3:-"chore: 合并 $branch"}
    [ -n "$branch" ] || usage
    dir=$(worktree_of "$branch")
    if [ -z "$dir" ]; then
      echo "找不到分支 $branch 对应的工作树（可能已清理）"
      exit 1
    fi

    # 工作树里不能有未提交改动，避免合并丢东西
    if [ -n "$(git -C "$dir" status --porcelain)" ]; then
      echo "工作树里还有未提交改动：$dir"
      echo "请先在该目录执行：npm run snapshot -- \"<type>: <说明>\""
      exit 1
    fi

    # 主工作区也必须干净，避免 merge 冲突夹在中间状态
    if [ -n "$(git status --porcelain)" ]; then
      echo "主工作区有未提交改动，请先提交或清理"
      exit 1
    fi

    cd "$MAIN_WT"
    current=$(git rev-parse --abbrev-ref HEAD)
    if [ "$current" != "$MAIN_BRANCH" ]; then
      echo "当前不在 $MAIN_BRANCH（在 $current），先切回主分支再合并"
      exit 1
    fi

    git merge --no-ff "$branch" -m "$message"
    ver=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")

    if [ -n "$(git remote 2>/dev/null | head -1)" ]; then
      # 推送失败不阻断合并与清理：本地已合并，稍后可手动补推
      if git push origin "$MAIN_BRANCH" --follow-tags; then
        echo "已推送到 origin/$MAIN_BRANCH"
      else
        echo "⚠️ 推送失败（网络或权限），本地合并已完成，稍后可手动 git push"
      fi
    else
      echo "未配置远程，跳过推送"
    fi

    git worktree remove "$dir"
    git branch -d "$branch"

    # 功能分支已合并，顺手清掉远程同名分支，避免 GitHub 上堆积
    if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
      if git push origin --delete "$branch" >/dev/null 2>&1; then
        echo "已删除远程分支 origin/$branch"
      else
        echo "远程分支 origin/$branch 删除失败，可手动清理"
      fi
    fi
    echo
    echo "已合并 $branch 到 $MAIN_BRANCH（v$ver），worktree 已清理"
    echo "如需发布标签：git tag -a v$ver -m \"说明\" && git push origin v$ver"
    ;;

  *)
    usage
    ;;
esac
