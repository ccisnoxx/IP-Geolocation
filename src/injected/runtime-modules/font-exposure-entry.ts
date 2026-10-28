import { VENDOR_SOFTWARE_FONT_FAMILIES } from '../../shared/font-families';
import { installFontExposureFilter } from './surfaces/font-exposure';
import { resolveFontFamilies } from '../../shared/font-layers';
import type { RuntimePayload } from './types';
import { createDocumentController, mountDocumentUpdates } from './document-controller';
import { parseFontUpdate } from './runtime-update';
import { installCanvasFontSpoof } from './surfaces/canvas-fonts';
import { canvasFontReplacementMap } from '../../shared/canvas-fonts';

// 模板只接收当前域的字体配置；旧文件入口默认固定名单仅保留作迁移清理。
export function applyFontFilter(payload: NonNullable<RuntimePayload['fontExposureConfig']> = {
  enabled: true, mode: 'vendor-software', blockedFamilies: [...VENDOR_SOFTWARE_FONT_FAMILIES]
}): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  if (!/^https?:$/.test(root.location.protocol) || root.origin === 'null') return;
  const controller = createDocumentController<NonNullable<RuntimePayload['fontExposureConfig']>>(root, (state, next) => {
    installFontExposureFilter(root, state, { ...next, blockedFamilies: resolveFontFamilies(next, root.navigator || {}) });
    if (next.enabled && next.canvasSpoof?.enabled) installCanvasFontSpoof(root, {
      platform: next.canvasSpoof.platform, replacements: canvasFontReplacementMap(next.canvasSpoof.platform)
    }, state);
  });
  controller.update(parseFontUpdate(payload));
  mountDocumentUpdates(root, 'font', controller, parseFontUpdate);
}
