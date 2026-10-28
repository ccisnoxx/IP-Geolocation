#!/usr/bin/env bash
# 状态：2026-10-29 已决定放弃合并上游（见 MERGE-ANALYSIS.md「决策」节），脚本仅作参考保留，不再执行。
#
# 把上游（默认 origin/main）收进当前分支，冲突按"重写线优先"收口。
#
#   bash scripts/merge-upstream.sh              # 收到"待提交"状态，不提交
#   bash scripts/merge-upstream.sh --commit     # 收完顺手提交
#   UPSTREAM=origin/main bash scripts/merge-upstream.sh
#
# 规则（依据 MERGE-ANALYSIS.md）：
#   1. 内容冲突（UU）→ 取本地；上游单方新增（UA）→ 丢掉
#   2. 本地删、上游改（DU）→ 保持删除，旧注入层已被新模块取代
#   3. 上游新增但挂在旧类型上的文件 → 删掉，等功能在新模型上重写（见报告 §7.1）
#   4. 自动合并成功但语义有问题的 HTML / tsconfig → 回滚到本地版本
set -euo pipefail

UPSTREAM="${UPSTREAM:-origin/main}"
COMMIT=0
for arg in "$@"; do
  case "$arg" in
    --commit) COMMIT=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

git rev-parse --verify --quiet "$UPSTREAM" >/dev/null || {
  echo "找不到引用 $UPSTREAM —— 先 git fetch origin" >&2
  exit 2
}

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区不干净，先提交或 stash：" >&2
  git status --short >&2
  exit 2
fi

BASE="$(git rev-parse HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# 「取本地」是全量覆盖：冲突块里上游的那半边当场就没了，事后想回看某一条只能靠
# reflog 里那个 MERGE_HEAD。这里把每条被覆盖的路径连同上游那一侧（stage 3）的
# blob 记到 .git 里（不污染工作区），收口完打印一句去哪儿看。
OURS_LOG="$(git rev-parse --git-dir)/vanishgeo-merge-ours.log"
OURS_COUNT=0
: > "$OURS_LOG"
log_ours() {
  local path="$1" stage2=""
  # stage 3 = 上游那一侧（stage 2 是我们自己，记下来没用）
  theirs="$(git rev-parse -q --verify ":3:$path" 2>/dev/null || true)"
  printf '%s\t%s\n' "$path" "${theirs:-none}" >> "$OURS_LOG"
  OURS_COUNT=$((OURS_COUNT + 1))
}

# 任何一步中途失败（门禁红了、pathspec 对不上）都要把"怎么退回去"说出来：
# 这时仓库已经进了 merge 状态（冲突已 stage、MERGE_HEAD 在），停在半路的
# 仓库比失败本身更容易让人踩坑，而脚本尾部的提示根本走不到。
rollback_hint() {
  echo "回滚：git merge --abort 2>/dev/null || git reset --hard ${BASE:0:8}" >&2
}
trap rollback_hint ERR

echo "==> 合并 $UPSTREAM → ${BRANCH}（基准 ${BASE:0:8}）"

# `|| true` 会把"非冲突的失败"也一起吞掉（unrelated histories、无效 ref、已经在 merge 中），
# 后面三步在错误的基础上空转、门禁还能在 HEAD 上全绿、最后照样打印"冲突已收口"。
# 只有真的进入 merge 状态（有 MERGE_HEAD）才算"有冲突待收口"。
if ! git merge --no-commit --no-ff "$UPSTREAM"; then
  if [ ! -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]; then
    echo "合并失败：仓库没有进入 merge 状态（不是冲突，见上面 git 的报错）" >&2
    exit 1
  fi
fi

# 1) 逐条解决冲突标记
# 用 `-z` + `core.quotePath=false` 读：porcelain 默认会把非 ASCII 路径加上引号转义，
# 拿到 `"\351\205\215..."` 这样的串去 checkout 只会报 pathspec 不匹配，
# set -e 就在半路把脚本撕断（实测中文路径必踩）。
while IFS= read -r -d '' record; do
  [ -n "$record" ] || continue
  code="${record:0:2}"
  path="${record:3}"
  case "$code" in
    UU|AA)
      echo "  取本地   $path"
      log_ours "$path"
      git checkout --ours -- "$path"
      git add -- "$path"
      ;;
    DU|UA)
      echo "  保持删除 $path"
      git rm -q --force -- "$path"
      ;;
    UD)
      echo "  保留本地 $path"
      git checkout HEAD -- "$path"
      git add -- "$path"
      ;;
    AU)
      echo "  保留本地 $path"
      git add -- "$path"
      ;;
    *)
      ;;
  esac
done < <(git -c core.quotePath=false status --porcelain -z || true)

# 2) 上游新增、但直接挂在旧配置类型上的文件：暂不移植
for f in src/background/ip-sync.ts tests/ip-sync.test.mjs; do
  if git cat-file -e "HEAD:$f" 2>/dev/null; then continue; fi
  if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    echo "  暂不移植 ${f}（新模型上重写，见报告 §7.1）"
    git rm -q --force -- "$f"
  fi
done

# 3) 自动合并成功但语义不对的：回滚到本地版本
for f in src/options/options.html src/popup/popup.html tsconfig.json; do
  if git diff --cached --quiet HEAD -- "$f"; then continue; fi
  echo "  回滚自动合并 $f"
  git checkout HEAD -- "$f"
done

# 4) 门禁：类型 → 构建 → 测试（测试要读 dist）
echo "==> 门禁：tsc --noEmit"
npx tsc --noEmit
echo "==> 门禁：vite build"
npx vite build >/tmp/vanishgeo-merge-build.log 2>&1 || { tail -20 /tmp/vanishgeo-merge-build.log; exit 1; }
tail -1 /tmp/vanishgeo-merge-build.log
echo "==> 门禁：单元测试"
npx tsx --test tests/*.test.ts 2>&1 | tail -6

echo
if [ "$OURS_COUNT" -gt 0 ]; then
  echo "==> 共 ${OURS_COUNT} 条冲突「取本地」，清单与上游一侧（stage 3）的 blob 记在："
  echo "    ${OURS_LOG}"
  echo "    （想单独回看某一条的上游版本：git show <blob> 或 git checkout ${UPSTREAM} -- <path>）"
fi
echo "==> 冲突已收口，未提交。检查 diff 后："
echo "    git commit -m 'merge: 收进 ${UPSTREAM}（重写线优先，旧注入层保持删除）'"
echo "    回滚：git reset --hard ${BASE:0:8}"

if [ "$COMMIT" = "1" ]; then
  git commit -q -m "merge: 收进 ${UPSTREAM}（重写线优先，旧注入层保持删除）"
  echo "==> 已提交：$(git log -1 --oneline)"
fi