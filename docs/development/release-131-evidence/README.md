# VG-045 候选证据

`verification.json`汇总代码提交9c4cc57之前构建候选的本地门禁、Chrome155隔离Profile、正式dist及固定语言/时区persona样本、7个本地包的独立静态审计。

`chrome155-native-parity.json.gz`保留原始完整JSON压缩字节，解压后SHA-256见摘要；`chrome155-intl.json`是独立临时最小扩展的Intl/Date对照，不代表生产注册。

原始报告中的CSP对照为：HTTP入口响应connect-src none在native阻止请求，在Blob包装后允许请求。用户已于2026-10-28单独接受该release入口CSP语义；Shared跨页分离与此项分别记录授权。

普通包通过现行完整门禁与普通产物审查，6个persona按独立预期preset/domain逐文件字节审查。浏览器persona仅为新生成的Singapore/loopback样本；6个ZIP没有逐包浏览器验收。包只在本机临时review目录准备，不是tag或Release。

Node/VM/jsdom、真实Chrome155样本和人工验收分别记录。没有访问个人Profile、外部provider或真实传感器；Chrome138、任意CSP、升级／完整重启／BFCache、真实定位委托、定时出口网络切换和真实网站不由此推定通过。历史VG-041 NO_GO不被本次候选覆盖。

功能代码已以9c4cc57提交、快进合入main并推送。证据中的baselineHead/workingTreeDirty反映构建采样时状态；它们不是当前Git状态。普通ZIP与最终浏览器使用dist的指纹相同，压缩证据原始字节及hash保持不变。任务保持review，人工验收pending，未打tag或发布。
