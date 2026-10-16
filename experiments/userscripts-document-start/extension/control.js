// 代码和数据都来自扩展包；网页不参与配置、模板或代码交付。
const snapshots = Object.freeze({
  A: Object.freeze({ language: 'x-vg-a' }),
  B: Object.freeze({ language: 'x-vg-b' })
});
const registrationId = 'vg-local-snapshot';
function sourceFor(key) {
  if (!Object.hasOwn(snapshots, key)) throw new Error('未知合成快照');
  return `(() => {
    const snapshot = Object.freeze(${JSON.stringify(snapshots[key])});
    Object.defineProperty(Navigator.prototype, 'language', {
      configurable: true, enumerable: true, get: () => snapshot.language
    });
  })();`;
}
function description(key, narrow = false) {
  return {
    id: registrationId,
    matches: [narrow ? 'http://localhost/matched/*' : 'http://localhost/*'],
    allFrames: true,
    world: 'MAIN',
    runAt: 'document_start',
    js: [{ code: sourceFor(key) }]
  };
}
async function verified(key, narrow) {
  const rows = await chrome.userScripts.getScripts();
  const expected = description(key, narrow);
  const row = rows[0];
  return rows.length === 1 && row.id === registrationId &&
    row.world === expected.world && row.runAt === expected.runAt && row.allFrames === true &&
    JSON.stringify(row.matches) === JSON.stringify(expected.matches) &&
    row.js?.length === 1 && row.js[0].code === expected.js[0].code;
}
// 只在非 WAR 的扩展控制页暴露固定动作；不设置消息、DOM 或网页配置桥。
globalThis.vgExperiment = Object.freeze({
  async probe() {
    try {
      if (!chrome.userScripts) return { available: false, reason: 'USER_SCRIPTS_UNAVAILABLE' };
      const rows = await chrome.userScripts.getScripts();
      return { available: true, empty: rows.length === 0 };
    } catch {
      return { available: false, reason: 'USER_SCRIPTS_UNAVAILABLE' };
    }
  },
  async registerA() {
    await chrome.userScripts.register([description('A')]);
    return verified('A', false);
  },
  async updateB() {
    await chrome.userScripts.update([description('B')]);
    return verified('B', false);
  },
  async narrowB() {
    await chrome.userScripts.update([description('B', true)]);
    return verified('B', true);
  },
  async unregister() {
    await chrome.userScripts.unregister({ ids: [registrationId] });
    return (await chrome.userScripts.getScripts()).length === 0;
  }
});
