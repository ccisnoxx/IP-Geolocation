> 2026-10-16：用户已明确确认本实验通过人工验收，US-EXP=done；原文中的“待人工验收/review”为交付时历史状态。人工记录见 .trellis/tasks/10-16-userscripts-loopback-fixture/implement.md。生产恢复在独立VG-023任务实施。

# Linux 仅 loopback 的真实 Chrome fixture

2026-10-16；实验状态 **done / 用户人工验收通过**。机器结论由 acceptance.mjs 重算，当前为 **GO / 0**；证据文件 linux-evidence.json。没有恢复生产 runtime，没有修改正式权限或最低 Chrome 版本，没有提交或发布。

## 启动修复与数据流

原 macOS27 / Chrome155.0.8059.80 在外层 Seatbelt 内初始化自身 sandbox 被拒绝。本轮没有修改原 loopback.sb，而是使用独立 Debian13 ARM64 Lima/VZ VM 和官方 Google Chrome155.0.8059.84。

宿主 runner → 本机 SSH/vsock → VM root 协调器 → 新 network namespace → 普通用户 Node collector → Chrome。协调器建立仅有 lo 的网络命名空间，IPv4/IPv6 非 loopback 的默认路由均为 prohibit；没有外部接口、veth、NAT、网关或 IP 转发。两个方向的本地 TCP/UDP 及非 loopback IPv4/IPv6 拒绝、子进程继承先行实测，未知不通过。

Chrome 启动参数没有关闭 sandbox。实际 chrome://sandbox 回报 Layer 1 Sandbox=Namespace、PID/Network namespaces=Yes、Seccomp-BPF=Yes、adequately sandboxed。Linux 的内核命名空间与 Chrome 自身 sandbox 独立，不要求 Chrome 再次应用 macOS Seatbelt 策略。

浏览器只访问本地 fixture、扩展控制页及 chrome://sandbox、chrome://extensions。合成快照只有 A=x-vg-a、B=x-vg-b；没有真实配置、位置、出口档案或公网查询。只修改 navigator.language，不导入生产 runtime。依赖下载发生在准备阶段；实验 Chrome/collector 的 IP 通信从启动起即受命名空间限制。该限制不覆盖 VM 内其他安装/系统进程，也不扩写为整机流量审计。

Allow User Scripts 不是绕过：临时扩展初始 UI 开关关闭、getScripts 不可用；通过正常详情页可见开关的可信鼠标输入开启，回读开关和 API。CDP 扩展调试选项只用于装载本地临时扩展；不设置 userScripts 放行 flags、prefs 或私有设置接口。自动点击与用户人工验收分别记录。

## 可复现准备

需要 macOS 的 Lima/VZ、Node22+ 和可用的 Linux ARM64 Google Chrome 安装包。使用本任务独占名称，不能指向用户日常 Chrome。创建时不挂载宿主文件系统、不装容器运行时：

```sh
limactl start --name vg-userscripts-fixture --vm-type vz --cpus 2 --memory 4 --disk 12 --mount-none --containerd none --tty=false template:debian-13
```

本轮从 Debian 官方镜像、Debian 软件源、Google 官方 Linux ARM64 deb 和 Node 官方 v24.16.0 ARM64 包准备依赖。VM 中需要 node22+、iproute2、util-linux、google-chrome 和其运行库；Node 路径为 /usr/local/bin/node。依赖包是可复用安装，不在实验运行期下载。无 headless sandbox 关闭参数。原 VM 的既有实例没有启动或修改。

准备好后从仓库根目录执行：

```sh
node --test experiments/userscripts-document-start/*.test.mjs
node experiments/userscripts-document-start/runner.mjs --linux-vm --output experiments/userscripts-document-start/linux-evidence.json
```

Linux namespace 定向测试需要在该 VM 中由 sudo 运行，以建立命名空间并降权测试；宿主执行会明确 skip，不把 skip 计为通过。生产基线比较始终由宿主 runner 读取原仓库，包含开工前已有修改与未跟踪文件。

本轮宿主实验测试19通过、4个环境专用项skip；VM内3项namespace/中断测试及宿主显式启用的1项真实Chrome跨VM传输中断测试均单独执行通过。项目typecheck、typecheck:tests、174项测试、build和Chrome dry-run通过；dry-run没有浏览器验收含义。独立复核提出的启动期取消与清理字段缺项两问题已修复并定向验证，最终JSON是在修复后重新运行生成。

## 实际验收边界

- API：register A、update B、窄路径 update、unregister 均成功且回读一致。
- 页面：16 个场景，每个独立 top/HTTP iframe 的 earliest/load/postLoad 均 PASS；earliest 必须 readyState=loading、scriptIndex=1、inline=true。
- 快照：update 后已有 A 不变；新文档和同 URL reload 为 B；unregister 后已有 B 不变，新文档和 reload 为原生。
- 匹配：localhost 与 127.0.0.1 对照、窄路径内外及相似前缀、子帧独立 URL 匹配通过。
- BFCache：实际文档实例连续性与 pageshow.persisted 联合判定；是否本次命中以 JSON 的 bfcacheObserved 为准，不能由历史一次命中代替。
- 生产：原仓库文件 changedCount=0；runtime-injection-paused 闸门保持；既有用户修改保留。
- 清理：浏览器/连接/fixture/profile、进程组、namespace 和 staging 逐层清理。VM 是可复用验收环境，交付时停止；再次复验需先启动它。

此结果不证明 macOS 原后端可启动，不覆盖 HTTPS、about:blank、srcdoc、data/blob、特殊 sandbox frame、真实生产 runtime、timezone、Worker/SharedWorker、Geolocation、Canvas、进行中的导航/注册竞态、扩展 update 或浏览器重启持久性。不访问第三方测试站点，不做恶意页面或对抗测试。

具体命令、检查结果、独立复核与人工验收状态见 Trellis 任务 .trellis/tasks/10-16-userscripts-loopback-fixture/implement.md；用户人工确认记录已补齐；生产恢复在独立VG-023任务中实施并单独等待review。
