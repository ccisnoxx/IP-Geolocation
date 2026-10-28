import type { GeolocationPayload } from '../../shared/types';
import { installGeolocationSpoof } from './surfaces/geolocation-permissions';
import { createDocumentController, mountDocumentUpdates } from './document-controller';
import { parseGeolocationUpdate } from './runtime-update';

// 新文档一次性闭包快照，不导出 controller 或在页面全局保存配置。
export function applyGeolocationRuntime(payload: GeolocationPayload): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  if (!/^https?:$/.test(root.location.protocol) || root.origin === 'null') return;
  const controller = createDocumentController<GeolocationPayload>(root, (state, next) => installGeolocationSpoof(root, state, next));
  controller.update(parseGeolocationUpdate(payload));
  mountDocumentUpdates(root, 'geolocation', controller, parseGeolocationUpdate);
}
