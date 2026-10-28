import { createContextMenus, handleContextMenuClick } from './context-menu';
import { createBackgroundMessageRouter } from './message-router';
import { createBackgroundServices } from './services';
import { DiagnosticRunError } from './diagnostic-runs';
import { pageRuntimeSource, geolocationRuntimeSource, fontRuntimeSource } from '../injected/runtime';
import { AUTOMATIC_EXIT_ALARM } from './automatic-exit';

const services = createBackgroundServices(pageRuntimeSource, geolocationRuntimeSource, fontRuntimeSource);
const router = createBackgroundMessageRouter(services);

function runBackgroundTask(label: string, task: Promise<unknown>): void {
  task.catch((error) => {
    console.warn(`VanishGeo ${label}失败：`, error instanceof Error ? error.message : String(error));
  });
}

async function refreshAutomaticExit(force = false): Promise<void> {
  try { await services.refreshAutomaticExit(force); }
  finally { await services.refreshActionBadges(); }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  router.respond(request, sender)
    .then(response => {
      sendResponse(response);
      if (response.saved || request?.action === 'reconcileRuntime') runBackgroundTask('自动出口与角标对账', refreshAutomaticExit(request?.action === 'reconcileRuntime'));
    })
    .catch((error) => sendResponse({ status: 'error', code: error instanceof DiagnosticRunError ? error.code : undefined, message: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  runBackgroundTask('右键菜单初始化', createContextMenus());
  runBackgroundTask('安装初始化', services.handleInstalled(details.reason).then(() => refreshAutomaticExit()));
});

chrome.runtime.onStartup.addListener(() => {
  runBackgroundTask('右键菜单初始化', createContextMenus());
  runBackgroundTask('启动初始化', services.initializeExtension().then(() => refreshAutomaticExit()));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(services, info, tab);
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === 'loading') services.invalidateDiagnosticTab(tabId);
  if (change.url || change.status === 'loading' || change.status === 'complete') runBackgroundTask('角标刷新', services.refreshActionBadges(tabId));
});
chrome.tabs.onActivated.addListener(({ tabId }) => runBackgroundTask('角标刷新', services.refreshActionBadges(tabId)));
chrome.tabs.onRemoved.addListener((tabId) => services.invalidateDiagnosticTab(tabId, true));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AUTOMATIC_EXIT_ALARM) runBackgroundTask('自动出口定时检测', refreshAutomaticExit(true));
});

// 每次 MV3 worker 被唤醒也对账；不能只依赖浏览器 onStartup。
runBackgroundTask('运行时对账', services.initializeExtension().then(() => refreshAutomaticExit()));
