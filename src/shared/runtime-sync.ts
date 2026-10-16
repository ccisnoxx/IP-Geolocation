import type { RuntimeSyncComponent, RuntimeSyncError, RuntimeSyncReport } from './types';

export const RUNTIME_SYNC_COMPONENT_LABELS: Record<RuntimeSyncComponent, string> = {
  contentScripts: '页面语言/时区注册', dnr: 'DNR 请求头规则', webrtc: 'WebRTC 策略', tabReload: '已有文档刷新提示'
};

// 仅用于识别历史暂停报告；新页面注册以 pageRuntime 为准。
export const RUNTIME_INJECTION_PAUSED: RuntimeSyncError = {
  code: 'runtime-injection-paused',
  message: '页面伪装已暂停：语言、时区、位置、Canvas 和 worker 伪装均不执行。请求头规则与 WebRTC 按各自状态报告。已有 hook 与旧 BFCache 文档需关闭并重建，暂停不会撤销已执行代码。'
};

export function isRuntimeInjectionPaused(report?: RuntimeSyncReport): boolean {
  return !report?.pageRuntime && Boolean(report?.components.contentScripts.errors.some((error) => error.code === RUNTIME_INJECTION_PAUSED.code));
}

export const PAGE_RUNTIME_PAUSED_SURFACES = 'Geolocation / Permissions geolocation、Canvas、Worker / SharedWorker 仍暂停，相关配置仅保存。';
export const PAGE_RUNTIME_DOCUMENT_SCOPE = 'about:blank、srcdoc、data:、blob: 和特殊 sandbox 文档不支持（unsupported / UNKNOWN）。';
const DOCUMENT_SNAPSHOT_MESSAGE = '已有文档与 BFCache 恢复文档保留原快照，不会热更新或自动刷新；当前页面实际值尚未验证。';

export function pageRuntimeMessage(report?: RuntimeSyncReport): string {
  const page = report?.pageRuntime;
  if (!page) return isRuntimeInjectionPaused(report)
    ? '历史报告：页面伪装已暂停，重试同步不会恢复该历史注入路径。已有 hook 与旧 BFCache 文档需关闭并重建。'
    : '页面语言/时区注册状态尚未确认，请重试同步；当前页面实际值为 UNKNOWN。';
  switch (page.state) {
    case 'ready':
      return `页面语言/时区已注册 ${page.registeredRuleCount} 条规则，新建且匹配规则的 HTTP(S) 顶层文档和普通 iframe 可使用已同步的语言/时区快照。${page.reloadRequired ? '已有受影响页面需完整重载（reload）或关闭后重新打开。' : ''}${DOCUMENT_SNAPSHOT_MESSAGE}`;
    case 'disabled':
      return `页面语言/时区当前未注册启用规则。${page.reloadRequired ? '已有受影响页面需完整重载（reload）或关闭后重新打开，才能使用当前关闭配置。' : ''}${DOCUMENT_SNAPSHOT_MESSAGE}`;
    case 'api-unsupported':
      return '浏览器不支持所需 userScripts API，页面语言/时区不可用；请使用 Chrome 138+ 后重试同步。当前页面实际值为 UNKNOWN。';
    case 'permission-required':
      return '扩展缺少 userScripts 权限，页面语言/时区不可用；请检查扩展权限并加载获准使用 userScripts 的版本后重试同步。当前页面实际值为 UNKNOWN。';
    case 'switch-required':
      return 'Allow User Scripts（允许用户脚本）尚未开启，页面语言/时区不可用。请在 chrome://extensions 打开 VanishGeo 详情页，正常开启“Allow User Scripts（允许用户脚本）”后点击“重试同步”。当前页面实际值为 UNKNOWN。';
    case 'sync-failed':
      return '页面语言/时区注册同步失败，请查看错误并重试同步；新文档状态尚未确认，当前页面实际值为 UNKNOWN。';
  }
}

export class RuntimeSyncOperationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function syncError(error: unknown, message: string): RuntimeSyncError {
  return error instanceof RuntimeSyncOperationError
    ? { code: error.code, message: error.message }
    : { code: 'browser-api-failed', message };
}

export async function syncSignature(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function runtimeSyncMessage(report?: RuntimeSyncReport): string {
  if (!report) return `同步状态尚未确认，请重试同步。${pageRuntimeMessage()} ${PAGE_RUNTIME_PAUSED_SURFACES} ${PAGE_RUNTIME_DOCUMENT_SCOPE}`;
  const details = (Object.keys(RUNTIME_SYNC_COMPONENT_LABELS) as RuntimeSyncComponent[])
    .filter((key) => key === 'dnr' || key === 'webrtc' || report.components[key].status !== 'ok')
    .map((key) => {
      const component = report.components[key];
      const status = component.status === 'ok' ? '已同步' : component.status === 'failed' ? '同步失败' : '部分同步';
      return `${RUNTIME_SYNC_COMPONENT_LABELS[key]}：${status}${component.errors.length ? `（${component.errors.map((error) => error.message).join('；')}）` : ''}`;
    });
  if (report.metadataError) details.push(report.metadataError.message);
  if (report.warnings) details.push(...report.warnings.map((warning) => warning.message));
  return `${report.status === 'ok' ? '配置已保存，同步已完成。' : '已保存但未完全生效。'}${pageRuntimeMessage(report)} ${details.join('；')}。${PAGE_RUNTIME_PAUSED_SURFACES} ${PAGE_RUNTIME_DOCUMENT_SCOPE}`;
}

export function renderRuntimeSyncReport(element: HTMLElement, report?: RuntimeSyncReport): void {
  element.textContent = runtimeSyncMessage(report);
  element.dataset.status = report?.status || 'partial';
  element.dataset.pageRuntime = report?.pageRuntime?.state || 'unknown';
}
