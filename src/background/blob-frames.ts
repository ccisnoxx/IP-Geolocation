import { createFrameReceiptCodec, type FrameEvidence, type FrameReceipt, type FrameBoundary } from './frame-receipts';

/**
 * webNavigation 会过滤 blob URL。只在缺失节点时，按浏览器 documentId 精确读取
 * ISOLATED 中可访问的真实父窗口；不拼接异步 DOM 索引快照，不猜测跨源祖先。
 */
export function readAccessibleWebParent(): { url: string; parentUrl: string | null } {
  let frame: Window = window;
  while (frame !== frame.parent) {
    frame = frame.parent;
    // 跨源时原生 Location 会抛错，交给调用侧拒绝本次解析。
    const url = new URL(frame.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return { url: location.href, parentUrl: url.href };
    if (!['blob:', 'data:', 'filesystem:'].includes(url.protocol)
      && !(url.protocol === 'about:' && (url.pathname === 'blank' || url.pathname === 'srcdoc'))) break;
  }
  return { url: location.href, parentUrl: null };
}

interface BlobParent { url: string; parentUrl: string }

export async function resolveBlobParent(tabId: number, frameId: number, documentId: string, expectedUrl?: string): Promise<BlobParent> {
  if (!chrome.scripting?.executeScript) throw new Error('blob document ancestry is unavailable');
  let result;
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] }, world: 'ISOLATED', func: readAccessibleWebParent
    });
  } catch (error) {
    // Chrome119 的程序化注入不支持 blob 来源回退；只询问已经合法注入的本扩展
    // ISOLATED 端点。双 ID 不可降为 frameId 或广播，也不接收 payload 请求体的父地址。
    try {
      result = await chrome.tabs.sendMessage(tabId, { action: 'readBlobParent' }, { frameId, documentId });
    } catch (queryError) {
      throw new Error(`blob document ancestry query failed: ${String(error)}; ${String(queryError)}`);
    }
  }
  if (results) result = results.find((entry) => entry.frameId === frameId && entry.documentId === documentId)?.result;
  if (!result || typeof result.url !== 'string' || new URL(result.url).protocol !== 'blob:'
    || (expectedUrl !== undefined && result.url !== expectedUrl) || typeof result.parentUrl !== 'string'
    || !/^https?:$/.test(new URL(result.parentUrl).protocol)) {
    throw new Error('blob document ancestry is unavailable or changed');
  }
  return { url: result.url, parentUrl: result.parentUrl };
}

/** 仅发现投递目标；返回列表不提供父关系证明，也不是原子树快照。 */
export async function discoverOpaqueDocuments(tabId: number): Promise<Array<{ frameId: number; documentId: string; url: string }>> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true }, world: 'ISOLATED', func: () => location.href
  });
  return results.flatMap((entry) => entry.documentId && typeof entry.result === 'string' && /^(blob:|data:|about:blank|about:srcdoc|filesystem:)/.test(entry.result)
    ? [{ frameId: entry.frameId, documentId: entry.documentId, url: entry.result }] : []);
}

type Frame = FrameEvidence;
export type FrameRuleResolver = (tabId: number, frameId: number, documentId: string, url: string, frames?: Frame[]) => Promise<string>;
export interface FrameRuleContext { effectiveUrl: string; frameEvidence?: FrameReceipt }
export type FrameContextResolver = (tabId: number, frameId: number, documentId: string, url: string, frames?: Frame[]) => Promise<FrameRuleContext>;

/**
 * 文档自持会话认证的完整父链；后台只留有界缓存和一个随机密钥。
 * 不按年龄/查询失败猜文档死亡，不扫描或投递历史 BFCache 文档。
 */
export function createFrameRuleResolver() {
  const verified = new Map<string, Frame>();
  const closedTabs = new Set<number>();
  const receipts = createFrameReceiptCodec();
  const supported = (value: string): boolean => {
    const parsed = new URL(value);
    return ['http:', 'https:', 'blob:', 'data:', 'filesystem:'].includes(parsed.protocol)
      || (parsed.protocol === 'about:' && ['blank', 'srcdoc'].includes(parsed.pathname));
  };
  const knownOpaque = new Map<string, { tabId: number; topDocumentId: string; frameId: number; documentId: string; url: string }>();
  const resolveForContent: FrameContextResolver = async (tabId, frameId, documentId, url, snapshot) => {
    if (closedTabs.has(tabId)) throw new Error('content tab has closed');
    if (!supported(url)) throw new Error('unsupported content document URL');
    if (/^https?:/.test(url)) return { effectiveUrl: url };
    const frames = snapshot ?? await chrome.webNavigation.getAllFrames({ tabId }) ?? [];
    const key = (id: string) => `${tabId}:${id}`;
    const recovered = new Map<string, Frame>();
    const rememberDocument = (id: number, doc: string, documentUrl: string): void => {
      const topDocumentId = frames.find(f => f.frameId === 0)?.documentId;
      if (topDocumentId) {
        knownOpaque.set(key(doc), { tabId, topDocumentId, frameId: id, documentId: doc, url: documentUrl });
        if (knownOpaque.size > 500) knownOpaque.delete(knownOpaque.keys().next().value!);
      }
    };
    const blobs: Array<{ frameId: number; documentId: string; url: string }> = [];
    const blobParent = async (id: number, doc: string, expected?: string): Promise<string> => {
      const result = await resolveBlobParent(tabId, id, doc, expected);
      blobs.push({ frameId: id, documentId: doc, url: result.url });
      return result.parentUrl;
    };
    const select = async (id: number, doc: string): Promise<Frame | undefined> => {
      const current = frames.find(f => f.frameId === id);
      if (current && current.documentId !== doc) throw new Error('content document has navigated');
      let old = verified.get(key(doc)) || recovered.get(doc);
      if (!old && (!current || (id === frameId && doc === documentId))) {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'readFrameEvidence' }, { frameId: id, documentId: doc });
        if (response?.frameEvidence !== undefined && response.frameEvidence !== null) {
          const proof = await receipts.verify(response.frameEvidence, tabId, id, doc);
          for (const entry of proof.frames) recovered.set(entry.documentId, entry);
          old = recovered.get(doc);
        }
      }
      if (current && old && (current.parentFrameId !== old.parentFrameId || current.parentDocumentId !== old.parentDocumentId)) {
        throw new Error('content parent document relationship changed');
      }
      return current || (old?.frameId === id ? old : undefined);
    };
    const seen: Frame[] = [];
    const visited = new Set<string>();
    let frame = await select(frameId, documentId);
    let effective: string;
    let boundary: FrameBoundary | undefined;
    if (!frame) {
      if (!url.startsWith('blob:')) throw new Error('content document is absent from browser frame snapshot');
      effective = await blobParent(frameId, documentId, url);
    } else {
      while (true) {
        if (visited.has(frame.documentId)) throw new Error('content parent document chain contains a cycle');
        visited.add(frame.documentId);
        seen.push(frame);
        if (!supported(frame.url)) throw new Error('unsupported parent document URL');
        if (/^https?:/.test(frame.url)) { effective = frame.url; break; }
        if (frame.parentFrameId < 0 || !frame.parentDocumentId) throw new Error('content parent document chain is unavailable');
        const parent = await select(frame.parentFrameId, frame.parentDocumentId);
        if (!parent) {
          boundary = { frameId: frame.parentFrameId, documentId: frame.parentDocumentId };
          effective = await blobParent(boundary.frameId, boundary.documentId);
          break;
        }
        frame = parent;
      }
    }
    let frameEvidence: FrameReceipt | undefined;
    if (seen.length) {
      frameEvidence = await receipts.sign(tabId, frameId, documentId, seen, boundary);
      if (closedTabs.has(tabId)) throw new Error('content tab has closed');
      // 文档先持证再发布事实。ACK 丢失可以保守失败，不能删除其他文档依赖的会话密钥。
      const acknowledgement = await chrome.tabs.sendMessage(tabId, { action: 'storeFrameEvidence', frameEvidence }, { frameId, documentId });
      if (acknowledgement?.stored !== true) throw new Error('frame evidence was not stored by its document');
    }
    if (closedTabs.has(tabId)) throw new Error('content tab has closed');
    for (const blob of blobs) rememberDocument(blob.frameId, blob.documentId, blob.url);
    for (const entry of seen) {
      verified.set(key(entry.documentId), { ...entry });
      if (verified.size > 500) verified.delete(verified.keys().next().value!);
      if (!/^https?:/.test(entry.url)) rememberDocument(entry.frameId, entry.documentId, entry.url);
    }
    return { effectiveUrl: effective, ...(frameEvidence ? { frameEvidence } : {}) };
  };
  return {
    resolve: (async (...args) => (await resolveForContent(...args)).effectiveUrl) as FrameRuleResolver,
    resolveForContent,
    async forgetTab(tabId: number): Promise<void> {
      closedTabs.add(tabId);
      const prefix = `${tabId}:`;
      for (const name of verified.keys()) if (name.startsWith(prefix)) verified.delete(name);
      for (const name of knownOpaque.keys()) if (name.startsWith(prefix)) knownOpaque.delete(name);
    },
    knownDocuments(tabId: number, topDocumentId?: string) {
      return [...knownOpaque.values()].filter(doc => topDocumentId && doc.tabId === tabId && doc.topDocumentId === topDocumentId)
        .map(({ frameId, documentId, url }) => ({ frameId, documentId, url }));
    }
  };
}
