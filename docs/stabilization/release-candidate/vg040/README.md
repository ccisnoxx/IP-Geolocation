# VG-040 v2.1.1 本地候选

日期：2026-10-24。用户已人工验收通过并授权本地提交及最终提交级候选审查，先不推送。版本保持2.1.1，不打tag或发布。原工作区证据以基线 `20fa4792c4fea17d0708bda2f7fdd3d105c4a07f` 加VG-040修改采集；实际最终commit、树摘要及审查结论在提交后写入本地 `release/vg040-final-commit-rc.json`。

- 产品合同：既定43项字体（含普通简繁中文字体）过滤；名单外显式字体正常测量，顶层／普通iframe一致。Accept-Language沿用有效站点语言列表，其他请求头原生。
- 单站点关闭：禁用当前域名，继承父域时创建禁用子规则；共享解析、语言／定位／字体注册及请求头均排除禁用子范围，兄弟域保持；重新启用保留出口与覆盖。
- 首次配置：新检测确认的出口自动选入引导，不预选站点、不自动勾选或启用。
- 独立复核：两项边界问题修复后通过；独立核验最终dist顶层/iframe VM和ZIP50文件，未发现其他可触发缺陷。用户已人工验收通过，主清单done、Trellis completed。
- 验证：`npm run check`通过，342/342测试、两项类型检查和build；定向首次新增测试调用签名有误，字体key旧测试夹具也随合同更新，修正后完整门禁通过。独立复核指出的多窗口档案误选与字体名空白误匹配均已修复并加入回归；Chrome字体runner旧断言同步，语法检查通过，未执行该真实Chrome脚本。
- 输入库存：`007186058412421daac9ec1473c47f27a5a445ac4594926df3400a9289414cb4`，详见[源码和检查身份](workspace-candidate.json)。包含src/build/tests/fixtures/public/rules/scripts与构建配置，不含生成报告自身。
- 产物：[50文件逐字节审查](artifact-evidence.json)，ZIP为本地忽略目录 `release/vanishgeo-v2.1.1-candidate-vg040.zip`；SHA-256 `7c43c302ad427fb835d06ec25b5edc4974908b603be31364b776281cd4aa819d`。
- [Blob现场调查](blob-investigation.md)：本次未复现警告，底层取证不完整，不写作已修复；已安装扩展未与本候选绑定。

历史VG-037报告及旧ZIP保持原身份。本轮未改变Worker、权限、verified边界或发布流程。生成入口VM和后台mock回归不是Chrome现场验收；本轮后续已补齐三项重点真实Chrome行为证据，VG-039遗留项仍需独立完成。

最终提交级审查在本次获授权确定实际提交后，核对上述维护源／测试库存与提交一致、版本及ZIP库存一致，再绑定实际commit。若输入变化，重跑受影响检查并重建ZIP；未变化的检查证据可复用。不得将本报告的基线HEAD当作候选commit。

2026-10-24补充：[当前Chrome观测证据](../../../../.trellis/tasks/10-23-vg-040-product-contract/chrome-current-evidence.json)覆盖同源顶层/iframe的43项过滤与名单外透传、Popup关闭子域不影响父域和兄弟域、新检测出口自动选中。已清理临时规则/档案和本机服务器；用户已确认主动删除一个未使用的旧出口档案并要求保留；清理后全量配置严格等于验收前基线仅移除该档案，恢复比对通过。未新增生产源码变更。

最终报告放在忽略的release目录以避免commit自引用；提交内workspace-candidate.json保留检查采集时的原工作区身份，不能用其baseCommit冒充最终候选。逐文件证明最终commit输入等于该库存后，既有342项测试、类型检查、build和真实Chrome证据可复用。
