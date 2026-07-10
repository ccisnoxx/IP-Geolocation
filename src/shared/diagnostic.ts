export const REQUEST_HEADER_PROBE_SOURCES = {
  browserleaks_ip: 'browserleaks.com/ip',
  httpbin_headers: 'httpbin.org/headers',
  httpbingo_headers: 'httpbingo.org/headers'
} as const;

export type WebRtcCandidateRisk = 'none' | 'local' | 'public';
export type DiagnosticVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface DiagnosticComparisonResult {
  status: DiagnosticVerdict;
  message: string;
}

export interface DiagnosticSummary {
  status: DiagnosticVerdict;
  passed: number;
  failed: number;
  unknown: number;
  total: number;
}

function isMissingExpected(value: unknown): boolean {
  return value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
}

function normalizeComparableString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeComparableList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableString).filter(Boolean);
  }
  return String(value ?? '')
    .split(',')
    .map(normalizeComparableString)
    .filter(Boolean);
}

function normalizeComparableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareDiagnosticValue(input: {
  expected?: unknown;
  actual?: unknown;
  kind?: 'string' | 'list' | 'number';
  tolerance?: number;
}): DiagnosticComparisonResult {
  const kind = input.kind || 'string';
  if (isMissingExpected(input.expected)) {
    return { status: 'UNKNOWN', message: 'expected value is not configured' };
  }
  if (isMissingExpected(input.actual)) {
    return { status: 'UNKNOWN', message: 'actual value is not available' };
  }

  if (kind === 'list') {
    const expected = normalizeComparableList(input.expected);
    const actual = normalizeComparableList(input.actual);
    const matches = expected.length === actual.length && expected.every((item, index) => item === actual[index]);
    return matches
      ? { status: 'PASS', message: 'matches expected list' }
      : { status: 'FAIL', message: 'does not match expected list' };
  }

  if (kind === 'number') {
    const expected = normalizeComparableNumber(input.expected);
    const actual = normalizeComparableNumber(input.actual);
    if (expected === null) return { status: 'UNKNOWN', message: 'expected number is invalid' };
    if (actual === null) return { status: 'UNKNOWN', message: 'actual number is invalid' };
    const tolerance = Number.isFinite(Number(input.tolerance)) ? Math.max(0, Number(input.tolerance)) : 0;
    const delta = Math.abs(expected - actual);
    return delta <= tolerance
      ? { status: 'PASS', message: tolerance > 0 ? `within tolerance ${tolerance}` : 'matches expected number' }
      : { status: 'FAIL', message: `delta ${delta} exceeds tolerance ${tolerance}` };
  }

  return normalizeComparableString(input.expected) === normalizeComparableString(input.actual)
    ? { status: 'PASS', message: 'matches expected value' }
    : { status: 'FAIL', message: 'does not match expected value' };
}

export function summarizeDiagnosticVerdicts(statuses: DiagnosticVerdict[]): DiagnosticSummary {
  const passed = statuses.filter((status) => status === 'PASS').length;
  const failed = statuses.filter((status) => status === 'FAIL').length;
  const unknown = statuses.filter((status) => status === 'UNKNOWN').length;
  return {
    status: failed > 0 ? 'FAIL' : unknown > 0 ? 'UNKNOWN' : 'PASS',
    passed,
    failed,
    unknown,
    total: statuses.length
  };
}

export function calculateDistanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const earthRadiusMeters = 6371000;
  const fromLatitude = from.latitude * Math.PI / 180;
  const toLatitude = to.latitude * Math.PI / 180;
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function compareGeolocationCoordinates(input: {
  expectedLatitude?: unknown;
  expectedLongitude?: unknown;
  actualLatitude?: unknown;
  actualLongitude?: unknown;
  toleranceMeters?: unknown;
}): DiagnosticComparisonResult & { distanceMeters: number | null } {
  const expectedLatitude = normalizeComparableNumber(input.expectedLatitude);
  const expectedLongitude = normalizeComparableNumber(input.expectedLongitude);
  const actualLatitude = normalizeComparableNumber(input.actualLatitude);
  const actualLongitude = normalizeComparableNumber(input.actualLongitude);
  if (expectedLatitude === null || expectedLongitude === null) {
    return { status: 'UNKNOWN', message: 'expected coordinate is not configured', distanceMeters: null };
  }
  if (actualLatitude === null || actualLongitude === null) {
    return { status: 'UNKNOWN', message: 'actual coordinate is not available', distanceMeters: null };
  }

  const toleranceMeters = normalizeComparableNumber(input.toleranceMeters) ?? 0;
  const distanceMeters = calculateDistanceMeters(
    { latitude: expectedLatitude, longitude: expectedLongitude },
    { latitude: actualLatitude, longitude: actualLongitude }
  );
  return distanceMeters <= toleranceMeters
    ? { status: 'PASS', message: `within ${Math.round(distanceMeters)}m of expected coordinate`, distanceMeters }
    : { status: 'FAIL', message: `${Math.round(distanceMeters)}m exceeds tolerance ${toleranceMeters}m`, distanceMeters };
}

function isPrivateIp(value: string): boolean {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 169 && parts[1] === 254)
    || parts[0] === 127;
}

function extractIpv4(value: string): string[] {
  return String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
}

function extractMdnsHosts(value: string): string[] {
  return String(value || '').match(/\b[a-z0-9-]+\.local\b/gi) || [];
}

export function classifyWebRtcCandidate(candidate: string) {
  const text = String(candidate || '');
  const ips = extractIpv4(text);
  const localIps = ips.filter(isPrivateIp);
  const publicIps = ips.filter((ip) => !isPrivateIp(ip));
  const mdnsHosts = extractMdnsHosts(text);
  const candidateTypeMatch = text.match(/\btyp\s+([a-z0-9-]+)/i);
  return {
    candidate: text,
    type: candidateTypeMatch ? candidateTypeMatch[1].toLowerCase() : '',
    ips,
    localIps,
    publicIps,
    mdnsHosts,
    risk: publicIps.length > 0 ? 'public' as WebRtcCandidateRisk : localIps.length > 0 ? 'local' as WebRtcCandidateRisk : 'none' as WebRtcCandidateRisk
  };
}

export function buildWebRtcLeakSnapshot(input: { candidates?: string[]; policyState?: unknown }) {
  const candidates = Array.isArray(input?.candidates) ? input.candidates.map(String) : [];
  const classified = candidates.map(classifyWebRtcCandidate);
  const exposesLocalIp = classified.some((candidate) => candidate.localIps.length > 0);
  const exposesPublicIp = classified.some((candidate) => candidate.publicIps.length > 0);
  return {
    candidates: classified,
    exposesLocalIp,
    exposesPublicIp,
    protected: !exposesLocalIp && !exposesPublicIp,
    policyState: input?.policyState || null
  };
}

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

export function buildWorkerDiagnosticsSnapshot(input: any) {
  const normalized = input && typeof input === 'object' ? input : {};
  return {
    classicWorker: normalizeWorkerDiagnosticEntry(normalized.classicWorker),
    moduleWorker: normalizeWorkerDiagnosticEntry(normalized.moduleWorker),
    sharedWorker: normalizeWorkerDiagnosticEntry(normalized.sharedWorker),
    nestedWorker: normalizeWorkerDiagnosticEntry(normalized.nestedWorker, 'Nested worker boundary recorded.'),
    serviceWorker: normalizeWorkerDiagnosticEntry(normalized.serviceWorker, 'Service worker registration hook is not installed.')
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
