export interface PresetTarget {
  id: string;
  name: string;
  description: string;
  geolocation: { latitude: number; longitude: number; accuracy: number; country: string };
  language: { language: string; languages: string[]; acceptLanguage: string };
  timezone: { timezone: string };
}

/** 与 src/shared/config-model.ts 的 DEFAULT_GEOLOCATION.accuracy 同源。 */
export const DEFAULT_PRESET_ACCURACY: number;

export function parsePresets(source: string): PresetTarget[];
export function readPresets(root: string): PresetTarget[];