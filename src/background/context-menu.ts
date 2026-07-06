import type { BackgroundServices } from './services';

export function createContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'enable-globally', title: 'Enable globally', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'disable-globally', title: 'Disable globally', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'separator-1', type: 'separator', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'enable-on-site', title: 'Enable on this site', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'disable-on-site', title: 'Disable on this site', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'separator-2', type: 'separator', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-leak-test', title: 'Open diagnostic page', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'reset-webrtc', title: 'Reset WebRTC policy', contexts: ['action'] });
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
          if (tab.id) await chrome.tabs.reload(tab.id);
        }
        break;
      case 'disable-on-site':
        if (tab?.url) {
          await services.deleteDomainRule(new URL(tab.url).hostname);
          if (tab.id) await chrome.tabs.reload(tab.id);
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
    console.error('Context menu action failed:', error);
  });
}
