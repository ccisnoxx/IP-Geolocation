# P2 改动代码复核（发版前）

复核对象：`git status` 里 31 个改动（22 files changed, 885 insertions, 226 deletions）——合并收口 + schema 5 迁移 + US-West 预设 + 检测站白名单 + 「跟随出口 IP」开关 + 共享 preset 解析器。

复核口径：`npx tsc --noEmit` 干净、`npx eslint src tests` 干净、`npx tsx --test tests/*.test.ts` **411 pass / 0 fail**、`vite build` 通过、真 Chrome 烘焙包 E2E 13/13。以下问题全部在绿门禁之外，靠读代码 + 单独构造输入复现。

**结论：没有会写坏用户数据或让功能整体失效的缺陷，可以按下面的顺序修完 P1 再发版。** P1 里有两条属于"静默错误输出"（解析器漏 preset、E2E 假绿），一条属于"按钮偶尔不说话"，两条属于"失败路径静默"，都不是功能主体的问题。

> **2026-10-29 更新：第 1–5 条与 6/7/8 已修并复验，改动清单见文末「修复记录」。** 剩下的 9–22 条按原样保留（其中第 10 条只需改文档）。

---

## P1 —— 发版前修

### 1. preset 解析器会把注释当代码，静默漏掉 preset
`scripts/lib/presets.mjs:46-66`（`splitEntries` / `skipString`）

扫描器只认引号和大括号，不认注释。两种输入都会让结果**变少且不报错**：

- 注释里出现 `[` `]` 配对（例如 `// 参考 [1]`）→ `if (char === ']' && depth === 0) break;` 提前收尾；
- 注释里出现撇号（例如 `// don't remove`）→ `skipString` 从撇号一路吞到下一个引号。

实测（临时改 `src/shared/config-model.ts` 加两行注释后调用 `readPresets`，随即还原）：

```
解析出 preset 数: 1 singapore      # 原本 6 个，无异常、无警告
```

模块头注释声称已修掉"静默漏 preset"，但实际只修了按行切分那一层。当前源码数组里没有注释，所以是**潜在**问题；但它一旦发生，`npm run release` 会安静少出一个包。
改法：`splitEntries` 循环顶部先判 `//` → 跳到行尾、`/*` → 跳到 `*/`（未闭合抛错），再进大括号逻辑。

### 2. `smoke-presets.mjs` 拆掉了第 1 条的报警器
`tools/smoke-presets.mjs:33`：`if (!presets.length) throw`

原来写死 `!== 5` 会在数量不符时报错；改成"至少有一个"之后，配合第 1 条，E2E 会打印 **"1/1 通过"** 这种完美绿。改法：用第二信源交叉核对，比如数 `src/popup/popup.html` 里的 `data-profile="` 出现次数（`tests/presets.test.ts` 已把卡片与 `DEFAULT_PROFILES` 钉死），两者不等即抛错。

### 3. 单飞吞掉 `force`：点「立即同步一次」偶尔什么也没发生
`src/background/ip-sync.ts:271-273` → `src/background/ip-sync.ts:188` → `src/options/options.ts:490`

`runExitIpSync` 只要有在飞的 run 就直接 `return inFlight`，而 `force` 是 `execute` 内部读的，第二趟的 `force: true` 被丢弃。触发条件很现实：打开开关保存时 `services.ts:1141` 的 `void checkExitIp()` 或 alarm 已经发起一轮（单次查询最多 3 × 5s），用户紧接着点按钮 → 拿回上一轮的 `skipped: 'same-ip'` → 界面弹「出口 IP 没变，这次跳过」，看起来像按钮坏了。

改法：
```ts
if (inFlight) {
  return deps.force ? inFlight.then(() => execute(deps), () => execute(deps)) : inFlight;
}
```

### 4. 「立即同步一次」失败时无提示 + unhandled rejection
`src/options/options.ts:521-538`（只有 `finally`）、`src/shared/runtime-message.ts:12`（`status === 'error'` 即 reject）、`src/background/message-router.ts` 的 `respond` 没有 try/catch

后台任何一个环节抛错（`checkExitIp` 之后的两次 `getSiteConfig`/`getExitIpSyncState`、扩展重载后的失效上下文），前端只看到按钮恢复，连 "同步失败" 都没有。同文件 `exportBakeSnapshot`（`options.ts:400`）对同类失败是 `alert('导出失败: ...')`，行为不一致。
改法：`catch` 里写 `ipSyncStatusEl.textContent` + `alert('同步失败：' + msg)`。

### 5. `merge-upstream.sh` 的三条失败路径都不安全
`scripts/merge-upstream.sh:42 / 45-53 / 89-96`

- `git -c core.quotePath` 默认开启 → 非 ASCII 冲突路径带引号，`git checkout --ours -- "<path>"` 报 `pathspec ... did not match`，`set -e` 把脚本撕在半路，第 99-101 行的回滚提示永远打印不到；
- `git merge ... || true` 把"非冲突失败"（unrelated histories、无效 ref、已在 merge 中）也吞了 → 三步空转、门禁在 HEAD 上全过、照样打印"冲突已收口"，退出码 0；
- 门禁失败没有 trap → 仓库停在 merge 状态（冲突已 stage、`MERGE_HEAD` 在），回滚提示在脚本尾部够不到。

改法：`git -c core.quotePath=false status --porcelain -z` + `while IFS= read -r -d ''`；`if ! git merge ...; then [ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ] || exit 1; fi`；`trap rollback_hint ERR`（bash 3.2 可用）。

---

## P2 —— 修完 P1 顺手修

### 6. 回填的规则 id 每次读都在变，签名去重失效
`src/shared/config-model.ts`（`backfillV5Rules`）→ `src/background/services.ts:1112-1134`

`backfillV5Rules` 用 `createRule(domain)` 生成 `rule-<Date.now()>-<random>`。而 `migrateStoredConfig` **不写回**存储，所以只要存量配置还是 v4，每读一次就重新生成 7 个新 id：

```
同一份 v4 配置读两次，rules 数量: 20 20
id 相同? false
```

后果：`applyConfigNow` 的 `JSON.stringify(config)` 签名每次都不同 → 去重彻底失效。文件里注释写明的"保存路径 + `storage.onChanged` 各来一趟、靠签名去重只应用一次"不再成立 → **升级后第一次保存会应用两次**（DNR 重写 ×2、`updateAllTabs` ×2；页面重载有 `lastHeaderValues` 自己兜着，不会双载）。用户只要点过一次保存就落成 v5，之后稳定。
改法：回填时给确定性 id，例如 `{ ...createRule(domain), id: `v5-${domain}` }`。

### 7. `Boolean(request.force)` 会把字符串 `"false"` 当成 true
`src/background/message-router.ts:27`。字符串 `"false"` 为真 → 多打一次接口并无条件重写配置（`ip-sync.ts:24-25` 注释说会驱逐 BFCache）。测试只钉了 `true`/`undefined`。改法：`request.force === true`。

### 8. 关掉开关后 `syncLanguage` 仍残留 `true`
`src/options/options.ts:145-149` / `460-465`、`src/shared/config-model.ts`（`normalizeIpSync` 不清 `syncLanguage`）

实测保存出 `{"enabled":false,"intervalMinutes":5,"syncLanguage":true}`：勾选框被 `disabled` 但仍 `checked`，用户无法取消。后果是重新打开总开关时，语言跟随**静默恢复**（会改写 `Accept-Language`）。
改法：保存时写 `syncLanguage: ipSyncOn && ipSyncLanguageEl.checked`。

### 9. 状态行轮询会叠加且不可取消
`src/options/options.ts:104 / 513-518`

每次 `populateForm` 起一条 5 × 800ms 的循环，互不感知；实测连续三次保存后 1.5s 内 `getExitIpSyncState` 消息 14 条。旧循环命中 `catch`（`:506-509`）时会把「读取同步状态失败」盖在新循环刚渲染好的文案上。
改法：模块级 `statusPollToken`，循环内与写入前判令牌。

### 10. 文档说"手填的值还在"，实现是覆盖
`CONFIG_GUIDE.md:53` vs `src/background/ip-sync.ts:230-240`

文档写「手填的值还在，只是暂时不参与」，但 `planExitIpSync` 会写入 `timezone: info.timezone` 与 `geolocation.latitude/longitude/country`，只把 `mode` 设成 `auto`。关掉开关并切回 `manual` 时，看到的是出口 IP 的时区/坐标，**用户手填的值已经没了**。
改法：改文档（更省事、也更符合"跟随出口 IP"的语义），或者真做备份字段。

### 11. 启动路径串行打两次归属地接口
`src/background/services.ts`（`bootstrap`）

```ts
await applyConfig();
await updateGeolocation(false);   // 最多 3 × 5s
if (isIpSyncEnabled(await getSiteConfig())) {
  await checkExitIp();            // 再最多 3 × 5s
}
```

离线或接口全挂时启动路径多等一轮（最坏合计约 30s，`onStartup`/`onInstalled` 都被拖）。改法：`void checkExitIp().catch(...)`，或者复用 `updateGeolocation` 刚拿到的 location 判断 IP 是否变化。

### 12. 开关打开时点保存，会把后台刚对齐的时区/坐标换回表单旧值
`src/options/options.ts`（`readForm`）

`mode` 被正确强制成 `auto`，但 `timezone`/`geolocation` 的字段值仍取表单（用户手填的旧值）。于是配置里出现"auto 模式 + 手填值"，实际生效按 `lastLocation` 走所以行为没错，但 `planExitIpSync` 下一轮看到 `timezone.timezone !== info.timezone` 会多报一层；若 IP 没变就 `same-ip` 跳过 → 这处脱节会一直留着。
改法：`ipSyncOn` 时字段值取 `currentConfig.globalProfile` 的现值，不取表单。

### 13. 换接口时 `geolocation.country` 在 `"US"` / `"United States"` 之间漂移
`src/background/geo-api.ts:54-59` + `src/background/ip-sync.ts`（`isSameLocation`）

`toCountry` 优先返回 `data.country` 字符串：ipwho.is 给国名、ipapi.co / ipinfo 给两字母码。于是同一台机器换一次接口返回，`country` 就从 `US` 变 `United States`，`isSameLocation` 判成"定位变了"→ 多写一次 `lastLocation` + 多 apply 一次。改法：统一规范成国名（或统一只存 `countryCode`）。

### 14. `--ours` 批量覆盖零留档（merge 脚本）
`scripts/merge-upstream.sh:50-53`。所有 `UU` 一律 `git checkout --ours`，上游那份内容事后无从比对；`package.json` / `tsconfig.json` / `types.ts` 只要进 `UU` 就被整文件覆盖，门禁也测不出来。改法：覆盖前 `git show ":3:$path" > "$(git rev-parse --git-dir)/merge-theirs/$(printf '%s' "$path" | tr '/' '_')"`。

---

## P3 —— 可选，不影响发版

15. `tools/smoke-options.mjs:203-218`：等 12s 拿 `lastSyncedExitIp`，而页面侧自刷新 `refreshIpSyncStatusUntilSettled` 只跑 ~4s；IP 落在 4~12s 窗口就会"storage 有值、文本还是旧文案"→ CI 偶发红。断言前 `location.reload()` 更稳。
16. `scripts/lib/presets.mjs:71`（`pickString`）：`[^']*` 在转义撇号处截断，`name: 'Don\'t'` → `Don\`；且只认单引号，双引号会让 name/description 静默退化成 `''`/id。
17. `scripts/lib/presets.mjs:110` 的 `accuracy: 50` 与 `scripts/lib/bake-plan.mjs:72` 的 `?? 30` 双默认，漏写时 50 生效、30 永不触发（旧不一致搬进了共享模块，测试只断言 `> 0`）。
18. `scripts/lib/presets.mjs:34` 的 `BLOCK_START` 无词边界，会命中 `DEFAULT_PROFILES_BY_ID` 或注释里的同名字样。
19. 残留的"5"：`tools/audit.mjs:88`（`'5 preset 浏览器 E2E'`，报告会写 5 但实际跑 6）、`scripts/lib/bake-plan.mjs:40` 注释、`README.md:377`（`five built-in presets`）。
20. `scripts/merge-upstream.sh:74` 白名单写 `tests/ip-sync.test.mjs`，本仓库是 `.ts`；`:71` 未处理 `DD`（双方都删），该路径留 unmerged，错误拖到最后 `git commit` 才暴露。
21. `src/options/options.ts`（`readForm`）：`ipSyncInterval` 输入框清空 → `Number('')` = 0 → 静默变 5 分钟。不报错也不提示。
22. `tests/ui-options.test.ts:36-49` 的 mock 里 `getSiteConfig` 恒返回 `DEFAULT_CONFIG`，:261-296 两条断言只验证渲染函数对桩状态的输出；删掉 `options.ts:145-149` 的 ipSync 整块它们仍然绿。另 `:222-227` 的 `enableIpSync()` 直接改 DOM 不走保存，第 12 条那种路径测不到。

---

## 已核对、确认不是缺陷

- 区间夹取安全：`Number('')`→0、`-3`、`abc`、`Infinity`、`7.6`、`9999` 全部经 `normalizeIpSync` 夹到 5–1440 且取整，不会写出 `NaN`。
- `parseExitIpResponse` 强制要求合法时区才接受响应，所以 `planExitIpSync` 不会把 `timezone: null` 写进配置。
- `parseGeoApiResponse` 的 0 坐标 / `null` / 空串处理正确（赤道与本初子午线不会被当成"缺字段"），`timezoneOffset = -offset/60` 与 `Date#getTimezoneOffset()` 语义一致。
- `reloadTabsForHeaderChange` 自己按 `domain → header` 记了 `lastHeaderValues`，即使第 6 条导致 apply 两次也不会重载两次。
- `ensureIpSyncAlarmFor`：关掉时真的 `clear`，周期变化才 `create`；`chrome.alarms.onAlarm` 两个名字分派正确，未知 alarm 不影响。
- 回填规则按 **domain** 寻址（`deleteDomainRule` / `setDomainRuleEnabled` 都收 domain），第 6 条的 id 漂移不会让删除/开关失效。
- 检测站 20 条与 `BUILTIN_DOMAINS_V5` 的 7 条留有重复定义风险（两份手工清单），建议加一条 `BUILTIN_DOMAINS_V5 ⊆ DEFAULT_RULE_DOMAINS` 的断言。
- options.html 无重复 id、label 关联正确、新按钮在无 `<form>` 下缺 `type` 无影响；`us-west` 在 `DEFAULT_PROFILES`、v5 白名单、popup `data-profile` 三处一致。
- 共享解析器确实只有一份（`release.mjs` 与 `smoke-presets.mjs` 都走 `scripts/lib/presets.mjs`，仓库内无第三份文本解析）；`bash -n` 在 macOS 3.2.57 下通过，无 bash4-only 语法；冲突码 `UU/AA/DU/UD` 的落法实测可正确收口。

---

## 建议的修复顺序

1. **第 1 + 2 条**（同一类静默漏包，一起改，加两条 fixture：preset 之间夹注释、转义撇号/双引号）。
2. **第 3 + 4 条**（同一个按钮的两种"不说话"，一起改：force 排队 + catch 提示）。
3. **第 5 条**（merge 脚本失败路径，`trap` 与 `-z` 一起改）。
4. 第 6、7、8 条（各一两行，改完跑一次 `npm test` 就能确认）。
5. 第 10 条只改文档，第 11、12 条视是否要在本次发版里动启动路径。
6. 第 19 条的三个残留"5"跟 P3 其它项一起清。
---

## 修复记录（2026-10-29）

按 1+2 → 3+4 → 5 → 6/7/8 的顺序落地。门禁：`tsc --noEmit` 干净、`eslint src tests` 干净、`npx tsx --test tests/*.test.ts` **419 pass / 0 fail**（新增 8 条）、`vite build` 157ms、真 Chrome 烘焙包 `smoke-options` **13/13**。

| 条 | 改动 | 复验 |
| --- | --- | --- |
| 1 | `scripts/lib/presets.mjs`：新增 `stripComments()`（字符串字面量原样保留、`//` 跳到行尾、`/* */` 换成空格、未闭合抛错），`parsePresets` 先剥注释再扫描；`BLOCK_START` 换成带 `\b` 的正则，注释里出现同名字样不会带偏起点 | 在真实 `config-model.ts` 数组里插 `// 参考 [1]` + `// don't remove` 后解析 → **6 个**（改前 1 个）；新增 4 条 fixture（行/块注释、注释提到 `DEFAULT_PROFILES`、字符串里的 `//`、未闭合块注释抛错） |
| 2 | `tools/smoke-presets.mjs:32-46`：用 `src/popup/popup.html` 的 `data-profile` 集合做第二信源，缺/多/为空都抛错并打印两边清单 | 抹掉 us-west 卡片后跑脚本 → `内置 preset 与弹窗卡片对不上：解析到 6 个 […]，弹窗有 5 张 […]；缺 []，多 [us-west]`，Chrome 都没启动 |
| 3 | `src/background/ip-sync.ts`（`runExitIpSync`）：带 `force` 的调用不再复用在飞的那一趟，改为 `inFlight.then(rerun, rerun)` 排队重跑 | 新增测试：plain 趟拿到 `skipped:'same-ip'`，force 趟拿到 `changed:true`，`lookup` 恰好 2 次 |
| 4 | `src/options/options.ts`（`handleIpSyncNow`）：补 `catch` → 状态行 + `alert('同步失败：…')`，按钮仍在 `finally` 恢复 | 新增测试：mock 返回 `{status:'error', message:'后台炸了'}` → 两个位置都出现「同步失败：后台炸了」，按钮恢复可点 |
| 5 | `scripts/merge-upstream.sh`：`git -c core.quotePath=false status --porcelain -z` + `read -r -d ''` 逐条读；`git merge` 只在存在 `MERGE_HEAD` 时才算"冲突待收口"，否则 `exit 1`；`trap rollback_hint ERR` 让中途失败也能看到回滚命令 | /tmp 实测：中文名冲突路径正常「取本地」（改前是 `pathspec did not match`）；unrelated histories → `合并失败：仓库没有进入 merge 状态` + 退出码 1；门禁失败 → 打出 `回滚：git merge --abort 2>/dev/null || git reset --hard <base>` + 退出码 1；`bash -n` 通过 |
| 6 | `src/shared/config-model.ts`（`backfillV5Rules`）：回填规则 id 改成 `v5-<domain>` | 同一份 v4 配置读两次，`JSON.stringify` 一致（改前每次都不同）；新增测试钉住 id 形态与唯一性 |
| 7 | `src/background/message-router.ts`：`force: request.force === true` | 测试补 `"false"` 与 `1` 两个用例，都透传 `{force:false}` |
| 8 | `src/options/options.ts`（`readForm`）：`syncLanguage: ipSyncOn && ipSyncLanguageEl.checked` | 新增测试：勾着语言跟随但关掉总开关保存 → 载荷 `{enabled:false, syncLanguage:false}`；真 Chrome E2E 载荷同为 `syncLanguage:false` |

第二轮（2026-10-29，决定放弃合并上游之后）又修了 4 条：

| 条 | 改动 | 复验 |
| --- | --- | --- |
| 10 | `CONFIG_GUIDE.md` 改成分两句说清：开关打开期间的保存提交的是后台对齐后的值（手填被忽略），同步是**覆盖**语义（`timezone.timezone`/经纬度/`country` 都会被改写，关掉开关也不会恢复原值） | 读文档即实现 |
| 12 | `src/options/options.ts` `readForm`：`ipSyncOn` 时时区取 `currentConfig.globalProfile.timezone.timezone`、坐标取 `currentConfig` 的经纬度，并补上一直没提交的 `geolocation.country` | 新测试：表单改成柏林再保存 → 载荷仍是 `America/Los_Angeles` + `34.0522,-118.2437` + `country: 'United States'`；`options.html` 的 section 描述也写明了这条 |
| 13 | `src/background/ip-sync.ts` 新增 `canonicalCountry()`（两字母码 → `Intl.DisplayNames` 国名），解析响应时归一，`planExitIpSync` 与 `isSameLocation` 的比较两边都归一 | 新测试：`US`/`us`/`United States` 折成同一值；ipinfo 形状与 ipwho.is 形状的响应算出同一个 `info.country`，配置已对齐时 force 也只报 `['profile']` |
| 22 | `tests/ui-options.test.ts` 的桩改成有状态：`getSiteConfig` 返回可变 `siteConfig`，`setSiteConfig` 写入它，`checkExitIpSync` 基于它构造回包，并暴露 `setSiteConfig()` 供用例预置 | 上面第 12 条的测试就是靠这个桩才成立（改前恒返回 `DEFAULT_CONFIG`，保存后再读拿不到改动） |

第三轮（同一决定之后，提交历史落定再做）：

| 条 | 改动 | 复验 |
| --- | --- | --- |
| 9 | `src/options/options.ts`：状态行刷新加轮次序号 `ipSyncStatusRound`，`await` 回来后比对序号，旧的一轮既不再写 DOM 也不继续重试（连点两次保存不再闪回旧文案） | 现有 17 条 options 用例全绿（状态行断言依赖同一路径） |
| 11 | `src/background/services.ts` `bootstrap()`：跟随时改由 `checkExitIp` 负责查归属地（与 `updateGeolocation` 同一组接口），只有它没写出 `lastLocation` 时才回退到 `updateGeolocation`；否则走原来的单次定位 | 新测试：开开关、清掉 `lastSyncedExitIp` 冷启动 → 只打 **1** 轮接口（改前 2 轮），且 IP 与坐标都落库 |
| 14 | `scripts/merge-upstream.sh`：每条「取本地」把路径 + 上游一侧（stage 3）的 blob 写进 `.git/vanishgeo-merge-ours.log`，收尾打印条数与位置 | /tmp 造冲突实测：日志两列 `path<TAB>blob`，`git show <blob>` 出来的是上游版本（第一版错记成 stage 2 = 我们自己，已修） |

第四轮（P3 清尾，第 15–21 条全部处理）：

| 条 | 改动 | 复验 |
| --- | --- | --- |
| 15 | `tools/smoke-options.mjs` 状态行断言改成**重新打开配置页再读**，不再依赖页面自刷（原来的 12s 窗口让这条断言实际在测"页面多久刷一次"） | 真 Chrome 跑通，状态行仍显示出口 IP |
| 16 | `scripts/lib/presets.mjs` 的 `pickString` 改成转义感知（`(?:\\.|[^'\\])*` + 反转义），值里带 `\'` 不再截成半截 | 新用例：`name: 'Cote d\'Ivoire'` → 解析出完整名字；把正则改回 `[^']*` 时用例变红（拿到 `Cote d\`） |
| 17 | 精度默认值收敛成 `DEFAULT_PRESET_ACCURACY`（`presets.mjs` 导出，`bake-plan.mjs` 两处引用），与扩展内 `DEFAULT_GEOLOCATION.accuracy` 同源 | 新用例断言两个常量相等 + 每个 preset 的精度都等于它 |
| 18 | `BLOCK_START` 的正则词边界（此前已加 `\b`）补测试 | 新用例：`DEFAULT_PROFILES_OLD = []` 在前时仍取到真正的 `DEFAULT_PROFILES` |
| 19 | 去掉会随 preset 数量漂移的硬编码：`tools/audit.mjs` 的「5 preset 浏览器 E2E」→「内置 preset 浏览器 E2E」、`bake-plan.mjs` 注释「五个城市」→「几个城市」、`README.md` 「five built-in presets」→「every built-in preset」 | 全仓 grep 无残留（`tools/README.md` 那张历史成绩表保留原样，它记录的是当时那一轮） |
| 20 | `scripts/merge-upstream.sh`：待丢弃白名单 `tests/ip-sync.test.mjs` → `.ts`；补 `DD`（两边都删）分支 `git rm`，否则留下冲突项让后续 commit 失败 | `bash -n` 通过 |
| 21 | `src/options/options.ts` 周期输入：空/非数字保持上次存的值（`parseIntervalMinutes`），不再被 `Number('') === 0` 夹成 5 | 新用例：存成 17 → 清空 → 再保存仍是 17；改回 `Number()` 时用例变红（5 ≠ 17） |

至此 22 条里第 1–14、16–22 条已修，第 15/18/19/20 条属"文档/脚本/测试强度"，第 22 条（测试桩）也一并改了。
