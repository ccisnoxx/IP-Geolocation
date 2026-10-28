// 字表移植自同仓库 MIT release/1.3.1（5b61905）；许可及署名随 LICENSE / NOTICE 分发。
import type { FontExposureConfig } from './types';
export type FontPlatform = 'mac' | 'windows' | 'linux';

export const PLATFORM_FONTS: Record<FontPlatform, readonly string[]> = {
  mac: [
    // 中文
    'PingFang SC', 'PingFang TC', 'PingFang HK', 'Hiragino Sans GB',
    'STHeiti', 'STSong', 'Songti SC',
    // 日文 / 韩文
    'Hiragino Kaku Gothic ProN', 'Hiragino Mincho ProN', 'Apple SD Gothic Neo',
    // 拉丁
    'Helvetica Neue', 'SF Pro Text', 'SF Pro Display', 'Menlo', 'Monaco',
    'Geneva', 'Lucida Grande', 'Avenir Next', 'Baskerville', 'Optima'
  ],
  windows: [
    // 中文
    'Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'NSimSun', 'SimHei',
    'KaiTi', 'FangSong', 'DengXian',
    'Microsoft JhengHei', 'PMingLiU', 'MingLiU', 'DFKai-SB',
    // 日文 / 韩文
    'Yu Gothic', 'Meiryo', 'MS Gothic', 'MS Mincho', 'Malgun Gothic',
    // 拉丁
    'Segoe UI', 'Segoe UI Semibold', 'Calibri', 'Cambria', 'Candara',
    'Consolas', 'Lucida Console', 'Sylfaen'
  ],
  linux: [
    // 中文
    'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei', 'Droid Sans Fallback',
    // 桌面发行版常见
    'Ubuntu', 'Ubuntu Mono', 'Cantarell', 'Fira Sans', 'DejaVu Sans',
    'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans', 'Liberation Serif',
    'Liberation Mono', 'Noto Sans CJK JP', 'Noto Sans Mono'
  ]
};

/** 中文 / 国产厂商字体：与平台无关，属于"中文环境"这一类信号 */
export const CJK_VENDOR_FONTS: readonly string[] = [
  // Windows 简体
  'Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'NSimSun', 'SimHei',
  'KaiTi', 'FangSong', 'DengXian',
  // macOS
  'PingFang SC', 'PingFang MO', 'Hiragino Sans GB', 'STHeiti', 'STSong', 'Songti SC',
  // 开源 CJK
  'Source Han Sans CN', 'Source Han Sans SC', 'Source Han Sans TW',
  'Noto Sans CJK SC', 'Noto Sans CJK TC', 'Noto Serif CJK SC',
  'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei',
  // 繁体
  'Microsoft JhengHei', 'PMingLiU', 'MingLiU', 'DFKai-SB',
  'PingFang TC', 'PingFang HK',
  // 国产厂商 / 软件自带
  'MiSans', 'MIUI', 'HarmonyOS Sans SC', 'HarmonyOS Sans', 'HONOR Sans',
  'OPPO Sans', 'vivo Sans', 'Alibaba PuHuiTi', 'Alibaba Sans',
  'DingTalk JinBuTi', 'Douyin Sans',
  'HYQiHei', 'FZShuSong-Z01S', 'FZKai-Z03S', 'FZHei-B01S', 'FZFangSong-Z02S'
];

export function detectFontPlatform(navigator: { userAgentData?: { platform?: string }; platform?: string }): FontPlatform | null {
  const raw = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (raw.includes('mac')) return 'mac';
  if (raw.includes('win')) return 'windows';
  if (raw.includes('linux') || raw.includes('x11') || raw.includes('bsd')) return 'linux';
  return null;
}

export function resolveFontFamilies(config: Pick<FontExposureConfig, 'enabled' | 'mode' | 'blockedFamilies' | 'layers'>,
  navigator: { userAgentData?: { platform?: string }; platform?: string }): string[] {
  if (!config.enabled) return [];
  if (config.mode !== 'layered') return config.blockedFamilies.slice();
  const layers = config.layers!;
  const platform = layers.platform === 'auto' ? detectFontPlatform(navigator) : null;
  const families = [
    ...(platform ? (Object.keys(PLATFORM_FONTS) as FontPlatform[]).filter(item => item !== platform).flatMap(item => PLATFORM_FONTS[item]) : []),
    ...(layers.hideCjkFonts ? CJK_VENDOR_FONTS : []),
    ...config.blockedFamilies
  ];
  const seen = new Set<string>();
  return families.filter(family => {
    const key = family.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
