import type { RuntimePayload } from './types';

export function normalizeTimezonePayload(payload: RuntimePayload): { timezone: string | null } {
  const timezoneConfig = payload.timezoneConfig || { enabled: false, mode: 'auto', timezone: '' };
  const timezone = timezoneConfig.enabled === false
    ? null
    : timezoneConfig.mode === 'manual' && timezoneConfig.timezone
      ? timezoneConfig.timezone
      : payload.timezone || null;
  return { timezone };
}
