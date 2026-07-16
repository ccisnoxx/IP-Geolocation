import { createContextMenus, handleContextMenuClick } from './context-menu';
import { createBackgroundMessageRouter } from './message-router';
import { createBackgroundServices } from './services';

const services = createBackgroundServices();
const router = createBackgroundMessageRouter(services);

function runBackgroundTask(label: string, task: Promise<void>): void {
  task.catch((error) => {
    console.warn(`VanishGeo ${label}失败：`, error instanceof Error ? error.message : String(error));
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  router.respond(request, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ status: 'error', message: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  runBackgroundTask('初始化', services.initializeExtension());
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  runBackgroundTask('启动初始化', services.initializeExtension());
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(services, info, tab);
});
