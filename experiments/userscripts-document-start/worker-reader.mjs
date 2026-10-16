// 只供 fixture 通过 CDP 读取扩展 worker；不触发业务消息或启动 worker。
const transientProtocolError = error => Number.isInteger(error.cdpCode)
  && /^(?:Cannot find default execution context|Cannot find context with specified id|Execution context was destroyed|Inspected target navigated or closed|No target with given id found|Session with given id not found|Target closed|No session with given id)(?:[.!]|$)/i.test(error.message);

export function createWorkerReader(cdp, extensionOrigin, { attempts = 200, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const sessions = new Map();
  const diagnostics = { attachments: 0, unavailableContexts: 0, wrongVersions: 0, invalidations: 0, targetChanges: 0 };
  let lastTarget;
  const targets = async () => (await cdp.send('Target.getTargets')).targetInfos
    .filter(target => target.type === 'service_worker' && target.url.startsWith(extensionOrigin));
  async function detach(targetId) {
    const sessionId = sessions.get(targetId);
    sessions.delete(targetId);
    if (!sessionId) return;
    try { await cdp.send('Target.detachFromTarget', { sessionId }); }
    catch (error) { if (!transientProtocolError(error)) throw error; }
  }
  return {
    diagnostics: () => ({ ...diagnostics }),
    // expression 仅来自仓库固定调用点；只读操作才可因 context/target 失效而重试。
    async read(expression, version, accept = () => true) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const available = await targets();
        for (const targetId of sessions.keys()) {
          if (!available.some(target => target.targetId === targetId)) await detach(targetId);
        }
        for (const target of available) {
          const targetId = target.targetId;
          try {
            if (!sessions.has(targetId)) {
              const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
              sessions.set(targetId, sessionId); diagnostics.attachments++;
              await cdp.send('Runtime.enable', {}, sessionId);
            }
            const sessionId = sessions.get(targetId);
            // API 就绪、版本判断和实际读取处于同一次求值，不在 undefined namespace 上调用 API。
            const result = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
              expression: '(async () => { const c = globalThis.chrome;'
                + ' if (typeof c?.runtime?.getManifest !== "function" || typeof c?.userScripts?.getScripts !== "function"'
                + ' || typeof c?.userScripts?.unregister !== "function") return {ready:false};'
                + ' const version = c.runtime.getManifest().version;'
                + ' if (version !== ' + JSON.stringify(version) + ') return {ready:true,version};'
                + ' return {ready:true,version,value:await (' + expression + ')}; })()' }, sessionId);
            if (result.exceptionDetails) throw new Error('WORKER_READ_EXCEPTION');
            const row = result.result.value;
            if (!row?.ready) { diagnostics.unavailableContexts++; continue; }
            if (row.version !== version) { diagnostics.wrongVersions++; continue; }
            // 读取期间若 target 已换代，旧 session 的成功返回也不能成为新一代证据。
            if (!(await targets()).some(current => current.targetId === targetId)) {
              diagnostics.invalidations++; await detach(targetId); continue;
            }
            if (!accept(row.value)) continue;
            if (lastTarget && lastTarget !== targetId) diagnostics.targetChanges++;
            lastTarget = targetId;
            return { value: row.value, worker: { targetId, sessionId },
              readiness: { apiReady: true, version: row.version, ...diagnostics } };
          } catch (error) {
            if (!transientProtocolError(error)) throw error;
            diagnostics.invalidations++; await detach(targetId);
          }
        }
        if (attempt + 1 < attempts) await delay(50);
      }
      throw new Error('WORKER_READINESS_TIMEOUT');
    },
    async close() { for (const targetId of sessions.keys()) await detach(targetId); }
  };
}
