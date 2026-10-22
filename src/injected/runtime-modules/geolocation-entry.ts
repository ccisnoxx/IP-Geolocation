import type { GeolocationPayload } from '../../shared/types';
import { createRuntimeState } from './registry';
import { installGeolocationSpoof } from './surfaces/geolocation-permissions';

// 新文档一次性闭包快照，不导出 controller 或在页面全局保存配置。
export function applyGeolocationRuntime(payload: GeolocationPayload): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  installGeolocationSpoof(root, createRuntimeState(root), payload);
}
