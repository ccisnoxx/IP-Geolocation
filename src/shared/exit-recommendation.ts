import { normalizeCountryCode, normalizeFontExposure, normalizeLanguage, validateTimezone } from './config-model';
import type { ExitEnvironmentRecommendation, ExitLocationProfile } from './types';

// 地区常用候选，不代表个人语言偏好；未维护的地区不猜测默认语言。
const REGION_LOCALES: Readonly<Record<string, string>> = {
  US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ', IE: 'en-IE',
  CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK', JP: 'ja-JP', KR: 'ko-KR', SG: 'en-SG',
  DE: 'de-DE', FR: 'fr-FR', ES: 'es-ES', IT: 'it-IT', NL: 'nl-NL', PT: 'pt-PT', BR: 'pt-BR'
};

export function recommendExitEnvironment(profile: ExitLocationProfile): ExitEnvironmentRecommendation {
  const verified = profile.verification === 'verified';
  const countryCode = normalizeCountryCode(profile.countryCode);
  const locale = verified && countryCode ? REGION_LOCALES[countryCode] : undefined;
  const timezone = verified && profile.timezone && validateTimezone(profile.timezone) ? profile.timezone : null;
  return {
    profileId: profile.id,
    verifiedAt: verified ? profile.verifiedAt : null,
    countryCode,
    timezone: {
      value: timezone,
      confidence: timezone ? 'provider-reported' : 'unknown',
      reason: timezone ? '来自已确认的同一次 IP 定位响应；单一服务声明，未交叉验证，不证明实际所在位置。' : '缺少已确认的有效时区，不根据国家或坐标猜测。'
    },
    language: {
      value: locale ? normalizeLanguage({ enabled: true, mode: 'custom', language: locale, languages: [locale, locale.split('-')[0]] }) : null,
      reason: locale ? '地区常用语言候选；多语言地区仅列出一个示例，不代表个人偏好，默认保留现有语言设置。' : '国家代码未知、档案未验证或该地区没有维护候选；保留现有语言设置。'
    },
    fontExposure: {
      value: normalizeFontExposure({ enabled: true, mode: 'vendor-software' }),
      reason: '可选内置厂商／软件及27项简繁中文字体探测过滤；可能影响文本测量和站点排版。固定内置名单仅在已启用HTTP(S)规则上注册，自定义及三层名单也可注册，需要允许用户脚本；旧版本文档需完整重建。'
    },
    webRtc: {
      value: 'compatible',
      reason: '建议 compatible（仅公网接口），可能影响通话兼容性；不保证代理出口一致。全局策略需另行明确选择。'
    }
  };
}
