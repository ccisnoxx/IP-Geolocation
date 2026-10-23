# Blob Worker 警告调查

日期：2026-10-24。用户当前不确定是否仍存在警告，明确要求查看 https://fuck-claude.vercel.app/zh/ 。

## 当前现场

使用用户已打开的 Chrome 标签，先重新扫描，再完整刷新页面并点击“开始检测”。两轮均完成，显示英文语言、非中国时区、中文／厂商字体 none detected、WebRTC no leak detected。读取该标签捕获的 warn/error：VanishGeo 和 Content Security Policy 过滤均为空。

**结论：本次未复现 Blob 源核验警告。** 页面分数与这组普通信号不证明站点执行了受支持 Blob Worker 路径，更不证明所有 Worker 同步成功。

没有改动扩展保存配置、Chrome 权限、其他扩展或个人设置；没有重载扩展，也没有绑定运行中扩展与本次候选的摘要，因此现场结果不用于验收本次字体和站点关闭修复。

原始 CDP 响应事件存在 truncated，且读取响应正文时工具报告文档响应解析期间 raw CDP 不可用。缺少完整响应头、源代码和 Blob 生命周期证据；未将空日志推导为不存在 CSP，也不推定核验失败已修复。未持久化完整网络日志、IP、Blob URL 或个人配置。

## 源码可确定的触发机制

维护源 `src/injected/runtime-modules/surfaces/blob-worker.ts` 的 Worker 构造代理只对本 realm 自身创建且仍在私有映射中的 Blob URL 进行同步 XHR GET，只有 status=200 才包装。异常或非200会输出固定警告并交回原生加载，不绕过 CSP、不复活已撤销资源。

| 情况 | 实际含义 |
| --- | --- |
| CSP / connect-src 阻止该 Blob URL 的同步请求 | 可以进入核验失败分支；需同次控制台 CSP 证据确认，不能由警告单独定因 |
| 其他 realm 撤销 Blob URL，私有映射尚存 | 核验发现源不可用，防止从私有副本复活原本失效的资源 |
| 同步 XHR 被限制或执行失败 | 同一 catch 分支；警告自身不能区分具体异常 |
| worker-src 或 module/classic 依赖加载被 CSP 拒绝 | Worker 构造／异步加载错误，不等同于前面的核验失败 |
| 外来 Blob、安装前 Blob、HTTP(S)、SharedWorker | 沿用已有未覆盖／暂停范围，不能用本站分数宣称支持 |

现有固定警告保留；没有足够现场证据支持修改 Worker、弱化核验或新增 CSP 绕行。后续若再出现，最小有效材料为同次警告与浏览器原生 CSP/加载错误；无需导出完整配置或包含精确地址的网络记录。
