# VanishGeo / main ↔ origin/main 合并冲突分析

生成时间：2026-10-28 21:34（Asia/Shanghai）
本地 HEAD：`b757d8b` docs(tools): 探测开销测量工具，文档跟上三个新冒烟
上游：`origin/main` = `c1b7952` Merge pull request #1 from zzy-life/feat/auto-ip-sync
公共祖先：`028c59f`（initial clone，"Merge pull request #0 …" 之前那个仓库起点）

---

## 决策（2026-10-29）：不合并上游，本地线独立演进

**结论：不 merge `origin/main`，也不 rebase 到它。本地 `main` 是唯一演进线。**

依据：

1. 上游那 18 个提交里「合并会丢」的三件事，已经按新架构在本地重写完成 —— US-West 预设（第 2 步）、7 个检测站默认白名单 + `schemaVersion 5` 增量回填（第 3 步）、出口 IP 同步 opt-in（第 4 步）。上游同名功能的实现进不来，也不需要进来。
2. 上游剩下的修复在新架构里都有等价物，逐条对照过（见下表），没有「只有上游有、本地缺」的能力缺口。
3. 两边的模块划分已经分叉：本地是 `src/shared/config-model.ts` + 大一统 `src/background/services.ts`，上游是 `src/shared/types.ts` 系 + `dnr.ts`/`ip-sync.ts`/`webrtc.ts`。`src/background/ip-sync.ts` 在两边同名却不同实现，靠 merge 合并只会产生两份同时运行的同步器。

### 分支布局（2026-10-29 收口后）

`gh` 上这个仓库现在只有两条活线，另有一个只读比对源：

| ref | 指向 | 说明 |
| --- | --- | --- |
| `main`（默认） | `ae23cd7` / tag `v2.2.0` | **唯一演进线**。2.2.0 的六个烘焙包 + 开发包都从它构建 |
| `legacy/2.1.1` | `e0536a2`（原 `main`，92 个提交） | 旧 2.x 架构线的存档，只读。它与 `main` 的 `merge-base` 是 `5b61905 chore(release): 1.3.1`，之后是两套并行实现，**不要试图合并** |
| `origin/main` | `c1b7952` | 上游，只读比对源，长期 `behind` 属预期 |

曾经存在过的 `rewrite/1.4` / `rewrite/2.2` 已删除：内容与 `main` 同一个提交，`v2.2.0` tag 仍然指向它，需要时 `git branch whatever v2.2.0` 就能取回。

### 代价与约束

- 上游以后的新修复**不会自动到达**。要吸收时按「读上游 diff → 在本地等价模块重写 → 补测试」手动移植，**不要 cherry-pick**：那些路径在本地已经不存在或语义不同。
- `scripts/merge-upstream.sh` 只作为参考保留，不再执行（脚本里那套「全取本地 + 删 7 个旧模块」的决策仍是一份可查的记录）。
- `origin/main` 从此只作只读比对源；`git status` 会长期显示 `behind 18`，这是预期状态，不是待办。

### 上游修复 ↔ 本地等价实现

| 上游提交 | 上游修什么 | 本地等价位置 |
| --- | --- | --- |
| `b6385b7` | DNR 用 `requestDomains` 匹配子域 | `src/background/dnr.ts`、`src/background/services.ts` |
| `a83162a` | `Intl` 各 formatter 的 `resolvedOptions` 泄露 | `src/injected/signal-spoof.ts`（`resolvedOptions`） |
| `abb2882` / `4a5eafb` | language getter 伪装成 native | `src/injected/define.ts`、`signal-spoof.ts`（`getOwnPropertyDescriptor`） |
| `1efb8c7` | 注入竞态（上游用 `sessionStorage` 预缓存） | `src/injected/runtime.ts:543` 端口 + 构建期 nonce 握手（本地方案不用 `sessionStorage`） |
| `40a0bfd` | Geolocation 挂原型 + `Permissions` mock | `src/injected/geolocation.ts:272`、`src/background/services.ts`（permissions） |
| `fae83d8` | 真实本地化时区名 | `src/injected/signal-spoof.ts:130,224`（`timeZoneName: 'long'`）、`worker-patch.ts:156` |
| `b612426` | 通配域名匹配误判 | `src/shared/config-resolver.ts:106` `domainMatches`（后缀匹配 + 测试） |
| `3276c4a` | `noEmit` / `all_frames` | `tsconfig.json` 的 `noEmit: true`（本次补）、`src/background/services.ts:335,350` 的 `allFrames` |


---

## 0. 结论先说

1. **这不是几行的小冲突，是两条互不相交的演进线**。本地 24 个提交把注入层与配置模型整体重写（`refactor: 重写注入层与配置模型` → schema v4），上游 18 个提交（含刚合进来的 PR #1 `feat/auto-ip-sync`）改的正是被重写掉的那批文件。于是 git 只能报 **21 个冲突路径 = 14 个内容冲突 + 7 个 modify/delete**，合计 48 个冲突块。
2. 上游 18 个提交里 **14 个已被新架构覆盖**（下面逐条给了证据行号），真正会丢掉的东西只有 3 件：
   - **自动出口 IP 同步**（`f57ac0b` + `96b280a` + `0df0033`，即 PR #1 的主体）；
   - **隐私检测站默认白名单**（`1a45137` 的 7 个域名）；
   - **US-West（洛杉矶）预设**（同一个提交）。
3. **已实测**：按"全取本地 + 删掉 7 个旧模块 + 暂不移植 ip-sync"解决后，`tsc --noEmit` 干净、`vite build` 通过、`tsx --test tests/*.test.ts` **343/343 通过**。也就是说机械冲突可以一次收干净，剩下的只是 3 件功能取舍。
4. **`mine/main` 不能拿来 merge**：与 HEAD 无公共祖先（`git merge-base` 为空），普通 merge 会直接 `refusing to merge unrelated histories`。

---

## 1. 分支现状（实测）

| 引用 | commit | 时间 | 与 HEAD 关系 |
| --- | --- | --- | --- |
| `main` | `b757d8b` | 2026-10-28 14:30 | 本地主开发线，**ahead 24** |
| `origin/main` | `c1b7952` | 2026-10-25 15:05 | **behind 18**，含 PR #1 auto-ip-sync |
| `fork/main` | `c1b7952` | 同上 | 与 origin/main 同点 |
| `mine/main` | `7eb8ff0` | 2026-10-28 15:26 | **无关历史**，merge-base 为空 |
| `mine/codex/local-updates-20261028` | `40c33a4` | — | 与 mine/main 同一条线 |
| `mine/release/1.3.1` | `5b61905` | — | 已是 HEAD 的祖先 |

工作区当前**干净**，没有残留的 merge 状态、没有未跟踪的冲突标记文件。

---

## 2. 冲突清单（`git merge-tree` 干跑 + 临时 worktree 实跑，均未落回主工作区）

### 2.1 内容冲突（14 个文件，48 个冲突块）

| 文件 | 冲突块 | 建议 | 原因 |
| --- | --- | --- | --- |
| `README.md` | 20 | 取本地 | 本地是新写的 27 KB 文档；上游那版是 v1.1.2 的重写，内容已被超越 |
| `src/injected/geolocation.ts` | 6 | 取本地 | 上游把改 `Geolocation` 改成原型安装；本地已经是原型安装 + deny 语义 |
| `src/popup/popup.ts` | 5 | 取本地 | 上游加 `autoIPSync` 开关与 IP 定位分支；本地 popup 已按 `SiteSpoofConfig` 重写 |
| `src/background/service-worker.ts` | 3 | 取本地 | 上游挂 `checkExitIP`/`ensureIPCheckAlarm`；本地拆成 `services` + `message-router` |
| `src/content/content.ts` | 2 | 取本地 | 上游是 `window.postMessage` + sessionStorage 预缓存；本地是 port + 构建期 nonce |
| `src/options/options.ts` | 2 | 取本地 | 同上，配置字段与 UI 全换 |
| `manifest.json` | 2 | 取本地 | 上游是静态 `content_scripts`（MAIN world + web_accessible_resources）；本地改成运行时 `chrome.scripting.registerContentScripts`（`src/background/services.ts:422,437` 带 `allFrames: true`） |
| `src/background/dnr.ts` | 1 | 取本地 | 上游用 `urlFilter`/`regexFilter` 修子域；本地 `src/background/dnr.ts:81-83` 已用 `requestDomains`，并写了 Helium/Chromium 156 上 `regexFilter` + modifyHeaders 会 `ERR_ABORTED` 的实测注释 |
| `src/shared/defaults.ts` | 1 | 取本地 | 本地改成从 `config-model` re-export |
| `src/shared/storage.ts` | 1 | 取本地 | 存储键 `bpg_config` → `SITE_CONFIG_KEY`，走 `migrateLegacyConfig` |
| `src/shared/types.ts` | 1 | 取本地 | `PrivacyConfig`（平铺）→ `SiteSpoofConfig`（`globalProfile` + `rules` + `schemaVersion`） |
| `package.json` | 1 | 取本地 | 版本 1.3.1 vs 1.1.4；脚本体系不同（`tsx --test tests/*.test.ts` vs `node --test`） |
| `package-lock.json` | 2 | 取本地 | 依赖树不同，冲突无意义 |
| `.gitignore` | 1 | 取本地（可并集） | 上游只加了少量产物条目，本地已有等价规则 |

**注意**：`src/options/options.html`、`src/popup/popup.html` 属于**自动合并成功但语义有问题**的一类，git 不报冲突，见 §4.2。

### 2.2 modify/delete（7 个，本地删除、上游修改）

| 文件 | 上游改动量 | 本地对应物 |
| --- | --- | --- |
| `src/injected/injected.ts` | +212/-117（nonce 握手）/ 4 行（Intl） | `content/content-bridge.ts` + `injected/runtime.ts` |
| `src/injected/timezone.ts` | +191/-232 | `injected/signal-spoof.ts` + `shared/config-resolver.ts` |
| `src/injected/language.ts` | +62/-134、+51 | `injected/signal-spoof.ts` + `injected/disguise.ts` |
| `src/injected/permissions.ts` | +56/-31 | 并入 `injected/geolocation.ts` |
| `src/injected/anti-detection.ts` | +6/-3 | 并入 `injected/runtime.ts` |
| `src/injected/utils.ts` | +21/-8 | 并入 `injected/define.ts` / `disguise.ts` |
| `src/shared/domain-matcher.ts` | +14/-8 | `shared/config-resolver.ts`（`domainMatches`） |

处理方式统一为 `git rm`（保留删除），否则会把旧模块连同旧类型一起拖回树里，直接编译不过。

---

## 3. 为什么会冲突成这个规模

- **目录层被拆了**：旧的 `injected/{injected,anti-detection,language,timezone,permissions,utils}.ts` 六个文件 → 新架构 `injected/{runtime,define,disguise,signal-spoof,canvas-patch,canvas-state,font-mask,local-fonts,worker-patch,baked-resolver,geolocation}.ts`。上下游两边动的是同一片解剖结构，git 无法按行对齐。
- **配置模型换了 species**：
  - 上游：`PrivacyConfig`，平铺 `geolocation/language/timezone/canvas`，存储键 `bpg_config`，版本 1.1.4；
  - 本地：`SiteSpoofConfig`，`schemaVersion: 4`（`src/shared/config-model.ts:412`）+ `globalProfile` + `rules[]` + `masterEnabled`，存储键 `SITE_CONFIG_KEY`，带 `LEGACY_VANISHME_CONFIG_KEY` 迁移（`src/shared/storage.ts:12-22`）。
  - 连字段语义都变了：`TimezoneConfig` 里 `offsetMinutes` 已删除，只剩 `timezone` + `mode: auto|manual`。
- **注入时机换了机制**：静态 `content_scripts`（manifest）→ 运行时注册；`window.postMessage` → port + nonce。

---

## 4. 语义冲突（git 不报，但合并后会坏）

### 4.1 `src/background/ip-sync.ts`（PR #1 主体）直接编译错误

实测 `tsc --noEmit` 原文 4 条：

```
src/background/ip-sync.ts(2,15): error TS2305: Module '"../shared/types"' has no exported member 'PrivacyConfig'.
src/background/ip-sync.ts(73,19): error TS2339: Property 'geolocation' does not exist on type 'SiteSpoofConfig'.
src/background/ip-sync.ts(78,19): error TS2339: Property 'timezone' does not exist on type 'SiteSpoofConfig'.
src/background/ip-sync.ts(83,19): error TS2339: Property 'language' does not exist on type 'SiteSpoofConfig'.
```

另外它读 `config.globalEnabled` / `config.autoIPSync`，这两个字段在 `SiteSpoofConfig` 里都不存在（对应的是 `masterEnabled`，且没有 `autoIPSync`）。要保留这个功能必须**在新模型上重写**，不能 cherry-pick。

### 4.2 自动合并进来的 UI 是"死开关"

- `src/options/options.html`、`src/popup/popup.html` 被 git 自动合并进 `#autoIPSync` 复选框与说明文字，但两边的 `.ts` 都取本地版本 → 没有任何事件监听、没有字段、没有 storage 写入。点了没反应，还会让"保存后生效"的文案变成假承诺。
- `src/popup/popup.html` 同时被自动合并进 `data-profile="us-west"` 卡片（"美西 (洛杉矶)"），但 `src/shared/config-model.ts` 的 `DEFAULT_PROFILES` 里没有 `us-west`（只有 `united-states`）→ 点这张卡会因为找不到 profile 而无效。

### 4.3 默认白名单丢了 7 个"开箱即测"站点

上游 `1a45137` 往 `defaults.ts` 加的是：`iprisk.top`、`browserscan.net`、`browserleaks.com`、`ipleak.net`、`deviceinfo.me`、`whoer.net`、`ipinfo.io`（各带 `*.` 通配，共 14 条）。
本地 `src/shared/default-domains.json` 只有 13 条常规站点（chatgpt/openai/claude/anthropic/gemini/copilot/google/bing/x/twitter/youtube/reddit/linkedin），**一个检测站都没有**。

### 4.4 新增默认项不会回填给老用户

`src/shared/config-model.ts:431,433`：

```ts
profiles: normalizeProfiles(profile.profiles).length ? normalizeProfiles(profile.profiles) : clone(DEFAULT_PROFILES),
rules: Array.isArray(input.rules) ? input.rules.map(normalizeRule) : defaultRules()
```

存量配置只要 `profiles` / `rules` 非空，就**整段以存量为准**——新加的内置预设与白名单不会出现。上游 `1a45137` 在 `storage.ts` 里做了 merge 回填（`Array.from(new Set([...stored, ...newBuiltins]))`），新架构这边**没有对等逻辑**。所以 §4.3 的补丁必须同时改 `normalizeConfig` 或 `migrateLegacyConfig`，否则只有新装用户生效。

### 4.5 上游测试不会被执行

`tests/ip-sync.test.mjs` 是 `node:test` + `.mjs`，本地 runner 是 `tsx --test tests/*.test.ts` → 文件名与扩展名都不匹配，等于死文件；且它 `import '../src/background/ip-sync.js'` 等旧路径。

### 4.6 顺带两个小问题（合并时一并处理）

- `tsconfig.json` 上游加了 `"noEmit": true`，与本地 `typecheck: tsc --noEmit` 重复但无害，可以收。
- `src/shared/config-model.ts:350` 的 `DEFAULT_CONFIG.schemaVersion` 写的是 `1`，而 `CONFIG_SCHEMA_VERSION = 4`（第 412 行）。当前被 `normalizeConfig` 覆盖掉所以看不出问题，但它是个埋着的雷。

---

## 5. 上游 18 个提交逐条判定

| 提交 | 内容 | 判定 | 本地证据 |
| --- | --- | --- | --- |
| `3276c4a` | noEmit、清编译产物、`all_frames` | **已覆盖** | 运行时注册带 `allFrames: true`（`src/background/services.ts:422,437`）；`typecheck` 已 `--noEmit` |
| `b612426` | 通配域名正则防误匹配 | **已覆盖** | `src/shared/config-resolver.ts:106-109` `host === domain \|\| host.endsWith('.' + domain)` |
| `40a0bfd` | Geolocation 上原型、Permissions 加固 | **已覆盖** | `src/injected/geolocation.ts:84,156,176` 分别改 `Geolocation` / `GeolocationCoordinates` / `GeolocationPosition` 原型 |
| `fae83d8` | 时区本地化名称、同步 DateTimeFormat | **已覆盖** | `src/injected/signal-spoof.ts:120,130,224`（`timeZoneName: 'long'` + parts 回读） |
| `abb2882` | language getter 伪装原生 | **已覆盖** | `src/injected/disguise.ts:24-50` `Function.prototype.toString` 查表，输出与原生同形签名 |
| `1efb8c7` | sessionStorage 预缓存 + nonce 握手消除竞态 | **已覆盖（换了机制）** | `src/content/content.ts:6-18` 注释 + `src/content/content-bridge.ts:188-189` port ack 带 nonce |
| `b6385b7` | DNR 用 `requestDomains` 匹配子域 | **已覆盖** | `src/background/dnr.ts:81-83`，且注释记录了 regexFilter 在 Helium 上 abort 的实测 |
| `a83162a` | Intl `resolvedOptions` 防 locale 泄漏 | **已覆盖** | `src/injected/signal-spoof.ts:90`（`NativeDateTimeFormat().resolvedOptions()`）+ `:446` 替换表；Worker 侧 `worker-patch.ts:107,372` |
| `3cad868` / `9a25f1e` / `74a2ecd` | 版本号 1.1.2/1.1.3/1.1.4 | **丢弃** | 本地已 1.3.1 |
| `3245a7e` | README 重写（v1.1.2） | **丢弃** | 本地 README 已重写且更新 |
| `1a45137` | 检测站白名单 + US-West 预设 | **需移植** | 见 §4.3 / §4.4 |
| `4a5eafb` | navigator.language 全原生、过 iprisk 检测 | **已覆盖** | `src/injected/disguise.ts` + `runtime.ts` 的 define 链 |
| `f57ac0b` / `96b280a` / `0df0033` | 出口 IP 变化自动同步（opt-in） | **需移植（重写）** | 见 §4.1；本地只有 alarm 驱动 `updateGeolocation`，无语言随 IP、无开关 |
| `c1b7952` | PR #1 合并节点 | 同上 | — |

---

## 6. 已验证的解决结果（实测，未动你的工作区）

在 `/tmp/vg-merge-probe`（`git worktree add --detach HEAD`）里实跑：

```
git merge --no-commit --no-ff origin/main
git checkout --ours -- <13 个内容冲突文件>
git rm --force src/injected/{anti-detection,injected,language,permissions,timezone,utils}.ts src/shared/domain-matcher.ts
git rm --force src/background/ip-sync.ts tests/ip-sync.test.mjs   # 暂不移植
npx tsc --noEmit          → 无输出（干净）
npx vite build            → ✓ built in 143ms
npx tsx --test tests/*.test.ts → tests 343 / pass 343 / fail 0
```

注意：只做"取本地"而不删 `ip-sync.ts`，`tsc` 会报 §4.1 那 4 条错误——**这两步必须一起做**，否则会出现"冲突解完了但项目编译不过"的假阳性。

---

## 7. 建议的落地步骤

```bash
# 0) 别 merge mine/main（无关历史，merge-base 为空）
git fetch origin

# 1) 真合并（保留合并节点，方便以后 blame 上游）
git merge --no-ff origin/main

# 2) 冲突解决：内容冲突全取本地，旧模块保持删除
git checkout --ours -- \
  .gitignore README.md manifest.json package.json package-lock.json \
  src/background/dnr.ts src/background/service-worker.ts \
  src/content/content.ts src/injected/geolocation.ts \
  src/options/options.ts src/popup/popup.ts \
  src/shared/defaults.ts src/shared/storage.ts src/shared/types.ts
git rm --force \
  src/injected/anti-detection.ts src/injected/injected.ts src/injected/language.ts \
  src/injected/permissions.ts src/injected/timezone.ts src/injected/utils.ts \
  src/shared/domain-matcher.ts \
  src/background/ip-sync.ts tests/ip-sync.test.mjs

# 3) 把自动合并进来的死 UI 一起回滚到本地版本
git checkout --ours -- src/options/options.html src/popup/popup.html   # 之后按 §7.1 决定是否重加
git checkout --ours -- tsconfig.json                                   # noEmit 可选保留

# 4) 门禁
npm run typecheck && npm test && npx vite build
git commit -m "merge: 收进 origin/main（重写线优先，旧注入层保持删除）"
```

### 7.1 三个功能单独提交（合并后另开 commit，不要塞进 merge）

1. **autoIPSync（重写版）** — 在新模型上的落点：
   - 类型：`SiteSpoofConfig` 加 `autoIPSync: boolean`，`normalizeConfig` 里 `autoIPSync: input.autoIPSync === true`，`CONFIG_SCHEMA_VERSION` 提到 5 并写迁移说明（`config-model.ts:401-412` 已有版本注释模板）。
   - 逻辑：复用 `src/background/services.ts` 的 `fetchJson` / `parseGeoApiResponse`（已有 `ipapi.co` 多端点与坐标校验），不要另引 `ipwhois.app`；写入走 `updateConfig()` 以过 `validateConfig`。
   - **产品决定点**：上游会连 `language` 一起覆盖，而本地的设计是"语言与定位解耦"（`src/shared/config-resolver.ts:305-311` 注释、`tools/smoke-ip-change.mjs` 明确断言"语言不跟着出口变"）。建议只同步 `timezone` + `geolocation`，语言留配置；否则会和 `smoke:ipchange` 的断言直接对撞。
2. **检测站白名单** — `src/shared/default-domains.json` 追加 7 个域（14 条通配），并加回填：`normalizeConfig` 里对 `rules` 做 defaultRules 增量合并（按 `domain` 去重），否则老用户看不到（§4.4）。
3. **US-West 预设** — `DEFAULT_PROFILES` 加 `{ id: 'us-west', latitude 34.0522, longitude -118.2437, America/Los_Angeles }`，同样需要预设回填；`popup.html` 的卡片再按本地渲染方式加回。

### 7.2 测试补齐

- 把 `tests/ip-sync.test.mjs` 改写成 `tests/ip-sync.test.ts`（`tsx --test` 只跑 `.ts`），断言迁到 `SiteSpoofConfig` 字段；上游 330 行用例（生命周期 + 失败路径）结构可复用。
- `npm run smoke:ipchange` 已有出口切换的端到端验证，功能落地后必须跑一遍，确认"语言不跟着变"的既有断言不被新功能打破。

---

## 8. 一句话总结

机械冲突可以按"重写线优先 + 删旧模块"一次性收干净（已验证 343 测试全绿）；**真正的取舍只有三件**：自动 IP 同步要不要、检测站白名单要不要、US-West 预设要不要。这三件都得在新模型上重写，不能 cherry-pick 上游实现。