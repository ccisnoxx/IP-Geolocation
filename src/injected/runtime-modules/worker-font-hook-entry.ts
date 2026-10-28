import { VENDOR_SOFTWARE_FONT_FAMILIES } from '../../shared/font-families';
import { createRuntimeState } from './registry';
import { buildWorkerPatchSourceFromFonts, installWorkerHooks } from './surfaces/workers';
import { workerBootstrap } from 'virtual:vanishgeo-worker';

/**
 * 文件型 Worker 字体钩子的维护实验入口，不参与生产注册。
 *
 * 页面运行时 graph 有"不含 worker/ 依赖"的契约（tests/runtime-build.test.ts 守着），
 * 所以这条钩子不塞进页面运行时，而是单独注册成一条脚本：只做字体，不碰语言/时区，
 * 与 font-exposure 过滤同样是"固定内置名单 + 同域 full 规则"的开关条件。
 */
export function applyWorkerFontHook(): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  if (!/^https?:$/.test(root.location.protocol) || root.origin === 'null') return;
  const families = [...VENDOR_SOFTWARE_FONT_FAMILIES];
  if (!families.length) return;
  installWorkerHooks(root, createRuntimeState(root), buildWorkerPatchSourceFromFonts(families, workerBootstrap));
}
