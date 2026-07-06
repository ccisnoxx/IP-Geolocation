import { createContextMenus, handleContextMenuClick } from './context-menu';
import { createBackgroundMessageRouter } from './message-router';
import { createBackgroundServices } from './services';

const services = createBackgroundServices();
const router = createBackgroundMessageRouter(services);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    void services.injectScript(tabId, tab.url);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === services.alarmName) {
    void services.updateGeolocation();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  router.respond(request, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ status: 'error', message: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(services.alarmName, { periodInMinutes: 1 });
  createContextMenus();
  void services.initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(services.alarmName, { periodInMinutes: 1 });
  createContextMenus();
  void services.initializeExtension();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.siteSpoofConfig) {
    void services.initializeExtension();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(services, info, tab);
});
