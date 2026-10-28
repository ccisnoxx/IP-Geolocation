import type { RuntimeSyncComponent, RuntimeSyncError, RuntimeSyncReport } from './types';

export const RUNTIME_SYNC_COMPONENT_LABELS: Record<RuntimeSyncComponent, string> = {
  contentScripts: '页面脚本注册', webrtc: 'WebRTC 策略', tabReload: '已有文档刷新提示', headers: 'Accept-Language 同步'
};

// 仅用于识别历史暂停报告；新页面注册以 pageRuntime 为准。
export const RUNTIME_INJECTION_PAUSED: RuntimeSyncError = {
  code: 'runtime-injection-paused',
  message: '历史完整页面 runtime 已暂停：语言、时区、位置、字体暴露过滤和 worker 均不由该路径执行。当前独立页面注册、Accept-Language 与 WebRTC 按各自状态报告。已有 hook 与旧 BFCache 文档需关闭并重建，暂停不会撤销已执行代码。'
};

export function isRuntimeInjectionPaused(report?: RuntimeSyncReport): boolean {
  return !report?.pageRuntime && Boolean(report?.components.contentScripts.errors.some((error) => error.code === RUNTIME_INJECTION_PAUSED.code));
}

export const PAGE_RUNTIME_PAUSED_SURFACES = '未来同源HTTP(S)及自身Blob Dedicated/SharedWorker可继承创建时语言/时区与字体快照。SharedWorker跨页可能分离为独立实例；Blob入口的CSP和全局相对URL与原生HTTP入口不同。外来Blob、TrustedScriptURL、未接管父级未覆盖。字体过滤与地理位置分别报告注册状态。';
export const PAGE_RUNTIME_DOCUMENT_SCOPE = 'about:blank、srcdoc、data:、blob: 和特殊 sandbox 文档不支持（unsupported / UNKNOWN）。';
const DOCUMENT_SNAPSHOT_MESSAGE = '已初始化文档会尝试实时更新及关闭恢复，BFCache返回时重新读取；新启用域或旧版本文档需完整重载，不自动刷新。已有Worker保留创建时快照；消息送达不代表实际生效，当前页面实际值尚未验证。';

export function fontRuntimeMessage(report?: RuntimeSyncReport): string {
  const font = report?.fontRuntime;
  if (!font) return '字体暴露过滤注册状态尚未确认，请重试同步；当前页面实际值为 UNKNOWN。';
  const snapshot = `${font.reloadRequired ? '已有受影响页面需完整重载（reload）或关闭后重新打开；提示保守包含可能嵌入受影响 iframe 的页面。' : ''}${DOCUMENT_SNAPSHOT_MESSAGE}`;
  switch (font.state) {
    case 'ready': return `字体过滤已注册 ${font.registeredRuleCount} 条规则，供新建且匹配的 HTTP(S) 顶层文档和普通 iframe 使用。覆盖 measureText() 与原生授权后的 queryLocalFonts() 结果过滤；FontFaceSet.check() 保持原生，新建且接管的Worker继承名单。DOM尺寸、local()、像素比对及未接管Worker未覆盖。${snapshot}`;
    case 'disabled': return `字体过滤当前未注册启用规则。${snapshot}`;
    case 'paused': return `已配置但当前未应用：固定名单字体过滤仍在人工恢复门禁内，未注册字体脚本。${snapshot}`;
    case 'custom-paused': return `已配置但当前未应用：自定义名单仅保存，当前不生产派发。${snapshot}`;
    case 'sync-failed': return '字体注册撤销或同步失败，残留注册数量尚未确认；请查看错误并重试同步，必要时关闭扩展。旧文档须关闭重建，当前页面实际值为 UNKNOWN。';
  }
}

export function fontRuntimeSummary(report?: RuntimeSyncReport): string {
  const state = report?.fontRuntime?.state;
  const status = state ? {
    ready: '已同步', disabled: '未启用', paused: '暂不可用',
    'custom-paused': '自定义名单暂不可用', 'sync-failed': '同步失败'
  }[state] : '待确认';
  return `字体过滤：${status}`;
}

export function renderFontRuntimeStatus(element: HTMLElement, report?: RuntimeSyncReport, format: 'detailed' | 'compact' = 'detailed'): void {
  element.textContent = format === 'compact' ? fontRuntimeSummary(report) : fontRuntimeMessage(report);
  element.dataset.fontRuntime = report?.fontRuntime?.state || 'unknown';
}

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

export function pageRuntimeSummary(report?: RuntimeSyncReport): string {
  const state = report?.pageRuntime?.state;
  const status = state ? {
    ready: '已同步', disabled: '未启用',
    'api-unsupported': '需要 Chrome 138+ 的 userScripts 支持',
    'permission-required': '缺少 userScripts 权限',
    'switch-required': '请在扩展详情开启“允许用户脚本”（Allow User Scripts）',
    'sync-failed': '同步失败'
  }[state] : isRuntimeInjectionPaused(report) ? '已暂停，请查看完整配置' : '待确认，请重试同步';
  return `语言/时区：${status}`;
}

export function geolocationRuntimeSummary(report?: RuntimeSyncReport): string {
  const state = report?.geolocationRuntime?.state;
  const status = state ? { ready: '已同步', disabled: '未启用', 'api-unsupported': '需要 Chrome 138+',
    'permission-required': '缺少 userScripts 权限', 'switch-required': '请开启允许用户脚本', 'sync-failed': '同步失败' }[state] : '待确认';
  return `定位：${status}`;
}

export function geolocationRuntimeMessage(report?: RuntimeSyncReport): string {
  const geo = report?.geolocationRuntime;
  return `${geolocationRuntimeSummary(report)}${geo?.state === 'ready' ? `（${geo.registeredRuleCount} 条规则）` : ''}。仅普通安全上下文且允许使用定位的匹配网页可用；定位权限开启时会授予Chrome真实站点定位权限；关闭该选项时委托原生定位并替换成功坐标。${geo?.reloadRequired ? '已有受影响页面需重新加载或关闭重开（保守包含 iframe）。' : ''}${DOCUMENT_SNAPSHOT_MESSAGE}`;
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
  if (!report) return `同步状态尚未确认，请重试同步。${pageRuntimeMessage()} ${geolocationRuntimeMessage()} ${fontRuntimeMessage()} ${PAGE_RUNTIME_PAUSED_SURFACES} ${PAGE_RUNTIME_DOCUMENT_SCOPE}`;
  const details = (Object.keys(RUNTIME_SYNC_COMPONENT_LABELS) as RuntimeSyncComponent[])
    .filter((key) => key === 'webrtc' || key === 'headers' || report.components[key]?.status !== 'ok')
    .map((key) => {
      const component = report.components[key] || { status: 'partial', errors: [{ code: 'header-status-unknown', message: '历史报告未确认请求头同步，请重试。' }] };
      const status = component.status === 'ok' ? '已同步' : component.status === 'failed' ? '同步失败' : '部分同步';
      return `${RUNTIME_SYNC_COMPONENT_LABELS[key]}：${status}${component.errors.length ? `（${component.errors.map((error) => error.message).join('；')}）` : ''}`;
    });
  if (report.metadataError) details.push(report.metadataError.message);
  if (report.warnings) details.push(...report.warnings.map((warning) => warning.message));
  return `${report.status === 'ok' ? '配置已保存，同步已完成。' : '已保存但未完全生效。'}${pageRuntimeMessage(report)} ${geolocationRuntimeMessage(report)} ${fontRuntimeMessage(report)} ${details.join('；')}。请求头规则供同步确认后的新文档使用；更新期间及已有文档的请求头与旧页面快照可能不同，需完整重载。${PAGE_RUNTIME_PAUSED_SURFACES} ${PAGE_RUNTIME_DOCUMENT_SCOPE}`;
}

export function runtimeSyncSummary(report?: RuntimeSyncReport): string {
  if (!report) return '同步状态待确认，请重试同步。';
  const webrtc = report.components.webrtc.status;
  const parts = [geolocationRuntimeSummary(report), pageRuntimeSummary(report), fontRuntimeSummary(report),
    `Accept-Language：${report.components.headers?.status === 'ok' ? '已同步' : report.components.headers?.status === 'failed' ? '同步失败' : '待确认'}`,
    `WebRTC：${webrtc === 'ok' ? '已同步' : webrtc === 'failed' ? '同步失败' : '部分同步'}`];
  for (const key of ['contentScripts', 'tabReload'] as const) {
    if (report.components[key].status !== 'ok') parts.push(`${RUNTIME_SYNC_COMPONENT_LABELS[key]}：未完成`);
  }
  if (report.metadataError || report.warnings?.length) parts.push('有同步提醒，详见完整配置');
  if (report.pageRuntime?.reloadRequired || report.fontRuntime?.reloadRequired || report.geolocationRuntime?.reloadRequired) parts.push('请重新加载已打开的网页');
  return `${parts.join('；')}。`;
}

export function renderRuntimeSyncReport(element: HTMLElement, report?: RuntimeSyncReport, format: 'detailed' | 'compact' = 'detailed'): void {
  element.textContent = format === 'compact' ? runtimeSyncSummary(report) : runtimeSyncMessage(report);
  element.dataset.status = report?.status || 'partial';
  element.dataset.pageRuntime = report?.pageRuntime?.state || 'unknown';
  element.dataset.geolocationRuntime = report?.geolocationRuntime?.state || 'unknown';
  element.dataset.fontRuntime = report?.fontRuntime?.state || 'unknown';
}

export function renderRuntimeSyncPending(element: HTMLElement): void {
  element.textContent = '正在保存并同步，完成前请勿关闭 Allow User Scripts。';
  element.dataset.status = 'pending';
  element.dataset.pageRuntime = 'unknown';
  element.dataset.geolocationRuntime = 'unknown';
  element.dataset.fontRuntime = 'unknown';
}
