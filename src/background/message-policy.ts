import type { FrameContextResolver, FrameRuleContext } from './blob-frames';

const UI_PATHS = new Set(['/popup/popup.html', '/options/options.html', '/leak-test/leak-test.html']);
const CONTENT_ACTIONS = new Set(['getPayloadForUrl', 'reportFontLayers', 'reportWorkerFallback']);

type MessageCaller =
  | { kind: 'ui' }
  | ({ kind: 'content'; documentId: string } & FrameRuleContext);

function contentUrlKind(url: URL): 'web' | 'opaque' {
  if (url.protocol === 'http:' || url.protocol === 'https:') return 'web';
  if ((url.protocol === 'about:' && (url.pathname === 'blank' || url.pathname === 'srcdoc'))
    || url.protocol === 'blob:' || url.protocol === 'data:' || url.protocol === 'filesystem:') return 'opaque';
  throw new Error('unsupported content document URL');
}

/**
 * 规则继承策略：沿浏览器可证明的父文档链，使用最近 HTTP(S) 父文档的规则。
 * 这不证明 blob/data 等文档的创建者 origin，也不接受消息自报的 referrer。
 */
export async function authorizeBackgroundMessage(action: unknown, sender: chrome.runtime.MessageSender, resolveFrameRuleUrl: FrameContextResolver): Promise<MessageCaller> {
  const extensionId = chrome.runtime.id;
  if (!extensionId || sender.id !== extensionId) throw new Error('untrusted extension message sender');

  const url = new URL(sender.url || '');
  if (url.protocol === 'chrome-extension:') {
    const trustedUrl = url.hostname === extensionId && !url.port && !url.username && !url.password && UI_PATHS.has(url.pathname);
    const trustedOrigin = sender.origin === undefined || sender.origin === `chrome-extension://${extensionId}`;
    if (!trustedUrl || !trustedOrigin) throw new Error('untrusted extension UI document');
    return { kind: 'ui' };
  }

  if (typeof action !== 'string' || !CONTENT_ACTIONS.has(action)) throw new Error('action is not allowed for content documents');
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  const documentId = sender.documentId;
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0
    || typeof frameId !== 'number' || !Number.isInteger(frameId) || frameId < 0
    || typeof documentId !== 'string' || !documentId.trim()) {
    throw new Error('content sender requires browser tab, frame and document identity');
  }
  const context = contentUrlKind(url) === 'web'
    ? { effectiveUrl: sender.url! }
    : await resolveFrameRuleUrl(tabId, frameId, documentId, sender.url!);
  return { kind: 'content', documentId, ...context };
}
