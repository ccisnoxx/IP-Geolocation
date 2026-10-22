# VG-033 实现与验证记录

状态：done。用户于2026-10-23明确选择“先修复 Blob Worker，并实测美西配置”，随后明确确认本次验收通过，授权提交到本地并要求先不推送。依赖VG-023、VG-032已为done。

## 实现

生产语言/时区userScripts入口复用最小快照，构建独立自包含Blob Worker bootstrap，与页面共用navigator及Intl/Date实现。仅跟踪安装后本realm创建的Dedicated Blob classic/module Worker；不恢复历史HTTP(S)/SharedWorker包装，不增加权限、host或配置来源，不硬编码美西。

classic在独立业务脚本执行前安装补丁；module通过静态依赖顺序覆盖业务及其依赖的首次执行。私有源副本支持立即撤销原URL，启动、错误和terminate清理私有URL。保留普通URL对象、选项单次转换、严格模式和原生消息排队。

独立只读复核发现并修复同源其他realm撤销后的源码复活、URL对象遗漏、选项getter重入撤销及重复参数转换问题。核验仅同步读取已跟踪的blob:，捕获原生XHR方法/status getter；CSP拒绝时明确警告未同步并交回原生加载。

## 验证

- `npm run check`通过：源与测试typecheck、293/293测试、生产build。
- 探针服务脚本独立TypeScript检查通过；`git diff --check`通过。
- 当前用户Chrome通过正常扩展详情页重新加载dist，并完整刷新现有检测页。页面与classic/module Blob Worker均为en-US、[en-US,en]、America/Los_Angeles；冬季offset480、夏季420。没有在这些已测默认值中出现中文locale或Asia/Shanghai。
- module静态依赖首执行、classic严格模式及全局`let URL=null`、URL对象、空MIME classic、立即撤销原URL及提前发送消息均通过。
- 同源外realm撤销、首尾空白URL、大写Blob协议撤销均拒绝，业务未执行。
- DevTools Network实际同源诊断fetch请求的Accept-Language为en-US,en;q=0.9。未将API响应误当作请求头回显，也未保存Cookie/IP等其他字段。
- 本地CSP原生/补丁各3组实际Chrome对照通过。正常组同步；connect-src阻止核验时警告且保持原生未同步；script-src阻止Blob依赖时报Worker错误、业务不执行。各组terminate前私有URL存活数为0。

最终独立只读复核核对了证据与当前三个候选文件SHA-256，确认前轮P1/P2及Chrome/CSP门禁均已闭合，无剩余具体阻断项；Chrome采样由主代理执行，复核者未冒称亲自采样。

具体脱敏值与构建哈希见[Chrome证据](chrome-evidence.json)。生产扩展验证与loopback合成payload资格验证分开记录；Node/VM测试不冒充真实Chrome验收。

## 已知边界

HTTP(S)、SharedWorker、嵌套、外来/安装前Blob及TrustedScriptURL未覆盖。CSP必须允许Blob入口、依赖以及核验读取；受限页面不能宣称已清除残留。同步核验有随Blob大小增加的主线程成本。Worker location、import.meta.url及错误Blob地址可观察变化，不保证不可检测。旧文档/BFCache/旧Worker需完整重建，其他未接管API保持原生。当前使用既有美西站点配置；未修改Chrome或系统原生语言/时区。

本轮临时Worker、URL与测试iframe已清理；临时检测标签页已关闭，原Network筛选已恢复。

## 人工验收与本地提交

2026-10-23用户明确验收通过，任务清单与task.json同步为done。本次提交包含VG-033实现、测试、范围说明及脱敏Chrome证据；不推送、不发布。chrome-evidence.json中的review为采样时状态，保留历史原样。收尾只更新验收记录，复用上一轮293/293测试、类型检查和构建证据；实测绑定的产物及核心源文件SHA-256一致，提交前再次检查差异。
