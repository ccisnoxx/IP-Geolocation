import type { FontRuntimePayload, GeolocationPayload, LanguageTimezonePayload } from '../../shared/types';
import type { RuntimeGlobals } from './types';

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('页面更新对象无效');
  return value as Record<string, any>;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError('页面更新列表无效');
  return value.slice();
}

export function parseFontUpdate(value: unknown): FontRuntimePayload | null {
  if (value === null) return null;
  const data = object(value);
  if (typeof data.enabled !== 'boolean' || !['vendor-software', 'custom', 'layered'].includes(data.mode)) throw new TypeError('字体更新模式无效');
  const result: FontRuntimePayload = { enabled: data.enabled, mode: data.mode, blockedFamilies: strings(data.blockedFamilies) };
  if (data.mode === 'layered') {
    const layers = object(data.layers);
    if (!['auto', 'none'].includes(layers.platform) || typeof layers.hideCjkFonts !== 'boolean') throw new TypeError('字体层设置无效');
    result.layers = { platform: layers.platform, hideCjkFonts: layers.hideCjkFonts };
  }
  if (data.canvasSpoof !== undefined) {
    const canvas = object(data.canvasSpoof);
    if (typeof canvas.enabled !== 'boolean' || !['macos', 'windows'].includes(canvas.platform)) throw new TypeError('Canvas字体更新无效');
    result.canvasSpoof = { enabled: canvas.enabled, platform: canvas.platform };
  }
  return result;
}

export function parseGeolocationUpdate(value: unknown): GeolocationPayload | null {
  if (value === null) return null;
  const data = object(value);
  if (data.unavailable === true) return { unavailable: true };
  if (!Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90 || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180
    || !Number.isFinite(data.accuracy) || data.accuracy <= 0 || !Number.isFinite(data.randomRadiusMeters) || data.randomRadiusMeters < 0
    || typeof data.randomize !== 'boolean' || typeof data.spoofPermission !== 'boolean') throw new TypeError('定位更新值无效');
  return { latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy,
    randomRadiusMeters: data.randomRadiusMeters, randomize: data.randomize, spoofPermission: data.spoofPermission };
}

export function createPageUpdateParser(root: RuntimeGlobals): (value: unknown) => LanguageTimezonePayload | null {
  // 捕获安装前原生构造器，不能用已被strict策略替换的构造器验证时区。
  const DateTimeFormat = root.Intl.DateTimeFormat;
  const canonicalLocales = root.Intl.getCanonicalLocales;
  return value => {
    if (value === null) return null;
    const data = object(value);
    if (!['strict', 'compatible'].includes(data.intlMode)) throw new TypeError('Intl更新模式无效');
    const result: LanguageTimezonePayload = { intlMode: data.intlMode };
    if (data.language !== undefined) {
      const language = object(data.language);
      if (typeof language.language !== 'string' || !language.language) throw new TypeError('页面更新语言无效');
      const languages = strings(language.languages);
      if (languages.length > 1000 || languages.some(item => !item)) throw new TypeError('页面更新语言列表无效');
      canonicalLocales([language.language, ...languages]);
      result.language = { language: language.language, languages: languages.length ? languages : [language.language] };
    }
    if (data.timezone !== undefined) {
      if (typeof data.timezone !== 'string' || !data.timezone || /^[+-]/.test(data.timezone)) throw new TypeError('页面更新时区无效');
      new DateTimeFormat('en-US', { timeZone: data.timezone });
      result.timezone = data.timezone;
    }
    if (data.blockedFonts !== undefined) result.blockedFonts = strings(data.blockedFonts);
    if (data.fontPolicy !== undefined) {
      const policy = parseFontUpdate(data.fontPolicy);
      if (!policy) throw new TypeError('页面字体策略无效');
      result.fontPolicy = policy;
    }
    return result;
  };
}
