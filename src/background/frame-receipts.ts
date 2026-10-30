/** 后台会话密钥只签浏览器父链事实；凭证由所属 ISOLATED 文档保管，不进入 MAIN。 */
export const FRAME_RECEIPT_KEY = 'vanishgeo.frame-receipt-key.v1';
export type FrameEvidence = Pick<chrome.webNavigation.GetAllFrameResultDetails,
  'frameId' | 'documentId' | 'parentFrameId' | 'parentDocumentId' | 'url'>;
export interface FrameReceipt { body: string; mac: string }
export interface FrameBoundary { frameId: number; documentId: string }
interface ReceiptBody {
  purpose: 'vanishgeo/frame-evidence/v1';
  tabId: number;
  frameId: number;
  documentId: string;
  frames: FrameEvidence[];
  boundary?: FrameBoundary;
}
const PURPOSE = 'vanishgeo/frame-evidence/v1';
const supported = (url: string): boolean => {
  const parsed = new URL(url);
  return ['http:', 'https:', 'blob:', 'data:', 'filesystem:'].includes(parsed.protocol)
    || (parsed.protocol === 'about:' && ['blank', 'srcdoc'].includes(parsed.pathname));
};

function validateBody(value: any, tabId: number, frameId: number, documentId: string): ReceiptBody {
  if (!value || value.purpose !== PURPOSE || value.tabId !== tabId || value.frameId !== frameId
    || value.documentId !== documentId || !Array.isArray(value.frames) || !value.frames.length) {
    throw new Error('invalid frame evidence identity');
  }
  const visited = new Set<string>();
  for (let index = 0; index < value.frames.length; index++) {
    const frame = value.frames[index];
    if (!frame || !Number.isInteger(frame.frameId) || frame.frameId < 0
      || typeof frame.documentId !== 'string' || !frame.documentId || visited.has(frame.documentId)
      || !Number.isInteger(frame.parentFrameId) || frame.parentFrameId < -1
      || (frame.parentFrameId >= 0 && (typeof frame.parentDocumentId !== 'string' || !frame.parentDocumentId))
      || typeof frame.url !== 'string' || !supported(frame.url)) throw new Error('invalid frame evidence chain');
    visited.add(frame.documentId);
    if (index === 0 && (frame.frameId !== frameId || frame.documentId !== documentId)) throw new Error('invalid frame evidence anchor');
    if (index < value.frames.length - 1) {
      const next = value.frames[index + 1];
      if (/^https?:/.test(frame.url) || !next || frame.parentFrameId !== next.frameId
        || frame.parentDocumentId !== next.documentId) throw new Error('disconnected frame evidence chain');
    }
  }
  const last = value.frames[value.frames.length - 1];
  if (/^https?:/.test(last.url)) {
    if (value.boundary !== undefined) throw new Error('unexpected frame evidence boundary');
  } else if (!value.boundary || value.boundary.frameId !== last.parentFrameId
    || value.boundary.documentId !== last.parentDocumentId || last.parentFrameId < 0
    || visited.has(value.boundary.documentId)) throw new Error('invalid frame evidence boundary');
  return value;
}

export function createFrameReceiptCodec() {
  let keyReady: Promise<CryptoKey> | undefined;
  function key(create: boolean): Promise<CryptoKey> {
    if (!keyReady) {
      const pending = (async () => {
        let bytes = (await chrome.storage.session.get(FRAME_RECEIPT_KEY))[FRAME_RECEIPT_KEY];
        if (bytes === undefined && create) {
          bytes = Array.from(crypto.getRandomValues(new Uint8Array(32)));
          await chrome.storage.session.set({ [FRAME_RECEIPT_KEY]: bytes });
        }
        if (!Array.isArray(bytes) || bytes.length !== 32
          || !bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
          throw new Error('frame evidence session key unavailable or invalid');
        }
        return crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
      })();
      keyReady = pending;
      // 初始化失败不发布密钥；允许现有拉取重试再次尝试，不能让队列永久中毒。
      void pending.catch(() => { if (keyReady === pending) keyReady = undefined; });
    }
    return keyReady;
  }
  return {
    async sign(tabId: number, frameId: number, documentId: string, frames: FrameEvidence[], boundary?: FrameBoundary): Promise<FrameReceipt> {
      const bodyValue: ReceiptBody = {
        purpose: PURPOSE, tabId, frameId, documentId,
        frames: frames.map(frame => ({ frameId: frame.frameId, documentId: frame.documentId,
          parentFrameId: frame.parentFrameId, parentDocumentId: frame.parentDocumentId,
          url: frame.url.startsWith('data:') ? 'data:' : frame.url })),
        ...(boundary ? { boundary: { frameId: boundary.frameId, documentId: boundary.documentId } } : {})
      };
      validateBody(bodyValue, tabId, frameId, documentId);
      const body = JSON.stringify(bodyValue);
      const mac = await crypto.subtle.sign('HMAC', await key(true), new TextEncoder().encode(body));
      return { body, mac: Array.from(new Uint8Array(mac), value => value.toString(16).padStart(2, '0')).join('') };
    },
    async verify(receipt: unknown, tabId: number, frameId: number, documentId: string): Promise<{ frames: FrameEvidence[]; boundary?: FrameBoundary }> {
      const value = receipt as FrameReceipt | null;
      if (!value || typeof value.body !== 'string' || typeof value.mac !== 'string' || !/^[a-f0-9]{64}$/.test(value.mac)) {
        throw new Error('invalid frame evidence receipt');
      }
      const signature = new Uint8Array(value.mac.match(/../g)!.map(byte => Number.parseInt(byte, 16)));
      if (!await crypto.subtle.verify('HMAC', await key(false), signature, new TextEncoder().encode(value.body))) {
        throw new Error('invalid frame evidence signature');
      }
      const body = validateBody(JSON.parse(value.body), tabId, frameId, documentId);
      return { frames: body.frames, ...(body.boundary ? { boundary: body.boundary } : {}) };
    }
  };
}
