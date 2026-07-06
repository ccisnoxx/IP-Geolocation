(function() {
  const key = '__vanishGeoBridgeReady';
  const globalWindow = window as typeof window & Record<string, boolean>;
  if (globalWindow[key]) return;
  globalWindow[key] = true;

  function postPayload(payload: unknown): void {
    window.postMessage({
      source: 'vanishgeo-extension',
      type: 'apply-spoof',
      payload
    }, '*');
  }

  function requestPayload(): void {
    chrome.runtime.sendMessage({ action: 'getPayloadForUrl', url: window.location.href }, (response) => {
      if (chrome.runtime.lastError || !response || response.status === 'error') return;
      if (response.matched && response.payload) {
        postPayload(response.payload);
      }
    });
  }

  requestPayload();
})();
