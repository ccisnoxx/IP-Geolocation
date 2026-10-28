import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createContentBridge } from '../src/content/content-bridge';
import { compileLiveBridgeScripts } from '../src/background/live-updates';
import { createInitialConfig, createRule } from '../src/shared/config-model';

test('只读桥按当前frame重拉，丢弃旧响应，只转最小surface，不接受页面配置写入', async () => {
  const dom = new JSDOM('', { url: 'https://child.example.test/' });
  const scope = dom.window;
  const posts: any[] = [], requests: any[] = [];
  const replies: Array<(value: any) => void> = [];
  const listeners = new Set<Function>();
  scope.postMessage = ((value: any) => { posts.push(value); }) as typeof scope.postMessage;
  const runtime = { id: 'synthetic-extension',
    sendMessage: (request: any) => { requests.push(request); return new Promise<any>(resolve => replies.push(resolve)); },
    onMessage: { addListener: (listener: Function) => listeners.add(listener), removeListener: (listener: Function) => listeners.delete(listener) } };
  const stop = createContentBridge(scope as any, runtime);
  const incoming = (data: unknown, origin = scope.location.origin) => scope.dispatchEvent(new scope.MessageEvent('message', { source: scope as any, origin, data }));
  try {
    const nonce = 'a'.repeat(32);
    incoming({ kind: 'vg-live-request-v1', surface: 'page', nonce });
    incoming({ kind: 'vg-live-request-v1', surface: 'font', nonce });
    assert.equal(requests.length, 1);
    assert.ok(requests.every(request => JSON.stringify(request) === '{"action":"getLiveRuntimeUpdate"}'));
    for (let count = 0; count < 100; count++) incoming({ kind: 'vg-live-request-v1', surface: 'page', nonce });
    assert.equal(requests.length, 1);
    replies[0]({ status: 'ok', payloads: { page: { intlMode: 'strict', timezone: 'Pacific/Honolulu' } } });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2);
    assert.equal(posts.filter(post => post.kind === 'vg-live-update-v1').length, 0);
    replies[1]({ status: 'ok', payloads: { page: { intlMode: 'strict', timezone: 'UTC' }, font: null, geolocation: null } });
    await new Promise<void>(resolve => setImmediate(resolve));
    const delivered = posts.filter(post => post.kind === 'vg-live-update-v1');
    assert.deepEqual(delivered.map(post => [post.surface, JSON.parse(post.payloadText)]), [['page', { intlMode: 'strict', timezone: 'UTC' }], ['font', null]]);
    incoming({ kind: 'vg-live-request-v1', surface: 'page', nonce }, 'https://other.test');
    incoming({ action: 'setSiteConfig', config: { masterEnabled: true } });
    for (const listener of listeners) listener({ action: 'refreshLiveRuntime' }, { id: 'other-extension' }, () => {});
    assert.equal(requests.length, 2);
    stop();
    assert.equal(listeners.size, 0);
  } finally { stop(); scope.close(); }
});

test('桥只注册有效规则普通HTTP(S)frame，沿用子域排除，native/禁用不透过父域', () => {
  const config = createInitialConfig(); config.masterEnabled = true;
  config.rules = [createRule('example.test'), { ...createRule('child.example.test'), compatibilityPreset: 'native' }, createRule('deep.child.example.test')];
  const scripts = compileLiveBridgeScripts(config);
  assert.deepEqual(scripts.map(script => script.id), ['vanishgeo-live-bridge-deep.child.example.test', 'vanishgeo-live-bridge-example.test']);
  const parent = scripts[1];
  assert.ok(parent.excludeMatches?.includes('*://child.example.test/*'));
  assert.equal(parent.world, 'ISOLATED');
  assert.equal(parent.allFrames, true);
  assert.equal(parent.matchOriginAsFallback, false);
  config.masterEnabled = false;
  assert.deepEqual(compileLiveBridgeScripts(config), []);
});


test('桥对账接受Chrome省略空excludeMatches，保留稳定注册且不重复写入', async () => {
  const { reconcileLiveBridge } = await import('../src/background/live-updates');
  const previous = globalThis.chrome;
  const config = createInitialConfig();config.masterEnabled=true;config.rules=[createRule('example.test')];
  const scripts = compileLiveBridgeScripts(config);for(const script of scripts)delete script.excludeMatches;
  let writes=0;
  Object.assign(globalThis,{chrome:{scripting:{getRegisteredContentScripts:async()=>structuredClone(scripts),
    unregisterContentScripts:async()=>{writes++},registerContentScripts:async()=>{writes++}}}});
  try {assert.equal((await reconcileLiveBridge(config)).status,'ok');assert.equal(writes,0);}finally{globalThis.chrome=previous;}
});
