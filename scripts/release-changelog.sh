#!/usr/bin/env bash
set -euo pipefail

if [[ "$(git rev-parse --is-shallow-repository)" != false ]]; then
  echo '无法生成发布日志：需要完整 Git 历史与 tags（checkout fetch-depth: 0）。' >&2
  exit 1
fi

# 从全部祖先选上一版；排除当前提交上的所有 tag 及未合并分支。
previous_tag=''
head_commit=$(git rev-parse HEAD)
release_pattern='v[0-9]*.[0-9]*.[0-9]*'
release_tags=$(git tag --list "$release_pattern" --merged HEAD)
describe_options=(--tags --abbrev=0 --match "$release_pattern")
has_previous=false
while IFS= read -r tag; do
  if [[ -z "$tag" ]]; then continue; fi
  tag_commit=$(git rev-parse "${tag}^{commit}")
  if [[ "$tag_commit" == "$head_commit" ]]; then
    describe_options+=("--exclude=$tag")
  else
    has_previous=true
  fi
done <<< "$release_tags"
if [[ "$has_previous" == true ]]; then
  previous_tag=$(git describe "${describe_options[@]}" HEAD)
fi

if [[ -n "$previous_tag" ]]; then
  printf '## 更新日志（自 %s）\n\n' "$previous_tag"
  git log "${previous_tag}..HEAD" --format='- %s (%h)'
else
  printf '## 更新日志（首次发布，完整历史）\n\n'
  git log HEAD --format='- %s (%h)'
fi

cat <<'EOF'

## 安装方法

1. 下载此 Release 的 `vanishgeo-v<版本>.zip` 并解压。
2. 打开 `chrome://extensions/` 并启用开发者模式。
3. 点击“加载已解压的扩展程序”，选择解压后直接包含 `manifest.json` 的目录。

功能、权限、隐私与人工浏览器验收边界见仓库 README、PERMISSIONS、PRIVACY 和 RELEASE 文档。
EOF
