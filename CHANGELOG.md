# 更新日志

只记对使用者有影响的变化。格式按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号跟 `manifest.json` 一致。

## 未发布

- 时区一致性补齐：`Temporal.Now.timeZoneId()` 与不带时区的 `Temporal.Now.*ISO()` 按目标时区返回
  （Chrome 156 默认开启 Temporal，此前一行代码就能读到真实时区并与 `Date` 对质）；`Temporal.Instant` 的
  `toLocaleString` 带目标时区；`document.lastModified` 按目标时区输出
- 默认 locale 补齐：`Intl.DurationFormat`、`Number` / `BigInt.prototype.toLocaleString`、
  `String.prototype.localeCompare` / `toLocaleUpperCase` / `toLocaleLowerCase` 与各 Temporal 类型的
  `toLocaleString` 跟随目标语言；Worker 内同步
- 请求头：启用站点的页面发往**其它域名**（CDN、接口、统计）的子资源请求也改写 `Accept-Language`，
  此前这些请求带真实语言；同时补上 media / websocket / ping 等资源类型
- 嵌套 Worker：Worker 里再创建的 Worker 同样换成带补丁的入口（相对路径按原脚本地址解析），
  配置更新由父 Worker 逐层转发；此前孙 Worker 读到真实时区与语言
- 配置体检：新增「声明时区与出口 IP 所在地不一致」「手动坐标离出口 IP 超过 500 公里」两条
  （各带一键修复），以及「WebRTC 策略没有生效」（被其它扩展接管或被策略锁定）；诊断页显示
  WebRTC 的期望值与浏览器实际值

## 2.4.3

- **升级提醒**：扩展装载（安装 / 更新 / 重新启用）之前就已打开的标签页不会再被补注入，
  需要**刷新一次**才会生效；之后新打开或刷新过的页面不受影响
- 关闭消息桥 P1：注入层与内容桥改为在 `document_start` 同步握手（桥先挂监听，注入层同步派发携带私有端口的事件），
  注入层不再监听任何 window 消息，页面没有入口构造握手、读取 nonce 或推送 / 清除配置
  （依赖内容脚本先于页面脚本执行的时序，已在 Chrome 119 / 156 实测）
- 后台不再向已打开的标签页晚注入注入层（即上面的刷新提醒的原因）：
  此前任何站点（包括不在规则里的站点）都可借晚注入的注入层探测到扩展并改写自身的伪装值
- 烘焙构建的静态 `content_scripts` 改为桥在前、注入层在后
- 修复 Chrome 119 上 blob / data 子框架偶发停在原生值：119 的 `tabs.sendMessage` 不按 `documentId` 隔离，
  同 frame 旧文档的帧凭证会落到新文档，导致后台每次都按身份不符拒绝；桥收到该错误时丢弃旧凭证再重试

## 2.4.2

- 函数伪装：`Function.prototype.toString` 的替换物改成方法形状 —— 没有自有 `prototype`、
  `new` 会抛 TypeError、`Object.getOwnPropertyNames` 只剩 `['length','name']`，与原生内建函数同形
- `disguise()` 改为惰性安装：原生值已经等于目标值时不碰 `Function.prototype.toString`
- 注入层与 Worker blob 显式 `"use strict"`：sloppy 代码里的函数会多出自有 `arguments` / `caller`，
  那是页面一行就能看出来的残差
- 后台消息按来源分权：内容脚本只能调用三个只读 action，任意管理动作不再能从内容桥转发（P1 桥缺口仍开放，见 `REVIEW-P1-BRIDGE.md`）
- opaque frame 的文档身份与父链证据独立建模，补上 frames / opaque-frames / opaque-recovery 冒烟
- 新增 `test:coverage:security` 覆盖率门禁（消息来源策略、opaque frame 证据、补丁开关、函数伪装逐文件阈值）
- `native-parity` 增加函数对象自身的 own keys / own symbols / descriptors / IsConstructor 比对
- 发布流程：正文改成从 `default-domains.json` / `DEFAULT_PROFILES` / `release/*.json` 生成；
  真浏览器冒烟挡在创建 Release 之前；`--require` 跟着预设数量现算

## 2.4.1

- 加固后台消息权限：从「router 直接调用 service」改为显式来源策略
- 页面与 Worker 的配置更新生命周期对齐（含 set* 家族）
- 修复 Date / Intl 的若干真实语义差异
- 发布校验去掉恒真路径

## 2.4.0

- 域名树规则按浏览器 API 能力拆分，不再复用一张排除表
- 权限撤销走 Chrome API 能力模型
