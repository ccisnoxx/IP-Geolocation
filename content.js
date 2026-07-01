// Isolated-world bridge: posts a spoof payload only when the current host is allowlisted.
(function() {
  chrome.storage.local.get(null, (data) => {
    const config = IPGeoConfig.migrateLegacyConfig(data);
    const lastLocation = data[IPGeoConfig.LAST_LOCATION_KEY] || null;
    const resolved = IPGeoConfig.getEffectiveProfile(config, window.location.hostname, lastLocation);
    if (!resolved.matched || !resolved.payload) return;

    window.postMessage({
      source: 'ip-geolocation-extension',
      type: 'apply-spoof',
      payload: resolved.payload
    }, '*');
  });
})();
