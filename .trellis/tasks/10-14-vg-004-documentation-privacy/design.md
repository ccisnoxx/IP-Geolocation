# VG-004 设计

## 事实来源

package.json、manifest.json、vite.config.ts、release.yml 决定命令、版本、权限、产物和发布触发。services 的 GEO_API_URLS/detect/confirm 决定主动检测及 session/local；config-model/resolver/storage 决定配置、verified 与迁移；diagnostic-runs/probe/report 决定内存 TTL、可信文档、采样与比较；外部 leak-test 决定 localStorage 和网页可见数据。文档链接到这些维护源，不增加配置或匹配事实来源。

## 文档分工

README 为功能与边界入口；INSTALL 为当前 unpacked 安装/更新；CONFIG_GUIDE 为规则、auto 绑定、manual、WebRTC 与诊断步骤；PRIVACY 为全扩展数据流；PERMISSIONS 为当前权限用途；RELEASE 描述现有 workflow 及其尚未具备的门禁；CONTRIBUTING 说明合成数据、验证和待批准历史清理；NOTICE 保留 MIT 来源，纠正主动检测说明。提示词包去个人路径并明确以 manifest 校准范围。

## 生命周期与限制

出口检测依次请求三个 provider，首次完整响应结束，不拼接；session 候选五分钟后不可确认，但无定时删除器，过期访问/新检测/确认/取消及浏览器会话清理各有实际边界。已确认 local 档案可含公网 IP 和位置；完整配置导出未经脱敏。诊断 run 两分钟、一次性、仅内存；报告不是完整浏览器审计或匿名承诺。

## 回滚和停止条件

仅恢复 VG-004 可归属的增量，不 git reset/clean，不撤销 VG-000～003，不碰用户浏览器数据。只在依赖未 done、不可消解合同冲突、需要未批准破坏性操作/权限或服务授权、违反安全边界或不可区分的阻塞基线时 blocked。没有此类阻塞。
