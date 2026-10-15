# 最早 inline script 时序验收

构建后由本地服务提供 `fixtures/injection/earliest-inline.html`。top 与 `child.html` 都以 head 的首个同步 inline script 读取 language、languages、locale、timezone、固定日期 `1768478400000` 的 offset，以及 readyState/scriptIndex/inline/capturedAtMs。srcdoc 与先创建 about:blank 再 document.write 的文档执行同一首脚本正文；不是父页在 load 后遍历读取来模拟早期值。Chrome 中 document.write 后空白帧 URL 可继承创建页，因此报告用 frame 的声明来源作描述性标签；授权仍依据独立文档身份/有效 origin 和原 resolver。

每个文档在首脚本先保存 earliest，再注册 load 回调保存 load；到 load 时只将既有两个实际快照放进本 fixture 的 JSON script 和可见区域。扩展报告另读 postLoad（本次报告采集）的实际 API。三个阶段分别比较，后阶段 PASS 不能补足 earliest FAIL。没有 runtime marker、预期配置、URL 参数、页面配置桥或站点存储。

```bash
npm run build
npm run test:e2e:chrome -- --injection --runs=3
```

自动入口需要 Node22+ 原生 WebSocket 与支持 Extensions.loadUnpacked 的真实 Chrome，可用 CHROME_BIN 指定可执行文件。使用独立临时 profile、合成语言/时区和普通 localhost，先采未启用对照，再启用规则并重复导航。每次等待本次 loaderId 的 load，只取回首脚本已经保存的值。证据、比较、渲染和返回值来自同一次扩展 run，且只读取固定 fixture 路径；不调用 provider、位置、header echo 或 STUN。退出0为全PASS、1为实际FAIL/UNKNOWN、2为自动化失败。`--output <path>`保存脱敏JSON，默认只打印阶段结果；JSON有实际语言/时区，但没有IP、坐标、run/documentID或个人路径。profile/server在finally清理。

人工检查：`npm run serve:leak-test`后，加载最新dist，在Options给localhost配置合成语言/手动时区（关闭位置或配置有效合成值），刷新本fixture。从Popup/Options打开扩展诊断报告，选择该标签页并点击“VG-009 · 验收最早 inline script”。比较四类文档的earliest/load/postLoad实际和预期。普通网页不能读取预期或给出配置PASS/FAIL；生产页面不添加本fixture的JSON元素。

首次真实Chrome结果和最终候选证据以[VG-009执行记录](../../.trellis/tasks/10-15-vg-009-earliest-inline/implement.md)为准。动态document_start只保证ISOLATED初始化通知的调度点，不能凭声明推断异步后台配置读取与MAIN执行先于首脚本。缺失fixture/不明origin为UNKNOWN；不把本地Node/VM/dry-run、Chrome155定向结果或加载后通过扩大为Chrome119、跨源/sandbox/所有空白帧、冷启动或人工验收通过。
