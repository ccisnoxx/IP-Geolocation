import { VENDOR_SOFTWARE_FONT_FAMILIES } from '../../shared/font-families';
import { createRuntimeState } from './registry';
import { installFontExposureFilter } from './surfaces/font-exposure';

// 固定包内名单；没有配置参数、跨 world 通道或异步读取。
export function applyFontFilter(): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  if (!/^https?:$/.test(root.location.protocol) || root.origin === 'null') return;
  installFontExposureFilter(root, createRuntimeState(root), {
    enabled: true, mode: 'vendor-software', blockedFamilies: [...VENDOR_SOFTWARE_FONT_FAMILIES]
  });
}
