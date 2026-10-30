import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameRuleResolver, discoverOpaqueDocuments, readAccessibleWebParent, resolveBlobParent } from '../src/background/blob-frames';
import { createFrameReceiptCodec, FRAME_RECEIPT_KEY, type FrameReceipt } from '../src/background/frame-receipts';

interface FrameWindow {
  location: { href: string };
  parent: FrameWindow;
}

function frameWindow(url: string, parent?: FrameWindow): FrameWindow {
  const frame = { location: { href: url } } as FrameWindow;
  frame.parent = parent || frame;
  return frame;
}

function readFromWindow(frame: FrameWindow) {
  const descriptors = ['window', 'location'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: frame });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: frame.location });
  try {
    return readAccessibleWebParent();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const BLOB_URL = 'blob:https://creator.example/document';

test('readAccessibleWebParent 穿过已知 opaque 父窗口，停在最近 HTTP 祖先', () => {
  const top = frameWindow('https://top.example/');
  const nearest = frameWindow('http://nearest.example/path', top);
  let parent = nearest;
  for (const url of ['about:blank', 'about:srcdoc', 'blob:https://other.example/parent', 'data:text/html,parent', 'filesystem:https://other.example/temporary/parent']) {
    parent = frameWindow(url, parent);
  }
  assert.deepEqual(readFromWindow(frameWindow(BLOB_URL, parent)), {
    url: BLOB_URL,
    parentUrl: 'http://nearest.example/path'
  });
});

test('readAccessibleWebParent 不越过未知 scheme，也不给无父文档猜祖先', () => {
  const top = frameWindow('https://top.example/');
  for (const url of ['file:///tmp/parent.html', 'chrome://settings/', 'about:config']) {
    assert.deepEqual(readFromWindow(frameWindow(BLOB_URL, frameWindow(url, top))), { url: BLOB_URL, parentUrl: null });
  }
  assert.deepEqual(readFromWindow(frameWindow(BLOB_URL)), { url: BLOB_URL, parentUrl: null });
  assert.deepEqual(readFromWindow(frameWindow(BLOB_URL, frameWindow('about:blank'))), { url: BLOB_URL, parentUrl: null });
});

test('readAccessibleWebParent 遇到原生 Location 的 SOP 拒绝即失败，不回退创建者或顶层', () => {
  const blocked = frameWindow('https://blocked.example/', frameWindow('https://top.example/'));
  const denied = new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError');
  Object.defineProperty(blocked, 'location', { get() { throw denied; } });
  assert.throws(() => readFromWindow(frameWindow(BLOB_URL, blocked)), (error) => error === denied);
});

function createSessionStorage(initial: Record<string, unknown> = {}) {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const values = copy(initial);
  const gets: Array<string | string[] | null> = [];
  const sets: Record<string, unknown>[] = [];
  const removes: Array<string | string[]> = [];
  return {
    gets, sets, removes,
    async get(keys: string | string[] | null) {
      gets.push(keys);
      const names = keys === null ? Object.keys(values) : typeof keys === 'string' ? [keys] : keys;
      return copy(Object.fromEntries(names.filter(name => name in values).map(name => [name, values[name]])));
    },
    async set(items: Record<string, unknown>) {
      sets.push(copy(items));
      Object.assign(values, copy(items));
    },
    async remove(keys: string | string[]) {
      removes.push(keys);
      for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
    }
  };
}

function createContentEvidence() {
  const receipts = new Map<string, unknown>();
  const calls: any[] = [];
  const key = (tabId: number, frameId: number, documentId: string) => `${tabId}:${frameId}:${documentId}`;
  return {
    receipts, calls, key,
    async sendMessage(tabId: number, request: any, options: any) {
      calls.push([tabId, request, options]);
      const identity = key(tabId, options.frameId, options.documentId);
      if (request.action === 'readFrameEvidence') return { frameEvidence: receipts.get(identity) ?? null };
      if (request.action === 'storeFrameEvidence') {
        receipts.set(identity, request.frameEvidence);
        return { stored: true };
      }
      throw new Error(`unexpected content action: ${request.action}`);
    }
  };
}

function installScriptResults(results: any[] | Error, session = createSessionStorage(), content = createContentEvidence()) {
  const calls: any[] = [];
  (globalThis as any).chrome = {
    storage: { session },
    tabs: { sendMessage: content.sendMessage },
    scripting: {
      executeScript: async (details: any) => {
        calls.push(details);
        if (results instanceof Error) throw results;
        return results;
      }
    }
  };
  return calls;
}

test('resolveBlobParent 仅按 documentId 精准探测，并要求返回 frame/document 同时匹配', async () => {
  const parentUrl = 'https://nearest.example/path';
  const calls = installScriptResults([
    { frameId: 8, documentId: 'other', result: { url: BLOB_URL, parentUrl: 'https://unrelated.example/' } },
    { frameId: 3, documentId: 'blob-doc', result: { url: BLOB_URL, parentUrl } }
  ]);
  assert.deepEqual(await resolveBlobParent(7, 3, 'blob-doc', BLOB_URL), { url: BLOB_URL, parentUrl });
  assert.deepEqual(calls, [{
    target: { tabId: 7, documentIds: ['blob-doc'] },
    world: 'ISOLATED',
    func: readAccessibleWebParent
  }]);
});

test('resolveBlobParent 拒绝空结果、身份或 URL 改变，以及不具备 HTTP 父证据的输出', async () => {
  const valid = { frameId: 3, documentId: 'blob-doc', result: { url: BLOB_URL, parentUrl: 'https://nearest.example/path' } };
  const cases = [
    [],
    [{ ...valid, frameId: 4 }],
    [{ ...valid, documentId: 'navigated-doc' }],
    [{ ...valid, documentId: undefined }],
    [{ ...valid, result: undefined }],
    ...[undefined, 7, 'https://creator.example/page', 'data:text/html,blob', 'invalid', 'blob:https://creator.example/navigated'].map((url) => [{ ...valid, result: { ...valid.result, url } }]),
    ...[null, '', 'blob:https://creator.example/parent', 'data:text/html,parent', 'about:blank', 'invalid'].map((parentUrl) => [{ ...valid, result: { ...valid.result, parentUrl } }])
  ];
  for (const results of cases) {
    installScriptResults(results);
    await assert.rejects(() => resolveBlobParent(7, 3, 'blob-doc', BLOB_URL), JSON.stringify(results));
  }
});

test('resolveBlobParent 缺少 API 或探测抛错时拒绝', async () => {
  (globalThis as any).chrome = {};
  await assert.rejects(() => resolveBlobParent(7, 3, 'blob-doc'), /ancestry is unavailable/);
  const denied = new Error('Cannot access contents of the page');
  installScriptResults(denied);
  await assert.rejects(() => resolveBlobParent(7, 3, 'blob-doc'), /Cannot access contents of the page/);
});

test('discoverOpaqueDocuments 用 ISOLATED allFrames 发现投递文档，只返回已知 opaque 身份列表', async () => {
  const calls = installScriptResults([
    { frameId: 0, documentId: 'top', result: 'https://top.example/' },
    { frameId: 3, documentId: 'blob-doc', result: BLOB_URL },
    { frameId: 4, documentId: '', result: 'blob:https://creator.example/no-document' },
    { frameId: 5, result: 'blob:https://creator.example/missing-document' },
    { frameId: 6, documentId: 'data-doc', result: 'data:text/html,hello' },
    { frameId: 7, documentId: 'invalid-result', result: { url: BLOB_URL, parentUrl: 'https://forged.example/' } },
    { frameId: 8, documentId: 'blank-doc', result: 'about:blank' },
    { frameId: 9, documentId: 'srcdoc-doc', result: 'about:srcdoc' },
    { frameId: 10, documentId: 'fs-doc', result: 'filesystem:https://creator.example/temporary/child' },
    { frameId: 11, documentId: 'unknown-about', result: 'about:config' },
    { frameId: 12, documentId: 'unknown-file', result: 'file:///tmp/child.html' }
  ]);
  assert.deepEqual(await discoverOpaqueDocuments(7), [
    { frameId: 3, documentId: 'blob-doc', url: BLOB_URL },
    { frameId: 6, documentId: 'data-doc', url: 'data:text/html,hello' },
    { frameId: 8, documentId: 'blank-doc', url: 'about:blank' },
    { frameId: 9, documentId: 'srcdoc-doc', url: 'about:srcdoc' },
    { frameId: 10, documentId: 'fs-doc', url: 'filesystem:https://creator.example/temporary/child' }
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].target, { tabId: 7, allFrames: true });
  assert.equal(calls[0].world, 'ISOLATED');
});

function installBlobQuery(response: any) {
  const calls: any[] = [];
  const evidenceEndpoint = chrome.tabs.sendMessage;
  (chrome as any).tabs = {
    sendMessage: async (...args: any[]) => {
      if (args[1].action !== 'readBlobParent') return (evidenceEndpoint as any)(...args);
      calls.push(args);
      if (response instanceof Error) throw response;
      return typeof response === 'function' ? response(...args) : response;
    }
  };
  return calls;
}

test('Chrome119 注入拒绝后只向双 ID 内容端点查询，并采用端点实际读取的最近父地址', async () => {
  const parentUrl = 'https://nearest.example/actual';
  const scriptCalls = installScriptResults(new Error('Cannot access contents of url "blob:https://creator.example/document"'));
  const queries = installBlobQuery(() => readFromWindow(frameWindow(BLOB_URL, frameWindow(parentUrl))));

  assert.deepEqual(await resolveBlobParent(7, 3, 'blob-doc', BLOB_URL), { url: BLOB_URL, parentUrl });
  assert.deepEqual(scriptCalls, [{
    target: { tabId: 7, documentIds: ['blob-doc'] },
    world: 'ISOLATED',
    func: readAccessibleWebParent
  }]);
  assert.deepEqual(queries, [[7, { action: 'readBlobParent' }, { frameId: 3, documentId: 'blob-doc' }]]);
});

test('Chrome119 回退缺少合法端点或端点报错时拒绝，并保留两条失败原因', async () => {
  for (const tabs of [undefined, {}]) {
    installScriptResults(new Error('Chrome119 blob injection denied'));
    (chrome as any).tabs = tabs;
    await assert.rejects(() => resolveBlobParent(7, 3, 'blob-doc', BLOB_URL), /Chrome119 blob injection denied/);
  }
  installScriptResults(new Error('Chrome119 blob injection denied'));
  const queries = installBlobQuery(new Error('Could not establish connection. Receiving end does not exist.'));
  await assert.rejects(() => resolveBlobParent(7, 3, 'blob-doc', BLOB_URL), (error: unknown) => {
    assert.match(String(error), /Chrome119 blob injection denied/);
    assert.match(String(error), /Receiving end does not exist/);
    return true;
  });
  assert.deepEqual(queries, [[7, { action: 'readBlobParent' }, { frameId: 3, documentId: 'blob-doc' }]]);
});

test('Chrome119 内容端点读取父 Location 遭 SOP 拒绝时不能借顶层地址恢复', async () => {
  installScriptResults(new Error('Chrome119 blob injection denied'));
  const top = frameWindow('https://top.example/');
  const blocked = frameWindow('https://cross-origin.example/', top);
  Object.defineProperty(blocked, 'location', {
    get() { throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError'); }
  });
  const queries = installBlobQuery(() => readFromWindow(frameWindow(BLOB_URL, blocked)));
  await assert.rejects(() => resolveBlobParent(7, 3, 'blob-doc', BLOB_URL), /SecurityError/);
  assert.equal(queries.length, 1);
});

test('Chrome119 回退拒绝空响应、自报替代字段、非 blob、URL 变化或非 HTTP 父地址', async () => {
  const valid = { url: BLOB_URL, parentUrl: 'https://nearest.example/' };
  const invalid = [
    undefined, null, {}, 'https://nearest.example/',
    { senderUrl: BLOB_URL, referrer: valid.parentUrl, effectiveUrl: valid.parentUrl },
    { url: BLOB_URL, referrer: valid.parentUrl, parentURL: valid.parentUrl },
    ...[undefined, null, 7, '', 'invalid', 'https://creator.example/page', 'data:text/html,child', 'about:blank', 'blob:https://creator.example/changed']
      .map((url) => ({ ...valid, url })),
    ...[undefined, null, 7, '', 'invalid', 'blob:https://creator.example/parent', 'data:text/html,parent', 'about:blank', 'filesystem:https://creator.example/temporary/parent', 'file:///tmp/parent.html']
      .map((parentUrl) => ({ ...valid, parentUrl }))
  ];
  for (const response of invalid) {
    installScriptResults(new Error('Chrome119 blob injection denied'));
    const queries = installBlobQuery(response);
    await assert.rejects(() => resolveBlobParent(7, 3, 'blob-doc', BLOB_URL), JSON.stringify(response));
    assert.deepEqual(queries, [[7, { action: 'readBlobParent' }, { frameId: 3, documentId: 'blob-doc' }]]);
  }
});

test('executeScript 成功但结果为空、身份不符或内容无效时绝不触发内容端点回退', async () => {
  const valid = { frameId: 3, documentId: 'blob-doc', result: { url: BLOB_URL, parentUrl: 'https://nearest.example/' } };
  const invalid = [
    [],
    [{ ...valid, frameId: 9 }],
    [{ ...valid, documentId: 'other-document' }],
    [{ ...valid, documentId: undefined }],
    [{ ...valid, result: undefined }],
    [{ ...valid, result: { ...valid.result, url: 'blob:https://creator.example/changed' } }],
    [{ ...valid, result: { ...valid.result, parentUrl: null } }]
  ];
  for (const results of invalid) {
    installScriptResults(results);
    const queries = installBlobQuery(valid.result);
    await assert.rejects(() => resolveBlobParent(7, 3, 'blob-doc', BLOB_URL));
    assert.deepEqual(queries, [], '成功的程序化探测不能因结果拒绝而降级为另一路证据');
  }
});

test('executeScript 已给出匹配的 blob 父证据时不查询内容端点', async () => {
  const valid = { url: BLOB_URL, parentUrl: 'https://nearest.example/from-script' };
  installScriptResults([{ frameId: 3, documentId: 'blob-doc', result: valid }]);
  const queries = installBlobQuery({ url: BLOB_URL, parentUrl: 'https://unrelated.example/' });
  assert.deepEqual(await resolveBlobParent(7, 3, 'blob-doc', BLOB_URL), valid);
  assert.deepEqual(queries, []);
});

test('knownDocuments 登记成功 blob 身份并按 tab 与顶层 documentId 隔离，不保存父 URL', async () => {
  installScriptResults(new Error('Chrome119 blob injection denied'));
  installBlobQuery({ url: BLOB_URL, parentUrl: 'https://nearest.example/' });
  const resolver = createFrameRuleResolver();
  const top = (documentId: string) => [{ frameId: 0, documentId, parentFrameId: -1, url: 'https://top.example/' }];
  await resolver.resolve(7, 3, 'blob-doc', BLOB_URL, top('top-7'));
  await resolver.resolve(8, 3, 'blob-doc', BLOB_URL, top('top-8'));
  await resolver.resolve(7, 4, 'new-blob-doc', BLOB_URL, top('new-top-7'));
  const identity = { frameId: 3, documentId: 'blob-doc', url: BLOB_URL };
  assert.deepEqual(resolver.knownDocuments(7, 'top-7'), [identity]);
  assert.deepEqual(resolver.knownDocuments(8, 'top-8'), [identity]);
  assert.deepEqual(resolver.knownDocuments(7, 'new-top-7'), [{ ...identity, frameId: 4, documentId: 'new-blob-doc' }]);
  for (const [tabId, topDocumentId] of [[7, undefined], [7, 'top-8'], [8, 'top-7'], [9, 'top-7']] as const) {
    assert.deepEqual(resolver.knownDocuments(tabId, topDocumentId), []);
  }
  await resolver.resolve(7, 5, 'no-top-doc', BLOB_URL, []);
  assert.deepEqual(resolver.knownDocuments(7, 'top-7'), [identity], '缺少顶层身份不能新增可枚举记录');
});

test('knownDocuments 保留同 frame 的不同 documentId，不让旧文档身份遮住新文档', async () => {
  installScriptResults(new Error('Chrome119 blob injection denied'));
  installBlobQuery({ url: BLOB_URL, parentUrl: 'https://nearest.example/' });
  const resolver = createFrameRuleResolver();
  const frames = [{ frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' }];
  await resolver.resolve(7, 3, 'old-blob-doc', BLOB_URL, frames);
  await resolver.resolve(7, 3, 'new-blob-doc', BLOB_URL, frames);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), [
    { frameId: 3, documentId: 'old-blob-doc', url: BLOB_URL },
    { frameId: 3, documentId: 'new-blob-doc', url: BLOB_URL }
  ]);
});

test('成功父链的 data 与 about:blank 均可供 BFCache 恢复发现，重新解析仍读取当前 blob 父地址', async () => {
  installScriptResults(new Error('Chrome119 blob injection denied'));
  let parentUrl = 'https://nearest.example/before';
  const queries = installBlobQuery(() => ({ url: BLOB_URL, parentUrl }));
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const blank = { frameId: 4, documentId: 'blank-doc', parentFrameId: 3, parentDocumentId: 'blob-doc', url: 'about:blank' };
  const data = { frameId: 6, documentId: 'data-doc', parentFrameId: 4, parentDocumentId: 'blank-doc', url: 'data:text/html,child' };
  assert.equal(await resolver.resolve(7, 6, 'data-doc', data.url, [top, blank, data]), parentUrl);
  const known = resolver.knownDocuments(7, 'top');
  assert.deepEqual(known.sort((left, right) => left.documentId.localeCompare(right.documentId)), [
    { frameId: 4, documentId: 'blank-doc', url: blank.url },
    { frameId: 3, documentId: 'blob-doc', url: BLOB_URL },
    { frameId: 6, documentId: 'data-doc', url: data.url }
  ]);
  for (const tabId of [8, 9]) assert.deepEqual(resolver.knownDocuments(tabId, 'top'), []);
  assert.deepEqual(resolver.knownDocuments(7, 'new-top'), []);

  parentUrl = 'https://nearest.example/restored';
  for (const doc of known) {
    assert.equal(await resolver.resolve(7, doc.frameId, doc.documentId, doc.url, [top]), parentUrl);
  }
  assert.equal(queries.length, 4, '发现身份后仍逐次探测，不能用发现记录内的地址授权');
  assert.deepEqual(queries, Array.from({ length: 4 }, () => [7, { action: 'readBlobParent' }, { frameId: 3, documentId: 'blob-doc' }]));
});

test('known blob 身份每次重新读取父 URL，查询失败不能复用历史父地址授权', async () => {
  installScriptResults(new Error('Chrome119 blob injection denied'));
  let response: any = { url: BLOB_URL, parentUrl: 'https://nearest.example/before' };
  const queries = installBlobQuery(() => {
    if (response instanceof Error) throw response;
    return response;
  });
  const resolver = createFrameRuleResolver();
  const frames = [{ frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' }];
  assert.equal(await resolver.resolve(7, 3, 'blob-doc', BLOB_URL, frames), 'https://nearest.example/before');
  response = { url: BLOB_URL, parentUrl: 'https://nearest.example/after' };
  assert.equal(await resolver.resolve(7, 3, 'blob-doc', BLOB_URL, frames), 'https://nearest.example/after');
  response = new Error('content endpoint closed');
  await assert.rejects(() => resolver.resolve(7, 3, 'blob-doc', BLOB_URL, frames), /content endpoint closed/);
  assert.equal(queries.length, 3);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), [{ frameId: 3, documentId: 'blob-doc', url: BLOB_URL }]);
});

test('失败的 blob 查询不留下新身份，已知 blob 列表和冷实例均不能证明缺失 data 父链', async () => {
  const frames = [{ frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' }];
  const resolver = createFrameRuleResolver();
  for (const response of [undefined, { url: 'https://creator.example/navigated', parentUrl: frames[0].url }, new Error('endpoint closed')]) {
    installScriptResults(new Error('Chrome119 blob injection denied'));
    installBlobQuery(response);
    await assert.rejects(() => resolver.resolve(7, 3, 'failed-blob-doc', BLOB_URL, frames));
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  }
  installScriptResults(new Error('Chrome119 blob injection denied'));
  const queries = installBlobQuery({ url: BLOB_URL, parentUrl: 'https://nearest.example/' });
  await resolver.resolve(7, 3, 'blob-doc', BLOB_URL, frames);
  queries.length = 0;
  for (const instance of [resolver, createFrameRuleResolver()]) {
    await assert.rejects(() => instance.resolve(7, 6, 'data-doc', 'data:text/html,child', frames), /absent from browser frame snapshot/);
  }
  assert.deepEqual(queries, [], '已知 blob 身份不提供缺失 data 文档与它的父边');
});

test('knownDocuments 身份表上限 500，淘汰最早身份且保留最新成功文档', async () => {
  installScriptResults(new Error('Chrome119 blob injection denied'));
  installBlobQuery((_tabId: number, _request: any, options: any) => ({
    url: `blob:https://creator.example/${options.documentId}`,
    parentUrl: 'https://nearest.example/'
  }));
  const resolver = createFrameRuleResolver();
  const frames = [{ frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' }];
  for (let index = 0; index <= 500; index++) {
    await resolver.resolve(7, index + 1, `blob-${index}`, `blob:https://creator.example/blob-${index}`, frames);
  }
  const known = resolver.knownDocuments(7, 'top');
  assert.equal(known.length, 500);
  assert.equal(known.some((entry) => entry.documentId === 'blob-0'), false);
  assert.deepEqual(known[0], { frameId: 2, documentId: 'blob-1', url: 'blob:https://creator.example/blob-1' });
  assert.deepEqual(known.at(-1), { frameId: 501, documentId: 'blob-500', url: 'blob:https://creator.example/blob-500' });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('内容私有凭证使新 resolver 恢复 root 与嵌套 data 父链，session 只保存固定密钥', async () => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  installScriptResults([], session, content);
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/rule' };
  const root = { frameId: 1, documentId: 'root-data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,private-root-content' };
  const blank = { frameId: 2, documentId: 'blank', parentFrameId: 1, parentDocumentId: 'root-data', url: 'about:blank' };
  const child = { frameId: 3, documentId: 'nested-data', parentFrameId: 2, parentDocumentId: 'blank', url: 'data:text/html,private-child-content' };
  const rootSnapshot = { ...root, payload: { content: 'must-not-persist' }, effectiveUrl: 'https://forged.example/', parentUrl: 'https://forged.example/' };
  const original = createFrameRuleResolver();
  const first = await original.resolveForContent(7, root.frameId, root.documentId, root.url, [top, rootSnapshot]);
  assert.equal(first.effectiveUrl, top.url);
  assert.deepEqual(first.frameEvidence, content.receipts.get(content.key(7, root.frameId, root.documentId)));
  assert.equal(await original.resolve(7, child.frameId, child.documentId, child.url, [top, root, blank, child]), top.url);

  const stored = await session.get(null);
  assert.deepEqual(Object.keys(stored), [FRAME_RECEIPT_KEY]);
  assert.equal((stored[FRAME_RECEIPT_KEY] as number[]).length, 32);
  const childReceipt = content.receipts.get(content.key(7, child.frameId, child.documentId)) as FrameReceipt;
  assert.deepEqual((await createFrameReceiptCodec().verify(childReceipt, 7, child.frameId, child.documentId)).frames,
    [{ ...child, url: 'data:' }, blank, { ...root, url: 'data:' }, top]);
  const restored = createFrameRuleResolver();
  assert.deepEqual(restored.knownDocuments(7, 'top'), []);
  content.calls.length = 0;
  assert.equal(await restored.resolve(7, root.frameId, root.documentId, root.url, [top]), top.url);
  assert.equal(await restored.resolve(7, child.frameId, child.documentId, child.url, [top]), top.url);
  assert.deepEqual(content.calls.filter(call => call[1].action === 'readFrameEvidence'), [
    [7, { action: 'readFrameEvidence' }, { frameId: root.frameId, documentId: root.documentId }],
    [7, { action: 'readFrameEvidence' }, { frameId: child.frameId, documentId: child.documentId }]
  ]);
  assert.equal(restored.knownDocuments(7, 'top').some(entry => entry.documentId === child.documentId), true);
  const persisted = JSON.stringify([await session.get(null), [...content.receipts.values()]]);
  for (const forbidden of ['private-root-content', 'private-child-content', 'payload', 'effectiveUrl', 'parentUrl']) {
    assert.equal(persisted.includes(forbidden), false, forbidden);
  }
});

test('凭证恢复 data 到缺失 blob 的父边后仍精确重读当前 blob，绝不签入探测出的 HTTP 父地址', async () => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  installScriptResults(new Error('Chrome119 blob injection denied'), session, content);
  let parentUrl = 'https://nearest.example/before';
  const queries = installBlobQuery(() => ({ url: BLOB_URL, parentUrl }));
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const blank = { frameId: 4, documentId: 'blank', parentFrameId: 3, parentDocumentId: 'blob-doc', url: 'about:blank' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 4, parentDocumentId: 'blank', url: 'data:text/html,private-content' };
  assert.equal(await createFrameRuleResolver().resolve(7, 6, 'data', child.url, [top, blank, child]), parentUrl);
  const receipt = content.receipts.get(content.key(7, 6, 'data')) as FrameReceipt;
  assert.deepEqual(await createFrameReceiptCodec().verify(receipt, 7, 6, 'data'), {
    frames: [{ ...child, url: 'data:' }, blank], boundary: { frameId: 3, documentId: 'blob-doc' }
  });
  parentUrl = 'https://nearest.example/after';
  const restored = createFrameRuleResolver();
  assert.equal(await restored.resolve(7, 6, 'data', child.url, [top]), parentUrl);
  assert.deepEqual(queries, Array.from({ length: 2 }, () => [7, { action: 'readBlobParent' }, { frameId: 3, documentId: 'blob-doc' }]));
  const persisted = JSON.stringify([await session.get(null), [...content.receipts.values()]]);
  assert.equal(persisted.includes('nearest.example'), false);
  assert.equal(persisted.includes(BLOB_URL), false);
  assert.equal(persisted.includes('private-content'), false);
});

test('超过 500 个内存事实被淘汰后，原文档仍从精确内容端点恢复且 session 大小恒定', async () => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  installScriptResults([], session, content);
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const first = { frameId: 1, documentId: 'data-0', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,first' };
  await resolver.resolve(7, first.frameId, first.documentId, first.url, [top, first]);
  for (let index = 1; index <= 501; index++) {
    const frame = { ...first, frameId: index + 1, documentId: `data-${index}` };
    await resolver.resolve(7, frame.frameId, frame.documentId, frame.url, [top, frame]);
  }
  assert.equal(resolver.knownDocuments(7, 'top').some(entry => entry.documentId === first.documentId), false);
  content.calls.length = 0;
  assert.equal(await resolver.resolve(7, first.frameId, first.documentId, first.url, [top]), top.url);
  assert.deepEqual(content.calls.filter(call => call[1].action === 'readFrameEvidence'), [
    [7, { action: 'readFrameEvidence' }, { frameId: first.frameId, documentId: first.documentId }]
  ]);
  assert.deepEqual(Object.keys(await session.get(null)), [FRAME_RECEIPT_KEY]);
  assert.equal(session.sets.length, 1, '文档增长不得增加 session 事实或重复写密钥');
  assert.deepEqual(session.removes, []);
});

test('同 tab 的不同文档并发共享初始化密钥，set 和 store ACK 完成后才发布 known 身份', async () => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  installScriptResults([], session, content);
  const entered = deferred();
  const release = deferred();
  const originalSet = session.set;
  let writes = 0;
  session.set = async items => {
    if (++writes === 1) { entered.resolve(); await release.promise; }
    await originalSet(items);
  };
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const first = { frameId: 1, documentId: 'first', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,first' };
  const second = { ...first, frameId: 2, documentId: 'second', url: 'data:text/html,second' };
  const firstResolve = resolver.resolve(7, first.frameId, first.documentId, first.url, [top, first]);
  const secondResolve = resolver.resolve(7, second.frameId, second.documentId, second.url, [top, second]);
  await entered.promise;
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.deepEqual(await session.get(null), {});
  assert.equal(content.calls.some(call => call[1].action === 'storeFrameEvidence'), false);
  release.resolve();
  assert.deepEqual(await Promise.all([firstResolve, secondResolve]), [top.url, top.url]);
  assert.equal(writes, 1);
  for (const frame of [first, second]) {
    const receipt = content.receipts.get(content.key(7, frame.frameId, frame.documentId));
    assert.deepEqual((await createFrameReceiptCodec().verify(receipt, 7, frame.frameId, frame.documentId)).frames,
      [{ ...frame, url: 'data:' }, top]);
  }
  assert.deepEqual(resolver.knownDocuments(7, 'top').map(entry => entry.documentId).sort(), ['first', 'second']);
  const restored = createFrameRuleResolver();
  for (const frame of [first, second]) assert.equal(await restored.resolve(7, frame.frameId, frame.documentId, frame.url, [top]), top.url);
});

test('quota 或密钥 set 失败明确拒绝，不能发布新 data 父边、凭证或 blob 发现身份', async () => {
  for (const failure of [new Error('QUOTA_BYTES quota exceeded'), new Error('session write failed')]) {
    const session = createSessionStorage();
    const originalSet = session.set;
    session.set = async () => { throw failure; };
    const content = createContentEvidence();
    installScriptResults(new Error('Chrome119 blob injection denied'), session, content);
    const queries = installBlobQuery({ url: BLOB_URL, parentUrl: 'https://nearest.example/' });
    const resolver = createFrameRuleResolver();
    const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
    const child = { frameId: 6, documentId: 'data', parentFrameId: 3, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
    await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top, child]), error => error === failure);
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
    assert.deepEqual(await session.get(null), {});
    assert.equal(content.receipts.size, 0);
    assert.equal(content.calls.some(call => call[1].action === 'storeFrameEvidence'), false);
    session.set = originalSet;
    for (const instance of [resolver, createFrameRuleResolver()]) {
      await assert.rejects(() => instance.resolve(7, 6, 'data', child.url, [top]), /absent from browser frame snapshot/);
    }
    assert.equal(queries.length, 1, '失败提交不能留下可用来再次触发 blob 探测的内存父边');
  }
});

test('session read 失败拒绝当前解析，不写入事实或发布 known 身份', async () => {
  const session = createSessionStorage();
  const failure = new Error('session read unavailable');
  session.get = async () => { throw failure; };
  const probes = installScriptResults([], session);
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
  await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top, child]), error => error === failure);
  assert.deepEqual(session.sets, []);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.deepEqual(probes, []);
});

test('内容凭证 shape、MAC 或 frame/document 身份无效时拒绝且不触发 blob 探测', async () => {
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:' };
  const session = createSessionStorage();
  const content = createContentEvidence();
  const probes = installScriptResults([], session, content);
  const codec = createFrameReceiptCodec();
  const valid = await codec.sign(7, 6, 'data', [child, top]);
  const invalid = [
    null, false, 'data:', [], {},
    { body: valid.body }, { mac: valid.mac }, { body: valid.body, mac: '0'.repeat(64) },
    { ...valid, body: `${valid.body} ` },
    await codec.sign(8, 6, 'data', [child, top]),
    await codec.sign(7, 9, 'other', [{ ...child, frameId: 9, documentId: 'other' }, top])
  ];
  session.sets.length = 0;
  for (const value of invalid) {
    content.receipts.set(content.key(7, 6, 'data'), value);
    const resolver = createFrameRuleResolver();
    await assert.rejects(() => resolver.resolve(7, 6, 'data', 'data:text/html,child', [top]), JSON.stringify(value));
    assert.deepEqual(session.sets, []);
    assert.deepEqual(probes, []);
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  }
});

test('新 resolver 拒绝有效凭证父边与当前导航身份或父文档冲突', async () => {
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:' };
  for (const current of [
    { ...child, documentId: 'new-document' },
    { ...child, parentFrameId: 9, parentDocumentId: 'different-parent' },
    { ...child, parentDocumentId: 'different-top' }
  ]) {
    const session = createSessionStorage();
    const content = createContentEvidence();
    const probes = installScriptResults([], session, content);
    content.receipts.set(content.key(7, 6, 'data'), await createFrameReceiptCodec().sign(7, 6, 'data', [child, top]));
    session.sets.length = 0;
    const resolver = createFrameRuleResolver();
    await assert.rejects(() => resolver.resolve(7, 6, 'data', 'data:text/html,child', [top, current]), /navigated|relationship changed/);
    assert.deepEqual(session.sets, []);
    assert.deepEqual(probes, []);
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  }
});

test('blob 探测失败时不签发正在遍历的 data 父边或猜测的 blob 事实', async () => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  installScriptResults(new Error('Chrome119 blob injection denied'), session, content);
  installBlobQuery(new Error('blob endpoint closed'));
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 3, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
  await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top, child]), /blob endpoint closed/);
  assert.deepEqual(session.sets, []);
  assert.deepEqual(await session.get(null), {});
  assert.equal(content.receipts.size, 0);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  installBlobQuery({ url: BLOB_URL, parentUrl: top.url });
  await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top]), /absent from browser frame snapshot/);
});

test('forgetTab 清空本 tab 内存并阻止晚到 ACK 发布，保留共享密钥及其他 tab 凭证', async () => {
  const protectedItems = {
    unrelated: { payload: 'preserve' },
    'vanishgeo.worker-coverage:7': { preserve: true }
  };
  const session = createSessionStorage(protectedItems);
  const content = createContentEvidence();
  installScriptResults([], session, content);
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
  await resolver.resolve(7, 6, 'data', child.url, [top, child]);
  await resolver.resolve(8, 6, 'data', child.url, [top, child]);
  const before = await session.get(null);
  const entered = deferred();
  const release = deferred();
  const originalSend = chrome.tabs.sendMessage;
  (chrome.tabs as any).sendMessage = async (...args: any[]) => {
    if (args[0] === 7 && args[1].action === 'storeFrameEvidence') {
      entered.resolve();
      await release.promise;
    }
    return (originalSend as any)(...args);
  };
  const pending = resolver.resolve(7, 6, 'data', child.url, [top, child]);
  const queuedChild = { ...child, frameId: 9, documentId: 'queued' };
  const queued = resolver.resolve(7, 9, 'queued', child.url, [top, queuedChild]);
  const results = Promise.allSettled([pending, queued]);
  await entered.promise;
  const forgotten = resolver.forgetTab(7);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  release.resolve();
  await forgotten;
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.match(String(result.reason), /tab has closed/);
  }
  assert.deepEqual(await session.get(null), before);
  assert.deepEqual(session.removes, []);
  assert.equal(content.receipts.has(content.key(8, 6, 'data')), true);
  assert.equal(resolver.knownDocuments(8, 'top').length, 1);
  await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top, child]), /tab has closed/);
});

test('storeFrameEvidence 只向精确文档投递，ACK 之前不返回结果或发布 known 身份', async () => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  installScriptResults([], session, content);
  const entered = deferred();
  const release = deferred();
  const stores: any[] = [];
  const originalSend = chrome.tabs.sendMessage;
  (chrome.tabs as any).sendMessage = async (...args: any[]) => {
    if (args[1].action === 'storeFrameEvidence') {
      stores.push(args);
      entered.resolve();
      await release.promise;
    }
    return (originalSend as any)(...args);
  };
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,private-content' };
  let returned = false;
  const pending = resolver.resolveForContent(7, 6, 'data', child.url, [top, child]).then(result => { returned = true; return result; });
  await entered.promise;
  assert.equal(returned, false);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.equal(content.receipts.size, 0);
  assert.equal(session.sets.length, 1);
  assert.equal(stores.length, 1);
  const receipt = stores[0][1].frameEvidence;
  assert.deepEqual(stores[0], [7, { action: 'storeFrameEvidence', frameEvidence: receipt }, { frameId: 6, documentId: 'data' }]);
  assert.deepEqual((await createFrameReceiptCodec().verify(receipt, 7, 6, 'data')).frames, [{ ...child, url: 'data:' }, top]);
  release.resolve();
  assert.deepEqual(await pending, { effectiveUrl: top.url, frameEvidence: receipt });
  assert.deepEqual(resolver.knownDocuments(7, 'top'), [{ frameId: 6, documentId: 'data', url: child.url }]);
});

test('store ACK 缺失、无效或投递失败不能发布父边、凭证结果或 blob 发现身份', async () => {
  for (const acknowledgement of [undefined, null, {}, { stored: false }, { stored: 1 }, new Error('content store closed')]) {
    const session = createSessionStorage();
    const content = createContentEvidence();
    installScriptResults(new Error('Chrome119 blob injection denied'), session, content);
    const blobQueries = installBlobQuery({ url: BLOB_URL, parentUrl: 'https://nearest.example/' });
    const originalSend = chrome.tabs.sendMessage;
    const stores: any[] = [];
    (chrome.tabs as any).sendMessage = async (...args: any[]) => {
      if (args[1].action !== 'storeFrameEvidence') return (originalSend as any)(...args);
      stores.push(args);
      if (acknowledgement instanceof Error) throw acknowledgement;
      return acknowledgement;
    };
    const resolver = createFrameRuleResolver();
    const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
    const child = { frameId: 6, documentId: 'data', parentFrameId: 3, parentDocumentId: 'blob-doc', url: 'data:text/html,child' };
    await assert.rejects(() => resolver.resolveForContent(7, 6, 'data', child.url, [top, child]), /not stored|content store closed/);
    assert.equal(stores.length, 1);
    assert.equal(content.receipts.size, 0);
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
    assert.deepEqual(Object.keys(await session.get(null)), [FRAME_RECEIPT_KEY]);
    assert.deepEqual(session.removes, []);
    (chrome.tabs as any).sendMessage = originalSend;
    await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top]), /absent from browser frame snapshot/);
    assert.equal(blobQueries.length, 1, 'ACK 失败不能把已遍历父边留给后续解析');
  }
});

test('原生 HMAC sign 失败不能投递或发布父边，已经持久化的密钥保留', async (t) => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  installScriptResults([], session, content);
  const failure = new Error('native HMAC signing failed');
  const signing = t.mock.method(crypto.subtle, 'sign', async () => { throw failure; });
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
  await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top, child]), error => error === failure);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.equal(content.calls.some(call => call[1].action === 'storeFrameEvidence'), false);
  assert.equal(content.receipts.size, 0);
  assert.deepEqual(Object.keys(await session.get(null)), [FRAME_RECEIPT_KEY]);
  signing.mock.restore();
  await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top]), /absent from browser frame snapshot/);
});

test('tab 在密钥初始化期间关闭时，晚到签名不能投递或回填 known 身份', async () => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  installScriptResults([], session, content);
  const entered = deferred();
  const release = deferred();
  const originalSet = session.set;
  session.set = async items => {
    entered.resolve();
    await release.promise;
    await originalSet(items);
  };
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:text/html,child' };
  const pending = resolver.resolveForContent(7, 6, 'data', child.url, [top, child]);
  const rejected = assert.rejects(() => pending, /tab has closed/);
  await entered.promise;
  await resolver.forgetTab(7);
  release.resolve();
  await rejected;
  assert.equal(content.calls.some(call => call[1].action === 'storeFrameEvidence'), false);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.deepEqual(Object.keys(await session.get(null)), [FRAME_RECEIPT_KEY]);
  assert.deepEqual(session.removes, []);
});

test('恢复凭证时缺失或畸形密钥不能发布事实，也不能创建替代密钥', async () => {
  const sourceSession = createSessionStorage();
  installScriptResults([], sourceSession);
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:' };
  const receipt = await createFrameReceiptCodec().sign(7, 6, 'data', [child, top]);
  for (const initial of [{}, { [FRAME_RECEIPT_KEY]: [1, 2, 3] }]) {
    const session = createSessionStorage(initial);
    const content = createContentEvidence();
    const probes = installScriptResults([], session, content);
    content.receipts.set(content.key(7, 6, 'data'), receipt);
    const resolver = createFrameRuleResolver();
    await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top]), /key/);
    assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
    assert.equal(content.calls.some(call => call[1].action === 'storeFrameEvidence'), false);
    assert.deepEqual(await session.get(null), initial);
    assert.deepEqual(session.sets, []);
    assert.deepEqual(probes, []);
  }
});

test('readFrameEvidence 端点失败明确拒绝，不把完整快照伪装为已完成的凭证交付', async () => {
  const session = createSessionStorage();
  const content = createContentEvidence();
  const probes = installScriptResults([], session, content);
  const failure = new Error('content receipt endpoint closed');
  (chrome.tabs as any).sendMessage = async () => { throw failure; };
  const resolver = createFrameRuleResolver();
  const top = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://top.example/' };
  const child = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:' };
  await assert.rejects(() => resolver.resolve(7, 6, 'data', child.url, [top, child]), error => error === failure);
  assert.deepEqual(resolver.knownDocuments(7, 'top'), []);
  assert.deepEqual(session.sets, []);
  assert.equal(content.receipts.size, 0);
  assert.deepEqual(probes, []);
});
