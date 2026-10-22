# VG-034 限定嵌套 Blob Dedicated Worker

2026-10-23用户明确授权：已同步的Blob Dedicated Worker内新建的自身Blob Dedicated Worker，继承父级语言/时区快照，用当前Chrome实测美西。HTTP(S)、SharedWorker不动；完成后review等待验收，不自动提交。

依赖VG-033已done。仅递归覆盖同一接管链中、各realm安装后自身createObjectURL(Blob)创建的URL，不接管外来URL；保持CSP、撤销、错误、terminate和选项语义。复用同一加载实现，不建立新配置来源，不硬编码美西，不新增权限。父Worker未同步时不承诺子Worker覆盖。

验收包括classic/module父子组合、孙Worker、首段及模块依赖、立即revoke、消息、失败和释放、未覆盖/禁用对照；完整本地门禁和独立只读复核。
