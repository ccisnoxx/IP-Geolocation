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

以上条目为提交历史，包含已被后续变更替代的中间状态。当前版本通过 userScripts 提供语言／时区和合成定位，使用 declarativeNetRequestWithHostAccess 同步 Accept-Language，并提供固定名单字体过滤；VG-033／VG-034进一步限定同步页面及已同步链内各realm自身新建的Blob Dedicated Worker语言／时区，classic和module按相同最小快照继承；具体启用条件和限制见下文。

## 安装方法

1. 使用 Chrome 138 或更高版本，下载此 Release 的 `vanishgeo-v<版本>.zip` 并解压。
2. 打开 `chrome://extensions/` 并启用开发者模式。
3. 点击“加载已解压的扩展程序”，选择解压后直接包含 `manifest.json` 的目录。
4. 在 VanishGeo 的“详情”页正常开启 **Allow User Scripts（允许用户脚本）**，打开 Popup 或 Options，点击“重试同步”。
5. 全新安装默认关闭保护且没有预配置站点。在 Options 中配置所需站点和信号；推荐流程需主动检测并确认出口档案，再明确应用，查看推荐本身不会开启保护。
6. 等待保存／同步成功，分别确认语言／时区、定位和字体的注册状态；完整重载或关闭重开已有目标页面，使配置在新文档生效。

## 可靠关闭与已知限制

- 先关闭**插件总开关**并保存，等待同步成功，再完整重载或关闭重开已有目标页面，让页面语言与 Accept-Language 一起恢复原生；之后才按需关闭 Allow User Scripts。
- Chrome 的 Allow User Scripts 开关与请求头规则独立。直接关闭该开关仍可能让首请求携带旧语言头；不承诺跨 API 原子同步。
- 配置按每文档快照生效，旧文档与 BFCache 可能保留旧值；没有热更新或自动刷新。HTTP(S) Dedicated Worker、SharedWorker、自定义字体与非普通 HTTP(S) 文档继续暂停／不支持；外来Blob和未接管父级的后代不在覆盖范围。
- Blob Worker仅接管安装后本realm自身创建的Blob，CSP必须允许入口、依赖和源核验；源无法核验时明确警告“本次语言/时区未同步”并保持原生，禁止脚本时可能Worker报错。Blob地址可观察变化；旧Worker需随文档完整重建。
- VG-035同源HTTP module包装实验确认入口CSP与全局相对路径不等价，继续暂停，不作为恢复资格。VG-036在Chrome138.0.7204.183／macOS arm64通过现有Blob及嵌套Blob的首读、四种父子组合、撤销终止、CSP拒绝和关闭reload定向补验。
- 合成定位仍受安全上下文、origin 和 Permissions Policy 等条件限制，不等同原生传感器或所有权限语义；WebRTC 策略状态也不是所有网络路径的防泄漏证明。
- Chrome 138 的真实验收覆盖 138.0.7204.183 / macOS arm64 的已记录场景；不代表其他平台、全部补丁版本、HTTPS 最早脚本／自动恢复、全部升级和故障组合均已验证。首轮恢复异常与历史附件缺口仍保留。

功能、权限、隐私与人工浏览器验收边界见仓库 README、INSTALL、PERMISSIONS、PRIVACY、RELEASE 及 docs/stabilization/evidence-index.md；Chrome 138 的详细覆盖与异常记录见 docs/stabilization/chrome138/README.md；Blob增量见 .trellis/tasks/10-23-vg-036-chrome138-blob-worker/implement.md，HTTP包装暂停依据见 docs/stabilization/http-module-worker-feasibility.md。
EOF
