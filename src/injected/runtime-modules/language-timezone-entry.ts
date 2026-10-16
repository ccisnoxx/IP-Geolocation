import type { LanguageTimezonePayload } from '../../shared/types';
import { createRuntimeState } from './registry';
import { installLanguageSpoof } from './surfaces/navigator';
import { installDateTimeSpoof } from './surfaces/intl-date';

// 由 Chrome 按注册规则在新文档开始执行；无初始化消息、热更新或其他 surface 安装。
export function applyPageRuntime(payload: LanguageTimezonePayload): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  if (!/^https?:$/.test(root.location.protocol) || root.origin === 'null') return;
  const state = createRuntimeState(root);
  const language = payload.language?.language || null;
  installLanguageSpoof(root, state, language, payload.language?.languages || null);
  installDateTimeSpoof(root, state, { language, timezone: payload.timezone, intlMode: payload.intlMode, includeTemporal: false });
}
