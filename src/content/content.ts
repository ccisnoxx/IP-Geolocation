/**
 * ISOLATED world 桥：把后台解析好的 payload 送进 MAIN world。
 *
 * 通道模型换过一次，原因值得写下来。
 *
 * 旧做法是 `window.postMessage({ __vanishGeo: NONCE, payload })`：nonce 是构建期
 * 随机值，看起来安全，但页面的 `message` 监听器和我们监听的是**同一个事件**。
 * 页面只要 `window.addEventListener('message', e => e.data)` 就能读到 nonce 和
 * 整份 payload，之后想推什么就推什么 —— 共享秘密一旦上了公开频道就不再是秘密。
 *
 * 第二版用 `window.postMessage` 递 MessagePort 握手，仍是异步派发：页面的 message
 * 监听器能拿到端口，晚注入时还能抢先构造握手、从 ack 读出 nonce 后任意驱动 runtime。
 *
 * 现在的握手在 document_start 同步完成（见 content-bridge.ts）：
 * 桥先挂监听，runtime 同步派发携带私有端口的事件，页面脚本还没执行过；runtime 不再
 * 监听任何 window 事件，也不再被晚注入。安全性只依赖派发时机，构建 nonce 仍只是
 * 消息标识，不是秘密。
 *
 * `--no-bridge` / `--frozen` 构建里 `__VANISHGEO_BRIDGE__` 为 false，这个文件整体空转：
 * 配置已经烘焙进 runtime.js 且不再接受运行时更新，完全不需要通道。普通 persona
 * 构建仍保留桥，排除站点 / 关总开关 / 改配置都要能实时 clear。
 *
 * 具体实现拆到 content-bridge.ts，便于在 Node 里单测；这里只读构建期常量并启动。
 */

import { createContentBridge } from './content-bridge';

(function () {
  if (typeof __VANISHGEO_BRIDGE__ === 'boolean' && !__VANISHGEO_BRIDGE__) return;
  if (typeof __VANISHGEO_NONCE__ !== 'string' || !__VANISHGEO_NONCE__) return;
  createContentBridge({ window, document, chrome, nonce: __VANISHGEO_NONCE__ });
})();
