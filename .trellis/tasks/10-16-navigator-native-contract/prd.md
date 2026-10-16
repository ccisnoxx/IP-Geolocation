# navigator.language 原生合同与状态隐私修复

用户授权修复本会话审查确认的三项问题，仅限兼容性和隐私一致性。此任务独立于已验收稳定化清单，不恢复生产 MAIN 注入，不增加权限、配置桥或设备伪装。

## 实施合同

- 移除页面和 Worker 的全局 Symbol 状态及 Object/Reflect/Function.prototype.toString 替换。反射直接读取实际 descriptor，不维护平行缓存。
- 保持 Navigator / WorkerNavigator prototype 上的原生 getter proxy；安装 flags 不变，非目标 receiver 调用原生 getter。
- 状态由每次安装闭包拥有，安装返回私有 update 句柄，调用方只通过该句柄维持同次安装的幂等和未来 Worker 更新。新序列化安装不再从网页全局找回前次状态；未来生产恢复须另行设计句柄生命周期，不能发布页面 marker/桥。
- 保持 SharedWorker 同安装缓存、Blob 回收、Intl 配置策略与现有失败语义。函数反射返回引擎实际结果，不保证包装函数 source 与原函数文本相同。

## 验收

- 回归保护全局 own keys（包含 Proxy 和另一 realm 的反射）、完整反射 API 引用/descriptor/构造/非法调用合同；属性更新、删除和 freeze 的 descriptor 反映实际状态。
- 页面、独立 iframe realm、classic/module Worker 与 SharedWorker 有明确测试；非目标 receiver 包含非法对象和合法跨 realm Navigator。
- 保留生成函数及二次 Worker 序列化自包含、map/watch 构建守卫。
- 真实 Chrome 定向验证与 Node/VM 分别报告；生产暂停的 wiring/行为证据保持。
- 完成项目本地门禁，fresh critical_reviewer 独立只读复核；不提交、push 或发布。

## 2026-10-16 追加授权：iframe 浏览器覆盖

继续补齐跨源、srcdoc 和 about:blank iframe 的真实 Chrome 回归；仅扩展测试、证据及相关规范，不恢复生产注入或改变 runtime。跨源用不同 localhost 端口构成真实不同 origin，保留浏览器同源策略；CDP 逐 frame 选择原生 MAIN 执行上下文，不通过父页跨源 eval。每个 realm 分别捕获原生基线，核对 prototype/descriptor/getter receiver、反射与内部状态不可达性；srcdoc/about:blank 验证继承 origin，跨源访问的 SecurityError 与合法非目标 receiver 结果分开判定。保留原页面/Worker 回归。

## 2026-10-16 追加授权：OOPIF 与 sandbox opaque origin

继续补齐跨站点 OOPIF 和 sandbox opaque origin 的真实 Chrome 回归。只扩展测试及相关证据，保持生产暂停和既有实现。跨站点 fixture 使用 localhost 与 127.0.0.1，本地 Chrome 开启 site-per-process，必须由实际 iframe target/session 证明 OOPIF，不能以 URL 跨源冒充进程隔离。CDP 按 session+frame 默认上下文定向；opaque 场景采用 sandbox=allow-scripts、不含 allow-same-origin，核对有效 origin 为 null、父子/opaque sibling 原生 SecurityError。各场景独立核对 prototype、descriptor、receiver 与内部状态；没有可访问的合法跨 realm Navigator 时保留原生非法 receiver 和访问拒绝对照，不绕开同源策略取得对象。
