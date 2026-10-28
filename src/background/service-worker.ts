import { createContextMenus, handleContextMenuClick } from './context-menu';
import { createBackgroundMessageRouter } from './message-router';
import { createBackgroundServices } from './services';

const services = createBackgroundServices();
const router = createBackgroundMessageRouter(services);

/** 出口坐标的刷新周期。改太短只会把 IP 归属地接口打到限流，而失败就是 fail-closed。 */
const LOCATION_ALARM_MINUTES = 5;

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  // runtime 由注册的内容脚本在 document_start 装上，这里不再注入任何脚本，
  // 只负责刷新角标与标题。
  if (changeInfo.status === 'complete') {
    void services.refreshActionBadge();
  }
});

chrome.tabs.onActivated.addListener(() => {
  void services.refreshActionBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === services.alarmName) {
    void services.updateGeolocation();
    return;
  }
  // 「跟随出口 IP」：出口换了才改配置，同 IP 直接跳过（见 ip-sync 的 planExitIpSync）。
  if (alarm.name === services.ipSyncAlarmName) {
    void services.checkExitIp();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  router.respond(request, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ status: 'error', message: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(services.alarmName, { periodInMinutes: LOCATION_ALARM_MINUTES });
  createContextMenus();
  void services.bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(services.alarmName, { periodInMinutes: LOCATION_ALARM_MINUTES });
  createContextMenus();
  void services.bootstrap();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  // 任何写入都先让内存快照失效，否则读取方会拿到旧值（尤其是 lastLocation）
  services.invalidateStorageCache();
  // 保存路径自己会应用一次；这里兜住其它写入方（导入、迁移、旧版本残留），
  // 同一份配置靠签名去重，且绝不触发 IP 定位。
  if (changes.siteSpoofConfig) {
    void services.applyConfig();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(services, info, tab);
});