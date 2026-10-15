import type { RuntimePayload, AntiDetectionState } from '../types';
import { createNativeProxyFunction, defineRegisteredProperty, replaceMethod } from '../registry';

export function randomCoordinateInRadius(lat: number, lon: number, radiusMeters: number) {
  if (radiusMeters <= 0) return { latitude: lat, longitude: lon };
  const earthRadius = 6371000;
  const distance = Math.random() * radiusMeters;
  const bearing = Math.random() * 2 * Math.PI;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distance / earthRadius)
    + Math.cos(lat1) * Math.sin(distance / earthRadius) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distance / earthRadius) * Math.cos(lat1),
    Math.cos(distance / earthRadius) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    latitude: Math.max(-90, Math.min(90, (lat2 * 180) / Math.PI)),
    longitude: (((lon2 * 180) / Math.PI) + 540) % 360 - 180
  };
}

export function getStableGeolocationCoordinate(realmState: AntiDetectionState, geolocation: NonNullable<RuntimePayload['geolocation']>) {
  const latitude = Number(geolocation.latitude);
  const longitude = Number(geolocation.longitude);
  const radius = Number(geolocation.randomRadiusMeters) > 0 ? Number(geolocation.randomRadiusMeters) : 0;
  const key = [
    latitude,
    longitude,
    geolocation.randomize === true,
    radius
  ].join('|');

  if (realmState.values.geolocationCoordinate?.key === key) {
    return realmState.values.geolocationCoordinate;
  }

  const coordinate = geolocation.randomize && radius > 0
    ? randomCoordinateInRadius(latitude, longitude, radius)
    : { latitude, longitude };
  realmState.values.geolocationCoordinate = { key, ...coordinate };
  return realmState.values.geolocationCoordinate;
}

export function buildGeolocationPosition(
  globals: typeof globalThis & Record<string, any>,
  realmState: AntiDetectionState,
  geolocation: NonNullable<RuntimePayload['geolocation']>
) {
  const coordinate = getStableGeolocationCoordinate(realmState, geolocation);
  const latitude = coordinate.latitude;
  const longitude = coordinate.longitude;
  return {
    coords: {
      latitude,
      longitude,
      accuracy: Number.isFinite(Number(geolocation.accuracy)) ? Number(geolocation.accuracy) : 50,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    },
    timestamp: globals.Date ? globals.Date.now() : Date.now()
  } as GeolocationPosition;
}

export function installGeolocationSpoof(
  globals: typeof globalThis & Record<string, any>,
  realmState: AntiDetectionState,
  geolocation: RuntimePayload['geolocation']
): void {
  realmState.values.geolocation = geolocation;
  if (!geolocation || !Number.isFinite(Number(geolocation.latitude)) || !Number.isFinite(Number(geolocation.longitude))) return;
  if (realmState.installedSurfaces.has('geolocation')) return;
  realmState.installedSurfaces.add('geolocation');

  const navigatorTarget = globals.navigator as Navigator & { geolocation?: Geolocation; permissions?: Permissions };
  if (!navigatorTarget) return;
  if (!navigatorTarget.geolocation) {
    defineRegisteredProperty(globals, realmState, navigatorTarget, 'geolocation', {
      value: {},
      configurable: true
    }, 'geolocation-permissions');
  }

  const watches = new Map<number, ReturnType<typeof setInterval>>();
  let nextWatchId = 1;
  const geo = navigatorTarget.geolocation as Geolocation;
  const geoPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, geo);
  const geoOwner = geoPrototype || geo;

  const getCurrentPosition = function getCurrentPosition(successCallback: PositionCallback, errorCallback?: PositionErrorCallback) {
    if (typeof successCallback !== 'function') {
      throw new TypeError('Geolocation success callback must be a function');
    }
    (globals.queueMicrotask || queueMicrotask)(() => {
      try {
        successCallback(buildGeolocationPosition(globals, realmState, realmState.values.geolocation as NonNullable<RuntimePayload['geolocation']>));
      } catch {
        errorCallback?.({
          code: 2,
          message: 'Position unavailable',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3
        } as GeolocationPositionError);
      }
    });
  };

  const watchPosition = function watchPosition(successCallback: PositionCallback, errorCallback?: PositionErrorCallback) {
    if (typeof successCallback !== 'function') {
      throw new TypeError('Geolocation success callback must be a function');
    }
    const watchId = nextWatchId;
    nextWatchId += 1;
    const intervalId = globals.setInterval(() => {
      try {
        successCallback(buildGeolocationPosition(globals, realmState, realmState.values.geolocation as NonNullable<RuntimePayload['geolocation']>));
      } catch {
        errorCallback?.({
          code: 2,
          message: 'Position unavailable',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3
        } as GeolocationPositionError);
      }
    }, 3000);
    watches.set(watchId, intervalId);
    (globals.queueMicrotask || queueMicrotask)(() => {
      if (watches.has(watchId)) successCallback(buildGeolocationPosition(globals, realmState, realmState.values.geolocation as NonNullable<RuntimePayload['geolocation']>));
    });
    return watchId;
  };

  const clearWatch = function clearWatch(watchId: number) {
    const intervalId = watches.get(watchId);
    if (intervalId === undefined) return;
    globals.clearInterval(intervalId);
    watches.delete(watchId);
  };

  replaceMethod(globals, realmState, geoOwner, 'getCurrentPosition', getCurrentPosition, 'geolocation-permissions');
  replaceMethod(globals, realmState, geoOwner, 'watchPosition', watchPosition, 'geolocation-permissions');
  replaceMethod(globals, realmState, geoOwner, 'clearWatch', clearWatch, 'geolocation-permissions');

  const createGrantedPermissionStatus = (nativeStatus?: PermissionStatus): PermissionStatus => {
    if (nativeStatus && typeof globals.Proxy === 'function') {
      return new globals.Proxy(nativeStatus, {
        get(target: PermissionStatus, property: PropertyKey, receiver: unknown) {
          if (property === 'state') return 'granted';
          if (property === 'name') return 'geolocation';
          return (globals.Reflect || Reflect).get(target, property, receiver);
        }
      });
    }

    const status = typeof globals.EventTarget === 'function'
      ? new globals.EventTarget()
      : {};
    const permissionPrototype = globals.PermissionStatus?.prototype;
    if (permissionPrototype) {
      try {
        realmState.originals.objectSetPrototypeOf.call(globals.Object || Object, status, permissionPrototype);
      } catch {}
    }
    realmState.originals.objectDefineProperty.call(globals.Object || Object, status, 'state', {
      configurable: true,
      enumerable: true,
      value: 'granted'
    });
    realmState.originals.objectDefineProperty.call(globals.Object || Object, status, 'name', {
      configurable: true,
      enumerable: true,
      value: 'geolocation'
    });
    realmState.originals.objectDefineProperty.call(globals.Object || Object, status, 'onchange', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: null
    });
    return status as PermissionStatus;
  };

  if (geolocation.spoofPermission !== false && navigatorTarget.permissions) {
    const permissions = navigatorTarget.permissions;
    const permissionsPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, permissions);
    const prototypeDescriptor = permissionsPrototype
      ? realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, permissionsPrototype, 'query')
      : undefined;
    const ownDescriptor = realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, permissions, 'query');
    const queryOwner = prototypeDescriptor ? permissionsPrototype : permissions;
    const originalDescriptor = prototypeDescriptor || ownDescriptor;
    const originalQuery = originalDescriptor && typeof originalDescriptor.value === 'function'
      ? originalDescriptor.value
      : permissions.query;
    if (typeof originalQuery === 'function') {
      const query = createNativeProxyFunction(globals, realmState, originalQuery, (target, thisArg, args) => {
        const permissionDesc = args[0] as PermissionDescriptor | undefined;
        if (permissionDesc && permissionDesc.name === 'geolocation') {
          return Promise.resolve(realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args))
            .then((nativeStatus) => createGrantedPermissionStatus(nativeStatus as PermissionStatus))
            .catch(() => createGrantedPermissionStatus());
        }
        return realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args);
      });
      defineRegisteredProperty(globals, realmState, queryOwner, 'query', {
        ...(originalDescriptor || { configurable: true, enumerable: false, writable: true }),
        value: query
      }, 'geolocation-permissions', originalDescriptor);
    }
  }
}
