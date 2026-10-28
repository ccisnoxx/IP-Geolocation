import { canvasFontReplacementMap, type CanvasFontPlatform } from '../../shared/canvas-fonts';
import { installCanvasFontSpoof } from './surfaces/canvas-fonts';

/**
 * Canvas 字体伪装入口，注册成独立 userScript（MAIN world / document_start）。
 *
 * 平台由构建期参数决定（`(${source})('macos')`），运行期不读配置、不跨 world 传值，
 * 也不进入页面运行时的 graph，从而不影响 runtime-build 的 graph 契约。
 */
export function applyCanvasFontSpoof(platform: CanvasFontPlatform): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  if (!/^https?:$/.test(root.location?.protocol || '') || root.origin === 'null') return;
  const chosen: CanvasFontPlatform = platform === 'windows' ? 'windows' : 'macos';
  installCanvasFontSpoof(root, { platform: chosen, replacements: canvasFontReplacementMap(chosen) });
}
