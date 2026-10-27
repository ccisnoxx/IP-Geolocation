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
 * 现在改成私有端口：
 *
 * 1. content script 在 `document_start` **同步**发出一条握手，携带 `MessagePort`；
 *    此刻页面还没有任何脚本执行，也就没有任何监听器能看到这条消息。
 * 2. MAIN world 的 runtime 早已挂好一次性监听器，收下端口后立刻移除自己的
 *    `message` 监听 —— 之后再没有任何可观测的握手。
 * 3. 后续 payload 全部走端口。端口只有两端持有（runtime 的闭包、这里的闭包），
 *    页面既看不到也拿不到；端口消息还要再校验一次 nonce，即使某个极端路径下
 *    端口被抢走，伪造消息也会被丢弃。
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
