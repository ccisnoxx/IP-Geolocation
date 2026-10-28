import { WORKER_COVERAGE, WORKER_FALLBACK_REASON_LABELS } from './worker-coverage';
import type { WorkerCoverageKey, WorkerFallbackSummary } from './worker-coverage';

export const REQUEST_HEADER_PROBE_SOURCES = {
  browserleaks_ip: 'browserleaks.com/ip',
  httpbin_headers: 'httpbin.org/headers',
  httpbingo_headers: 'httpbingo.org/headers'
} as const;

function stripHtml(value: string): string {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeObservedHeaderValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item || '').trim()).filter(Boolean);
    return items.length ? items.join(', ') : null;
  }
  const normalized = String(value || '').trim();
  return normalized || null;
}

function unsupportedRequestHeaderProbe() {
  return {
    status: 'unsupported',
    source: null,
    observedAcceptLanguage: null,
    message: `Unsupported page. Open ${REQUEST_HEADER_PROBE_SOURCES.browserleaks_ip}, ${REQUEST_HEADER_PROBE_SOURCES.httpbin_headers}, or ${REQUEST_HEADER_PROBE_SOURCES.httpbingo_headers}.`
  };
}

function parseBrowserleaksAcceptLanguage(html: string): string | null {
  const tbodyMatch = String(html || '').match(/<tbody[^>]*id=(["'])headers\1[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return null;

  const rowRegex = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = rowRegex.exec(tbodyMatch[2]))) {
    if (stripHtml(match[1]).toLowerCase() !== 'accept-language') continue;
    return normalizeObservedHeaderValue(stripHtml(match[2]));
  }
  return null;
}

function parseJsonHeaderEchoAcceptLanguage(text: string): string | null {
  if (!String(text || '').trim()) return null;
  let parsed: any = null;
  try {
    parsed = JSON.parse(String(text));
  } catch {
    return null;
  }
  const headers = parsed && typeof parsed === 'object' ? parsed.headers : null;
  if (!headers || typeof headers !== 'object') return null;
  const key = Object.keys(headers).find((name) => String(name).toLowerCase() === 'accept-language');
  return key ? normalizeObservedHeaderValue(headers[key]) : null;
}

export function buildRequestHeaderProbe(input: { url?: string; html?: string; bodyText?: string }) {
  const url = input && input.url ? String(input.url) : '';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return unsupportedRequestHeaderProbe();
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname;
  if (hostname === 'browserleaks.com' && pathname === '/ip') {
    const observed = parseBrowserleaksAcceptLanguage(input.html || '');
    return observed
      ? { status: 'ok', source: 'browserleaks_ip', observedAcceptLanguage: observed, message: 'Parsed browserleaks.com/ip headers.' }
      : { status: 'parse_error', source: 'browserleaks_ip', observedAcceptLanguage: null, message: 'Could not parse browserleaks.com/ip headers.' };
  }

  if ((hostname === 'httpbin.org' && pathname === '/headers') || (hostname === 'httpbingo.org' && pathname === '/headers')) {
    const source = hostname === 'httpbin.org' ? 'httpbin_headers' : 'httpbingo_headers';
    const observed = parseJsonHeaderEchoAcceptLanguage(input.bodyText || '');
    return observed
      ? { status: 'ok', source, observedAcceptLanguage: observed, message: `Parsed ${REQUEST_HEADER_PROBE_SOURCES[source]} headers.` }
      : { status: 'parse_error', source, observedAcceptLanguage: null, message: `Could not parse ${REQUEST_HEADER_PROBE_SOURCES[source]} headers.` };
  }

  return unsupportedRequestHeaderProbe();
}

export function buildFrameProbeSnapshot(executionResults: any[], frameTargets: any[]) {
  const normalizedResults = Array.isArray(executionResults)
    ? executionResults.reduce<any[]>((items, entry) => {
        if (!entry || !entry.result) return items;
        items.push({
          frameId: Number.isInteger(entry.frameId) ? entry.frameId : null,
          documentId: entry.documentId || null,
          ...entry.result
        });
        return items;
      }, [])
    : [];

  const top = normalizedResults.find((entry) => entry.isTopFrame || entry.frameId === 0) || normalizedResults[0] || null;
  const frames = normalizedResults.filter((entry) => {
    if (!top) return true;
    return !(entry.frameId === top.frameId && entry.url === top.url && entry.frameName === top.frameName);
  });

  return {
    top,
    frames,
    frameTargets: Array.isArray(frameTargets) ? frameTargets.slice() : []
  };
}

function normalizeWorkerDiagnosticEntry(entry: any, fallbackNote = '') {
  const normalized = entry && typeof entry === 'object' ? entry : {};
  return {
    status: normalized.status || 'not_attempted',
    result: normalized.result && typeof normalized.result === 'object' ? normalized.result : null,
    error: normalized.error ? String(normalized.error) : '',
    note: normalized.note ? String(normalized.note) : fallbackNote
  };
}

/**
 * 把覆盖面声明贴到探测结果上。
 *
 * 关键点：**探测成功不等于被覆盖**。SharedWorker 现在能正常返回，读到的却是原生
 * Date / Intl —— 如果这里照抄 `status: 'ok'`，诊断页就会把"没覆盖"显示成"通过"，
 * 用户据此以为自己在这个上下文里也伪装了。所以 UNSUPPORTED 的项一律以声明为准，
 * 原始观测值留在 `result` 里供排查。
 */
function withCoverage(
  key: WorkerCoverageKey,
  entry: any,
  fallbackNote = '',
  fallback: WorkerFallbackSummary | null = null
) {
  const coverage = WORKER_COVERAGE[key];
  const normalized = normalizeWorkerDiagnosticEntry(entry, fallbackNote);
  const unsupported = coverage.status === 'unsupported';
  // 声明是 SUPPORTED、但本页观察到回退：这是"部分覆盖"，既不能显示成 ok，
  // 也不能当成 unsupported（那会让人以为全部上下文都没接管）。
  const degraded = !unsupported && Boolean(fallback && fallback.count > 0);
  const reasons = degraded && fallback
    ? fallback.reasons.map((reason) => WORKER_FALLBACK_REASON_LABELS[reason]).join('、')
    : '';
  return {
    ...normalized,
    status: unsupported ? 'unsupported' : (degraded ? 'degraded' : normalized.status),
    coverage: coverage.status,
    fallback: fallback || null,
    detail: degraded && fallback
      ? `${coverage.detail} 本页有 ${fallback.count} 个 Worker 回退原生（${reasons}）。`
      : coverage.detail,
    note: normalized.note || (degraded && fallback && fallback.lastMessage ? fallback.lastMessage : coverage.detail)
  };
}

export function buildWorkerDiagnosticsSnapshot(input: any) {
  const normalized = input && typeof input === 'object' ? input : {};
  const fallback = normalized.workerFallback && typeof normalized.workerFallback === 'object'
    ? normalized.workerFallback as WorkerFallbackSummary
    : null;
  return {
    classicWorker: withCoverage('classicWorker', normalized.classicWorker, '', fallback),
    moduleWorker: withCoverage('moduleWorker', normalized.moduleWorker, '', fallback),
    sharedWorker: withCoverage('sharedWorker', normalized.sharedWorker),
    nestedWorker: withCoverage('nestedWorker', normalized.nestedWorker, 'Nested worker boundary recorded.'),
    serviceWorker: withCoverage('serviceWorker', normalized.serviceWorker, 'Service worker registration hook is not installed.')
  };
}

export function buildGeolocationBehaviorSnapshot(input: any) {
  const normalized = input && typeof input === 'object' ? input : {};
  return {
    status: normalized.status || 'not_attempted',
    successResult: normalized.successResult || '',
    watchResult: normalized.watchResult || '',
    clearWatchResult: normalized.clearWatchResult || '',
    errorResult: normalized.errorResult || '',
    note: normalized.note || ''
  };
}
