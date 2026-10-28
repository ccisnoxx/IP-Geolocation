import type { ExitLocationProfile } from './types';
import { recommendExitEnvironment } from './exit-recommendation';

/** 一键环境预设：把经纬度、语言、时区当作一个整体切换，避免三处各填一半。 */
export interface EnvironmentPreset {
  id: 'singapore' | 'japan-tokyo' | 'us-los-angeles' | 'germany-berlin' | 'china-shanghai' | 'us-new-york';
  /** 卡片与下拉里的旗帜图标，和上游项目一致。 */
  flag: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  country: string;
  language: string;
  languages: string[];
  timezone: string;
}

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: 'singapore', flag: '🇸🇬', name: '新加坡', description: '新加坡 · en-SG',
    latitude: 1.3521, longitude: 103.8198, country: 'Singapore',
    language: 'en-SG', languages: ['en-SG', 'en', 'zh-CN', 'zh'], timezone: 'Asia/Singapore'
  },
  {
    id: 'japan-tokyo', flag: '🇯🇵', name: '日本 · 东京', description: '东京 · ja-JP',
    latitude: 35.6762, longitude: 139.6503, country: 'Japan',
    language: 'ja-JP', languages: ['ja-JP', 'ja', 'en-US', 'en'], timezone: 'Asia/Tokyo'
  },
  {
    id: 'us-los-angeles', flag: '🇺🇸', name: '美国 · 洛杉矶', description: '洛杉矶 · en-US',
    latitude: 34.0522, longitude: -118.2437, country: 'United States',
    language: 'en-US', languages: ['en-US', 'en'], timezone: 'America/Los_Angeles'
  },
  {
    id: 'germany-berlin', flag: '🇩🇪', name: '德国 · 柏林', description: '柏林 · de-DE',
    latitude: 52.52, longitude: 13.405, country: 'Germany',
    language: 'de-DE', languages: ['de-DE', 'de', 'en-US', 'en'], timezone: 'Europe/Berlin'
  },
  {
    id: 'china-shanghai', flag: '🇨🇳', name: '中国 · 上海', description: '上海 · zh-CN',
    latitude: 31.2304, longitude: 121.4737, country: 'China',
    language: 'zh-CN', languages: ['zh-CN', 'zh', 'en-US', 'en'], timezone: 'Asia/Shanghai'
  },
  {
    id: 'us-new-york', flag: '🇺🇸', name: '美国 · 纽约', description: '纽约 · en-US',
    latitude: 40.7128, longitude: -74.006, country: 'United States',
    language: 'en-US', languages: ['en-US', 'en'], timezone: 'America/New_York'
  }
];

export function findEnvironmentPreset(id: string): EnvironmentPreset | null {
  return ENVIRONMENT_PRESETS.find(preset => preset.id === id) || null;
}

export interface QuickSetSignals {
  latitude: number;
  longitude: number;
  timezone: string;
  language: string;
  languages: string[];
  accuracy?: number;
  country?: string;
}

export function presetSignals(preset: EnvironmentPreset): QuickSetSignals {
  return {
    latitude: preset.latitude, longitude: preset.longitude, timezone: preset.timezone,
    language: preset.language, languages: [...preset.languages], country: preset.country
  };
}

/**
 * 从已确认出口档案推导快速设置信号：坐标与时区来自同一次检测；
 * 语言只用地区常用候选，取不到就保留现有语言（不按国家名猜）。
 */
export function exitProfileSignals(
  profile: ExitLocationProfile,
  current: { language: string; languages: string[] }
): QuickSetSignals | null {
  if (profile.verification !== 'verified') return null;
  const recommendation = recommendExitEnvironment(profile);
  const language = recommendation.language.value;
  return {
    latitude: profile.latitude,
    longitude: profile.longitude,
    timezone: recommendation.timezone.value || profile.timezone || '',
    language: language?.language || current.language,
    languages: language?.languages?.length ? [...language.languages] : [...current.languages],
    country: profile.country
  };
}
