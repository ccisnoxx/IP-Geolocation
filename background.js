importScripts(
  'shared/config-base.js',
  'shared/config-profile.js',
  'config.js',
  'shared/runtime.js',
  'shared/diagnostic.js',
  'background/services.js',
  'background/message-router.js'
);

// Service-worker entrypoint: listeners and startup wiring only.
const backgroundServices = IPGeoBackgroundServices.create(chrome);
const backgroundRouter = IPGeoBackgroundMessageRouter.create(backgroundServices);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    backgroundServices.injectScript(tabId, tab.url);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === backgroundServices.alarmName) {
    backgroundServices.updateGeolocation();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  backgroundRouter.respond(request, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ status: 'error', message: error.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(backgroundServices.alarmName, { periodInMinutes: 1 });
  backgroundServices.initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(backgroundServices.alarmName, { periodInMinutes: 1 });
  backgroundServices.initializeExtension();
});
