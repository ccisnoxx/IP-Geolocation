// Main-world spoof payload application helpers.
(function(root) {
  function applySpoof(payload) {
    if (!payload) return;
    if (payload.extensionEnabled === false || payload.enabled === false) return;

    const geolocation = payload.geolocation || (
      Number.isFinite(Number(payload.latitude)) && Number.isFinite(Number(payload.longitude))
        ? { latitude: Number(payload.latitude), longitude: Number(payload.longitude) }
        : null
    );
    const latitude = geolocation ? Number(geolocation.latitude) : NaN;
    const longitude = geolocation ? Number(geolocation.longitude) : NaN;
    const timezonePayload = root.IPGeoSpoofDateTime.normalizeTimezonePayload(payload);
    const languageConfig = payload.languageConfig && payload.languageConfig.enabled ? payload.languageConfig : null;
    const spoofLanguage = languageConfig && languageConfig.language ? languageConfig.language : null;
    const spoofLanguages = languageConfig && Array.isArray(languageConfig.languages) && languageConfig.languages.length
      ? languageConfig.languages
      : spoofLanguage ? [spoofLanguage] : null;

    if (spoofLanguage) {
      Object.defineProperty(navigator, 'language', {
        get: () => spoofLanguage,
        configurable: true
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => spoofLanguages,
        configurable: true
      });
    }

    if (Number.isFinite(latitude) && Number.isFinite(longitude) && root.IPGeoSpoofGeolocation) {
      const geoController = root.IPGeoSpoofGeolocation.createGeolocationController({
        latitude,
        longitude
      });
      navigator.geolocation.getCurrentPosition = (successCallback, errorCallback, options) => {
        geoController.getCurrentPosition(successCallback, errorCallback, options);
      };
      navigator.geolocation.watchPosition = (successCallback, errorCallback, options) => {
        return geoController.watchPosition(successCallback, errorCallback, options);
      };
      navigator.geolocation.clearWatch = (watchId) => {
        return geoController.clearWatch(watchId);
      };
      root.__ipGeoGeolocationController = geoController;
    }

    const patchConfig = {
      timezone: timezonePayload.timezone,
      language: spoofLanguage
    };
    root.IPGeoSpoofDateTime.installDateTimeSpoof(patchConfig);
    root.IPGeoSpoofWorkers.installWorkerHooks(
      root.IPGeoSpoofWorkers.buildTimezonePatchSource(patchConfig)
    );
  }

  function bindMessageListener() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'ip-geolocation-extension' || data.type !== 'apply-spoof') return;
      applySpoof(data.payload);
    });
  }

  root.IPGeoSpoofApply = {
    applySpoof,
    bindMessageListener
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
