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
      case 'getPayloadForUrl': {
        // 这条消息只可能来自 matches 命中域名的内容脚本：说明该文档已经由注册的
        // 内容脚本装过 runtime，记下 documentId，后面就不必再对同一文档执行脚本。
        await services.noteDocumentInjected((sender as { documentId?: string }).documentId);
        return { status: 'ok', ...(await services.getPayloadForUrl(request.url || sender.url || '')) };
      }
      case 'reportFontLayers': {
        // 来自内容脚本：注入层在 document_start 装完补丁后回报实际生效的字体层
        services.reportFontLayers(request.url || (sender as { url?: string }).url || '', request.layers);
        return { status: 'ok' };
      }
      case 'getFontLayers': {
        return { status: 'ok', layers: services.getFontLayers(request.url || '') };
      }
      case 'getBakeSnapshot': {
        // 只给扩展自己的页面用：拿到当前配置，导出成烘焙构建的输入
        return { status: 'ok', ...(await services.getBakeSnapshot()) };
      }
      case 'getCurrentTabState': {
        // 显式传 tabId 时按它算（弹窗拿不到目标标签、或者需要离线核对时都用得上）
        const tab = request.tabId !== undefined && request.tabId !== null
          ? await chrome.tabs.get(Number(request.tabId)).catch(() => undefined)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        return { status: 'ok', state: await services.getCurrentTabState(tab) };
      }
      case 'addDomainRule':
        return { status: 'ok', config: await services.addDomainRule(request.domain) };
      case 'setDomainRuleEnabled':
        return { status: 'ok', config: await services.setDomainRuleEnabled(request.domain, request.enabled) };
      case 'deleteDomainRule':
        return { status: 'ok', config: await services.deleteDomainRule(request.domain) };
      case 'reloadAffectedTabs':
        await services.reloadAffectedTabs(request.domain);
        return { status: 'ok' };
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
