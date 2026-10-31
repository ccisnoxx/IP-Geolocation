import { WORKER_COVERAGE, WORKER_FALLBACK_REASON_LABELS } from './worker-coverage';
import type { WorkerCoverageKey, WorkerFallbackSummary } from './worker-coverage';

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
    nestedWorker: withCoverage('nestedWorker', normalized.nestedWorker, '', fallback),
    serviceWorker: withCoverage('serviceWorker', normalized.serviceWorker, 'Service worker registration hook is not installed.')
  };
}
