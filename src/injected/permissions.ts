import type { GeolocationConfig } from '../shared/types';
import { getOriginals } from './utils';

export function installPermissionsSpoof(config: GeolocationConfig): void {
  if (!config.enabled || !config.spoofPermission) return;

  const originals = getOriginals();

  if (!navigator.permissions) {
    return;
  }

  const originalQuery = originals.permissionsQuery || navigator.permissions.query;

  navigator.permissions.query = function(permissionDesc: any) {
    if (permissionDesc && permissionDesc.name === 'geolocation') {
      return Promise.resolve({
        state: 'granted',
        name: 'geolocation',
        onchange: null,
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return true; }
      } as PermissionStatus);
    }

    return originalQuery.call(navigator.permissions, permissionDesc);
  };
}
