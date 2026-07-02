// Main-world geolocation behavior model helpers.
(function(root) {
  const WATCH_CLEARED = Symbol('watchCleared');

  function buildGeolocationError(code, message) {
    return {
      code,
      message: String(message || ''),
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3
    };
  }

  function buildGeolocationSuccessPayload(geolocation) {
    const latitude = Number(geolocation && geolocation.latitude);
    const longitude = Number(geolocation && geolocation.longitude);
    return {
      coords: {
        latitude,
        longitude,
        accuracy: 20 + Math.random() * 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: Date.now()
    };
  }

  function createGeolocationController(geolocation) {
    const watches = new Map();
    let nextWatchId = 1;
    let forcedError = null;

    function setForcedError(errorLike) {
      if (!errorLike) {
        forcedError = null;
        return;
      }
      forcedError = buildGeolocationError(
        Number.isFinite(Number(errorLike.code)) ? Number(errorLike.code) : 2,
        errorLike.message || 'Geolocation error'
      );
    }

    function clearForcedError() {
      forcedError = null;
    }

    function getCurrentPosition(successCallback, errorCallback) {
      if (forcedError) {
        if (typeof errorCallback === 'function') errorCallback(forcedError);
        return;
      }

      if (typeof successCallback === 'function') {
        successCallback(buildGeolocationSuccessPayload(geolocation));
      }
    }

    function watchPosition(successCallback, errorCallback) {
      const watchId = nextWatchId;
      nextWatchId += 1;

      const callbackRecord = {
        successCallback,
        errorCallback
      };
      watches.set(watchId, callbackRecord);

      queueMicrotask(() => {
        const active = watches.get(watchId);
        if (!active || active === WATCH_CLEARED) return;
        if (forcedError) {
          if (typeof active.errorCallback === 'function') active.errorCallback(forcedError);
          return;
        }
        if (typeof active.successCallback === 'function') {
          active.successCallback(buildGeolocationSuccessPayload(geolocation));
        }
      });

      return watchId;
    }

    function clearWatch(watchId) {
      if (!watches.has(watchId)) return false;
      watches.set(watchId, WATCH_CLEARED);
      watches.delete(watchId);
      return true;
    }

    function snapshot() {
      return {
        hasForcedError: Boolean(forcedError),
        activeWatchIds: Array.from(watches.keys()),
        nextWatchId
      };
    }

    return {
      setForcedError,
      clearForcedError,
      getCurrentPosition,
      watchPosition,
      clearWatch,
      snapshot
    };
  }

  const api = {
    buildGeolocationError,
    buildGeolocationSuccessPayload,
    createGeolocationController
  };

  root.IPGeoSpoofGeolocation = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
