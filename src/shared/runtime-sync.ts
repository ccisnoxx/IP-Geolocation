import type { RuntimeSyncComponent, RuntimeSyncError, RuntimeSyncReport } from './types';

export const RUNTIME_SYNC_COMPONENT_LABELS: Record<RuntimeSyncComponent, string> = {
  contentScripts: '页面脚本', dnr: '请求头规则', webrtc: 'WebRTC 策略', tabReload: '标签页刷新'
};

// 代码级安全暂停，没有配置或页面可控制的恢复开关。
export const RUNTIME_INJECTION_PAUSED: RuntimeSyncError = {
  code: 'runtime-injection-paused',
  message: '页面伪装已暂停：语言、时区、位置、Canvas 和 worker 伪装均不执行。请求头规则与 WebRTC 按各自状态报告。已有 hook 与旧 BFCache 文档需关闭并重建，暂停不会撤销已执行代码。'
};

export function isRuntimeInjectionPaused(report?: RuntimeSyncReport): boolean {
  return Boolean(report?.components.contentScripts.errors.some((error) => error.code === RUNTIME_INJECTION_PAUSED.code));
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
  if (!report) return '同步状态尚未确认，请重试同步。';
  if (report.status === 'ok') return '配置已保存，运行时已同步。';
  const details = (Object.keys(RUNTIME_SYNC_COMPONENT_LABELS) as RuntimeSyncComponent[])
    .filter((key) => report.components[key].status !== 'ok')
    .map((key) => `${RUNTIME_SYNC_COMPONENT_LABELS[key]}：${report.components[key].errors.map((error) => error.message).join('；')}`);
  if (report.metadataError) details.push(report.metadataError.message);
  if (report.warnings) details.push(...report.warnings.map((warning) => warning.message));
  return `已保存但未完全生效。${details.join('；')} ${isRuntimeInjectionPaused(report) ? '部分生效；重试同步不会恢复页面伪装。' : '可重试同步。'}`;
}

export function renderRuntimeSyncReport(element: HTMLElement, report?: RuntimeSyncReport): void {
  element.textContent = runtimeSyncMessage(report);
  element.dataset.status = report?.status || 'partial';
}
