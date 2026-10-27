# 发布指南

从仓库到 GitHub Release 的完整流程。安装与使用见 [INSTALL.md](INSTALL.md)。

## 0. 前置：仓库名与品牌

产品名统一为 **VanishGeo**（`manifest.json`、`package.json`、界面、文档都是这个名字）。
本文档里的 GitHub 链接按 `XiNian-dada/VanishGeo` 写。

如果仓库还没改名，先把 GitHub 仓库改成 `VanishGeo` 并同步 local remote：

```bash
git remote set-url origin https://github.com/XiNian-dada/VanishGeo.git
```

否则文档里的 Releases / Actions 链接会 404。

## 1. CI：每个提交都跑

`.github/workflows/ci.yml`，触发条件为所有分支的 push 与 PR，权限 `contents: read`：

| 步骤 | 命令 | 失败含义 |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | 类型不干净，不会进包 |
| Unit tests | `npm test` | 行为回归 |
| Build | `npm run build` | 构建失败 |
| Verify output | `test -f dist/...` | 产物缺文件 / manifest 不是 V3 |

## 2. 发版：推 tag 即发布

`.github/workflows/release.yml`，触发条件为 `v*.*.*` tag。

显式声明了：

```yaml
permissions:
  contents: write      # 创建 Release + 上传产物所必需；默认的只读 token 会 403
```

流程：

1. `npm ci` → **typecheck** → **单测** → `npm run build`
2. 从 tag 提取版本号，**校验与 `dist/manifest.json` 的 `version` 一致**（不一致直接失败）
3. 打包成 `vanishgeo-v<version>.zip`（**开发构建**：配置经异步 IPC 进页面，
   页面的第一个内联脚本可能读到原生值 —— 也就是"首屏窗口"）
4. 再跑一遍发布流水线 `npm run release -- --all-presets`，产出五个**烘焙**包
   `vanishgeo-<version>-<preset>.zip`（配置编译进 `runtime.js`，`document_start`
   同步生效，首屏零窗口），逐个用 `--check` 校验
5. 生成 changelog（上一个 tag..HEAD 的提交标题）
6. 创建 Release 并上传全部 zip；同时把 `dist/` 作为 Actions artifact 保留 30 天

三个 zip 之间不是重复：开发构建是"装一次就跟着你走"的通用包（选项页改动实时生效），
烘焙包是"这条机器就长这样"的定制品。用户要哪个取决于他会不会在第一帧被看穿。

> 版本号只有一个来源：`manifest.json`（`package.json` 跟着同步）。tag 只是触发器，
> 对不上就红，不会发出一个版本号自相矛盾的包。

## 3. 发一个版本的完整步骤

```bash
# 1) 本地先跑一遍与 CI 相同的检查
npm run typecheck
npm test
npm run build

# 2) 同步版本号（manifest.json 与 package.json 必须一致）
#    例如 1.1.0 -> 1.1.1

# 3) 提交并推送
git add -A
git commit -m "release: v1.1.1"
git push origin main

# 4) 打 tag 并推送（这一步才会触发发布）
git tag v1.1.1
git push origin v1.1.1
```

版本号规则（语义化版本）：

- **Major**：不兼容的配置结构变化（例如 `schemaVersion` 提升）
- **Minor**：新能力，向后兼容
- **Patch**：修复

## 4. 发布前检查清单

- [ ] `npm run typecheck` / `npm test` / `npm run build` 全绿
- [ ] `manifest.json` 与 `package.json` 版本号一致，且等于要打的 tag
- [ ] `dist/` 里没有残留的开发产物（`persona.config.json`、`*.map`）
- [ ] `npm run release -- --all-presets` 出得了包，`npm run verify:release -- --zip=…`
      真开浏览器量首屏（时区 / 语言 / `Date` 偏移四项）全过
- [ ] 仓库里没有真实 IP、个人路径、浏览器 profile（`tools/out/profiles/` 已被 gitignore）
- [ ] README / INSTALL / CONFIG_GUIDE 的描述与当前行为一致（匹配模型、默认值、生效方式）
- [ ] 在真实站点上手动验一遍：时区、语言、`Accept-Language`、WebRTC

## 5. 回溯与修复

```bash
# 删除本地/远程 tag 后重打（tag 已触发过发布会留下一条记录，需要手动清理 Release）
git tag -d v1.1.1
git push origin :refs/tags/v1.1.1

# 修改已发布的 Release 内容：GitHub → Releases → Edit
# 删除 Release：GitHub → Releases → Delete，再删 tag
```

## 6. 相关命令

```bash
npm run release          # 烘焙 → 校验 → 打包 → 记账，见 CONFIG_GUIDE §十
npm run verify:release   # 真开浏览器量首屏，证明零窗口成立
npm run audit            # 静态检查 + 双引擎 E2E，输出通过率表格
npm run smoke:options    # 选项页写入路径的端到端冒烟
npm run smoke:failclosed # fail-closed 行为
npm run smoke:fingerprint# 主线程 / iframe / Worker 跨上下文一致性
npm run smoke:ipchange   # 出口变化后是否跟随
npm run smoke:real-site  # 真实站点核对
```

`npm run audit` 里任何一项失败都会以非零退出码结束，适合放在发布前的最后一道闸。