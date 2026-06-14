#!/bin/bash
# 检查 master 上的 bug fix 是否需要同步到社区版
# Usage: ./scripts/community-sync-check.sh [master-branch] [community-branch]

set -e

MASTER_BRANCH=${1:-master}
COMMUNITY_BRANCH=${2:-community-prep}
LIMIT=${3:-20}

echo "=== 检查 $MASTER_BRANCH 上最近的 fix 类提交是否需要同步到 $COMMUNITY_BRANCH ==="
echo ""

# 获取 master 上最近的 fix 类 commits
git log --oneline --grep='^fix' "$MASTER_BRANCH" -"$LIMIT" | while read -r hash msg; do
    echo "[$hash] $msg"
    files=$(git diff-tree --no-commit-id --name-only -r "$hash")
    need_sync=false
    skip_reason=""

    for f in $files; do
        if git cat-file -e "$COMMUNITY_BRANCH:$f" 2>/dev/null; then
            echo "    [社区版存在] $f"
            need_sync=true
        else
            echo "    [社区版已移除] $f"
        fi
    done

    if [ "$need_sync" = true ]; then
        echo "    => ⚠️  需要同步到社区版"
    else
        echo "    => ✅ 无需同步（修改的均为 Pro 模块）"
    fi
    echo ""
done
