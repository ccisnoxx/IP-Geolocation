// ISOLATED world 仅通知后台初始化当前文档，不读取页面提供的数据。
chrome.runtime.sendMessage({ action: 'initializeRuntimeForSender' }, () => {
  void chrome.runtime.lastError;
});
