# VG-025 固定名单字体暴露过滤

> 当前状态（2026-10-22）：用户已确认本次最小字体允许名单改动验收通过。主清单为 done，Trellis 为 completed；验收仅限下文顶层 Canvas 测量允许名单，check/iframe及既有门禁不变。历史阶段的 review/pending 为当时记录，不扩大为其他指纹、旁路、原用户现场取证或跨平台验收。暂不提交或发布。详见[人工验收与收尾](implement.md#2026-10-22-人工验收与收尾)。

依据实施计划第7节；VG-024 与历史 VG-023 均 done。交付固定厂商/软件名单单文件候选、allowlist 派生串行对账、真实 Chrome 定向证据和恢复门禁。custom 名单不生产派发。仅 CanvasRenderingContext2D.measureText 和 FontFaceSet.check；普通字体及绘图/像素/导出原生。禁用只影响新文档，旧文档/BFCache必须完整重建。无敏感payload/页面桥/异步storage/documentId回退。首版不承诺 OffscreenCanvas、DOM/local()/Worker；真实 Chrome、独立复核与人工恢复授权齐全前保持生产暂停。结束review，不提交发布。

## 当前授权与验收边界

2026-10-20用户已明确授权恢复固定内置名单字体过滤，仅对启用HTTP(S) allowlist生效；自定义名单、位置和Worker继续暂停。FONT_FILTER_PRODUCTION_APPROVED已开启，不额外启用任何用户配置或新增权限。原始第7节生产恢复的实现、实际dist Chrome定向验证及独立复核已通过，状态为review；人工恢复授权与人工验收分开，未获得人工验收通过前不得done。暂不提交或发布。额外浏览器冷启动临时安装fixture仍BLOCKED，历史证据保留。

## 2026-10-22 简繁中文字体名单扩展授权

用户明确授权将目标站点的19项简体及8项繁体中文字体加入现有生产固定名单，仍仅启用HTTP(S) allowlist生效。单一名单由16项扩展为43项，保留vendor-software配置键、默认关闭、总开关/字体开关/规则门禁、custom暂停及每文档快照。仅改变现有measureText/FontFaceSet.check目标集合，不扩展DOM/local()/OffscreenCanvas/Worker或图像/绘制表面，不新增权限/网络请求。验收包含精确名单、v2/v3兼容、实际dist真实Chrome的目标站点宽度算法正负对照、未匹配域及禁用原生、完整本地门禁。历史现场取证停止状态不变；结束review，人工验收pending，不提交发布。

## 2026-10-22 顶层 Canvas 测量允许名单授权

用户明确授权最小实现：仅已启用 HTTP(S) 白名单顶层文档的 measureText 使用 monospace、sans-serif、serif 固定允许名单。移除其余具名字体，保留允许项顺序及字体样式；没有允许项时回退 sans-serif；原生测量完成或抛错后恢复 font。引号中的同名字体按具名字体处理。FontFaceSet.check 与 iframe 继续现有43项固定名单逻辑。生产入口在包内选择顶层策略，不增加持久化配置、权限、主机范围或页面通信，不改 Chromium。普通 HTTP(S) 文档范围、现有注册/开关门禁与人工重载合同不变，不实施全部 iframe 首读保证或后续旁路实验。

验收包括：通用字体原生结果；已知43项及未知合成别名的目标站宽度算法；顶层与普通 iframe 区别；check 非目标仍原生；三个开关/规则门禁及未匹配域；原生 TextMetrics、转换异常、font恢复和绘图/像素/导出透传。使用实际 dist 的独立临时真实 Chrome，不操作用户 profile、不请求外部 provider。本地结束 review，人工验收 pending，不提交发布。
