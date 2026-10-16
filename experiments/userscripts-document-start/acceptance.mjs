// 所有 GO 判定只在此处生成；collector 完成循环不能自行批准 GO。
export const scenarioDefinitions = [
  ['A-native', 'top/iframe earliest、load、postLoad 均原生'],
  ['B-register-A', 'top/iframe 三阶段均 x-vg-a，两个独立文档'],
  ['B-broad-subpath', 'localhost 任意子路径三阶段均 x-vg-a'],
  ['E-other-origin', '127.0.0.1 top/iframe 三阶段均原生'],
  ['C-existing-A', 'update 完成后已有 top/iframe 仍 x-vg-a，文档未重建'],
  ['C-reload-B', '同 URL 完整 reload 创建新 top/iframe，三阶段均 x-vg-b'],
  ['C-new-tab-B', '新标签 top/iframe 三阶段均 x-vg-b'],
  ['F-history-away', '旧 A 导航到 127.0.0.1 后 top/iframe 均原生'],
  ['F-history-back', '缓存恢复保留 A；文档重建用 B；各阶段无跨文档串用'],
  ['F-history-forward', '127.0.0.1 前进恢复或重建均原生'],
  ['E-narrow-inside', '/matched/sub/* top/iframe 三阶段均 x-vg-b'],
  ['E-narrow-outside', '/outside/* top 原生，独立匹配的 /matched/child.html iframe 为 B'],
  ['E-narrow-near-miss', '/matchedness/* top 原生，独立匹配 iframe 为 B'],
  ['D-existing-B', 'unregister 后已有 top/iframe 保留 B，文档未重建'],
  ['D-new-native', 'unregister 后新文档 top/iframe 三阶段均原生'],
  ['D-reload-native', 'unregister 后同 URL reload 三阶段均原生']
];
export const phases = ['earliest', 'load', 'postLoad'];
export const networkChecks = ['loopbackTcp', 'loopbackUdp', 'deniedTcp4', 'deniedTcp6', 'deniedUdp4', 'deniedUdp6', 'inherited'];
const aggregate = states => states.includes('FAIL') ? 'FAIL' : states.every(s => s === 'PASS') ? 'PASS' : 'UNKNOWN';

export function createEvidence() {
  return {
    schemaVersion: 3, conclusion: 'BLOCKED', exitCode: 2,
    environment: {
      chromeVersion: null, nodeVersion: process.version, platform: process.platform, architecture: process.arch, realChrome: false,
      allowUserScripts: 'UNKNOWN', allowUserScriptsUiState: 'NOT_OBSERVED', apiAvailable: 'UNKNOWN',
      allowUserScriptsEvidence: '尚未调用 API', mode: 'fresh-temporary-Chrome', transport: 'HTTP loopback',
      chromeSandbox: { status: 'UNKNOWN' },
      permissions: ['userScripts'], hostPermissions: ['http://localhost/*']
    },
    mechanism: {
      world: 'MAIN', runAt: 'document_start', allFrames: true, serviceWorker: false,
      documentTargetedInjection: false, source: '扩展包固定模板 + 固定合成 JSON；仅 navigator.language 实验 getter',
      register: 'UNKNOWN', update: 'UNKNOWN', narrowUpdate: 'UNKNOWN', unregister: 'UNKNOWN'
    },
    network: { status: 'UNKNOWN', backend: 'macOS-sandbox-exec', policyApplied: false,
      scope: 'collector-and-spawned-Chrome-process-tree',
      checks: Object.fromEntries(networkChecks.map(key => [key, 'UNKNOWN'])) },
    production: { status: 'UNKNOWN', unchanged: 'UNKNOWN', pauseGate: 'UNKNOWN' },
    scenarios: scenarioDefinitions.map(([id, expected]) => ({ id, expected, actual: null,
      status: 'UNKNOWN', phases: Object.fromEntries(phases.map(key => [key, 'UNKNOWN'])) })),
    cleanup: { status: 'UNKNOWN', failures: [] },
    limitations: [
      '仅 HTTP localhost/127.0.0.1、当前 Chrome 版本与运行平台；未验证 HTTPS 或 macOS 启动修复。',
      '不覆盖 about:blank、srcdoc、data:、blob:、sandbox 特殊帧、Worker/SharedWorker、Geolocation、Canvas、完整 runtime 或已有 Hook 自动撤销。',
      '不覆盖进行中的导航与注册更新竞态、扩展更新或浏览器重启持久性。',
      'BFCache 未命中只证明历史导航重建；不宣称已验证缓存恢复。',
      '网络约束覆盖本次派生进程树；不约束整台机器其他进程，不宣称已统计所有被拒绝的后台尝试。',
      '退出 0 仅为最小实验 GO；不授权生产集成、恢复或发布。'
    ],
    stopReason: null, productionRecoveryPerformed: false
  };
}

const native = '<native-control>';
const expectedValues = {
  'A-native': [native, native], 'B-register-A': ['x-vg-a', 'x-vg-a'],
  'B-broad-subpath': ['x-vg-a', 'x-vg-a'], 'E-other-origin': [native, native],
  'C-existing-A': ['x-vg-a', 'x-vg-a'], 'C-reload-B': ['x-vg-b', 'x-vg-b'],
  'C-new-tab-B': ['x-vg-b', 'x-vg-b'], 'F-history-away': [native, native],
  'F-history-forward': [native, native], 'E-narrow-inside': ['x-vg-b', 'x-vg-b'],
  'E-narrow-outside': [native, 'x-vg-b'], 'E-narrow-near-miss': [native, 'x-vg-b'],
  'D-existing-B': ['x-vg-b', 'x-vg-b'], 'D-new-native': [native, native], 'D-reload-native': [native, native]
};
function scenarioState(row) {
  if (!row) return 'UNKNOWN';
  const reported = aggregate([row.status, ...phases.map(phase => row.phases?.[phase])]);
  if (reported === 'FAIL') return 'FAIL';
  const frames = row.actual?.frames;
  if (!Array.isArray(frames) || frames.length !== 2) return 'UNKNOWN';
  if (row.actual.independentDocuments !== true) return row.actual.independentDocuments === false ? 'FAIL' : 'UNKNOWN';
  let expected = expectedValues[row.id];
  if (row.id === 'F-history-back') {
    const restored = [row.actual.restoredOriginalDocument, row.actual.childRestoredOriginalDocument];
    const persisted = [row.actual.pageshowPersisted, row.actual.childPageshowPersisted];
    if (![...restored, ...persisted, row.actual.bfcacheObserved].every(value => typeof value === 'boolean')) return 'UNKNOWN';
    if (restored.some((value, i) => value !== persisted[i]) || row.actual.bfcacheObserved !== (restored[0] && persisted[0])) return 'FAIL';
    expected = restored.map(value => value ? 'x-vg-a' : 'x-vg-b');
  }
  if (!expected) return 'UNKNOWN';
  for (let index = 0; index < 2; index++) {
    const frame = frames[index];
    if (frame.frame !== ['top', 'same-origin-http-iframe'][index]) return 'UNKNOWN';
    for (const phase of phases) {
      const sample = frame[phase];
      if (!sample || typeof sample.value !== 'string') return 'UNKNOWN';
      if (sample.value !== expected[index]) return 'FAIL';
      if (phase === 'earliest') {
        if (sample.readyState === undefined || sample.scriptIndex === undefined || sample.inline === undefined) return 'UNKNOWN';
        if (sample.readyState !== 'loading' || sample.scriptIndex !== 1 || sample.inline !== true) return 'FAIL';
      }
    }
    const event = frame.pageshow?.at(-1);
    if (typeof event?.persisted !== 'boolean' || typeof event.sample?.value !== 'string') return 'UNKNOWN';
    if (event.sample.value !== expected[index]) return 'FAIL';
    if (['F-history-back', 'F-history-forward'].includes(row.id)) {
      const restored = index === 0 ? row.actual.restoredOriginalDocument : row.actual.childRestoredOriginalDocument;
      const persisted = index === 0 ? row.actual.pageshowPersisted : row.actual.childPageshowPersisted;
      if (typeof restored !== 'boolean' || typeof persisted !== 'boolean') return 'UNKNOWN';
      if (restored !== persisted || event.persisted !== persisted) return 'FAIL';
    }
  }
  for (const key of ({ 'C-existing-A': ['sameDocuments'], 'C-reload-B': ['newDocuments', 'sameURL'],
    'D-existing-B': ['sameDocuments'] }[row.id] ?? [])) {
    if (row.actual[key] !== true) return row.actual[key] === false ? 'FAIL' : 'UNKNOWN';
  }
  return reported;
}

export function decideAcceptance(evidence) {
  const required = {
    realChrome138: evidence.environment?.realChrome === true &&
      /^\d+(?:\.\d+){3}$/.test(evidence.environment.chromeVersion ?? '') &&
      Number(evidence.environment.chromeVersion.split('.')[0]) >= 138 ? 'PASS' : 'UNKNOWN',
    chromeSandbox: evidence.environment?.chromeSandbox?.status === 'PASS' &&
      ['layerOne', 'pidNamespaces', 'networkNamespaces', 'seccompBpf', 'adequate'].every(key => evidence.environment.chromeSandbox[key] === true) ? 'PASS' : 'UNKNOWN',
    userScriptsSwitch: evidence.environment?.allowUserScriptsUiState === 'ENABLED' &&
      evidence.environment.userScriptsSwitch?.method === 'Chrome-extension-details-trusted-pointer' &&
      evidence.environment.userScriptsSwitch.before === false && evidence.environment.userScriptsSwitch.apiBefore === false &&
      evidence.environment.userScriptsSwitch.after === true ? 'PASS' : 'UNKNOWN',
    userScriptsApi: evidence.environment?.apiAvailable === true && evidence.environment.allowUserScripts === true ? 'PASS' : 'UNKNOWN',
    registrations: aggregate(['register', 'update', 'narrowUpdate', 'unregister'].map(key => evidence.mechanism?.[key])),
    networkLoopback: evidence.network?.policyApplied === true
      ? aggregate([evidence.network.status, ...networkChecks.map(key => evidence.network.checks?.[key])]) : 'UNKNOWN',
    productionUnchanged: aggregate([evidence.production?.status, evidence.production?.unchanged, evidence.production?.pauseGate]),
    cleanup: evidence.cleanup?.status ?? 'UNKNOWN'
  };
  if (evidence.network?.backend === 'linux-network-namespace') {
    required.networkNamespace = ['onlyLoopbackInterface', 'ipv4ProhibitDefault', 'ipv6ProhibitDefault', 'noExternalRoutes', 'nonRootCollector']
      .every(key => evidence.network.topology?.[key] === true) ? 'PASS' : 'UNKNOWN';
    required.cleanup = aggregate([evidence.cleanup?.status, evidence.cleanup?.coordinator, evidence.cleanup?.staging]);
  }
  for (const [id] of scenarioDefinitions) {
    const rows = evidence.scenarios?.filter(row => row.id === id) ?? [];
    required[id] = rows.length === 1 ? scenarioState(rows[0]) : 'UNKNOWN';
  }
  // 清理失败属于环境阻断；已经观察到的机制/约束失败仍保持 NO_GO。
  const explicitFailure = Object.entries(required).some(([key, status]) => key !== 'cleanup' && status === 'FAIL');
  const allPassed = Object.values(required).every(status => status === 'PASS');
  const conclusion = explicitFailure ? 'NO_GO' : allPassed && !evidence.stopReason &&
    evidence.productionRecoveryPerformed === false ? 'GO' : 'BLOCKED';
  return { requiredChecks: required, conclusion, exitCode: { GO: 0, NO_GO: 1, BLOCKED: 2 }[conclusion] };
}
