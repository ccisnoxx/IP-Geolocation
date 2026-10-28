// 首屏由Chrome直接执行；管理写入仅扩展页，content仅有当前frame最小更新读取。
import { normalizeWebRtc } from '../shared/config-model';
import { applyProfileToConfig } from '../shared/profile';
import type { BackgroundServices } from './services';
import type { ConfigSaveResult } from '../shared/types';

export function createBackgroundMessageRouter(services: BackgroundServices) {
  function requireExtensionPage(sender: chrome.runtime.MessageSender): void {
    const extensionRoot = chrome.runtime.getURL('');
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionRoot)) {
      throw new Error('该操作只允许扩展管理页面调用');
    }
  }

  function requireDiagnosticReport(sender: chrome.runtime.MessageSender) {
    requireExtensionPage(sender);
    if (sender.url !== chrome.runtime.getURL('diagnostic/report.html') || typeof sender.tab?.id !== 'number' || !sender.documentId) {
      throw new Error('诊断 run 只允许扩展报告文档调用');
    }
    return { tabId: sender.tab.id, documentId: sender.documentId };
  }

  function savedResponse(result: ConfigSaveResult) {
    return { status: result.syncReport.status === 'ok' ? 'ok' : 'partial', saved: true, ...result };
  }

  async function respond(request: any, sender: chrome.runtime.MessageSender): Promise<any> {
    if (request?.action === 'getLiveRuntimeUpdate') {
      const url = sender.url ? new URL(sender.url) : null;
      if (sender.id !== chrome.runtime.id || !url || !/^https?:$/.test(url.protocol) || sender.origin !== url.origin
        || typeof sender.tab?.id !== 'number' || !Number.isInteger(sender.frameId) || sender.frameId! < 0 || !sender.documentId) {
        throw new Error('页面更新只允许普通HTTP(S)文档的本扩展content调用');
      }
      // URL只取Chrome提供的当前frame sender；页面不能指定其他域或取得完整配置。
      return { status: 'ok', payloads: await services.getLiveRuntimeUpdate(url.href) };
    }
    requireExtensionPage(sender);
    switch (request?.action) {
      case 'getExtensionState':
        return { status: 'ok', state: await services.getExtensionState() };
      case 'setExtensionEnabled':
        return savedResponse(await services.setExtensionEnabled(Boolean(request.enabled)));
      case 'getSiteConfig':
        return { status: 'ok', ...(await services.getConfigState()) };
      case 'reconcileRuntime': {
        const result = await services.reconcileRuntime();
        return { status: result.syncReport.status === 'ok' ? 'ok' : 'partial', ...result };
      }
      case 'setSiteConfig':
        return savedResponse(await services.saveSiteConfig(request.config || {}));
      case 'applyConfigAuditFix':
        if (typeof request.findingId !== 'string') throw new Error('配置体检项目无效');
        return savedResponse(await services.applyConfigAuditFix(request.findingId));
      case 'importSiteConfig':
        return savedResponse(await services.importSiteConfig(request.config || {}));
      case 'resetSiteConfig':
        return savedResponse(await services.resetSiteConfig());
      case 'completeOnboarding':
        if (request.confirmed !== true) throw new Error('请明确确认启用所选站点');
        return savedResponse(await services.completeOnboarding(request.domains, request.profileId, request.webRtcMode, request.recommendation));
      case 'skipOnboarding':
        return savedResponse(await services.skipOnboarding());
      case 'detectExitLocation':
        return { status: 'ok', preview: await services.detectExitLocation(request.profileId || null) };
      case 'confirmExitLocationDetection':
        return savedResponse(await services.confirmExitLocationDetection(request.detectionId, request.name));
      case 'cancelExitLocationDetection':
        await services.cancelExitLocationDetection(request.detectionId);
        return { status: 'ok' };
      case 'renameExitLocationProfile':
        return savedResponse(await services.renameExitLocationProfile(request.profileId, request.name));
      case 'deleteExitLocationProfile':
        return savedResponse(await services.deleteExitLocationProfile(request.profileId));
      case 'setWebRtcGlobalMode':
        return savedResponse(await services.setWebRtcGlobalMode(request.mode));
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
        return savedResponse(await services.addDomainRule(request.domain));
      case 'setDomainRuleEnabled':
        return savedResponse(await services.setDomainRuleEnabled(request.domain, request.enabled));
      case 'deleteDomainRule':
        return savedResponse(await services.deleteDomainRule(request.domain));
      case 'applyProfile': {
        const config = await services.getSiteConfig();
        return savedResponse(await services.saveSiteConfig(applyProfileToConfig(config, request.profileId)));
      }
      case 'openDiagnosticPage':
      case 'openLeakTest':
        await services.openDiagnosticPage();
        return { status: 'ok' };
      case 'openDiagnosticTarget':
        requireDiagnosticReport(sender);
        return { status: 'ok', tabId: await services.openDiagnosticTarget(request.target, request.port) };
      case 'getDiagnosticTargets':
        requireDiagnosticReport(sender);
        return { status: 'ok', targets: await services.getDiagnosticTargets() };
      case 'prepareDiagnosticRun':
        return { status: 'ok', run: await services.prepareDiagnosticRun(request.tabId, requireDiagnosticReport(sender)) };
      case 'executeDiagnosticRun':
        return { status: 'ok', evidence: await services.executeDiagnosticRun(request.runId, requireDiagnosticReport(sender)) };
      case 'executeInjectionTimingRun':
        return { status: 'ok', evidence: await services.executeInjectionTimingRun(request.runId, requireDiagnosticReport(sender)) };
      case 'cancelDiagnosticRun':
        services.cancelDiagnosticRun(request.runId, requireDiagnosticReport(sender));
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
