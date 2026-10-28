export interface PresetTarget {
  id: string;
  name: string;
  description: string;
  geolocation: { latitude: number; longitude: number; accuracy: number; country: string };
  language: { language: string; languages: string[]; acceptLanguage: string };
  timezone: { timezone: string };
}

export function parsePresets(source: string): PresetTarget[];
export function readPresets(root: string): PresetTarget[];