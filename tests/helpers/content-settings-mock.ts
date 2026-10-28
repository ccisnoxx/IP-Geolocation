import { domainMatches } from '../../src/shared/config-resolver';

export function createContentSettingsMock() {
  const rules = new Map<string, string>();
  const calls: Array<{ action: string; details: Record<string, unknown> }> = [];
  return { rules, calls, api: {
    clear: async (details: Record<string, unknown>) => { calls.push({ action: 'clear', details }); rules.clear(); },
    set: async (details: { primaryPattern: string; setting: string }) => { calls.push({ action: 'set', details }); rules.set(details.primaryPattern, details.setting); },
    get: async ({ primaryUrl }: { primaryUrl: string }) => {
      const url = new URL(primaryUrl);
      const candidates = [...rules].filter(([pattern]) => {
        const hostname = pattern.split('://')[1].slice(0, -2);
        return hostname.startsWith('*.') ? domainMatches(url.hostname, hostname.slice(2)) : url.hostname === hostname;
      }).sort(([a], [b]) => b.replace('*.', '').length - a.replace('*.', '').length);
      return { setting: candidates[0]?.[1] || 'ask' };
    }
  } };
}
