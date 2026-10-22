import type { LanguageTimezonePayload } from '../../shared/types';
import { createRuntimeState } from './registry';
import { installLanguageSpoof } from './surfaces/navigator';
import { installDateTimeSpoof } from './surfaces/intl-date';

// 只供本页创建的 Dedicated Blob Worker 使用；复用页面合同，不安装嵌套 Worker hook。
export function applyBlobWorkerRuntime(payload: LanguageTimezonePayload): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  const state = createRuntimeState(root);
  const language = payload.language?.language || null;
  installLanguageSpoof(root, state, language, payload.language?.languages || null);
  installDateTimeSpoof(root, state, { language, timezone: payload.timezone, intlMode: payload.intlMode, includeTemporal: false });
}
