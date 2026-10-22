# VG-002 设计

## 所有权与数据流

后台 launcher 只构造固定 HTTPS URL 加固定 ui=zh，不再读取配置、解析有效 profile、读取 privacy API 或序列化异常。删除 appendExpectedProfileParams 及专属辅助函数，配置权威所有者不变。

leak-test 删除 ExpectedProfile、validation/expected*/actualWebRtc* query 解析、比较和 verdict 计数。所有行显示实际观测和 UNKNOWN；摘要明确 observation mode。普通网页无法观察 Chrome privacy policy，显示不可观察说明，不发送 runtime 消息。locale 示例使用页面当前 Date。

设备基线仅为旧有的本地实际观测快照，保留记录/清除与人工参考，不产生 PASS/FAIL。iframe/worker 继续采样现有 API；不新增伪装。STUN 与 ICE timeout 使用既有固定默认值。删除无调用者的诊断比较和 profile locale 格式化辅助函数。

页面设置 no-referrer；同源 header fetch 明确 referrerPolicy=no-referrer，避免手工打开旧敏感链接后再经请求 Referer 传播。页面不读取/回显预期 query；无法撤销已经到达旧 URL 服务器或浏览器历史中的数据。

## 控制台预期数据边界

收尾核对发现 debugMode 原先记录完整 runtime payload。为满足本任务明确的控制台隐私要求，仅把内部 log 收紧为单一 string，并删除固定应用提示后的 payload 参数。不开新伪装面，不改 payload、注入或页面 API 返回值；新增 VM 捕获日志回归，同时验证实际语言/时区/位置仍按配置返回。

## 合同同步

Chrome 验收脚本不构造 expected query，清单要求人工比较实际值，明确观察页不完成配置验收。只同步本任务所需 README/PRIVACY、质量规范、A02 验收及 VG-002 清单。清单中的阶段与验收以本次明确指令更新；其他任务保留。

## 生命周期与回滚

无 schema、storage、迁移、runtime action、manifest、权限、DNR 或注入改变。每次打开仍创建一个标签；失败传播给既有调用者。页面快照只在内存，设备基线仍使用原 localStorage 键，无新配置事实来源。

回滚仅反向应用本任务补丁并重建 dist，不 reset/clean，不改浏览器数据。若撤回观察页 UI，仍必须保留 launcher 不传敏感值的边界；完整回退旧 launcher 会重引入已确认泄露，不作为安全回滚。

## 验证

后台使用合成 profile 覆盖有效/无匹配/禁用/未绑定/不同 WebRTC 模式，断言 URL 精确白名单及配置/策略无读取。页面 VM 覆盖旧敏感 query 与策略快照被忽略、无桥、实际 API/headers 可见、成功/失败 ICE 均不判 PASS/FAIL；静态 wiring 保护源码和脚本。独立只读复核 URL/页面/外部请求边界；本地门禁不替代真实 Chrome 人工验收。
