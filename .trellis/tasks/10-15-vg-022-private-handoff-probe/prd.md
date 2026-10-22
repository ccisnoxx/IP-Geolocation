# VG-022：方案B P1私有交接隔离验证

依赖VG-020 done；VG-021研究已人工done但不是方案B的执行依赖。本任务只按RFC5.3/9执行隔离P1，不恢复生产，不改src、正式manifest/构建、权限、版本、旧证据或依赖，不提交/推送/发布。

验收：真实Chrome临时MV3扩展动态注册MAIN与ISOLATED，两种注册顺序及top/iframe/srcdoc/blank。后台仅向原runtime.Port响应，校验原生sender，固定合成grant不来自网页。区分同步CustomEvent.detail交接与公开postMessage/MessagePort对照；测试页面捕获、抢占、伪造broker、nonce/isTrusted/source过滤和跨文档转接。覆盖首脚本、父页/opener、初始blank/global复用、document.open、重入/复制端点；不能把未抢占或全部拒绝写作安全通过。

报告具体候选GO/NO_GO、最小反例、未验证范围及恢复门槛。成功伪造/截获则停止对应设计，不为通过实验增加权限、公开配置桥或密码依赖，不实施P2/P3/P4。允许晚交接的反例需标注受控启动条件，不能冒充所有早期私有设计不可能。收尾manifest/Trellis为review，人工确认前不done。
