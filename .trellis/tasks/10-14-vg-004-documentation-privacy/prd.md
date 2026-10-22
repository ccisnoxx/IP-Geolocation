# VG-004：清理文档、隐私说明和旧项目信息

2026-10-14 用户授权 R1，依赖 VG-003（manifest done，人工验收一致）。分支 stabilize/VG-004，提交 5701b55。保留任务前所有未提交工作与图标资产。

## 目标与验收

公开文档只描述当前 VanishGeo 安装、配置、构建、诊断和发布行为。移除个人绝对路径、真实公网 IP 示例、旧项目操作、已删除地区预设及不可验证评分承诺。补齐主动出口检测、local/session/内存、配置导出、普通诊断页观测、扩展侧比较、header echo/STUN、DNR、WebRTC 与 all_urls 隐私边界。示例使用 RFC 5737 文档地址；保留必要的许可证来源归属。

README、INSTALL、CONFIG_GUIDE、PRIVACY、PERMISSIONS 与源码一致；RELEASE 与 scripts、完整 dist 和现有 Actions 一致；本地链接与命令核验通过。历史敏感值只记录待人工批准的清理方案。repository description/topics 仅供人工设置。

## 范围和授权

只修改文档、必要文档验证和 VG-004 治理记录。不改运行时、schema、storage、迁移、消息、manifest、DNR、权限、依赖或 workflow；不重写历史、不提交、不推送、不发布、不部署、不实施后续任务。实现与本地验证结束为 review，completedAt=null；done 需要用户人工验收。

## 清单校准

旧 VG-004 WebRTC 条目是初始路线；当前明确文档清理请求覆盖该计划，校准同一 manifest。A04 完整策略生命周期与 ICE 验收仍保留为待用户重新分配的缺口；不能以 VG-004 文档完成推断通过。后续任务只读取 manifest；提示词包是模板，不是第二份状态清单。
