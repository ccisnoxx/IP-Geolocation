import { normalizeWebRtc } from '../shared/config-model';
import { applyProfileToConfig } from '../shared/profile';
import type { BackgroundServices } from './services';

export function createBackgroundMessageRouter(services: BackgroundServices) {
  async function respond(request: any, sender: chrome.runtime.MessageSender): Promise<any> {
    switch (request?.action) {
      case 'manualUpdate':
        return { status: 'ok', geo: await services.updateGeolocation(true) };
      case 'getExtensionState':
        return { status: 'ok', state: await services.getExtensionState() };
      case 'setExtensionEnabled':
        return { status: 'ok', config: await services.setExtensionEnabled(Boolean(request.enabled)) };
      case 'getSiteConfig':
        return { status: 'ok', config: await services.getSiteConfig() };
      case 'setSiteConfig':
        return { status: 'ok', config: await services.saveSiteConfig(request.config || {}) };
      case 'resetSiteConfig':
        return { status: 'ok', config: await services.saveSiteConfig({}) };
      case 'setWebRtcGlobalMode':
        return { status: 'ok', config: await services.setWebRtcGlobalMode(request.mode) };
      case 'getWebRtcConfig': {
        const config = await services.getSiteConfig();
        const webRtc = normalizeWebRtc(config.webRtc);
        return {
          status: 'ok',
          state: {
            config: webRtc,
            effectivePolicy: services.webRtcPolicies[webRtc.globalMode]
          }
        };
      }
      case 'getPayloadForUrl':
        return { status: 'ok', ...(await services.getPayloadForUrl(request.url || sender.url || '')) };
      case 'getCurrentTabState': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return { status: 'ok', state: await services.getCurrentTabState(tab) };
      }
      case 'addDomainRule':
        return { status: 'ok', config: await services.addDomainRule(request.domain) };
      case 'setDomainRuleEnabled':
        return { status: 'ok', config: await services.setDomainRuleEnabled(request.domain, request.enabled) };
      case 'deleteDomainRule':
        return { status: 'ok', config: await services.deleteDomainRule(request.domain) };
      case 'applyProfile': {
        const config = await services.getSiteConfig();
        return { status: 'ok', config: await services.saveSiteConfig(applyProfileToConfig(config, request.profileId)) };
      }
      case 'openDiagnosticPage':
      case 'openLeakTest':
        await services.openDiagnosticPage();
        return { status: 'ok' };
      case 'openOptions':
        await chrome.runtime.openOptionsPage();
        return { status: 'ok' };
      default:
        throw new Error(`unknown action: ${request?.action}`);
    }
  }

  return { respond };
}
