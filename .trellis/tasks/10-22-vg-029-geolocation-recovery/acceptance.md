# VG-029 人工验收

2026-10-22。实现、自动验证、独立源码复核和用户参与配置操作的当前 Chrome 匹配网站实测均已完成，用户已明确确认验收通过。稳定化清单为 done，Trellis 生命周期为 completed，不代表发布授权。首次重载阶段未修改用户规则、坐标、档案或浏览器站点权限；后续临时坐标修改与恢复由用户操作，详见下文。

## 2026-10-22 人工验收确认

验收人：用户；日期：2026-10-22（Asia/Shanghai）。用户在本会话明确确认：

> 验收通过，把 VG-029 标记为 done，同步任务清单和验收记录，完成收尾。不要 push 或发布。

本次签收覆盖地理位置恢复、当前匹配网站的配置坐标读取与修改后重载、语言/时区/字体回归，以及原自动定位和随机偏移配置恢复。下述已知边界继续有效，未实测项目不因签收改写为通过。

清单与任务状态已同步；原始 Chrome JSON、现场脱敏 JSON 和截图保持不变。保留任务原路径及所有证据，未提交、push或发布。

## 当前 Chrome 匹配网站现场实测

用户现有 Chrome profile，现有匹配网站 `https://fuck-claude.vercel.app/zh/`。网页端通过当前文档的 Geolocation、Permissions、Intl、FontFaceSet 与 Canvas API 验证；配置修改由用户在配置页完成。浏览器工具禁止访问 chrome-extension 协议，未绕过该限制修改配置。

| 步骤 | 实际结果 |
|---|---|
| 原自动模式及随机偏移 | 连续定位成功，精度50米，同文档坐标稳定 |
| 临时固定坐标(0,0)，重载 | getCurrentPosition、watchPosition均精确匹配(0,0) |
| 保存(1,2)，不重载 | 旧文档仍精确返回(0,0) |
| 原标签页完整导航重载 | getCurrentPosition、watchPosition均精确匹配(1,2) |
| 当前profile新文档对照 | 同样精确匹配(1,2) |
| 语言及时区回归 | en-US / en、America/Los_Angeles、Intl locale en-US保持 |
| 字体API回归 | MiSans、PingFang SC/TC、Microsoft YaHei的check为false，measureText与通用字体回退一致；通用字体仍可用且度量有区别 |
| 恢复原配置后再重载 | 用户确认坐标留空、随机偏移开启、半径1000米；实际读数已退出临时坐标、回到原粗略区域，同文档稳定，语言/时区/字体正常 |

部分早期导航请求被Browser Use暂停，期间仍读旧文档，未作为重载通过或扩展缺陷证据；重新正常导航后，在原标签页和新文档分别完成正向核验。恢复阶段只比较原粗略区域，不冒充随机半径测量。原精确坐标和公网IP不写入本记录。

最终网站自身扫描也显示洛杉矶时区、英文语言，中文字体和厂商字体均none detected。临时测试标签与开发者工具已关闭，原标签保留。见[current-chrome-evidence.json](current-chrome-evidence.json)及[current-chrome-regression.jpg](current-chrome-regression.jpg)。无源码变更，复用此前未失效的构建和测试证据；不push、不发布。

## 实际证据

| 检查 | 结果 |
|---|---|
| git diff --check、新增文件空白检查 | 通过 |
| npm run typecheck | 通过，最终 build 内执行 |
| npm run typecheck:tests | 通过 |
| npm test | 248/248，0失败/跳过；Node/VM/mock/静态检查 |
| npm run build | 通过，实际 dist 48文件 |
| node scripts/chrome-geolocation-smoke.mjs --output <任务证据> | 真实Chrome 30/30 PASS，exit0；见 chrome-evidence.json |

真实浏览器：Chrome/155.0.8059.86、macOS arm64、headless、独立临时profile。实际dist摘要a08136c3bd7ed8180da9ae665d1a8c6c73b571e99bbea1751cf078a2741df861。JSON摘要0296e3f07385e094798b619210334a66d6ba58c4a35b3bec260b5f938dad9350。fixture使用合成坐标与不同值原生哨兵，未调用真实定位/provider；浏览器自身后台网络未全量监控。临时浏览器、profile和server清理PASS。

30项覆盖：默认关闭、正常详情UI允许脚本、实际注册、首inline调用、三方法、取消、getter重入唯一ID、success异常、receiver/options、timeout/cache/highAccuracy、权限查询和事件、policy拒绝、同源/跨源iframe正负对照、5类特殊文档、语言时区字体保留、HTTPS origin fixture、A→B/reload、false权限三态、真实BFCache、后台stop/wake、扩展update、关闭/删规则新文档原生。HTTPS origin由CDP本地fulfill提供，未测试TLS传输。BFCache实际persisted=true；同一A文档在B保存后恢复仍A，watch初次/恢复各一次。恢复阶段关闭管理页且管理业务消息为0，启动和update恢复不依赖先打开面板。

## 人工操作

1. 打开扩展面板，确认四项状态均已同步。若提示重载，先完整重新加载准备验收的网页。
2. 在完整配置中确认总开关、定位开关、测试网站规则启用。手工模式可用合成零坐标与50米精度；自动模式须明确绑定已检测确认的出口档案。无需为了验收重新检测或修改原有档案。
3. 开启“合成位置权限伪装”，保存。完整重载匹配的普通安全网页，再运行该网页的定位检测，预期getCurrentPosition和watchPosition均得到所配置的合成位置；不会请求真实传感器。
4. 保持同一网页，修改合成坐标并保存：未重载仍保留旧值；完整重载后采用新值。修改后关闭重开也应采用新值。
5. 开启随机偏移时，单个网页内重复读取应保持同一偏移位置且在配置半径内；重新加载后可以重新生成偏移。
6. 关闭定位并保存、完整重载：本扩展停止接管定位，语言/时区/字体仍按各自开关工作。此负对照无需调用网页原生定位，避免取得真实位置。
7. 关闭权限伪装时，permissions.query保持Chrome原生状态；只有原生granted才交付合成位置。prompt/denied返回拒绝，不主动弹真实定位授权或调用传感器。
8. 检查语言、时区、固定内置字体仍按原配置工作，面板保持短状态，没有恢复大段配置引导。验收后恢复自己选择的配置。

## 已知边界

- 仅普通非opaque安全HTTP(S)文档且原生定位API存在、Permissions-Policy允许时可用；不安全HTTP、about:blank/srcdoc/data/blob/特殊sandbox与Worker不支持。
- 旧网页/BFCache可能继续返回旧坐标；更改或关闭后需要完整重载/关闭重开，已交付网页的数据不能撤回。
- 合成Position、Coordinates、PermissionStatus具有原型兼容和相应功能，但没有浏览器原生内部slot；不更改反射或承诺无法检测。原生合法其他realm receiver透传，网页主动保留/替换原生方法不属于绝对隔离保证。
- Chrome138、其他OS、TLS传输、真正浏览器冷启动/会话自动恢复和所有故障注入组合未在本轮真实Chrome覆盖；不得把30项结果扩写为这些项目通过。Node覆盖注册读写失败与重载恢复中断。
- 独立复核发现的注册恢复漏债P1和watch getter重入ID冲突P2均已修复并独立复验关闭，最终证据复核记录见implement.md。

## 2026-10-22 本地提交拆分验证

用户授权先分别提交必要前置任务，再单独提交VG-029；顺序为VG-028、VG-024、VG-025、VG-029，仅本地提交，不push或发布。各提交树剥离VG-026出口推荐、countryCode和右键菜单增量，原工作文件及其他未提交修改保留。

| 提交树 | 源码/测试类型检查 | Node测试 | Vite构建 |
|---|---|---|---|
| VG-028 | PASS | 210/210 | PASS |
| VG-024 | PASS | 203/203 | PASS |
| VG-025 | PASS | 218/218 | PASS |
| VG-029 | PASS | 237/237 | PASS |

测试数量因提交范围剥离而与原工作树248项不同。VG-028初次检查发现权限文档措辞与静态断言不符，修正文档后复验通过；VG-029初次临时树漏入旧Popup wiring断言，纳入已验收面板精简对应测试后完整检查通过。上述检查在独立临时源码树执行，未覆盖原工作树文件。

VG-029拆分树新构建在真实Chrome155.0.8059.86/macOS arm64/headless临时profile补验30/30 PASS，cleanup PASS；完整48文件构建SHA256为`ed0e3bedc80db9cfee6a0938e08a07d39121fbe4f47430423913cb4fb12b935d`。原个人Chrome验收和原构建JSON保留原样，新构建证据见[提交范围Chrome证据](./commit-scope-chrome-evidence.json)。本轮未修改个人Chrome配置。

独立只读复核确认DNR拆分与原18文件补丁一致，定位核心与已验收实现一致；发现一项VG-029前已存在的字体限制：启动读取配置失败清理字体注册后，故障期间新开匹配文档在恢复注册时可能漏报重载债。纯内存mock复现ready且reloadRequired=false；本次提交整理未修复该既有问题，不宣称字体存储故障窗口的完整重载提示已通过。本任务已验收的正常定位及语言/时区/字体路径不受该范围结论替代。

维护源、测试与文档差量的`git diff --check`通过。VG-024原始`source-changes.patch`作为字节不变的历史补丁保存，其空行上下文自带单个空格；格式检查排除这一个原始补丁，不改写历史补丁内容。
