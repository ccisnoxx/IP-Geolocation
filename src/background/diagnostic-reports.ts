import { normalizeWorkerFallbackReason } from '../shared/worker-coverage';
import type { WorkerFallbackReport, WorkerFallbackSummary } from '../shared/worker-coverage';

/**
 * 页面回报的两类诊断观察：字体层与 Worker 包装失败。
 *
 * 工厂而不是模块级 Map：每个 services 实例各持一份（测试之间不串），
 * 语义上也只属于本次 Service Worker 生命周期。
 */
export function createDiagnosticReports() {
  /**
   * 注入层报上来的字体层观察值。MAIN 桥未完成身份认证，这些数据不证明安装成功，
   * 也不参与配置或权限判定。只按 hostname 聚合在内存：重启后页面会重新报一次。
   */
  const fontLayerReports = new Map<string, { count: number; platform: string; hideCjkFonts: boolean; at: number }>();

  function reportFontLayers(url: string, layers: unknown): void {
    const hostname = url ? (() => { try { return new URL(url).hostname; } catch { return ''; } })() : '';
    if (!hostname || !layers || typeof layers !== 'object') return;
    const value = layers as { count?: unknown; platform?: unknown; hideCjkFonts?: unknown };
    const count = Number(value.count);
    if (!Number.isFinite(count) || count < 0) return;
    fontLayerReports.set(hostname, {
      count,
      platform: value.platform === 'none' ? 'none' : 'auto',
      hideCjkFonts: Boolean(value.hideCjkFonts),
      at: Date.now()
    });
    // 只保留最近 50 个域名，别让这张表无限长
    if (fontLayerReports.size > 50) {
      const oldest = [...fontLayerReports.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) fontLayerReports.delete(oldest[0]);
    }
  }

  function getFontLayers(url: string): { count: number; platform: string; hideCjkFonts: boolean; at: number } | null {
    const hostname = url ? (() => { try { return new URL(url).hostname; } catch { return ''; } })() : '';
    if (!hostname) return null;
    return fontLayerReports.get(hostname) || null;
  }

  /**
   * Worker 包装失败：按 hostname 聚合，只放内存。
   *
   * 为什么要记：包装只能靠 blob 入口，页面 CSP 的 worker-src / script-src 有权拒绝。
   * 拒绝时 runtime 回退原生，页面照常跑，但那个 Worker 里读到的是原生值 ——
   * 这是"部分覆盖"，不能和"已生效"显示成同一件事。
   *
   * 内存而不是 storage：页面刷新后 runtime 会重新报；Service Worker 重启丢掉旧记录
   * 也无所谓，下一次构造会补上。真正要求的是**别把旧状态当现状**。
   */
  const workerFallbacks = new Map<string, WorkerFallbackSummary>();

  function hostnameOf(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function reportWorkerFallback(url: string, report: Partial<WorkerFallbackReport> | null | undefined): void {
    const hostname = hostnameOf(url);
    if (!hostname || !report || typeof report !== 'object') return;
    const reason = normalizeWorkerFallbackReason(report.reason);
    const entry: WorkerFallbackSummary = workerFallbacks.get(hostname)
      || { hostname, count: 0, reasons: [], lastScript: '', lastMessage: '', at: 0 };
    entry.count += 1;
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    if (typeof report.script === 'string' && report.script) entry.lastScript = report.script.slice(0, 300);
    if (typeof report.message === 'string' && report.message) entry.lastMessage = report.message.slice(0, 300);
    entry.at = Date.now();
    workerFallbacks.set(hostname, entry);
    if (workerFallbacks.size > 50) {
      const oldest = [...workerFallbacks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) workerFallbacks.delete(oldest[0]);
    }
  }

  function getWorkerFallbacks(url: string): WorkerFallbackSummary | null {
    const hostname = hostnameOf(url);
    return hostname ? workerFallbacks.get(hostname) || null : null;
  }

  return { reportFontLayers, getFontLayers, reportWorkerFallback, getWorkerFallbacks };
}
