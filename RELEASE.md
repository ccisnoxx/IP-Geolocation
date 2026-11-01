# 发布指南

从仓库到 GitHub Release 的完整流程。安装与使用见 [INSTALL.md](INSTALL.md)。

## 0. 前置：仓库名与品牌

产品名统一为 **VanishGeo**（`manifest.json`、`package.json`、界面、文档都是这个名字）。
本文档里的 GitHub 链接按 `ccisnoxx/VanishGeo` 写。remote 与文档不一致时先对齐：

```bash
git remote set-url origin https://github.com/ccisnoxx/VanishGeo.git
```

否则文档里的 Releases / Actions 链接会 404。

### 作者信息

`package.json` 的 `author` / `repository` / `homepage` / `bugs` 都指向个人仓
`ccisnoxx/VanishGeo`，README 的安装命令也按这个地址写。

GitHub 侧栏的 **Contributors** 从提交作者生成，所以它会同时列出 `ccisnoxx` 与
上游原作者 `XiNian-dada`（历史里有 49 个提交属于后者）。要让它只显示一个人，
就得改写全部历史 —— 这会让所有 commit SHA 变化，已发布的 tag 与 Release 指向的
提交将不再存在于新历史里，因此**这是一次不可逆的操作**：

```bash
# 先备份（整仓 + 所有 ref），再在副本上操作
git clone --mirror https://github.com/ccisnoxx/VanishGeo.git vanishgeo.git
pip install git-filter-repo
cd vanishgeo.git
git filter-repo \
  --mailmap <(printf 'ccisnoxx <50921099+ccisnoxx@users.noreply.github.com> XiNian-dada <yszan968@gmail.com>\n') \
  --force
git push --force --all && git push --force --tags
```

改写后要顺手核对三件事：tag 是否重新打好（`git tag -l`）、GitHub Releases 是否
还挂着（必要时按第 5 节重发）、CI 徽章里的提交链接是否仍然可达。

**不要动** [NOTICE](NOTICE) 与 [LICENSE](LICENSE)：MIT 要求保留上游署名，
"作者列表里只有一个名字"和"保留许可署名"是两件事，前者可改、后者不能。

## 1. CI：每个提交都跑

Node 版本：CI 矩阵跑 **22 / 24**（`package.json` 的 `engines` 下限是 22）。Node 20
跑不动这套用例 —— `navigator`、`MessageChannel` 等全局在 20 里缺失，有 4 条"还原 /
重新注入"用例会直接 `ReferenceError`，所以不要把 `node-version` 调回 20。

`.github/workflows/ci.yml`，触发条件为所有分支的 push 与 PR，权限 `contents: read`：

| 步骤 | 命令 | 失败含义 |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | 类型不干净，不会进包 |
| Lint | `npm run lint` | 静态规则 / 未使用变量回归 |
| Unit tests | `npm test` | 行为回归 |
| Build | `npm run build` | 构建失败 |
| Verify output | `test -f dist/...` | 产物缺文件 / manifest 不是 V3 |

### 合并 PR 不等 CI

CI 跑的内容与本地 `npm run verify` 基本重复，等它全绿只是耗时。合并 PR 按下面的方式：

1. 本地 `npm run verify` 通过（它会先重建 `dist/`，避免测试读到别的分支的产物）；
   改到注入层、桥或权限时，再跑一次相关的 `npm run smoke:*`。
2. 推送后直接合并（普通合并，保留 merge commit），不轮询 CI；解决冲突产生的合并提交同样如此。
3. CI 照常在后台跑，只有失败时才回头处理。

发版不在此列：推 tag 前仍按第 3、4 节走完本地门禁，Release 流水线自带的检查也照常生效。

## 2. 发版：推 tag 即发布

`.github/workflows/release.yml`，触发条件为 `v*.*.*` tag。

显式声明了：

```yaml
permissions:
  contents: write      # 创建 Release + 上传产物所必需；默认的只读 token 会 403
```

流程：

1. `npm ci` → **typecheck** → **lint** → `npm run build` → **单测** →
   `test:coverage:core` → `test:coverage:security`
   （构建在单测之前：有几条接线用例要读 `dist/injected/runtime.js`；
   安全模块的分支门禁与核心门禁分开，见 §4 清单与 §6 命令表）
2. 从 tag 提取版本号，**校验与 `dist/manifest.json` 的 `version` 一致**（不一致直接失败）
3. 打包成 `vanishgeo-v<version>.zip`（**开发构建**：配置经异步 IPC 进页面，
   页面的第一个内联脚本可能读到原生值 —— 也就是"首屏窗口"）
4. **清空 `release/`** 后再跑 `npm run release -- --all-presets`，产出每个 preset
   一份**烘焙**包 `vanishgeo-<version>-<preset>.zip`（配置编译进 `runtime.js`，
   `document_start` 同步生效，首屏零窗口），逐个用 `--check` 校验。
   清空这一步不是洁癖：`release/` 在 `.gitignore` 里，本地重跑会留着上一版的 zip，
   而上传用的是 `release/*.zip` 通配 —— 不清理就可能把 2.4.1 的资产挂进 2.4.2 的 Release
5. **每个包真开一次浏览器**（`npm run smoke:release -- --dir=release --require=<preset 数>`）。
   `--require` 的数量由 `DEFAULT_PROFILES` 现算，不写死：preset 增删时写死的那一端
   会变成"少验一个包也算通过"。这一步必须挡在创建 Release **之前** —— 单测只能证明
   "参数被算出来了"，证明不了"页面第一个内联脚本读到的就是它"
6. 用 `node scripts/release-notes.mjs` 生成 Release 正文（变更日志取自 `CHANGELOG.md`
   的 `## <version>` 小节 —— 发版前先在那个文件里补一节，没有就会退回占位文案）
7. 创建 Release 并上传全部 zip；同时把 `dist/` 作为 Actions artifact 保留 30 天

Release 正文**不是手写的**。域名条数来自 `src/shared/default-domains.json`，包清单来自
`release/*.json` 里的真实产物体检（标签、时区、语言、`Accept-Language`、域名覆盖、
静态规则条数），安全承诺固定成"后台权限已分权 + MAIN 桥 P1 已修复（依赖时序的同步握手，
附剩余边界）"的表述。任何一处
对不上（旧版本包混进来、summary 少了 zip、包里的域名和默认清单分叉）都直接失败，
而不是发一段描述着不存在资产的文案。守卫用例：`tests/release-notes.test.ts`、
`tests/changelog.test.ts`。

**变更日志为什么不再从 git 历史现算**：v2.4.2 第一次发版时正文的日志写成了
「VanishGeo 首个发布」—— workflow 里现算 `git log 上一个 tag..HEAD`，而
`actions/checkout` 默认 shallow，上一个 tag 不在本地，fallback 就顶上了。正文看着
正常、内容完全是假的，比崩掉更难发现。现在这条线只有一个来源：仓库里的
`CHANGELOG.md`。

这些 zip 之间不是重复：开发构建是"装一次就跟着你走"的通用包（选项页改动实时生效），
烘焙包是"这条机器就长这样"的定制品。用户要哪个取决于他会不会在第一帧被看穿。

烘焙包默认保留运行时桥：排除站点、关总开关、改语言仍会实时生效（注入层逐项还原）。
只有 `--no-bridge` / `--frozen` 才把规则彻底冻结进包；这种包的后台也读烘焙配置，
保存配置不会改 DNR / 权限，改配置必须重新构建。

> 版本号只有一个来源：`manifest.json`（`package.json` 跟着同步）。tag 只是触发器，
> 对不上就红，不会发出一个版本号自相矛盾的包。

## 3. 发一个版本的完整步骤

```bash
# 1) 本地先跑一遍与 CI 相同的检查
npm run typecheck
npm run lint
npm run build          # 必须在 npm test 之前：有些接线用例要读 dist/
rm -rf release && node scripts/release.mjs --all-presets --out=release
npm test
npm run test:coverage:core
npm run test:coverage:security
# 每个包各开一次真浏览器：--require 的数量跟着 DEFAULT_PROFILES 走
npm run smoke:release -- --dir=release --require="$(node -e "import('./scripts/lib/presets.mjs').then(m => console.log(m.readPresets(process.cwd()).length))")"
npm run smoke:ipfollow                               # 跟随出口 IP：不换网络，桩改一次算换一次出口

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

- **Major**：不兼容的配置结构变化 —— 新代码读不了老配置，或老代码读新配置会出错
- **Minor**：新能力，向后兼容；`schemaVersion` 提升但**能自动迁移**的也算这一类
  （v5 就是：读存量配置时补 7 个检测站与 `us-west` 预设，老配置不需要手动处理）
- **Patch**：修复

判据是"用户要不要动手"：读出来就能用 = minor；要用户重新填一遍 = major。

## 4. 发布前检查清单

**先跑一条命令**，它把下面打 ✅ 的项按顺序串起来，任一红就停、退出码非 0：

```bash
npm run preflight                    # 21 个阶段，约 15 分钟（含三引擎审计）
npm run preflight -- --skip=audit    # 赶时间跳审计（约 5 分钟），但别在正式发版时跳
```

剩下的 ✅ 之外的项仍然要人做 —— 它们是"看一眼对不对"，不是"跑一遍过不过"。

- [x] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 全绿（`preflight: verify`）
- [ ] `manifest.json` 与 `package.json` 版本号一致，且等于要打的 tag（`preflight: version` 查前一半，tag 自己打）
- [x] `dist/` 里没有残留的开发产物（`persona.config.json`、`*.map`）（`preflight: version`）
- [x] `npm run release -- --all-presets` 出得了包（三个），`npm run verify:release -- --zip=…`
      真开浏览器量首屏（时区 / 语言 / `Date` 偏移四项）全过（`preflight: package` + `release-smoke`）
- [x] `npm run smoke:presets` 三个预设逐个在真浏览器里跑一遍（语言头 / 时区 / 界面卡片）
- [x] `npm run smoke:options` 选项页写入路径（含「跟随出口 IP」开关落库）
- [x] `npm run audit` 三引擎（Chrome / Chrome 119 / Helium）41 组全绿（`preflight: audit`） —— 夜跑只跑
      Chrome + Chrome 119，Helium 只能在本地过一遍。2.4.0 发版前这一步逮到两条真红
      （`定位失败可见性` 全引擎崩、`popup 交互` 在 Helium 上假红），都是面板重做后
      测试没跟上，光跑单测和离线冒烟发现不了
- [ ] 仓库里没有真实 IP、个人路径、浏览器 profile（`tools/out/profiles/` 已被 gitignore）
- [ ] README / INSTALL / CONFIG_GUIDE 的描述与当前行为一致（匹配模型、默认值、生效方式）
- [ ] 若 `CONFIG_SCHEMA_VERSION` 变过：确认升级用户读一次配置就补上新内置项
      （`npx tsx --test tests/config-migration.test.ts` 覆盖回填、幂等、不复活删除项）
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
node scripts/release.mjs --all-presets  # 全部内置 preset 全量构建
for z in release/*.zip; do node scripts/release.mjs --check="$z"; done  # 逐个校验
node scripts/release-notes.mjs --version=2.4.2 --release-dir=release --out=release-notes.md
                         # 从产物生成 Release 正文（先自己在本地看一眼再打 tag）
npm run verify:release   # 真开浏览器量首屏，证明零窗口成立
npm run test:coverage:security  # 安全模块分支门禁（改过 message-policy / disguise / patch-needs 时必跑）
npm run audit            # 静态检查 + 三引擎 E2E（Chrome 155 / 119 / Helium）
# GitHub Actions nightly 每天自动安装 Chrome 119 并跑可自动化的浏览器矩阵
npm run smoke:options    # 选项页写入路径的端到端冒烟
npm run smoke:failclosed # fail-closed 行为
npm run smoke:fingerprint# 主线程 / iframe / Worker 跨上下文一致性
npm run smoke:ipchange   # 出口变化后是否跟随
npm run smoke:presets    # 三个 preset 的浏览器 E2E
npm run smoke:cold-start # 冷启动 + clear
npm run smoke:popup      # popup 交互
npm run smoke:real-site  # 真实站点核对
```

`npm run audit` 里任何一项失败都会以非零退出码结束，适合放在发布前的最后一道闸。

## 7. 1.3.1 → 2.2.0：schema 4 → 5 的迁移说明

2.2.0 是 **minor**：`CONFIG_SCHEMA_VERSION` 从 4 抬到 5，但迁移在读取时自动完成，
用户不需要做任何操作（判据见上面「版本号规则」）。

**自动补什么**

| 补的内容 | 细节 |
| --- | --- |
| 7 个隐私检测站 | `browserleaks.com`、`ipleak.net`、`browserscan.net`、`deviceinfo.me`、`whoer.net`、`ipinfo.io`、`iprisk.top`，**追加在原有 13 条之后**，原顺序不变 |
| `us-west` 预设 | `United States (West)`：`34.0522, -118.2437`、`America/Los_Angeles`、`en-US` / `en` / `en-US,en;q=0.9` |

**怎么补的（`src/shared/config-model.ts`）**

- 唯一入口是 `migrateStoredConfig`：`storedSchemaVersion()` 低于 5 才调
  `backfillV5Rules` / `backfillV5Profiles`，所以**读多少次结果都一样**（幂等）。
- 只补"内置项"这一层：用户删过的站点不会被复活 —— 判断依据是"当前配置里没有这一条且
  版本低于 5"，补进去的 id 固定为 `v5-<domain>`（不是随机 id），保证同一份存量配置读
  两次得到的字节完全相同。
- 已有 20 条站点、6 个预设的配置什么都不会发生。

**不会自动做的事**

- 「跟随出口 IP」默认**关闭**：升级不会动用户的时区与坐标。打开之后才是覆盖语义 ——
  `timezone.timezone`、经纬度、`geolocation.country` 会被出口那边的值改写，关掉开关
  也不恢复原值（想留自己的值就先关再填）。
- 不会把用户的时区/坐标从 `manual` 改成 `auto`，除非用户自己打开跟随开关。

**从 2.1.x 升级（旧 2.x 线 → 本线）**

2.1.x 与本线是**两套并行实现**，但两边都用 `schemaVersion: 5`，所以升级时不会触发任何迁移，
设置原样读进来（`globalProfile` 的语言/时区/坐标、`webRtc`、`profile`、`rules` 全部保留），
`canvas` / `ipSync` 补默认值。实测过一份 2.1.1 形状的配置。

**会静默消失的字段**（本线的模型里没有对应的位置，`normalizeConfig` 只保留自己认识的键）：

| 旧字段 | 内容 | 影响 |
| --- | --- | --- |
| `exitLocationProfiles` | 用户自己存的出口位置档案（含已验证的 `publicIp` 与坐标） | 档案没了，但当前生效的时区/坐标在 `globalProfile` 里，所以**行为不变** |
| `intlMode` | 语言加载时机的模式开关 | 本线用规则里的 `overrides` 表达，语义上被取代 |

升级前想留住档案里的坐标，先在旧版里抄下来，升级后在配置页手填。
旧版本仍可回退：`legacy/2.1.1` 分支与 v2.1.0 tag 都还在。

**回滚注意**

1.3.1 不认识 `ipSync` 字段与 schema 5 的内置清单，把 v5 配置喂回去不会有迁移报错，但
新补的 7 个站点与 `us-west` 预设会消失、"跟随出口 IP" 的设置被忽略。回滚前先
配置页导出一次 JSON 备份。

**验证**

```bash
npx tsx --test tests/config-migration.test.ts   # 回填、幂等、不复活删除项、同对象两次读签名一致
npx tsx --test tests/presets.test.ts            # 预设解析与源文件严格一致
```

## 8. 2.4.1 → 2.4.2：为什么必须换版本号

公开的 `v2.4.1` Release 是**旧代码**：tag 指向 `9b78968`，而 `main` 上后续的修复
（后台消息来源分权、opaque frame 证据、函数伪装形状、发布校验去恒真）都在这之后。
于是同一个 `2.4.1` 底下存在两套实际不同的代码：

- 从 Release 下载的 zip：修复前
- 从 `main` 自己构建：修复后

用户报问题时光看版本号分不清是那一套。所以这一版把版本抬到 **2.4.2** 并重新出资产，
而不是让两套代码继续共用 `2.4.1`。想让版本号重新"一版一号"，唯一要做的事是：
`manifest.json` / `package.json` / `package-lock.json` 三处一起改，tag 打在同一提交上。

顺带把两处会分叉的东西钉住了：

- **Release 正文**：`scripts/release-notes.mjs` 从 `default-domains.json` /
  `DEFAULT_PROFILES` / `release/*.json` 生成，不再手写"13 个域名""五个预设"
- **发布包验数**：`--require` 跟着 `DEFAULT_PROFILES` 现算，不再写死 3

发布前的判据没变：真浏览器冒烟必须在**创建 Release 之前**跑完。旧的拓扑里浏览器冒烟
躺在另一条并行 CI 上，Release 可能先发出去、冒烟随后红 —— 坏资产已经挂上去了。
