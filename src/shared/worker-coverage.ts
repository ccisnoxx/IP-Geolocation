/**
 * Worker 覆盖面：**声明与行为必须同源**。
 *
 * 这张表不是文档装饰。`runtime.ts` 里哪些上下文真的被接管，决定了检测脚本换来
 * 一个执行上下文之后会拿到什么值；声明和实现一旦不一致，最轻的后果是用户误判
 * 自己在受保护状态，最重的后果是"主线程说伪装、Worker 说真话"这种自相矛盾。
 *
 * 现状的依据：
 *   - classic / module Worker：`installWorker()` 用 blob 前缀包了入口，
 *     Date / Intl / navigator / OffscreenCanvas 度量与绘制都有补丁；
 *     代价是相对 URL 基准和 CSP 语义可能变（取决于站点），失败时静默回落原生。
 *   - SharedWorker：**不包装**。身份是 (resolved URL, name)，换成 blob URL 会让
 *     每个文档各建一个实例，跨文档共享语义消失，且无法在 JS 层修回去。
 *   - nested worker：父 Worker 里的 `Worker` 构造器没有打补丁，孙 Worker 拿到的是
 *     原生值 —— 属于"看起来被覆盖、实际没有"的那类，按 UNSUPPORTED 记。
 *   - service worker：没有任何 hook。
 */
export type WorkerCoverageStatus = 'supported' | 'unsupported';

export interface WorkerCoverageEntry {
  status: WorkerCoverageStatus;
  detail: string;
}

export type WorkerCoverageKey =
  | 'classicWorker'
  | 'moduleWorker'
  | 'sharedWorker'
  | 'nestedWorker'
  | 'serviceWorker';

export const WORKER_COVERAGE: Record<WorkerCoverageKey, WorkerCoverageEntry> = {
  classicWorker: {
    status: 'supported',
    detail: 'blob 前缀包装入口；Date / navigator / canvas 与主线程同源，Intl 覆盖与主线程同一组八类构造器。配置活更新：配置变化时向已创建的 Worker 广播一次，关闭补丁广播空配置使其回到原生值（只影响经包装构造器创建并登记过的 Worker）。每个文档先探一次 blob 是否被 CSP 放行：被拒时全部走原生入口并回报，探测未完成（毫秒级）时也走原生。'
  },
  moduleWorker: {
    status: 'supported',
    detail: '同上，module 入口用 await import 串回原脚本。'
  },
  sharedWorker: {
    status: 'unsupported',
    detail: '不包装：换成 blob URL 会改变 (URL, name) 身份，跨文档共享实例的语义无法保留。读到原生值。'
  },
  nestedWorker: {
    status: 'unsupported',
    detail: '父 Worker 内的 Worker 构造器未打补丁，孙 Worker 读到原生值。'
  },
  serviceWorker: {
    status: 'unsupported',
    detail: '没有 hook navigator.serviceWorker.register。'
  }
};

/**
 * 包装失败的观测值。
 *
 * 为什么需要它：blob 前缀是"换了入口再构造"，页面 CSP 的 `worker-src` / `script-src`
 * 完全有权拒绝 blob。这时构造会抛错，runtime 只能回退成原生入口 —— 页面照常能跑，
 * 但那个 Worker 里读到的是原生 Date / Intl。以前这个回退是**静默**的：用户以为
 * 整页都在保护范围，实际有上下文没有被接管。
 */
export type WorkerFallbackReason = 'csp-blocked' | 'construct-failed' | 'blob-failed';

export const WORKER_FALLBACK_REASON_LABELS: Record<WorkerFallbackReason, string> = {
  'csp-blocked': '页面 CSP 拒绝 blob 入口',
  'construct-failed': 'Worker 构造失败',
  'blob-failed': '创建 blob 入口失败'
};

/** 注入层 → 桥 → 后台的单条回报 */
export interface WorkerFallbackReport {
  reason: WorkerFallbackReason;
  /** 原始入口地址（已去掉 query / hash），告诉用户是哪个脚本 */
  script: string;
  /** 原生异常消息，截断保存 */
  message: string;
}

/** 后台按 hostname 聚合后的摘要，给弹窗与诊断用 */
export interface WorkerFallbackSummary {
  hostname: string;
  count: number;
  reasons: WorkerFallbackReason[];
  lastScript: string;
  lastMessage: string;
  at: number;
}

export function normalizeWorkerFallbackReason(value: unknown): WorkerFallbackReason {
  return value === 'csp-blocked' || value === 'blob-failed' ? value : 'construct-failed';
}
