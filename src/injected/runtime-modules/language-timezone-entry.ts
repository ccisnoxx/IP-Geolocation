import type { LanguageTimezonePayload } from '../../shared/types';
import { installLanguageSpoof } from './surfaces/navigator';
import { installDateTimeSpoof } from './surfaces/intl-date';
import { installBlobWorker } from './surfaces/blob-worker';
import { installNetworkWorkers } from './surfaces/network-workers';
import { applyBlobWorkerRuntime } from 'virtual:vanishgeo-blob-worker';
import { resolveFontFamilies } from '../../shared/font-layers';
import { createDocumentController, mountDocumentUpdates } from './document-controller';
import { createPageUpdateParser } from './runtime-update';

// 首屏由Chrome同步派发，当前文档只读桥更新控制器；未来Worker继承创建时最小快照。
export function applyPageRuntime(payload: LanguageTimezonePayload, liveUpdates = true): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  if (!/^https?:$/.test(root.location.protocol) || root.origin === 'null') return;
  const parse = createPageUpdateParser(root);
  const controller = createDocumentController<LanguageTimezonePayload>(root, (state, next) => {
    if (next.fontPolicy) {
      const { fontPolicy, ...snapshot } = next;
      next = { ...snapshot, blockedFonts: resolveFontFamilies(fontPolicy, root.navigator || {}) };
    }
    const language = next.language?.language || null;
    installLanguageSpoof(root, state, language, next.language?.languages || null);
    installDateTimeSpoof(root, state, { language, timezone: next.timezone, intlMode: next.intlMode, includeTemporal: false });
    installBlobWorker(root, state, next, applyBlobWorkerRuntime);
    installNetworkWorkers(root, state, next, applyBlobWorkerRuntime);
  });
  controller.update(parse(payload));
  if (liveUpdates) mountDocumentUpdates(root, 'page', controller, parse);
}
