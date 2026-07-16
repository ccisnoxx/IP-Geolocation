// 消息路由把 content 初始化与扩展管理页动作分开校验。
import { normalizeWebRtc } from '../shared/config-model';
import { applyProfileToConfig } from '../shared/profile';
import type { BackgroundServices } from './services';

export function createBackgroundMessageRouter(services: BackgroundServices) {
  function requireExtensionPage(sender: chrome.runtime.MessageSender): void {
    const extensionRoot = chrome.runtime.getURL('');
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionRoot)) {
      throw new Error('该操作只允许扩展管理页面调用');
    }
  }

  async function respond(request: any, sender: chrome.runtime.MessageSender): Promise<any> {
    if (request?.action === 'initializeRuntimeForSender') {
      return { status: 'ok', ...(await services.initializeRuntimeForSender(sender)) };
    }

    requireExtensionPage(sender);
    switch (request?.action) {
      case 'getExtensionState':
        return { status: 'ok', state: await services.getExtensionState() };
      case 'setExtensionEnabled':
        return { status: 'ok', config: await services.setExtensionEnabled(Boolean(request.enabled)) };
      case 'getSiteConfig':
        return { status: 'ok', config: await services.getSiteConfig() };
      case 'setSiteConfig':
        return { status: 'ok', config: await services.saveSiteConfig(request.config || {}) };
      case 'importSiteConfig':
        return { status: 'ok', config: await services.importSiteConfig(request.config || {}) };
      case 'resetSiteConfig':
        return { status: 'ok', config: await services.resetSiteConfig() };
      case 'detectExitLocation':
        return { status: 'ok', preview: await services.detectExitLocation(request.profileId || null) };
      case 'confirmExitLocationDetection':
        return { status: 'ok', config: await services.confirmExitLocationDetection(request.detectionId, request.name) };
      case 'cancelExitLocationDetection':
        await services.cancelExitLocationDetection(request.detectionId);
        return { status: 'ok' };
      case 'renameExitLocationProfile':
        return { status: 'ok', config: await services.renameExitLocationProfile(request.profileId, request.name) };
      case 'deleteExitLocationProfile':
        return { status: 'ok', config: await services.deleteExitLocationProfile(request.profileId) };
      case 'setWebRtcGlobalMode':
        return { status: 'ok', config: await services.setWebRtcGlobalMode(request.mode) };
      case 'getWebRtcConfig': {
        const config = await services.getSiteConfig();
        const webRtc = normalizeWebRtc(config.webRtc);
        return {
          status: 'ok',
          state: {
            config: webRtc,
            effectivePolicy: services.webRtcPolicies[webRtc.globalMode],
            policyState: await services.getWebRtcPolicyState()
          }
        };
      }
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
        throw new Error(`未知操作：${request?.action}`);
    }
  }

  return { respond };
}
