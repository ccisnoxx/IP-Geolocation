import type { RuntimePayload } from './types';
import { workerBootstrap } from 'virtual:vanishgeo-worker';
import { getAntiDetectionState } from './registry';
import { normalizeTimezonePayload } from './payload';
import { installLanguageSpoof } from './surfaces/navigator';
import { installDateTimeSpoof } from './surfaces/intl-date';
import { installGeolocationSpoof } from './surfaces/geolocation-permissions';
import { installCanvasSpoof } from './surfaces/canvas-fonts';
import { buildWorkerPatchSource, installWorkerHooks } from './surfaces/workers';

// 唯一调度入口；首次先建 registry，重复调用仅更新未来 worker。
export function applyRuntime(payload: RuntimePayload, documentStateKey: string): void {
  const root = globalThis as typeof globalThis & Record<string, any>;
  const runtimeAnchor = Symbol.for(documentStateKey);
  const state = getAntiDetectionState(root, runtimeAnchor);
  if (state.runtimeReady) {
    if (payload && payload.extensionEnabled !== false && payload.enabled !== false) {
      installWorkerHooks(root, state, buildWorkerPatchSource(payload, documentStateKey, workerBootstrap));
    }
    return;
  }
  state.runtimeReady = true;

  const log = (message: string) => {
    if (state.debugMode) {
      console.log('[VanishGeo]', message);
    }
  };

  function applySpoofToRealm(globals: typeof globalThis & Record<string, any>, payload: RuntimePayload): void {
    if (!payload) return;
    if (payload.extensionEnabled === false || payload.enabled === false) return;

    const realmState = getAntiDetectionState(globals, runtimeAnchor);
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
    installCanvasSpoof(globals, realmState, payload.canvasConfig);
    installWorkerHooks(globals, realmState, buildWorkerPatchSource(payload, documentStateKey, workerBootstrap));
    log('applied payload');
  }

  applySpoofToRealm(root, payload);
}
