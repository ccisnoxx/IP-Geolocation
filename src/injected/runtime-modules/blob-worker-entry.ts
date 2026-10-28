import type { LanguageTimezonePayload } from '../../shared/types';
import { createRuntimeState } from './registry';
import { installLanguageSpoof } from './surfaces/navigator';
import { installDateTimeSpoof } from './surfaces/intl-date';
import { installBlobWorker } from './surfaces/blob-worker';
import { installWorkerFonts } from './surfaces/offscreen-fonts';

// 构建入口传入自包含函数本身；每一层仅接管自身创建的 Blob，继承同一快照。
export function applyBlobWorkerRuntime(payload: LanguageTimezonePayload, bootstrap: (payload: LanguageTimezonePayload) => void): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  const state = createRuntimeState(root);
  const language = payload.language?.language || null;
  installLanguageSpoof(root, state, language, payload.language?.languages || null);
  installDateTimeSpoof(root, state, { language, timezone: payload.timezone, intlMode: payload.intlMode, includeTemporal: false });
  installWorkerFonts(root, { blockedFonts: payload.blockedFonts });
  installBlobWorker(root, state, payload, bootstrap);
}
