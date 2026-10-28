import type { RuntimePayload, RuntimeController } from './types';
import { workerBootstrap } from 'virtual:vanishgeo-worker';
import { createRuntimeState } from './registry';
import { normalizeTimezonePayload } from './payload';
import { installLanguageSpoof } from './surfaces/navigator';
import { installDateTimeSpoof } from './surfaces/intl-date';
import { installGeolocationSpoof } from './surfaces/geolocation-permissions';
import { installFontExposureFilter } from './surfaces/font-exposure';
import { buildWorkerPatchSource, installWorkerHooks } from './surfaces/workers';
import { resolveFontFamilies } from '../../shared/font-layers';

// 每次安装创建独立闭包；后续更新必须复用返回的句柄，不从网页对象找回状态。
export function applyRuntime(payload: RuntimePayload): RuntimeController {
  const root = globalThis as typeof globalThis & Record<string, any>;
  const state = createRuntimeState(root);

  const log = (message: string) => {
    if (state.debugMode) {
      console.log('[VanishGeo]', message);
    }
  };

  function applySpoofToRealm(globals: typeof globalThis & Record<string, any>, payload: RuntimePayload): void {
    if (!payload) return;
    if (payload.extensionEnabled === false || payload.enabled === false) return;
    if (payload.fontExposureConfig) payload = { ...payload, fontExposureConfig: { ...payload.fontExposureConfig,
      blockedFamilies: resolveFontFamilies(payload.fontExposureConfig, globals.navigator || {}) } };

    const realmState = state;
    realmState.debugMode = Boolean(payload.debugMode);

    const geolocation = payload.geolocation || (
      Number.isFinite(Number(payload.latitude)) && Number.isFinite(Number(payload.longitude))
        ? { latitude: Number(payload.latitude), longitude: Number(payload.longitude) }
        : null
    );
    const timezonePayload = normalizeTimezonePayload(payload);
    const languageConfig = payload.languageConfig && payload.languageConfig.enabled ? payload.languageConfig : null;
    const spoofLanguage = languageConfig && languageConfig.language ? languageConfig.language : null;
    const spoofLanguages = languageConfig && Array.isArray(languageConfig.languages) && languageConfig.languages.length
      ? languageConfig.languages
      : spoofLanguage ? [spoofLanguage] : null;

    installLanguageSpoof(globals, realmState, spoofLanguage, spoofLanguages);
    installGeolocationSpoof(globals, realmState, geolocation);
    installDateTimeSpoof(globals, realmState, { timezone: timezonePayload.timezone, language: spoofLanguage, intlMode: payload.intlMode });
    installFontExposureFilter(globals, realmState, payload.fontExposureConfig);
    installWorkerHooks(globals, realmState, buildWorkerPatchSource(payload, workerBootstrap));
    log('applied payload');
  }

  const update = (nextPayload: RuntimePayload) => {
    if (state.runtimeReady) {
      if (nextPayload && nextPayload.extensionEnabled !== false && nextPayload.enabled !== false) {
        installWorkerHooks(root, state, buildWorkerPatchSource(nextPayload, workerBootstrap));
      }
      return;
    }
    state.runtimeReady = true;
    applySpoofToRealm(root, nextPayload);
  };
  update(payload);
  return { update };
}
