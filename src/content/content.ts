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
 * 现在通过携带 MessagePort 的 window 握手建立通道，后续 payload 走端口。
 * 已知安全缺口：postMessage 异步派发，晚注入时页面可能先监听或构造握手；
 * runtime 的 ack 还会回传构建 nonce，因此端口和 nonce 检查并不构成身份认证。
 * 构建常量也随发行包公开，不能直接当作共享密钥。需要重新设计信任边界，
 * 不能把这里的功能接线测试视为安全验收。
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
