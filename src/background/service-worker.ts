import { createContextMenus, handleContextMenuClick } from './context-menu';
import { createBackgroundMessageRouter } from './message-router';
import { createBackgroundServices } from './services';
import { DiagnosticRunError } from './diagnostic-runs';
import { pageRuntimeSource, geolocationRuntimeSource } from '../injected/runtime';

const services = createBackgroundServices(pageRuntimeSource, geolocationRuntimeSource);
const router = createBackgroundMessageRouter(services);

function runBackgroundTask(label: string, task: Promise<unknown>): void {
  task.catch((error) => {
    console.warn(`VanishGeo ${label}失败：`, error instanceof Error ? error.message : String(error));
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  router.respond(request, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ status: 'error', code: error instanceof DiagnosticRunError ? error.code : undefined, message: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  createContextMenus();
  runBackgroundTask('安装初始化', services.handleInstalled(details.reason));
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  runBackgroundTask('启动初始化', services.initializeExtension());
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(services, info, tab);
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === 'loading') services.invalidateDiagnosticTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => services.invalidateDiagnosticTab(tabId, true));

// 每次 MV3 worker 被唤醒也对账；不能只依赖浏览器 onStartup。
runBackgroundTask('运行时对账', services.initializeExtension());
