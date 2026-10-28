# 扩展可观察面审计

这是维护者的差分观测工具，不是网站检测服务的评分器。它不枚举或伪造用户扩展列表，不隐藏可观察结果，不根据检测站点分支，也不尝试绕过准入或风控。

## 运行与数据流

先 `npm ci`、`npm run check`，再运行：

```bash
mkdir -p release/observability
# 当前 Chrome；Node 22+，正式 dist，独立临时 Profile。
node --import tsx scripts/chrome-observability-audit.mjs --output release/observability/chrome.json
# Helium 需要独立设置实际可执行文件；不会接管个人 Profile。
CHROME_BIN='<Helium 可执行文件>' node --import tsx scripts/chrome-observability-audit.mjs --output release/observability/helium.json
# 只启动被动观测页面，供真实 Profile 人工对照。
node scripts/serve-observability.mjs
```

`serve-observability` 仅绑定 IPv4 loopback，默认为 `http://localhost:8790/`；用 localhost 与 127.0.0.1 在同一端口形成同源／跨源 iframe。HTTP Worker 和 SharedWorker 请求同一本机服务；Blob Worker 的业务脚本也只引用本机探针。传给父窗口的消息只含观测值，检查 source 和 origin，不含扩展预期配置，不能调用扩展管理动作。夹具不打包进扩展，无 WAR、网页配置桥或远程代码。

位置读取仅在 runner 使用的临时 Profile 的 `?position=1` 采样中开启。该 Profile 原生位置权限预先设为 denied；仅已启用的合成定位可提供坐标 0/0。正常无参数的页面不调用定位。ICE 使用 `iceServers: []`，不调用 STUN/TURN，不保存地址或 SDP，只保存类别数量。实际浏览器全局 WebRTC policy 在扩展上下文读取，与网页 ICE 分开记录。Chrome 自身后台网络未全量监控，不能将本机 fixture 等同浏览器完全离线。

runner 使用现有浏览器测试方式：临时 Profile、临时正式 dist 副本、Extensions CDP 装载及正常详情页 Allow User Scripts 开关。Helium 内置 uBlock 必须先在原生管理页出现，再通过开关停用并读回；不启用个人 Profile 的其他扩展。退出时关闭本次浏览器和服务、删除临时 Profile；输出 JSON 和 Options／实际 action Popup 截图保留。已有输出拒绝覆盖，便于保留失败尝试。

## 对照矩阵与判据

依次采集 native（未安装 VanishGeo）、installed-off、language、timezone、geolocation、fonts、webrtc；后五项逐步叠加，再采 consistency、native、full 预设及总开关再次关闭后的新文档。每阶段都有全新顶层、同源 iframe、跨源 iframe、HTTP classic/module Worker、本页新建 Blob classic/module Worker 与 SharedWorker 样本。

状态只使用以下四种：

| 状态 | 范围 |
| --- | --- |
| NATIVE | 本探针已采字段与同一浏览器的原生对照一致，或原生品牌 getter 接受返回对象。不是所有反射、时序或指纹均原生的证明。 |
| OBSERVABLE | 已观测差异或可直接观测的行为，如固定字体向量、合成定位品牌不兼容、实际 ICE 候选类别。不能推断扩展唯一身份。 |
| UNKNOWN | 缺少对照、未执行、权限拒绝、超时或空 ICE。定位未获原生对象时，不猜测其完整行为。 |
| UNSUPPORTED | 当前 realm 缺少对应 API；不把不存在的 API 当作正常采样。 |

JSON 的 `comparison` 逐字段保留状态，`observed` 保存实际值。顶层 `status: OBSERVABLE` 表示本轮确有差异且断言完成，不能解释为全部字段已通过。异常时顶层保持 UNKNOWN 并保存错误和已经完成的样本；不把采样结束或同步成功视为网页验收。`earliest` 是夹具模块开始执行时的样本，不宣称是 HTML 首个 inline 或 document_start 时序证明。

覆盖内容：

- DOM 中的扩展 URL、资源 URL、节点／属性结构及产品命名全局键；结果写入 DOM 前采集，避免报告污染自身。主文档和 iframe 都与原生结构比较。
- 实际 manifest 的空 WAR、未声明 externally_connectable、未申请 management。
- navigator、Intl、Date、Geolocation、Permissions，以及 Worker、Canvas 测量和 FontFaceSet 的 descriptor、函数名称／长度／toString、属性位置；非法 receiver、显式参数和异常行为。
- navigator.languages 与真实同源 Accept-Language 回显；顶层和 iframe 都验证配置顺序，普通原生头不被强制要求与 JS 逐字相同。
- 固定 43 项与两个对照字体的 check／measureText 向量；不随机修改输出。定位还记录返回对象 own keys 和原生 GeolocationPosition getter 的实际品牌检查。
- 每个 realm 的语言、时区和 API 存在性；HTTP(S) Worker／SharedWorker 仍按当前产品合同保留原生。缺少任一要求样本会使 runner 报错，不由顶层结果替代。
- 总开关关闭和 native 预设的新顶层及 iframe 原生字段、零页面／定位／字体注册与零所属语言头规则；预设不释放全局 WebRTC，policy 单独比较。
- 正式 Options 选择保存、实际 action Popup 的 change 事件及重新读回：从父域继承切换时创建当前域名子规则，保留父域及高级覆盖。

## 已有直接暴露边界

当前 manifest 的 WAR 为空且没有 externally_connectable。Chromium [WAR 合同](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)限制网页访问包内资源；[外部连接合同](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)在缺省时不允许普通网页连接，但不等于禁止其他扩展连接。配置管理仍须通过现有可信来源检查。

生产运行时状态由闭包持有，不在页面写入 VanishGeo 全局变量、DOM 标记或自定义事件；模板不插入 extension URL，不使用网页配置桥。关闭对应功能不注册其页面修改。本轮保留并增加验证这些已有边界，没有以“隐藏扩展”名义增加新的反射伪造层。

## 功能自身的可观察性

语言／时区替换会改变 API 结果及部分函数反射。strict 会覆盖显式 locale/timeZone，甚至可能覆盖本应触发原生错误的参数；compatible 保留显式参数，但默认值与其他 realm 仍可能不同。合成定位的自有属性、合成 PermissionStatus、原生内部 slot 品牌差异可观察。Blob Worker 包装会改变 Blob URL、location、import.meta.url、错误栈和加载行为。这些是已有产品能力的边界，本轮不增加隐藏它们的逻辑。

固定 43 项 `document.fonts.check()` 都返回 false，而原生浏览器对未安装字体的 check 也可能返回 true。与未列入名单的 Arial／monospace 及 fallback 测量结合，会形成稳定且有辨识力的行为向量；不能据此证明世界上只有 VanishGeo 产生该向量。重复 fonts／webrtc／full 阶段的同一向量是稳定性的实测依据。字体绘制、DOM 尺寸、local()、OffscreenCanvas 和 Worker 字体仍原生，测量与绘制可能不一致。低修改量的应对是 consistency 或 native，不是随机扰动字体结果。

WebRTC 的实际 policy 是浏览器全局设置；网页能看到网络行为，通常不能直接读取该 policy。strict、空候选、只有 host 候选都不等于所有网络路径没有泄漏。

## 未覆盖面

DOM 扫描不是所有瞬态插入、事件监听器或执行时间的穷举。没有测试所有跨站 OOPIF、嵌套 Blob、安装前／外来 Blob、srcdoc、opaque sandbox、任意 CSP／Trusted Types、HTTPS、BFCache、升级／冷启动、所有网站或所有 OS／浏览器版本。未做 STUN／TURN、代理组合、真实传感器或网络出口精度测试。WebGL、Audio、screen、硬件、codec、WebGPU、Temporal 等未接管表面不在本审计的变化断言内。既有独立 runner 的范围和过期合同失败需分别记录。

本轮运行记录见 [VG-043](../../.trellis/tasks/10-26-vg-043-observability/implement.md)，原始矩阵的精简归档见同目录 `evidence.json`。本地状态为 review，人工验收和发布授权另行处理。
