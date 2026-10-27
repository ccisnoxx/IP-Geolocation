import { evaluate, openPage, sleep } from './cdp.mjs';

/** 打开页面并确认真的导航到了目标 URL（about:blank 的 load 事件会抢先返回）。 */
export async function openPageStable(cdp, url) {
  const page = await openPage(cdp, url);
  let navigated = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let href = '';
    try { href = await evaluate(cdp, page.sessionId, 'location.href'); }
    catch { /* navigation in progress */ }
    if (href === url) {
      navigated = true;
      break;
    }
    if (attempt === 10 && href === 'about:blank') {
      await cdp.send('Page.navigate', { url }, page.sessionId).catch(() => {});
    }
    await sleep(100);
  }
  if (!navigated) throw new Error(`page did not navigate to ${url}`);
  return page;
}

/** 在扩展自己的页面里发 runtime 消息，统一处理 lastError。 */
export function sendRuntimeMessage(cdp, sessionId, message) {
  return evaluate(
    cdp,
    sessionId,
    `new Promise((resolve, reject) => chrome.runtime.sendMessage(${JSON.stringify(message)}, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    }))`,
    { awaitPromise: true }
  );
}

/** 轮询一个可能异步变化的条件，超时打印最后一次值。 */
export async function waitFor(predicate, { timeout = 10000, interval = 120, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) return last;
    } catch {
      /* 页面/配置还在变化，继续等 */
    }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

export { evaluate, openPage, sleep };
