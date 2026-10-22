# VG-027 文档与证据收尾记录

## 2026-10-22 记录重建与授权

用户授权限定范围的文档与证据收尾，要求保持review，不改生产代码、不提交或push。本目录原本不存在，`git log --all -- <本任务路径>`无记录；依据现存研究正文、清单及当前源码重建，不冒充找回的原研究执行记录。

任务依赖均done，人工验收pending。VG-029仍保持已验收done。本轮未运行Chrome、测试或构建，未做外部请求，未恢复旧个人浏览器现场。既有VG-029检查结果仅按原始产物和范围引用，不能表述为本轮重跑。

## VG-029 恢复来源

以下11个文件从提交 `838c301` 原样恢复到原任务目录；后续删除提交为 `da068f2`。恢复只写工作区，不操作索引；已有文件不会被覆盖。原文中的review、未提交等描述保留历史阶段含义，VG-029当前状态以清单done及其人工验收章节为准。

| 文件 | SHA256 |
| --- | --- |
| `acceptance.md` | `5254440abda7bf8a2aa188619208126ada1c348a1098179522a34d5a03029b44` |
| `check.jsonl` | `40dabff4b3e0949c79f6dbbbec55ba4d8eb31ab989ba5c77786bf2c951c88b92` |
| `chrome-evidence.json` | `0296e3f07385e094798b619210334a66d6ba58c4a35b3bec260b5f938dad9350` |
| `commit-scope-chrome-evidence.json` | `35b90faf7d5eb7daf5d4e543143163adaba636066e66fe74f52f7339cdafdcf0` |
| `current-chrome-evidence.json` | `95994526e0fcb0d1f6cfd5e5242ddc6f2e0309993695bbdbeb9936d19a3e4a19` |
| `current-chrome-regression.jpg` | `afdc316b8a5fb9466967cdb318465f717e7492177efeaddb3e4caa03c9eefe49` |
| `design.md` | `728d4438682e31c5b8c33e1bead1c73dff1681ace457b364f03eb6a3662ccd03` |
| `implement.jsonl` | `40dabff4b3e0949c79f6dbbbec55ba4d8eb31ab989ba5c77786bf2c951c88b92` |
| `implement.md` | `aa3e01da378a331b3bf60b04817c3c82a5660927f857b9f81adf47df4da5a742` |
| `prd.md` | `32bd3eb398b288a88a8abb764202290ea4c193be6a7e1cb7730605b7b679b4f4` |
| `task.json` | `dadd29ed481361e40057a2635155dcc3fe2b45922cc2117a8a68fa484bfee3d1` |

## 六项门槛对账与现行合同

完整对账见[研究正文的当前结论](../../../docs/stabilization/early-environment-delivery.md#2026-10-22-限定范围收尾对账)。当前源码核对了config-resolver的六字段定位payload、page-scripts的共享串行注册调用合同、独立geolocation入口，以及权限、watch、冻结/BFCache和退出清理逻辑。

从838c301到当前基线161064d，定位入口、geolocation-permissions、page-scripts、定位运行时测试和Chrome定位runner无差异。共享config-resolver有后续语言标签校验及localhost子域匹配变化；因此旧Chrome30项仅证明当时构建，不宣称当前全部输入重新实测。当前代码不再采用原研究时的watch interval轮询。

两份Chrome原始JSON（原工作树与提交范围）均为30/30 PASS、exitCode=0、cleanup PASS，包含实际persisted=true的BFCache和独立恢复/撤销对照。恢复的acceptance.md记录用户明确人工签收及已知限制。旧记录载明VG-029独立复核发现问题已修复复验；这不是VG-027本轮的新独立审查，原VG-027独立复核记录未找回，不伪造已完成复核。

## 剩余缺口与交付状态

- 未找到完整同源父页/原型污染对抗矩阵、document.open、受控注册撤销窗口等独立位置Chrome证据；部分receiver、重入、iframe移除和冻结行为有Node/VM测试，不扩写为浏览器全覆盖。
- Chrome138、其他OS、真实TLS、定位完整冷启动/会话恢复和全部故障组合未覆盖；VG-032语言头重启或VG-026联合页面验证不替代定位资格。
- JSON的fixtureInvokedNativePosition不是原生定位调用计数；哨兵仅证明未交付该值，不调用本realm真实取位的依据另包括源码与VM。
- 旧网页/BFCache保留快照，已交付坐标不可撤回；合成对象没有原生内部slot，不承诺不可检测；特殊文档和Worker继续不支持。
- 原VG-027执行及独立复核记录缺失。限定范围研究可以保留未知项交付review，不以此自动取得全六项安全PASS或新的生产授权。

本轮校验：恢复文件逐字节与Git blob一致；JSON/JSONL可解析；研究与任务新增链接、关键人工验收锚点及状态一致性检查；git diff --check与新增文本尾空白检查。结果详见本次工具输出，不将文档检查等同于生产功能验证。未暂存、提交、push或发布。

## 2026-10-22 人工验收确认

用户明确确认：“VG-027 按这次限定范围验收通过，把它标记为 done，补充人工验收记录并提交相关文档和恢复的 VG-029 证据，仍然不要 push。”据此将唯一任务清单和本任务状态同步为done，授权本地提交相关文档与恢复证据，不push、不打tag、不发布。

验收仅覆盖历史研究、现行合同与VG-029后续证据的对账、记录重建和原样证据恢复。不将原六项门槛全部改为PASS，不补造缺失的独立复核，不扩大位置或Worker能力，不将未验证范围改为通过。VG-029已有人工验收及恢复文件内容保持不变。

本次仅更新人工验收和状态说明；复核恢复文件仍与838c301逐字节一致，检查JSON/JSONL、链接/锚点及暂存差异。不运行新的测试、构建或Chrome；此前review/pending和未提交说明保留为历史阶段，以本节为当前验收结论。
