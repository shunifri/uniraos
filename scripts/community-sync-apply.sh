#!/bin/bash
# 将 master 上的某个 commit 同步到社区版
# Usage: ./scripts/community-sync-apply.sh <commit-hash>

set -e

COMMIT=${1:-}
COMMUNITY_BRANCH=${2:-community-prep}

if [ -z "$COMMIT" ]; then
    echo "Usage: $0 <commit-hash> [community-branch]"
    echo "Example: $0 01b064c"
    exit 1
fi

# 确保我们在社区版分支上
current=$(git branch --show-current)
if [ "$current" != "$COMMUNITY_BRANCH" ]; then
    echo "错误：当前分支是 $current，请切换到 $COMMUNITY_BRANCH 后再运行"
    exit 1
fi

patch_file="/tmp/raos-sync-${COMMIT}.patch"

echo "=== 从 $COMMIT 生成 patch ==="
git format-patch -1 "$COMMIT" --stdout > "$patch_file"

echo "=== 检查 patch 是否可自动应用 ==="
if git apply --check "$patch_file"; then
    echo "✅ patch 可以自动应用"
    read -p "是否应用？ [Y/n] " confirm
    if [ -z "$confirm" ] || [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        git apply "$patch_file"
        echo "✅ patch 已应用，请检查改动后提交"
        echo "提示：建议使用 git commit --amend 合并到社区版 init commit"
    else
        echo "已取消"
    fi
else
    echo "❌ patch 无法自动应用，需要手动处理"
    echo "patch 文件位于: $patch_file"
    echo "可先执行: git apply --reject $patch_file"
fi
