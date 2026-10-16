import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createWorkerReader } from './worker-reader.mjs';

const origin = 'chrome-extension://synthetic-extension/';
const protocolError = message => Object.assign(new Error(message), { cdpCode: -32000 });
function fixture({ evaluate, list } = {}) {
  let generation = 'a', sequence = 0, reads = 0;
  const calls = [], sessions = new Map();
  const target = id => ({ type: 'service_worker', url: origin + 'background.js', targetId: id });
  const native = version => ({ runtime: { getManifest: () => ({ version }) },
    userScripts: { getScripts: async () => { reads++; return [{ id: generation }]; }, unregister() { throw new Error('不得写入'); } } });
  const cdp = { async send(method, params = {}, sessionId) {
    calls.push({ method, params, sessionId });
    if (method === 'Target.getTargets') return { targetInfos: list ? list(target, generation) : [target(generation)] };
    if (method === 'Target.attachToTarget') {
      const sessionId = 'session-' + ++sequence; sessions.set(sessionId, params.targetId); return { sessionId };
    }
    if (method === 'Target.detachFromTarget') { sessions.delete(params.sessionId); return {}; }
    if (method === 'Runtime.enable') return {};
    assert.equal(method, 'Runtime.evaluate'); assert.ok(sessions.has(sessionId));
    const context = evaluate ? await evaluate({ sessionId, targetId: sessions.get(sessionId), native,
      replace: id => { generation = id; } }) : { chrome: native('2.1.1') };
    try { return { result: { value: await vm.runInNewContext(params.expression, context) } }; }
    catch (error) { return { exceptionDetails: { exception: { className: error.name } } }; }
  } };
  return { calls, reads: () => reads, reader: createWorkerReader(cdp, origin, { attempts: 4, delay: async () => {} }) };
}

test('target 已出现但 chrome/runtime/userScripts 尚未就绪：等待后才读原生 API', async () => {
  let count = 0;
  const f = fixture({ evaluate: ({ native }) => [ {}, { chrome: {} }, { chrome: { runtime: {} } },
    { chrome: native('2.1.1') } ][count++] });
  const result = await f.reader.read('chrome.userScripts.getScripts()', '2.1.1');
  assert.equal(f.reads(), 1); assert.equal(result.readiness.unavailableContexts, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), [{ id: 'a' }]);
  assert.equal(f.calls.filter(row => row.method === 'Target.attachToTarget').length, 1);
});

test('同一 target 的执行上下文销毁：丢弃 session 后重新附加', async () => {
  let first = true;
  const f = fixture({ evaluate: ({ native }) => {
    if (first) { first = false; throw protocolError('Cannot find context with specified id'); }
    return { chrome: native('2.1.1') };
  } });
  const result = await f.reader.read('chrome.userScripts.getScripts()', '2.1.1');
  assert.equal(result.worker.sessionId, 'session-2'); assert.equal(result.readiness.invalidations, 1);
  assert.equal(f.reads(), 1);
});

test('默认执行上下文暂不存在：重新附加并等到就绪后才读取注册', async () => {
  let first = true;
  const f = fixture({ evaluate: ({ native }) => {
    if (first) { first = false; throw protocolError('Cannot find default execution context'); }
    return { chrome: native('2.1.1') };
  } });
  const result = await f.reader.read('chrome.userScripts.getScripts()', '2.1.1');
  assert.equal(result.worker.sessionId, 'session-2');
  assert.equal(result.readiness.apiReady, true); assert.equal(result.readiness.version, '2.1.1');
  assert.equal(result.readiness.invalidations, 1); assert.equal(f.reads(), 1);
  assert.equal(f.calls.filter(row => row.method === 'Target.detachFromTarget').length, 1);
  assert.equal(f.calls.filter(row => row.method === 'Runtime.evaluate').length, 2);
});

test('session 随 target 换代失效：重新枚举并定位替代 worker', async () => {
  let first = true;
  const f = fixture({ evaluate: ({ native, replace }) => {
    if (first) { first = false; replace('b'); throw protocolError('Session with given id not found.'); }
    return { chrome: native('2.1.1') };
  } });
  const result = await f.reader.read('chrome.userScripts.getScripts()', '2.1.1');
  assert.equal(result.worker.targetId, 'b'); assert.equal(result.value[0].id, 'b'); assert.equal(f.reads(), 1);
});

test('读取完成前 target 已换代：不接受旧 target 的成功值', async () => {
  let first = true;
  const f = fixture({ evaluate: ({ native, replace }) => {
    const chrome = native('2.1.1');
    if (first) { first = false; chrome.userScripts.getScripts = async () => { replace('b'); return [{ id: 'obsolete' }]; }; }
    return { chrome };
  } });
  const result = await f.reader.read('chrome.userScripts.getScripts()', '2.1.1');
  assert.equal(result.worker.targetId, 'b'); assert.equal(result.value[0].id, 'b');
});

test('更新时两个 target 短暂并存：只读取期望版本，不固定取首个旧 target', async () => {
  const f = fixture({ list: target => [target('old'), target('new'),
    { type: 'page', url: origin + 'options.html', targetId: 'page' },
    { type: 'service_worker', url: 'chrome-extension://other/background.js', targetId: 'other' }],
  evaluate: ({ targetId, native }) => ({ chrome: native(targetId === 'new' ? '2.1.2' : '2.1.1') }) });
  const result = await f.reader.read('chrome.userScripts.getScripts()', '2.1.2');
  assert.equal(result.worker.targetId, 'new'); assert.equal(result.readiness.version, '2.1.2');
  assert.equal(result.readiness.wrongVersions, 1); assert.equal(f.reads(), 1);
  assert.deepEqual(f.calls.filter(row => row.method === 'Target.attachToTarget').map(row => row.params.targetId), ['old', 'new']);
});

test('API 存在但调用拒绝：不把真实异常当作未就绪而重试', async () => {
  let count = 0;
  const f = fixture({ evaluate: ({ native }) => {
    count++; const chrome = native('2.1.1');
    chrome.userScripts.getScripts = async () => { throw new Error('Allow User Scripts 未开启'); };
    return { chrome };
  } });
  await assert.rejects(f.reader.read('chrome.userScripts.getScripts()', '2.1.1'), /WORKER_READ_EXCEPTION/);
  assert.equal(count, 1);
});

test('非生命周期 CDP 错误直接失败，不根据含糊 context 文本吞掉错误', async () => {
  const f = fixture({ evaluate: () => { throw protocolError('Context access denied'); } });
  await assert.rejects(f.reader.read('null', '2.1.1'), /Context access denied/);
  assert.equal(f.calls.filter(row => row.method === 'Runtime.evaluate').length, 1);
});

test('缺少 API 有界超时，不能以 target 出现或 Runtime.enable 成功判定通过', async () => {
  const f = fixture({ evaluate: () => ({}) });
  await assert.rejects(f.reader.read('chrome.userScripts.getScripts()', '2.1.1'), /WORKER_READINESS_TIMEOUT/);
  assert.equal(f.reads(), 0); assert.equal(f.reader.diagnostics().unavailableContexts, 4);
  await f.reader.close();
  assert.equal(f.calls.filter(row => row.method === 'Target.detachFromTarget').length, 1);
});
