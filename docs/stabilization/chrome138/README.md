# Chrome 138 最低支持版本真实验收

2026-10-22。当前状态：**人工验收通过**。用户最初授权在当前功能范围补做最低版本验收，条件允许时补真实 HTTPS；现已确认验收并授权本地提交，不改版本、不 push。生产候选为 `d56ee9c` 的 2.1.1；本轮仅增加取证脚本、原始记录和核验文档，未改生产代码、manifest、权限或 workflow。

## 环境与真实操作

- Google Chrome for Testing **138.0.7204.183**，macOS arm64，有界面、独立临时 profile。来自 [Google 官方 CfT 版本清单](https://github.com/GoogleChromeLabs/chrome-for-testing/blob/main/data/latest-versions-per-milestone-with-downloads.json) 的 mac-arm64 包；未替换个人 Chrome，未访问其配置。
- 当前 dist 指纹 `c659b709bcdaae0c716bbd5e6f318d85dc7a3afe46d74479be2f10f0038fd0ba`，算法与 VG-032 一致：按目录项 localeCompare 遍历，依次散列相对路径和原始文件字节，排除 Chrome 生成的 `_metadata`。与此前最终关闭／重启证据构建相同。
- 全程用原生 UI 完成开发者模式、加载未打包扩展、系统目录选择器选择 dist、Allow User Scripts、Options 输入／确认／保存、启动恢复设置和退出。没有 `Extensions.loadUnpacked`、`--load-extension`、unsafe extension debugging、偏好文件写入、证书忽略或 sandbox 放宽。
- CDP 只用于只读状态采集与测试 provider 响应拦截。Options 主动检测请求在网络发送前返回文档地址 `203.0.113.10`、JP、Asia/Tokyo、坐标 `(0,0)`；真实 provider 不接收这次检测。配置身份由正常后台确认事务建立，没有直接写配置或伪造 verified。
- HTTP fixture 仅绑定 loopback。HTTPS 补测实际访问 `https://example.com/`，站点可见普通网络出口及语言头；只保存语言头、TLS 元数据和合成位置，不保存公网 IP、个人路径或凭据。Chrome 自身后台流量未全量监控。

## 原生 UI 过程记录

1. 安装前采集原生基线：页面 `zh-CN / [zh-CN]`、Asia/Shanghai，服务端导航与子请求头 `zh-CN,zh;q=0.9`。
2. 原生扩展页开启开发者模式，点击加载按钮，用系统选择器选择当前 dist；安装事件自动打开 Options。总开关关闭、规则为空，未开 Allow User Scripts 时准确显示 switch-required/partial。
3. 未勾明确启用时点击应用，页面提示先确认出口、选择站点并勾选确认，配置未启用。主动检测后在两次原生对话框确认合成结果并命名档案；选择档案、填写 localhost/example.com。推荐显示 JP、ja-JP、未交叉验证，读回仍无规则、总开关仍关闭。
4. 原生下拉选择出口语言和固定名单字体。进入扩展详情正常开启“允许运行用户脚本”，返回 Options，勾明确启用并应用。UI 显示同步完成，读回两条站点规则、页面/定位/字体 ready、语言头 ok。
5. 新匹配 HTTP 文档首 inline 为日语／东京时区，导航和子请求头一致；字体 check 和 measureText 有启用前后的可区分对照。未匹配 `127.0.0.1` 保持完整原生观测。
6. 原生设置页选中“继续浏览上次打开的网页”，关闭 Options/管理页，只留一个活动 localhost 标签。原生退出后检查进程树，再用同 profile 启动，不传网址，不主动唤醒 worker。正式干净轮次先收到首响应 nonce 对应的首脚本自报，再连接 CDP。
7. HTTPS 实际网络响应为 HTTP 200、TLS 1.3、secure、非磁盘缓存／Service Worker；实际语言头日语，加载后页面日语／东京时区，getCurrentPosition 返回合成 `(0,0)`，无真实位置权限提示。
8. Options 关闭总开关并点击保存，确认“配置已保存，同步已完成”。旧 HTTPS 文档仍保留日语；完整重载后恢复原生语言／时区和实际中文请求头。关闭后不调用原生定位传感器。
9. 关闭 Options，只留一个原生 HTTP 探针，正常完全退出再重启。首导航／自报在 CDP 连接前均原生；随后打开 Options 只读核对 master=false、dynamic=0、各脚本注册数量为0、同步ok。最后正常退出并删除本次临时 profile，关闭 fixture 和采集进程。

## 原始证据与判定

- [observations.json](observations.json)：保留各阶段 HTTP 导航、nonce、首inline、子请求头、状态读回、进程退出记录与测试过程错误。`result=OBSERVATIONS_COMPLETE` 只代表采集完成，不直接等于验收通过。
- [https.json](https.json)：两次实际 TLS 响应、Network extra-info 发送语言头及三次页面观测。不是服务端回显请求头；HTTP loopback 的头则由服务端直接记录。
- [verification.json](verification.json)：`node scripts/verify-chrome-minimum-evidence.mjs` 对原始记录及当前 dist 做 **14 项实质断言，全部 PASS**，绑定两份原始 JSON 的 SHA-256。原生 UI 操作来源由上述过程和本会话工具记录支持，不能由机器 JSON 独立证明。

| 正式重启轮次 | 退出进程数 | 首inline自报距启动 | 首导航与页面结果 | CDP 前取证 |
|---|---:|---:|---|---|
| enabled-restart-clean | 8 | 646 ms | ja-JP/ja、Asia/Tokyo、日语导航及子请求头 | 是 |
| disabled-restart | 9 | 673 ms | 原生 zh-CN、Asia/Shanghai、中文导航及子请求头 | 是 |

## 首轮环境异常与未通过过程

准备时首次启动超过采集器20秒等待，未开始产品验收；准备窗口退出后，采集器对浏览器启动等待扩至120秒。未据此改变扩展实现或通过标准。

第一次退出时过早发出 restart，脚本确认主进程未退出而拒绝，错误原文保留。完成原生退出后，第一次 enabled-restart 出现 macOS“上次重新打开窗口时意外退出”的恢复提示，点击重新打开后自动标签仍未完成导航。连接调试器只读诊断后，人工导航未匹配域及匹配域均能正常加载。**这一轮不计正常冷启动通过**，其后采到的未匹配域原生值也不能用作启用首请求 PASS。

系统提示已处理且匹配页正常加载后，重新正常退出并启动，获得 enabled-restart-clean；关闭状态则另有 disabled-restart。保留两轮独立首请求证据，不用刷新后的值覆盖失败轮次；系统提示及最初导航停滞的具体根因未建立，不宣称产品修复。后续无提示的启用／关闭正常恢复均通过。

收尾仅修正采集脚本 stdin 关闭和连接日志文字，避免采集结束后进程等待输入、避免没有首报告时也打印“报告后连接”；不改变本次原始 JSON 或产品判断。HTTPS observer 为一次性人工补证工具，不建议把公共 example.com 作为周期性自动测试服务。

## 验证与仍然保留的限制

- 三份脚本语法检查、`git diff --check`、14项证据断言通过；`npm run check` 的源码/测试类型检查、285/285测试与构建通过。构建后再次运行证据核验，确认dist指纹仍与浏览器取证一致。
- 本轮证明当前 macOS arm64 / Chrome 138.0.7204.183 的所列流程，不外推到全部138补丁版本、Windows/Linux/Edge、旧版本升级迁移、多窗口、后台延迟标签或崩溃恢复。
- HTTPS 已补实际可信 TLS、加载后语言／时区、合成定位及关闭重载恢复；**未证明 HTTPS 最早 inline 或 HTTPS 自动恢复首请求**，定位只覆盖合成成功路径，不等同完整权限／策略／传感器矩阵。
- HTTP 冷启动首inline包含字体观测；未重跑43项完整字体名单矩阵。WebRTC 本轮保持默认策略，不新增 ICE 或通话结论。
- 直接关闭 Allow User Scripts 的跨 API 首请求窗口、旧文档／BFCache快照、Worker/自定义字体等既有边界不变；本轮关闭恢复使用插件总开关，Allow User Scripts 保持开启。
- 7 个历史附件缺口继续保留，本轮新证据不冒充找回原件；不重新开启 VG-022/VG-027 研究，不改变31项已完成稳定化任务的状态。

## 独立只读复核

critical_reviewer 已完成独立证据复核，未发现本轮限定范围内的确认缺陷或证据阻断。复核方在内存执行14项断言，结果与 verification.json 一致；独立核对两份原始JSON摘要、当前dist、nonce和CDP前首请求、进程退出、HTTPS真实TLS边界及异常轮排除。三脚本语法和diff检查亦通过。该复核完成时状态为review；后续用户签收见下节，复核本身不构成发布批准。

## 2026-10-22 人工验收确认

- 验收人：用户；状态：通过；范围限定为本记录列出的 Chrome 138.0.7204.183 / macOS arm64 场景。
- 用户确认：“这轮 Chrome 138 验收通过，补充人工验收记录并提交相关取证脚本、验证记录和证据索引，保留首轮异常及已注明的覆盖限制，不改版本，仍然不要 push。”
- 签收覆盖正常 UI 安装、Options 推荐与明确应用、HTTP 页面／语言头生效及未匹配负对照、总开关关闭恢复、启用／关闭状态的完整退出自动恢复，以及真实 HTTPS 加载后生效和关闭重载恢复。
- 首轮系统恢复提示、导航停滞和过早 restart 拒绝继续保留，未计入正常冷启动通过；异常根因未建立。其他平台、全部138补丁版本、HTTPS最早inline／自动恢复、升级迁移及其他已注明限制不因签收提升为PASS。7个历史附件缺口不变。
- 收尾复用输入未变化的源码／测试类型检查、285/285测试、构建及真实Chrome取证和独立复核；重新核对14项证据断言、构建指纹及暂存差异。原始 observations.json 与 https.json 字节保持不变。
- 仅授权本地提交相关脚本、验证记录和索引；生产功能、权限、版本2.1.1和workflow不变，不push、打tag或发布。既有31项稳定化任务状态不变。
