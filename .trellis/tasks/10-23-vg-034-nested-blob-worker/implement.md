# VG-034 实现与验证

状态done。用户于2026-10-23明确验收通过，授权将本次修改提交到本地，要求先不推送。

## 实现

生产改动仅在Blob bootstrap入口复用installBlobWorker，以及构建footer显式传入自包含函数自身。每层独立持有URL表和待清理Worker；下一层继承父级已捕获的最小payload，不重新采样navigator或读取配置，不增加权限或热更新。HTTP(S)/SharedWorker/外来Blob不接管，未同步父级不承诺其后代。

新增VM用实际生成的入口执行classic子孙，验证闭包自包含、快照不受父级navigator随后改写影响及HTTP/外来URL透传。界面和能力文档同步限定范围。

## 验证

- `npm run check`通过：源与测试typecheck、294/294测试、生产build；生成的生产函数自包含。
- `scripts/serve-nested-blob-worker-probe.ts`独立TypeScript检查通过。
- 当前Chrome正常重新加载实际dist、完整刷新既有检测页；classic/classic、classic/module、module/classic、module/module父子组合均测试到孙级，首段及模块依赖、提前消息、立即撤销原URL全通过。各层语言en-US、列表[en-US,en]、Intl默认en-US、时区America/Los_Angeles，冬季offset480、夏季420。
- 生产扩展中终止根Worker后，500ms观测窗口内子孙定时消息为0，刻意保留的Worker内原URL全部不可读，叶级语言/时区仍匹配。
- 同一Chrome的loopback资格fixture共40组通过：classic/module父Worker内同步XHR、CSP核验拒绝警告并原生加载、原生import对照、worker-src none阻断、业务错误、立即terminate、已撤销、HTTP及外来Blob透传。每组最终URL存活0；不把HTTP fixture中显式装补丁算成生产HTTP覆盖。
- 独立只读核心及最终复核未发现剩余具体阻断项；最终复核包含探针判定、40组证据、候选哈希、范围文案和隐私。真实Chrome由主代理采样，复核者未冒称亲自操作。`git diff --check`通过。

## 边界调查

初版跨线程立即检查在terminate组曾看到1个URL。创建者Worker内同步检查与100ms后页面检查均为0，符合BlobURLStore撤销异步传播；不宣称立即跨线程原子可见。没有为此增加生产延迟或重试。

初版把script-src self导致module失败作为预期；新增原生静态Blob import对照表明同样放行module。classic importScripts与module静态图的请求策略不同。最终以同结构原生对照及worker-src none负例验证，不修改loader绕过CSP；connect-src拒绝仍明确未同步。

详见[脱敏Chrome证据](chrome-evidence.json)，区分生产实测和合成资格测试。旧Worker/BFCache需重建、Blob地址可观察变化、同步核验成本及TrustedScriptURL限制沿用VG-033。

临时探针服务已停止，临时Chrome标签页已关闭，原页面DevTools已收起。用户站点配置未更改；实际dist候选已加载，现有目标页已完整刷新。

## 人工验收与提交授权

2026-10-23用户明确确认本次验收通过，任务清单与task.json同步为done。本地提交包含限定嵌套Blob实现、测试、文档与脱敏Chrome证据，不推送、不发布。chrome-evidence.json中的review保留为采样时状态。收尾只更新验收记录及状态文案，复用上一轮294/294测试、类型检查、构建和40组Chrome边界对照；所有证据绑定的产物、实现和探针SHA-256一致，提交前复查差异。
