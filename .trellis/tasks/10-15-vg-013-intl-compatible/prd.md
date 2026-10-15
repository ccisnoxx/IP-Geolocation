# VG-013：增加时区与 Locale 兼容模式

依赖 VG-012 人工 done；本次授权 R3，替换 manifest 同 ID 初始集成计划；原 A13 缺口保留待重新分配。仅实施 VG-013，最终 review，人工确认前 completedAt=null。

## 目标与验收

- 全局 intlMode 为 strict/compatible；缺失字段、新安装、reset 默认 strict，旧用户升级行为不变。
- strict 保持已有强制 locale/timeZone；compatible 逐参数补省略/undefined 默认，显式参数交原生，含原生错误；空 locale 数组是显式值。
- Date 本地 getter/墙钟使用有效时区，两模式相同；Date locale 方法和既有 Intl 构造器遵循同一策略。
- top/iframe/Worker/SharedWorker/nested 的初始化模式一致；配置转换幂等且无其他数据丢失。
- Popup/Options 可保存并解释兼容性与一致性取舍；诊断包含默认及固定显式参数比较，无规避检测承诺。
- 生产 MAIN 安全暂停、可信 sender/verified/权限/host/DNR/WebRTC 边界保持。真实 Chrome 隔离测试不表示恢复生产。

## 不实施

生产派发恢复、新设备表面、WebRTC 语义、完整集成验收或发布、依赖升级与新增生产依赖。
