import type { BackgroundServices } from './services';

export function createContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'enable-globally', title: '全局启用', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'disable-globally', title: '全局禁用', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'separator-1', type: 'separator', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'enable-on-site', title: '在当前站点启用', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'disable-on-site', title: '在当前站点禁用', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'separator-2', type: 'separator', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-leak-test', title: '打开诊断页', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'reset-webrtc', title: '重置 WebRTC 策略', contexts: ['action'] });
  });
}

export function handleContextMenuClick(services: BackgroundServices, info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): void {
  void (async () => {
    switch (info.menuItemId) {
      case 'enable-globally':
        await services.setExtensionEnabled(true);
        break;
      case 'disable-globally':
        await services.setExtensionEnabled(false);
        break;
      case 'enable-on-site':
        if (tab?.url) {
          await services.addDomainRule(new URL(tab.url).hostname);
        }
        break;
      case 'disable-on-site':
        if (tab?.url) {
          const matched = await services.getPayloadForUrl(tab.url);
          if (matched.rule) await services.deleteDomainRule(matched.rule.domain);
        }
        break;
      case 'open-leak-test':
        await services.openDiagnosticPage();
        break;
      case 'reset-webrtc':
        await services.setWebRtcGlobalMode('default');
        break;
    }
  })().catch((error) => {
    console.error('右键菜单操作失败：', error);
  });
}
