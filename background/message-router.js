// Runtime message dispatch for background services.
(function(root) {
  function createBackgroundMessageRouter(services) {
    async function respond(request, sender) {
      if (request.action === 'manualUpdate') {
        return { status: 'ok', geo: await services.updateGeolocation(true) };
      }
      if (request.action === 'getExtensionState') {
        return { status: 'ok', state: await services.getExtensionState() };
      }
      if (request.action === 'setExtensionEnabled') {
        const config = await services.setExtensionEnabled(request.enabled);
        return { status: 'ok', config, state: { enabled: config.masterEnabled, config } };
      }
      if (request.action === 'getSiteConfig') {
        return { status: 'ok', config: await services.getSiteConfig() };
      }
      if (request.action === 'setSiteConfig') {
        return { status: 'ok', config: await services.saveSiteConfig(request.config || {}) };
      }
      if (request.action === 'setWebRtcGlobalMode') {
        const config = await services.getSiteConfig();
        config.webRtc = IPGeoConfig.normalizeWebRtc({ globalMode: request.mode });
        const saved = await services.saveSiteConfig(config);
        return {
          status: 'ok',
          state: {
            config: saved.webRtc,
            effectivePolicy: services.webRtcPolicies[saved.webRtc.globalMode]
          },
          config: saved
        };
      }
      if (request.action === 'getWebRtcConfig') {
        const config = await services.getSiteConfig();
        return {
          status: 'ok',
          state: {
            config: config.webRtc,
            effectivePolicy: services.webRtcPolicies[config.webRtc.globalMode]
          }
        };
      }
      if (request.action === 'getCurrentTabState') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return { status: 'ok', state: await services.getCurrentTabState(tab) };
      }
      if (request.action === 'addDomainRule') {
        return { status: 'ok', config: await services.addDomainRule(request.domain) };
      }
      if (request.action === 'setDomainRuleEnabled') {
        return {
          status: 'ok',
          config: await services.setDomainRuleEnabled(request.domain, request.enabled)
        };
      }
      if (request.action === 'deleteDomainRule') {
        return { status: 'ok', config: await services.deleteDomainRule(request.domain) };
      }
      if (request.action === 'openDiagnosticPage') {
        return {
          status: 'ok',
          state: await services.openDiagnosticPage(sender && sender.tab ? sender.tab : null)
        };
      }
      if (request.action === 'getDiagnosticState') {
        return { status: 'ok', state: await services.getDiagnosticState(request.tabId) };
      }
      if (request.action === 'openOptions') {
        await chrome.runtime.openOptionsPage();
        return { status: 'ok' };
      }
      throw new Error(`unknown action: ${request.action}`);
    }

    return { respond };
  }

  const api = {
    create: createBackgroundMessageRouter
  };

  root.IPGeoBackgroundMessageRouter = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
