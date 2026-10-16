#!/usr/bin/env node
// node --import tsx scripts/chrome-navigator-contract.mjs
// 独立 Chrome + localhost 合成配置；只测试维护 runtime，不恢复生产派发。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import ts from 'typescript';
import { generateRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime.ts';

const runtime = assertSelfContainedFunction((await generateRuntime()).code, 'applyVanishGeoRuntime');
const probe = assertSelfContainedFunction(ts.transpileModule(
  await readFile(new URL('../tests/helpers/navigator-contract.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }
).outputText, 'captureNavigatorContract');
const payload = { extensionEnabled: true,
  languageConfig: { enabled: true, language: 'fr-FR', languages: ['fr-FR', 'fr'], acceptLanguage: 'fr-FR' } };
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
if (!chrome || typeof WebSocket !== 'function') throw new Error('需要真实 Chrome 和 Node 22+');
const temporary = await mkdtemp(join(tmpdir(), 'vg-navigator-contract-'));
let frameOrigin, crossSiteOrigin;
const crossOriginServer = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Cross-origin Navigator contract</title>' +
    (request.url === '/child' ? '<iframe name="cross-origin-receiver" src="/receiver"></iframe>' : ''));
});
const crossSiteServer = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>OOPIF Navigator contract</title>' +
    (request.url === '/child' ? '<iframe name="cross-site-receiver" src="/receiver"></iframe>' : ''));
});
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url?.endsWith('.js') ? 'text/javascript' : 'text/html');
  // Worker 业务脚本为空；测试仪表在实际生成 Blob 的前后捕获和检查原生合同。
  if (request.url?.endsWith('.js')) response.end('');
  else response.end('<!doctype html><title>Navigator contract</title>' + (['/child', '/sandbox-child'].includes(request.url) ? '' : [
    '<iframe name="same-origin" src="/child"></iframe>',
    `<iframe name="cross-origin" src="${frameOrigin}/child"></iframe>`,
    '<iframe name="srcdoc" srcdoc="<!doctype html><title>srcdoc contract</title>"></iframe>',
    '<iframe name="about-blank" src="about:blank"></iframe>',
    `<iframe name="cross-site-oopif" src="${crossSiteOrigin}/child"></iframe>`,
    '<iframe name="sandbox-url" sandbox="allow-scripts" src="/sandbox-child"></iframe>',
    '<iframe name="sandbox-srcdoc" sandbox="allow-scripts" srcdoc="<!doctype html><title>Opaque srcdoc contract</title>"></iframe>',
    '<iframe name="sandbox-about-blank" sandbox="allow-scripts" src="about:blank"></iframe>'
  ].join('')));
});
const contexts = new Map();
const sessions = new Map();
const sessionErrors = [];
let child, socket;
const pending = new Map();
let sequence = 0;
async function until(read, accept, label = '目标状态') {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(`Navigator Chrome 合同检查等待超时：${label}`);
}
function send(method, params = {}, sessionId) {
  return new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP ${method} 超时`)); }, 15000);
    pending.set(id, { done, fail, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
// OOPIF 的上下文和 objectId 必须连同所属 session 使用，不可回退到顶层。
function attachFrameSession(sessionId, info) {
  if (sessions.has(sessionId)) return;
  const row = { info };
  sessions.set(sessionId, row);
  row.ready = (async () => {
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false,
      flatten: true, filter: [{ type: 'iframe' }, { exclude: true }] }, sessionId);
  })();
  row.ready.catch(error => sessionErrors.push(error));
}
function forgetSession(sessionId) {
  sessions.delete(sessionId);
  for (const [frameId, context] of contexts) if (context.sessionId === sessionId) contexts.delete(frameId);
}
function assertContract(result, expected = payload.languageConfig) {
  for (const [key, value] of Object.entries(result)) if (typeof value === 'boolean') assert.equal(value, true, key);
  assert.equal(result.language, expected.language);
  assert.deepEqual(result.languages, expected.languages);
}
function assertMutations(result) {
  for (const [key, value] of Object.entries(result)) assert.equal(value, true, key);
}
try {
  crossSiteServer.listen(0, '127.0.0.1');
  await once(crossSiteServer, 'listening');
  crossSiteOrigin = `http://127.0.0.1:${crossSiteServer.address().port}`;
  crossOriginServer.listen(0, 'localhost');
  await once(crossOriginServer, 'listening');
  frameOrigin = `http://localhost:${crossOriginServer.address().port}`;
  server.listen(0, 'localhost');
  await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`;
  assert.notEqual(frameOrigin, origin, '跨源 fixture 必须使用不同 origin');
  child = spawn(chrome, ['--headless=new', '--site-per-process', '--remote-debugging-port=0', `--user-data-dir=${temporary}`,
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => {
    try { return (await readFile(join(temporary, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }, Boolean);
  const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'iframe') {
      attachFrameSession(message.params.sessionId, message.params.targetInfo);
    } else if (message.method === 'Target.detachedFromTarget') {
      forgetSession(message.params.sessionId);
    } else if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault) {
      contexts.set(message.params.context.auxData.frameId,
        { id: message.params.context.id, sessionId: message.sessionId });
    } else if (message.method === 'Runtime.executionContextDestroyed') {
      for (const [frameId, context] of contexts) {
        if (context.sessionId === message.sessionId && context.id === message.params.executionContextId) contexts.delete(frameId);
      }
    } else if (message.method === 'Runtime.executionContextsCleared') {
      for (const [frameId, context] of contexts) if (context.sessionId === message.sessionId) contexts.delete(frameId);
    }
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.fail(new Error(`CDP 失败：${message.error.message}`));
    else request.done(message.result);
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  attachFrameSession(sessionId, { targetId, type: 'page' });
  await sessions.get(sessionId).ready;
  await send('Page.navigate', { url: origin }, sessionId);
  const value = response => {
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || '合同探针执行失败');
    return response.result;
  };
  const evaluate = async (expression, returnByValue = true, context) => value(await send('Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue, contextId: context?.id }, context?.sessionId || sessionId));
  const invoke = async (remote, functionDeclaration, args = []) => value(await send('Runtime.callFunctionOn',
    { objectId: remote.objectId, functionDeclaration, arguments: args.map(value => ({ value })), awaitPromise: true, returnByValue: true }, remote.sessionId)).value;
  await until(async () => (await evaluate('document.readyState')).value, value => value === 'complete');
  const topId = (await send('Page.getFrameTree', {}, sessionId)).frameTree.frame.id;
  let lastFrames = [];
  const collectFrames = async () => {
    if (sessionErrors.length) throw sessionErrors[0];
    await Promise.all([...sessions.values()].map(row => row.ready));
    const result = new Map();
    const add = (node, parentId) => {
      const existing = result.get(node.frame.id);
      result.set(node.frame.id, { ...existing, ...node.frame,
        name: node.frame.name || existing?.name || '', parentId: node.frame.parentId || parentId || existing?.parentId });
      for (const child of node.childFrames || []) add(child, node.frame.id);
    };
    for (const frameSession of sessions.keys()) add((await send('Page.getFrameTree', {}, frameSession)).frameTree);
    lastFrames = [...result.values()];
    return lastFrames;
  };
  const specs = [
    { name: 'same-origin', url: `${origin}/child`, origin, language: 'fr-FR' },
    { name: 'cross-origin', url: `${frameOrigin}/child`, origin: frameOrigin, language: 'de-DE', receiver: 'cross-origin-receiver' },
    { name: 'srcdoc', url: 'about:srcdoc', origin, language: 'es-ES' },
    { name: 'about-blank', url: 'about:blank', origin, language: 'it-IT' },
    { name: 'cross-site-oopif', url: `${crossSiteOrigin}/child`, origin: crossSiteOrigin,
      language: 'ko-KR', receiver: 'cross-site-receiver', oopif: true },
    { name: 'sandbox-url', url: `${origin}/sandbox-child`, origin: 'null', language: 'nl-NL', opaque: true },
    { name: 'sandbox-srcdoc', url: 'about:srcdoc', origin: 'null', language: 'sv-SE', opaque: true },
    { name: 'sandbox-about-blank', url: 'about:blank', origin: 'null', language: 'pl-PL', opaque: true }
  ];
  const requiredNames = [...specs.map(spec => spec.name), ...specs.filter(spec => spec.receiver).map(spec => spec.receiver)];
  const frames = await until(collectFrames, rows => requiredNames.every(name => rows.some(row => row.name === name))
    && rows.every(frame => contexts.has(frame.id)), '全部 frame/session 默认上下文').catch(error => {
      console.error(JSON.stringify({ frameSessionTypes: [...sessions.values()].map(row => row.info.type),
        frames: lastFrames.map(frame => ({ name: frame.name, hasContext: contexts.has(frame.id) })) }));
      throw error;
    });
  for (const spec of specs) {
    const matches = frames.filter(frame => frame.name === spec.name);
    assert.equal(matches.length, 1, `${spec.name} frame 身份必须唯一`);
    spec.id = matches[0].id;
    if (spec.receiver) {
      const controls = frames.filter(frame => frame.name === spec.receiver);
      assert.equal(controls.length, 1);
      assert.equal(controls[0].parentId, spec.id);
    }
    if (spec.oopif) {
      const context = contexts.get(spec.id);
      assert.notEqual(context.sessionId, sessionId, 'OOPIF 必须属于独立 renderer target session');
      const info = (await send('Target.getTargetInfo', { targetId: sessions.get(context.sessionId).info.targetId })).targetInfo;
      assert.equal(info.type, 'iframe');
      assert.notEqual(info.targetId, targetId);
      assert.equal(info.url, spec.url);
    }
  }
  const remoteFrame = (id, objectId) => {
    const context = contexts.get(id);
    assert.ok(context, 'frame 默认执行上下文已失效');
    return { objectId, sessionId: context.sessionId };
  };
  const evaluateFrame = (id, expression, returnByValue = true) => {
    const context = contexts.get(id);
    assert.ok(context, 'frame 默认执行上下文已失效');
    return evaluate(expression, returnByValue, context);
  };
  const identity = await evaluateFrame(topId, '({url:location.href,origin:globalThis.origin})');
  assert.deepEqual(identity.value, { url: `${origin}/`, origin });
  for (const spec of specs) {
    const actual = (await evaluateFrame(spec.id, '({url:location.href,origin:globalThis.origin})')).value;
    assert.deepEqual(actual, { url: spec.url, origin: spec.origin }, `${spec.name} 文档和有效 origin`);
  }
  const probes = new Map();
  const expected = new Map();
  for (const frame of frames) {
    probes.set(frame.id, remoteFrame(frame.id, (await evaluateFrame(frame.id, `(${probe})()`, false)).objectId));
    expected.set(frame.id, (await evaluateFrame(frame.id,
      '({language:navigator.language,languages:Array.from(navigator.languages)})')).value);
  }
  const topProbe = probes.get(topId);
  const topInspect = `function(){const frames=['same-origin','srcdoc','about-blank'].map(name=>window.frames[name]);return this.inspect(frames.map(frame=>frame.navigator),frames[0].Reflect.ownKeys);}`;
  const childInspect = 'function(){return this.inspect([parent.navigator],parent.Reflect.ownKeys);}';
  const crossInspect = 'function(){const frame=window.frames[0];return this.inspect([frame.navigator],frame.Reflect.ownKeys);}';
  const inspections = new Map(frames.map(frame => {
    const spec = specs.find(spec => spec.id === frame.id);
    return [frame.id, frame.id === topId ? topInspect : spec?.opaque ? 'function(){return this.inspect();}'
      : spec?.receiver ? crossInspect : childInspect];
  }));
  const assertRealms = async (skip = new Set()) => {
    for (const frame of frames) if (!skip.has(frame.id)) {
      assertContract(await invoke(probes.get(frame.id), inspections.get(frame.id)), expected.get(frame.id));
    }
  };
  const crossAccess = target => `(() => {
    const other=${target};
    return [()=>other.navigator,()=>other.Navigator,()=>other.Reflect,
      ()=>Object.getOwnPropertyDescriptor(other,'navigator'),
      ()=>Reflect.getOwnPropertyDescriptor(other,'navigator')].map(read=>{
        try {read();return 'allowed';} catch(error){return error.name;}
      });
  })()`;
  const accessCases = [];
  const protectedSpecs = specs.filter(spec => spec.receiver || spec.opaque);
  for (const spec of protectedSpecs) {
    accessCases.push({ id: topId, source: crossAccess(`window.frames[${JSON.stringify(spec.name)}]`) });
    accessCases.push({ id: spec.id, source: crossAccess('parent') });
  }
  const opaqueSpecs = specs.filter(spec => spec.opaque);
  // 不同 opaque origin 都序列化为 null；仍须阻止它们互相访问。
  for (let index = 0; index < opaqueSpecs.length; index++) {
    const sibling = opaqueSpecs[(index + 1) % opaqueSpecs.length];
    const siblingIndex = (await evaluateFrame(topId,
      `Array.from(document.querySelectorAll('body > iframe')).findIndex(frame=>frame.name===${JSON.stringify(sibling.name)})`)).value;
    assert.ok(siblingIndex >= 0);
    accessCases.push({ id: opaqueSpecs[index].id, source: crossAccess(`parent.frames[${siblingIndex}]`) });
  }
  const assertAccessBoundaries = async () => {
    for (const test of accessCases) {
      assert.deepEqual((await evaluateFrame(test.id, test.source)).value, Array(5).fill('SecurityError'));
    }
  };
  await assertAccessBoundaries();
  const sandboxFlags = (await evaluateFrame(topId,
    `Array.from(document.querySelectorAll('iframe[sandbox]'), frame=>frame.sandbox.value)`)).value;
  assert.deepEqual(sandboxFlags, Array(3).fill('allow-scripts'));
  // 仅测试仪表包装 Blob URL 工厂；原生产 wrapper、bootstrap 和 import 顺序照常执行。
  await evaluate(`(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => create(new Blob([
      ${JSON.stringify(`const __navigatorContractProbe = (${probe})();\n`)}, blob,
      ${JSON.stringify('\nconst __navigatorContractResult = {inspection:__navigatorContractProbe.inspect(),mutations:__navigatorContractProbe.mutate()};\nif(typeof self.postMessage === "function") self.postMessage(__navigatorContractResult);\nelse self.onconnect = event => event.ports[0].postMessage(__navigatorContractResult);')}
    ], {type:'text/javascript'}));
  })();true`);
  const controller = remoteFrame(topId, (await evaluateFrame(topId, `(${runtime})(${JSON.stringify(payload)})`, false)).objectId);
  expected.set(topId, payload.languageConfig);
  await assertRealms();
  for (const spec of specs) {
    const config = { ...payload, languageConfig: { ...payload.languageConfig,
      language: spec.language, languages: [spec.language] } };
    await evaluateFrame(spec.id, `(${runtime})(${JSON.stringify(config)});undefined`);
    expected.set(spec.id, config.languageConfig);
    // 每次单 frame 安装后检查所有 realm，避免把父页或邻帧误改写当作成功。
    await assertRealms();
  }
  await assertAccessBoundaries();

  const collectWorkers = `(async () => {
    const result={};
    for(const shared of [false,true]) for(const type of ['classic','module']) {
      const key=(shared?'SharedWorker':'Worker')+':'+type;
      result[key]=await new Promise((done,fail)=>{
        let worker;
        const cleanup=()=>{if(worker){if(worker.port)worker.port.close();else worker.terminate();}};
        const timer=setTimeout(()=>{cleanup();fail(new Error(key+' 合同探针超时'));},5000);
        try {
          worker=shared?new SharedWorker('/shared.js',{type,name:type}):new Worker('/worker.js',{type});
          const port=shared?worker.port:worker;
          port.onmessage=event=>{clearTimeout(timer);cleanup();done(event.data);};
          worker.onerror=()=>{clearTimeout(timer);cleanup();fail(new Error(key+' 加载失败'));};
          if(shared)port.start();
        } catch(error){clearTimeout(timer);cleanup();fail(error);}
      });
    }
    return result;
  })()`;
  const workers = (await evaluate(collectWorkers)).value;
  for (const row of Object.values(workers)) { assertContract(row.inspection); assertMutations(row.mutations); }
  const updated = { ...payload, languageConfig: { ...payload.languageConfig, language: 'ja-JP', languages: ['ja-JP'] } };
  await invoke(controller, 'function(payload){this.update(payload);}', [updated]);
  const future = (await evaluate(collectWorkers)).value;
  for (const row of Object.values(future)) { assertContract(row.inspection, updated.languageConfig); assertMutations(row.mutations); }
  await assertRealms();
  const mutated = new Set();
  for (const spec of specs) {
    assertMutations(await invoke(probes.get(spec.id), 'function(){return this.mutate();}'));
    mutated.add(spec.id);
    await assertRealms(mutated);
  }
  await assertAccessBoundaries();
  assertMutations(await invoke(topProbe, 'function(){return this.mutate();}'));
  console.log(JSON.stringify({ browser: version.Browser, page: 'passed',
    iframes: Object.fromEntries(specs.map(spec => [spec.name, {
      documentAndOrigin: 'passed', prototypeDescriptorReceiver: 'passed',
      internalStateAndReflection: 'passed', descriptorMutationDeletionFreeze: 'passed',
      ...(spec.oopif ? { independentIframeTarget: 'passed' } : {}),
      ...(spec.opaque ? { opaqueOriginAndSandbox: 'passed', receiverCoverage: 'native invalid receivers and protected foreign objects' } : {})
    }])),
    crossOriginAccess: 'native SecurityError in both directions', opaqueSiblingAccess: 'native SecurityError',
    crossOriginNativeReceiverControl: 'passed', frameInstallationIsolation: 'passed',
    siteIsolation: 'site-per-process with verified OOPIF target',
    workers: Object.keys(workers), privateControllerFutureWorkerUpdate: 'passed',
    productionInjection: 'not-exercised' }));
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  socket?.close();
  if (child && child.exitCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended;
  }
  for (const fixtureServer of [server, crossOriginServer, crossSiteServer]) {
    fixtureServer.closeAllConnections();
    await new Promise(done => fixtureServer.close(done));
  }
  await rm(temporary, { recursive: true, force: true });
}
