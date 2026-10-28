# release/1.3.1 合同迁移

任务：VG-045。代码来源固定为 `5b6190527c307a57d95f30a86f591930339e6f6b`。
用户已选择以 release 行为为目标。本文逐项定义目标、旧配置转换与验收边界；实施状态以任务记录和实际代码为准，不由历史合并提交推定完成。

## 实施顺序和当前状态

| 顺序 | 合同 | 当前状态 |
| --- | --- | --- |
| C1 | `fonts.check` 原生语义、`queryLocalFonts` 结果过滤 | 已实施，本地测试与Chrome原生check对照通过；枚举授权矩阵待人工 |
| C2 | 三层字体与统一配置迁移 | 已接入参数化模板与schema5迁移，完成定向本地验证；尚无真实Chrome验收 |
| C3 | 定位对象形状 | 已实施；零ownKeys及真正原生getter内部slot差异分别验证 |
| C4 | release 定位权限、真实定位委托 | 2026-10-28用户明确接受真实授权与传感器数据流，已实施，验证中 |
| C5 | 自动出口跟随 | 已接入5分钟alarms和后台检测事务；本地定向与独立复核通过；真实网络定时切换未验收 |
| C6 | 页面更新／清除和生命周期 | 已接入独立入口及只读桥；同文档更新/关闭Chrome验证通过 |
| C7 | HTTP(S) Dedicated Worker、SharedWorker | 已接入候选；同页共享/跨页分离及模块相对import已在Chrome验证；CSP差异单独记录 |

## C1：本地字体枚举与 check

- `FontFaceSet.prototype.check` 在页面、OffscreenCanvas Worker 和既有 Canvas 平台映射路径均不安装包装器。保留原生函数恒等、参数转换、加载状态、返回及异常。此项直接改变旧版本对被过滤字体强制 `false` 的行为，没有存储字段转换；旧版本且没有控制器的文档要完整重载才能移除旧包装器。
- `queryLocalFonts` 只在 API 原生存在、字体功能启用且域名规则有效时安装。原生方法拥有站点授权、用户操作要求、选项、receiver、枚举及拒绝；包装器不主动调用、不请求授权、不上传枚举结果，仅过滤返回数组。
- 族名、完整名、PostScript 名共用现有字体键解析；保留未过滤的原始 `FontData` 对象及其 `blob()`。不补建缺失 API，不将拒绝转换成空成功数组。
- 接受证据：原生方法恒等、原生异常／转换、保留对象身份、无功能／无 API 路径。浏览器还需覆盖未授权、拒绝、允许、Permissions Policy、失效用户操作和 iframe；Node 桩不证明浏览器权限验收。

依据：[CSS Font Loading check](https://www.w3.org/TR/css-font-loading/#font-face-set-check)、[Chrome Local Font Access](https://developer.chrome.com/docs/capabilities/web-apis/local-fonts)。

## C2：三层字体和 schema 迁移

目标为 release 的三层并集：真实平台 `auto`／平台层 `none`、可独立开关的 CJK／厂商层、手动追加层。`auto` 读取浏览器真实平台，不声称其他设备平台；未知平台只跳过平台层。页面先解析一次，给未来 Worker 传同一展开名单。测量仍保留 VG-044 参数转换、重入和 finally 恢复合同。

配置转换由 `config-model`／`config-resolver`／`storage` 原有入口完成：

1. 合并后的结构使用 schema **5**，避免与 release 自己的 schema 4 混淆。继续保留 main 的出口档案、规则 ID／绑定、Intl 模式和兼容预设，不引入第二份 `lastLocation`。
2. main schema 2／3 的字体启用值保留；迁移到 `auto` + 开启 CJK 层，旧自定义列表作为追加层。既有固定名单的额外厂商项保留；不把原来的字体关闭值改为开启。旧 Canvas 对端平台映射是不同能力，保留其明确开关和取值，不把它解释为平台层。
3. release schema 4 的 `canvas.enabled && canvas.spoofFonts` 转为字体启用值，`platform`／`hideCjkFonts`／`targetFonts` 转成三层字段。缺少 main 字段只补明确默认；历史 `lastLocation` 导入为未验证档案，不能凭文件声明得到 verified 身份。
4. 导入先校验原始结构，再转换、语义校验、隔离、同队列持久化。坏字段拒绝，不能靠归一化变成成功。结构升级失败时保留原数据，正常冷启动不重复写回。

生产派发需要参数化的自包含字体模板；名单只从上述模型派生。新模板与已有独立语言／时区模板通过同一注册队列使用同一规则及排除范围，页面与 Worker 不分别猜测平台。

接受证据：main 2／3、release 4、当前 5 的导入与冷启动、关闭值／自定义保留、未知字段错误、断点恢复、重叠域名、页面／Worker 同名单、枚举及测量同名单。真实 Chrome 还需装有目标字体的对照环境；字体名单本身不是设备指纹隐藏证明。

## C3：定位对象

目标为 release 的私有 WeakMap 对象：`Position`／`Coordinates` 实例没有自有字段，值由原型 getter 与 `toJSON` 返回，实例可扩展，原型与原生相同。包装器只识别本次产生的对象；其他 receiver 委托捕获的原生 getter／方法。

无配置迁移。位置缓存、随机坐标、WebIDL 参数、可见性、BFCache、策略与现有传感器边界独立保留。**原型形状不能制造浏览器内部 slot**：事先捕获的原生 getter 仍会拒绝合成对象，这一限制必须保留在诊断与验收记录中。

接受证据：零 ownKeys、原型 getter、原生 receiver、`toJSON`、可扩展性、缓存／随机稳定、任务回调及生命周期。不能从形状对照推定真实授权成功。

## C4：release 的真实站点授权与传感器委托

release 与 main 的差异涉及真实 Chrome 权限，必须单列：

- `spoofPermission=true`：release 用 `contentSettings.location` 把有效域及子域设为 `allow`；坐标不可解析则 `block`；被父域通配覆盖的禁用子规则以 `ask` 遮盖。`ask` 会改变该子域的浏览器授权表现，并非恢复此前的原生授权。
- `spoofPermission=false`：release 调用原生 `getCurrentPosition`／`watchPosition`，由浏览器发起授权与设备定位，成功后将返回给页面的坐标替换成配置值。真实传感器可能因此被调用。
- JS 包装并非 Chrome 权限隔离。对网站授予 `allow` 后，未接管 realm 或已捕获的原生 API 可以使用真实授权；不能宣称只因替换普通成功回调就保证真实位置永不被读取。

若采用该目标，需要新增并解释 `contentSettings` 权限；独占本扩展的 location 规则所有权，通过现有队列清理本扩展规则、重建并读回，不复制 release 中无效的“按 primaryPattern clear”。Chrome 的 `clear` 只接受 scope，并清除本扩展该类别的全部规则。API 错误必须可见，不能吞掉后标记同步成功。

配置迁移：`spoofPermission` 布尔值保留，但迁移说明明确以上新含义；导入、安装、升级都不能把真实权限变化藏在普通字体／语言迁移中。用户于2026-10-28明确选择按release自动站点授权和原生定位委托；当前代码已接入，正在独立验证。

接受证据必须在隔离 Chrome 中覆盖真实 allow／block／ask、用户已有授权、禁用子域、iframe Permissions Policy、撤销／关闭、安装升级、失败与重启恢复、原生 watch 清理和传感器调用计数。用户已明确确认该数据流影响；本地测试不能代替真实Chrome授权验收。

依据：[Chrome contentSettings](https://developer.chrome.com/docs/extensions/reference/api/contentSettings)、[Geolocation 隐私及权限](https://www.w3.org/TR/geolocation/#privacy_for_uas)。

## C5：自动出口跟随

已接入 release 的后台定时刷新与 `alarms`，启用 master 且存在有效 auto 规则时每 5 分钟检测一次，关闭时取消；启动和漏过的定时事件进行对账。复用现有 provider、超时／退避及检测结果验证，网络失败保留上次已验证结果并报告失效，不写假坐标或假成功。

迁移时保留手动坐标、手动时区、规则和历史档案。auto 规则显式绑定一个受后台检测事务管理的活动出口档案，旧档案保留但不冒充本次出口；第一次刷新未确认前保持未就绪。绑定与 verified 身份只由后台完整检测成功事务建立。手动档案与手动覆盖不随定时检测改写。

provider 请求只发送既有检测所需请求，由服务端观察请求出口地址；不向其上传 Chrome 传感器坐标、字体枚举、站点规则或浏览历史。真实出口 IP 与坐标仅留在现行用户本地配置／会话中，不写测试证据或仓库。

接受证据：开关／auto 资格、闹钟重建、重复事件合并、退出期间失败、配置与刷新并发、旧检测结果不能覆盖新绑定、网络失败、provider 切换、DNR 隔离及页面更新顺序。HTTP 请求头与页面更新不承诺跨 API 原子性。

## C6：页面更新和清除

普通包首屏仍使用 MAIN/document_start 同步模板。已初始化的语言/时区、字体、定位控制器可更新或关闭，不使用 documentId executeScript 初始化回退，不自动reload。新启用域名、此前未安装某surface或旧版本文档仍需完整重载；即使桥收到消息，也不把它当作应用成功证据，原有重载欠账保守保留。

- ISOLATED桥只派发在同一模型派生的有效HTTP(S)规则范围。后台只信Chrome sender的extension id、url、origin、tab/frame/documentId，不接受请求自报URL；只返回当前frame最小payload，管理写配置／检测／授权动作继续仅允许扩展管理页。
- 页面握手nonce只是本realm路由，不是身份认证。同页JS可干扰自己的环境和更新通道；不能据此取得扩展配置写权限、其他域配置或触发后台策略对账。每frame只保留一个在途读取并合并后续刷新。后台读取仅用已确认且与当前存储签名相同的快照，不进入配置队列、不做迁移、授权、DNR或闹钟操作。未知／初始化中快照报错，不能被编码为明确关闭。
- 后台保存后只发刷新通知；content立即确认收到，独立回拉，避免保存事务等待重新进入同一队列。多代响应与重复payload不重复装载，首屏和更新共用同一边界解析顺序。
- 撤销只恢复仍由本次安装持有的descriptor，保留网页后来修改；已缓存包装函数退休后原生透传。Date epoch不改；原生Intl resolvedOptions读取实例实际槽，旧formatter保留构造设置，locale／时区别名按原生规范化，不再用全局prototype包装器把旧formatter伪报为新设置。
- 定位watch在更新/关闭时取消，尚未交付的oneshot在同文档可见时恰好一次失败（POSITION_UNAVAILABLE），退出不回调；隐藏、freeze、BFCache仍受交付约束。已交付Position/Coordinates一直读取原WeakMap快照。其只读原型适配器留到realm销毁，停止产生新位置后也不能让旧对象失效；这不构造真实浏览器内部slot。
- 已有Worker固定创建时快照；未来Worker使用新值。BFCache返回重新读取，不能承诺冻结中即时更新。

无新增持久化字段，配置统一schema5。单元测试覆盖消息重放／伪造、突发请求、保存队列收敛、未知快照、缓存函数、网页后写descriptor、取消请求及历史Position寿命；真实Chrome覆盖首inline、同文档保存和关闭、旧formatter及旧Worker快照。完整重启、任意网站、BFCache浏览器矩阵仍需验收。

## C7：扩大Worker

用户于2026-10-28明确选择按release包装SharedWorker并接受**跨页可能分离为独立后台实例**。候选覆盖同源HTTP(S) classic/module Dedicated Worker、SharedWorker，以及原有本realm安装后自身创建Blob的递归链；未来Worker继承创建时语言/时区及展开字体名单，不引入第二份域名匹配或配置来源。

- Window相对入口使用document.baseURI，选项getter完成后重新解析；Worker realm保留原HTTP入口的解析基准。classic的importScripts相对原HTTP入口解析；module采用先prelude后绝对业务入口的静态import，业务相对模块及import.meta.url保留业务HTTP地址，保留TLA和原生初始消息顺序。
- Worker location、全局相对fetch/XHR/URL、错误栈仍会暴露Blob入口并可能与HTTP入口不同。页面必须允许Blob Worker及相应脚本依赖；构造拒绝不重试裸Worker、不创建有业务副作用的预检Worker。
- **原HTTP Worker响应CSP不会成为Blob Worker自身策略**。Blob入口继承创建方策略；业务HTTP脚本作为依赖加载。这可能改变原入口connect-src等限制，不宣称CSP原生等价。真实Chrome对照另存native与wrapped结果；用户于2026-10-28明确接受这项release入口CSP变化。不能把语言首读成功解释成策略等价。
- 同页相同URL/type/name/credentials在同一配置代复用Shared入口；跨页及配置代不共享缓存，接受实例分离。Shared module的prelude和私有业务副本在整代缓存寿命内保留，避免重连时导入已撤URL；关闭/退出只清理本次私有URL，不撤用户URL、不关闭仍有其他连接的后台实例。
- Dedicated自身Blob继续复制源以保留立即revoke语义，并同步核验原URL仍可读；选项getter撤销或跨realm撤销后不复活源。Shared自身Blob沿用同样边界。外来／安装前Blob、跨源入口、TrustedScriptURL、含extendedLifetime的SharedWorker选项保持原生且未同步；后者不能提前复制源再延迟调用可撤销源的getter。

本地测试及Chrome155隔离夹具覆盖classic/module、同页Shared复用、跨页Shared分离、配置代次、模块相对依赖/TLA、旧Worker快照、关闭恢复、参数转换和资源清理。Chrome138、任意CSP、原生定位传感器、真实站点及完整升级/BFCache不由此推定通过。

## 普通包与persona包

普通包保留配置队列、userScripts、DNR、真实定位权限管理和auto刷新。persona当前范围明确为**固定语言/时区包**，不是完整定位/字体/DNR画像：仅为指定域静态派发同源Worker所用快照，不安装实时更新通道；移除后台、管理popup/options入口、DNR及全部普通包API权限，不能通过保存或auto刷新改写固定身份。它独立核对预期预设/域名、manifest、每个ZIP路径和字节身份，不能用普通包审计代替persona审计。静态包没有普通包的在线关闭恢复，停用后已有文档仍需重建。

## 收尾条件

每项代码实施后进行对应定向验证、独立风险复核和必要的真实浏览器测试。全部本地实现和验证后 VG-045 才能进入 `review`；人工验收前不标 `done`。普通包和 persona 包各自审计，版本、tag 与发布门禁保持独立；代码提交、推送和main合并按用户原始明确授权收尾，以实际Git状态为准；本次不打tag或发布。
