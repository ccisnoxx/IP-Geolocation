import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createFrameReceiptCodec, FRAME_RECEIPT_KEY, type FrameEvidence, type FrameReceipt } from '../src/background/frame-receipts';

const TEST_KEY = Array.from({ length: 32 }, (_, index) => index + 1);
const TOP: FrameEvidence = { frameId: 0, documentId: 'top', parentFrameId: -1, url: 'https://nearest.example/rule' };
const CHILD: FrameEvidence = { frameId: 6, documentId: 'data', parentFrameId: 0, parentDocumentId: 'top', url: 'data:' };
const PURPOSE = 'vanishgeo/frame-evidence/v1';

function createSession(initial: Record<string, unknown> = {}) {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const values = copy(initial);
  const gets: Array<string | string[] | null> = [];
  const sets: Record<string, unknown>[] = [];
  const removes: Array<string | string[]> = [];
  return {
    gets, sets, removes, values,
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
      for (const name of typeof keys === 'string' ? [keys] : keys) delete values[name];
    }
  };
}

function installSession(session = createSession()) {
  (globalThis as any).chrome = { storage: { session } };
  return session;
}

function bodyValue() {
  return { purpose: PURPOSE, tabId: 7, frameId: 6, documentId: 'data', frames: [CHILD, TOP] };
}

// 独立计算 MAC，让畸形结构测试真正到达 verify 的结构验证边界。
function authenticated(value: unknown): FrameReceipt {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return { body, mac: createHmac('sha256', Buffer.from(TEST_KEY)).update(body).digest('hex') };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('签发原生 HMAC-SHA256 凭证并验证完整 HTTP 父链，后台只保存一个 32 字节密钥', async () => {
  const session = installSession();
  const receipt = await createFrameReceiptCodec().sign(7, 6, 'data', [CHILD, TOP]);
  assert.deepEqual(Object.keys(receipt).sort(), ['body', 'mac']);
  assert.match(receipt.mac, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(receipt.body), bodyValue());
  assert.deepEqual(Object.keys(session.values), [FRAME_RECEIPT_KEY]);
  const key = session.values[FRAME_RECEIPT_KEY] as number[];
  assert.equal(key.length, 32);
  assert.equal(key.every(value => Number.isInteger(value) && value >= 0 && value <= 255), true);
  assert.equal(receipt.mac, createHmac('sha256', Buffer.from(key)).update(receipt.body).digest('hex'));
  assert.deepEqual(await createFrameReceiptCodec().verify(receipt, 7, 6, 'data'), { frames: [CHILD, TOP] });
  assert.equal(session.sets.length, 1);
  assert.deepEqual(session.removes, []);
});

test('缺失 blob 边界只认证浏览器父身份，不包含现场探测出的 HTTP 父地址', async () => {
  installSession();
  const child = { ...CHILD, parentFrameId: 3, parentDocumentId: 'blob-doc' };
  const boundary = { frameId: 3, documentId: 'blob-doc' };
  const receipt = await createFrameReceiptCodec().sign(7, 6, 'data', [child], boundary);
  assert.deepEqual(await createFrameReceiptCodec().verify(receipt, 7, 6, 'data'), { frames: [child], boundary });
  assert.deepEqual(JSON.parse(receipt.body), { ...bodyValue(), frames: [child], boundary });
  assert.equal(receipt.body.includes('nearest.example'), false);
  assert.equal(receipt.body.includes('blob:https:'), false);
});

test('签发只保留 Frame 字段与 data 标记，页面内容、额外配置和密钥不进入凭证', async () => {
  const session = installSession(createSession({ [FRAME_RECEIPT_KEY]: TEST_KEY }));
  const receipt = await createFrameReceiptCodec().sign(7, 6, 'data', [
    { ...CHILD, url: 'data:text/html,private-page-content', payload: { secret: 'private-config' },
      effectiveUrl: 'https://forged.example/', parentUrl: 'https://forged.example/' } as FrameEvidence,
    TOP
  ]);
  assert.deepEqual(JSON.parse(receipt.body), bodyValue());
  for (const forbidden of ['private-page-content', 'private-config', 'payload', 'effectiveUrl', 'parentUrl', JSON.stringify(TEST_KEY)]) {
    assert.equal(JSON.stringify(receipt).includes(forbidden), false, forbidden);
  }
  assert.deepEqual(session.sets, []);
});

test('MAC 覆盖 purpose、tab/frame/document、父链与边界，任一未经重签的变更均拒绝', async () => {
  const session = installSession(createSession({ [FRAME_RECEIPT_KEY]: TEST_KEY }));
  const receipt = await createFrameReceiptCodec().sign(7, 6, 'data', [CHILD, TOP]);
  const original = bodyValue();
  const altered = [
    { ...original, purpose: 'other-purpose' }, { ...original, tabId: 8 }, { ...original, frameId: 9 },
    { ...original, documentId: 'other' },
    { ...original, frames: [{ ...CHILD, parentDocumentId: 'other' }, TOP] },
    { ...original, frames: [CHILD, { ...TOP, url: 'https://forged.example/' }] },
    { ...original, boundary: { frameId: 0, documentId: 'top' } }
  ];
  const codec = createFrameReceiptCodec();
  for (const value of altered) await assert.rejects(() => codec.verify({ ...receipt, body: JSON.stringify(value) }, 7, 6, 'data'), /signature/);
  await assert.rejects(() => codec.verify({ ...receipt, mac: '0'.repeat(64) }, 7, 6, 'data'), /signature/);
  assert.deepEqual(session.sets, []);
});

test('合法 MAC 仍绑定精确 tab/frame/document，未知用途或版本不能重放', async () => {
  const session = installSession(createSession({ [FRAME_RECEIPT_KEY]: TEST_KEY }));
  const receipt = authenticated(bodyValue());
  const codec = createFrameReceiptCodec();
  for (const [tabId, frameId, documentId] of [[8, 6, 'data'], [7, 9, 'data'], [7, 6, 'other']] as const) {
    await assert.rejects(() => codec.verify(receipt, tabId, frameId, documentId), /identity/);
  }
  for (const purpose of ['vanishgeo/frame-evidence/v2', 'vanishgeo/other/v1', undefined]) {
    await assert.rejects(() => codec.verify(authenticated({ ...bodyValue(), purpose }), 7, 6, 'data'), /identity/);
  }
  assert.deepEqual(session.sets, []);
});

test('凭证外层 schema、MAC 格式、JSON 与锚点结构无效时拒绝', async () => {
  const session = installSession(createSession({ [FRAME_RECEIPT_KEY]: TEST_KEY }));
  const valid = authenticated(bodyValue());
  const invalid = [
    null, undefined, false, 7, [], {}, valid.body,
    { body: valid.body }, { mac: valid.mac }, { body: 7, mac: valid.mac },
    ...['', '0'.repeat(63), '0'.repeat(65), 'g'.repeat(64), valid.mac.toUpperCase()].map(mac => ({ body: valid.body, mac })),
    authenticated('not-json'), authenticated(null), authenticated([]),
    authenticated({ ...bodyValue(), frames: null }), authenticated({ ...bodyValue(), frames: [] }),
    authenticated({ ...bodyValue(), frames: [{ ...CHILD, frameId: 8 }, TOP] }),
    authenticated({ ...bodyValue(), frames: [{ ...CHILD, documentId: 'other' }, TOP] })
  ];
  const codec = createFrameReceiptCodec();
  for (const receipt of invalid) await assert.rejects(() => codec.verify(receipt, 7, 6, 'data'), JSON.stringify(receipt));
  assert.deepEqual(session.sets, []);
});

test('合法 MAC 的断链、环、无效父身份和未知协议仍拒绝', async () => {
  installSession(createSession({ [FRAME_RECEIPT_KEY]: TEST_KEY }));
  const badChildren = [
    null, false, {}, { ...CHILD, frameId: 6.5 }, { ...CHILD, frameId: -1 },
    { ...CHILD, documentId: '' }, { ...CHILD, parentFrameId: 0.5 }, { ...CHILD, parentFrameId: -2 },
    { ...CHILD, parentDocumentId: undefined }, { ...CHILD, parentDocumentId: '' },
    { ...CHILD, parentFrameId: 9 }, { ...CHILD, parentDocumentId: 'different-top' },
    ...['invalid', 'chrome://settings/', 'file:///tmp/data', 'about:config', 'javascript:alert(1)'].map(url => ({ ...CHILD, url }))
  ];
  const badChains = [
    ...badChildren.map(child => [child, TOP]),
    [CHILD, { ...TOP, documentId: CHILD.documentId }],
    [CHILD, { ...TOP, url: 'about:blank', parentFrameId: 6, parentDocumentId: 'data' }, CHILD],
    [{ ...CHILD, url: 'https://child.example/' }, TOP]
  ];
  const codec = createFrameReceiptCodec();
  for (const frames of badChains) {
    await assert.rejects(() => codec.verify(authenticated({ ...bodyValue(), frames }), 7, 6, 'data'), JSON.stringify(frames));
  }
});

test('HTTP 终点不能附带边界，opaque 终点必须精确连接未访问的 missing-blob 身份', async () => {
  installSession(createSession({ [FRAME_RECEIPT_KEY]: TEST_KEY }));
  const opaque = { ...CHILD, parentFrameId: 3, parentDocumentId: 'blob-doc' };
  const invalid = [
    { ...bodyValue(), boundary: { frameId: 0, documentId: 'top' } },
    { ...bodyValue(), frames: [opaque] },
    ...[null, {}, { frameId: 4, documentId: 'blob-doc' }, { frameId: 3, documentId: 'other' },
      { frameId: 3, documentId: 'data' }].map(boundary => ({ ...bodyValue(), frames: [opaque], boundary })),
    { ...bodyValue(), frames: [{ ...CHILD, parentFrameId: -1, parentDocumentId: undefined }], boundary: { frameId: -1 } }
  ];
  const codec = createFrameReceiptCodec();
  for (const value of invalid) await assert.rejects(() => codec.verify(authenticated(value), 7, 6, 'data'), /boundary/);
});

test('验证缺失或畸形 session 密钥只读失败，不轮换密钥或创建新的会话证据', async () => {
  const receipt = authenticated(bodyValue());
  for (const value of [undefined, null, '', {}, [], TEST_KEY.slice(1), [...TEST_KEY, 33],
    TEST_KEY.map((byte, index) => index ? byte : -1), TEST_KEY.map((byte, index) => index ? byte : 256),
    TEST_KEY.map((byte, index) => index ? byte : 0.5)]) {
    const initial = value === undefined ? {} : { [FRAME_RECEIPT_KEY]: value };
    const session = installSession(createSession(initial));
    await assert.rejects(() => createFrameReceiptCodec().verify(receipt, 7, 6, 'data'), /key/);
    assert.deepEqual(session.values, initial);
    assert.deepEqual(session.gets, [FRAME_RECEIPT_KEY]);
    assert.deepEqual(session.sets, []);
    assert.deepEqual(session.removes, []);
  }
});

test('首次并发签发等待唯一密钥 set 成功，既有密钥跨 factory 复用且大小恒定', async (t) => {
  const session = installSession();
  const entered = deferred();
  const release = deferred();
  const originalSet = session.set;
  let writes = 0;
  session.set = async items => {
    writes++;
    entered.resolve();
    await release.promise;
    await originalSet(items);
  };
  const sign = t.mock.method(crypto.subtle, 'sign');
  const codec = createFrameReceiptCodec();
  let completed = 0;
  const pending = Array.from({ length: 3 }, () => codec.sign(7, 6, 'data', [CHILD, TOP]).then(value => { completed++; return value; }));
  await entered.promise;
  assert.equal(completed, 0);
  assert.equal(sign.mock.callCount(), 0);
  assert.deepEqual(session.values, {});
  release.resolve();
  const receipts = await Promise.all(pending);
  assert.equal(writes, 1);
  assert.equal(sign.mock.callCount(), 3);
  assert.deepEqual(receipts[1], receipts[0]);
  const before = JSON.stringify(session.values);
  assert.deepEqual(await createFrameReceiptCodec().sign(7, 6, 'data', [CHILD, TOP]), receipts[0]);
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(session.values), before);
  assert.deepEqual(session.gets, [FRAME_RECEIPT_KEY, FRAME_RECEIPT_KEY]);
});

test('密钥 read/set 初始化失败保持错误，同 factory 后续签发可以重试', async () => {
  for (const operation of ['get', 'set'] as const) {
    const session = installSession();
    const original = session[operation];
    const failure = new Error(`session ${operation} failed`);
    session[operation] = async () => { throw failure; };
    const codec = createFrameReceiptCodec();
    await assert.rejects(() => codec.sign(7, 6, 'data', [CHILD, TOP]), error => error === failure);
    assert.deepEqual(session.values, {});
    session[operation] = original as typeof session.get & typeof session.set;
    const receipt = await codec.sign(7, 6, 'data', [CHILD, TOP]);
    assert.deepEqual(await createFrameReceiptCodec().verify(receipt, 7, 6, 'data'), { frames: [CHILD, TOP] });
    assert.equal(session.sets.length, 1);
  }
});

test('原生 import/sign 失败可见，重试不替换已经持久化的密钥', async (t) => {
  for (const operation of ['importKey', 'sign'] as const) {
    const session = installSession();
    const failure = new Error(`native ${operation} failed`);
    const mocked = t.mock.method(crypto.subtle, operation, async () => { throw failure; });
    const codec = createFrameReceiptCodec();
    await assert.rejects(() => codec.sign(7, 6, 'data', [CHILD, TOP]), error => error === failure);
    const persisted = JSON.stringify(session.values);
    assert.equal(session.sets.length, 1);
    mocked.mock.restore();
    const receipt = await codec.sign(7, 6, 'data', [CHILD, TOP]);
    assert.deepEqual(await createFrameReceiptCodec().verify(receipt, 7, 6, 'data'), { frames: [CHILD, TOP] });
    assert.equal(session.sets.length, 1);
    assert.equal(JSON.stringify(session.values), persisted);
  }
});

test('缺密钥 verify 失败不阻塞同 factory 后续正常初始化和签发', async () => {
  const session = installSession();
  const codec = createFrameReceiptCodec();
  await assert.rejects(() => codec.verify(authenticated(bodyValue()), 7, 6, 'data'), /key/);
  assert.deepEqual(session.sets, []);
  const receipt = await codec.sign(7, 6, 'data', [CHILD, TOP]);
  assert.deepEqual(await codec.verify(receipt, 7, 6, 'data'), { frames: [CHILD, TOP] });
  assert.equal(session.sets.length, 1);
});
