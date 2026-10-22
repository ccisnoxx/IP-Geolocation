import type { BackgroundServices } from './services';

const menuItems: chrome.contextMenus.CreateProperties[] = [
  { id: 'enable-globally', title: '全局启用', contexts: ['action'] },
  { id: 'disable-globally', title: '全局禁用', contexts: ['action'] },
  { id: 'separator-1', type: 'separator', contexts: ['action'] },
  { id: 'enable-on-site', title: '在当前站点启用', contexts: ['action'] },
  { id: 'disable-on-site', title: '在当前站点禁用', contexts: ['action'] },
  { id: 'separator-2', type: 'separator', contexts: ['action'] },
  { id: 'open-leak-test', title: '打开诊断页', contexts: ['action'] },
  { id: 'reset-webrtc', title: '重置 WebRTC 策略', contexts: ['action'] }
];

let pendingCreation: Promise<void> | undefined;

async function rebuildContextMenus(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
  for (const item of menuItems) {
    await new Promise<void>((resolve, reject) => {
      chrome.contextMenus.create(item, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }
}

export function createContextMenus(): Promise<void> {
  // 安装与启动事件可能重叠；清理、全部创建回调结束前共用同一轮初始化。
  if (!pendingCreation) {
    pendingCreation = rebuildContextMenus().finally(() => { pendingCreation = undefined; });
  }
  return pendingCreation;
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
