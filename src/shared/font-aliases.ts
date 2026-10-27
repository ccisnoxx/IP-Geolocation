/**
 * 字体族别名表：同一个物理字体在 CSS 里有多个名字。
 *
 * 为什么需要这张表：`targetFonts` 里写的是拉丁名字（`PingFang SC`），但检测脚本
 * 完全可以用**本地化名字**去量宽度 —— `苹方-简`、`微软雅黑`、`思源黑体`。Chromium
 * 内部会把本地化名字解析到同一个字体，所以只按拉丁名匹配的补丁会漏掉一整类探测，
 * 而这类探测恰好是最常见的（中文检测站基本都这么写）。
 *
 * 匹配键的归一化规则见 {@link normalizeFontFamily}：去引号、压空白、小写、去掉
 * 尾随字重。`PingFang SC Light` 和 `PingFang SC` 归一化后是同一个键 —— Chromium
 * 把前者当作独立字体族解析，检测方换成字重写一遍就能绕过按名字精确匹配的实现。
 */

import type { CanvasConfig, CanvasPlatform } from './types';

/** 每一组是同一个物理字体的所有已知写法（顺序无关） */
const FONT_FAMILY_GROUPS: string[][] = [
  // ---------- Windows 简体 ----------
  ['Microsoft YaHei', '微软雅黑'],
  ['Microsoft YaHei UI', '微软雅黑 UI'],
  ['SimSun', '宋体', '中易宋体'],
  ['NSimSun', '新宋体'],
  ['SimHei', '黑体', '中易黑体'],
  ['KaiTi', '楷体', '楷体_GB2312', '中易楷体'],
  ['FangSong', '仿宋', '仿宋_GB2312', '中易仿宋'],
  ['DengXian', '等线'],

  // ---------- macOS ----------
  ['PingFang SC', '苹方-简', '苹方', '苹方简体'],
  ['PingFang TC', '苹方-繁', '苹方繁體'],
  ['PingFang HK', '苹方-港'],
  // 蒙古文变体：macOS 自带，属于同一个苹方家族。漏掉它就会出现"苹方-简 不存在、
  // 但 PingFang MO 存在"这种真机不会有的组合
  ['PingFang MO'],
  ['Hiragino Sans GB', '冬青黑体简体中文', 'ヒラギノ角ゴシック GB'],
  ['STHeiti', '华文黑体'],
  ['STSong', '华文宋体'],
  ['Songti SC', '宋体-简', '宋體'],

  // ---------- 繁体 ----------
  ['Microsoft JhengHei', '微軟正黑體', '微软正黑体'],
  ['PMingLiU', '新細明體', '新细明体'],
  ['MingLiU', '細明體', '细明体'],
  ['DFKai-SB', '標楷體', '标楷体'],

  // ---------- 开源 CJK ----------
  // Source Han 与 Noto CJK 是同一套字（Adobe / Google 两个发行名），CN / SC 也是
  // 同一种命名习惯，所以简体这一组必须合在一起：声明 'Source Han Sans SC' 之后，
  // 检测方用 '思源黑体' 或 'Noto Sans CJK SC' 探测都要命中。
  ['Source Han Sans CN', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Noto Sans CJK',
    '思源黑体', '思源黑體', '思源黑体 CN', '思源黑体 SC'],
  ['Source Han Sans TW', 'Noto Sans CJK TC', '思源黑體 TC', '思源黑體 TW'],
  ['Source Han Serif SC', 'Noto Serif CJK SC', '思源宋体', '思源宋體'],
  ['WenQuanYi Micro Hei', '文泉驿微米黑'],
  ['WenQuanYi Zen Hei', '文泉驿正黑'],

  // ---------- 国产厂商 ----------
  ['MiSans', '小米兰亭', 'MiLanPro'],
  ['MIUI', '小米兰亭 Pro'],
  ['HarmonyOS Sans SC', '鸿蒙黑体', 'HarmonyOS Sans'],
  ['HONOR Sans', '荣耀字体'],
  ['OPPO Sans'],
  ['vivo Sans'],
  ['Alibaba PuHuiTi', '阿里巴巴普惠体'],
  ['Alibaba Sans', '阿里巴巴普惠体'],
  ['DingTalk JinBuTi', '钉钉进步体'],
  ['Douyin Sans', '抖音美好体'],
  ['HYQiHei', '汉仪旗黑'],
  ['FZShuSong-Z01S', '方正书宋'],
  ['FZKai-Z03S', '方正楷体'],
  ['FZHei-B01S', '方正黑体'],
  ['FZFangSong-Z02S', '方正仿宋'],
  ['Founder Sans', '方正'],
  ['HarmonyOS Sans TC', '鴻蒙黑體'],

  // ---------- 日文（同属 CJK 兜底，检测方会顺带问一句） ----------
  ['Hiragino Kaku Gothic ProN', 'ヒラギノ角ゴ ProN'],
  ['Yu Gothic', '游ゴシック', 'YuGothic'],
  ['Meiryo', 'メイリオ'],
  ['MS Gothic', 'ＭＳ ゴシック'],
  ['MS Mincho', 'ＭＳ 明朝']
];

/** 尾随字重：`PingFang SC Light` 在 Chromium 里是独立的字体族名 */
const WEIGHT_SUFFIX = /\s*(?:w[1-9]|ultra\s*light|extra\s*light|demilight|demi\s*light|light|thin|hairline|book|regular|normal|roman|medium|semibold|semi\s*bold|demibold|demi\s*bold|bold|extrabold|extra\s*bold|heavy|black|ultra)$/;

/**
 * 归一化字体族名，用于比较。
 *
 * - 去首尾引号、压空白、转小写、去所有空白（`PingFang SC` === `PingFangSC`）
 * - 去掉尾随字重（`PingFang SC Light` → `pingfangsc`）
 * - 保留 CJK 字符本身：本地化名字是另一套独立键，靠别名表连起来
 */
export function normalizeFontFamily(family: string): string {
  const stripped = family
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/["']/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const withoutWeight = stripped.replace(WEIGHT_SUFFIX, '');
  return (withoutWeight || stripped).replace(/\s+/g, '');
}

let aliasIndex: Map<string, string[]> | null = null;

/**
 * 别名索引：归一化名字 → 同组所有归一化名字。
 *
 * 惰性构建一次。用 `null` 而不是 `undefined` 作为哨兵，避免每次调用都
 * 重新判断 `=== undefined`（构建成本虽小，但它在每次 measureText 里都会用到）。
 */
function getAliasIndex(): Map<string, string[]> {
  if (aliasIndex) return aliasIndex;
  const index = new Map<string, string[]>();
  for (const group of FONT_FAMILY_GROUPS) {
    const keys = [...new Set(group.map(normalizeFontFamily))];
    for (const key of keys) index.set(key, keys);
  }
  aliasIndex = index;
  return index;
}

/**
 * 把 `targetFonts` 展开成匹配键集合。
 *
 * 声明里出现的每个名字，连同它同组的所有别名，都会进入集合 —— 这样检测方用
 * `苹方-简` 还是 `PingFang SC` 探测，命中的都是同一把锁。
 */
export function buildTargetFontKeys(targetFonts: readonly string[]): Set<string> {
  const index = getAliasIndex();
  const keys = new Set<string>();
  for (const family of targetFonts) {
    if (!family) continue;
    const key = normalizeFontFamily(family);
    if (!key) continue;
    keys.add(key);
    const group = index.get(key);
    if (group) for (const alias of group) keys.add(alias);
  }
  return keys;
}

/** 判断一个被探测的字体族是否在被伪装集合里 */
export function isTargetFontFamily(family: string, keys: ReadonlySet<string>): boolean {
  if (!family) return false;
  return keys.has(normalizeFontFamily(family));
}

// ---------------------------------------------------------------------------
// 平台 → 字体
// ---------------------------------------------------------------------------

export type FontPlatform = 'mac' | 'windows' | 'linux';

/**
 * 各平台**自带**、别的平台通常没有的字体族。
 *
 * 判据是"默认安装"而不是"可能出现"：只有装系统就带着、别的系统默认没有的，
 * 才算平台特征。故意不收那些跨平台常见的（Arial / Times New Roman / Courier New /
 * Verdana / Tahoma / Noto Sans 通用名）—— 把它们藏起来，等于让本来正常的机器
 * 看起来缺字体，反而更像被动过。
 */
export const PLATFORM_FONTS: Record<FontPlatform, string[]> = {
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
export const CJK_VENDOR_FONTS: string[] = [
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

/** 除了 claimed 之外的那两个平台的字体 */
export function fontsForOtherPlatforms(claimed: FontPlatform): string[] {
  const others: FontPlatform[] = (['mac', 'windows', 'linux'] as FontPlatform[]).filter((item) => item !== claimed);
  return others.flatMap((platform) => PLATFORM_FONTS[platform]);
}

/**
 * 读浏览器真实平台。只在 `platform: 'auto'` 时用到。
 *
 * 顺序：UA-CH 的 platform → navigator.platform → Node 的 process.platform（构建期/测试）。
 * 读不到就返回 null，调用方跳过平台层 —— 宁可不隐藏，也不要按猜的平台乱隐藏。
 */
export function detectFontPlatform(): FontPlatform | null {
  const scope = globalThis as any;
  const navigator = scope.navigator || {};
  const raw = String(navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (raw.includes('mac')) return 'mac';
  if (raw.includes('win')) return 'windows';
  if (raw.includes('linux') || raw.includes('x11') || raw.includes('bsd')) return 'linux';

  const nodePlatform = scope.process?.platform;
  if (nodePlatform === 'darwin') return 'mac';
  if (nodePlatform === 'win32') return 'windows';
  if (nodePlatform === 'linux') return 'linux';
  return null;
}

/**
 * 把 canvas 配置解析成**最终要隐藏的字体列表**。
 *
 * 三层叠加，去重（不区分大小写）：
 *   1. 平台层：按本机真实平台 → 隐藏另外两个平台的自带字体
 *      （`auto` 用浏览器真实平台，`none` 关掉这一层）
 *   2. 中文层：`hideCjkFonts` → 隐藏中文 / 国产厂商字体
 *   3. 手动层：`targetFonts` → 用户自己追加的
 *
 * 平台层和中文层是**正交**的：一个解决"这台机器不像某个平台"，一个解决
 * "这台机器没有中文环境"。真 Mac 上还想消掉"装了中文字体"这个信号，
 * 就把 hideCjkFonts 也打开 —— 代价是自相矛盾（真 Mac 有苹方），收益是
 * 中文环境那条线索消失。两个开关都摆出来，让用户自己权衡。
 */
export function resolveCanvasTargetFonts(
  canvas: Partial<CanvasConfig> | null | undefined,
  realPlatform?: FontPlatform | null
): string[] {
  const input = canvas || {};
  // 允许传部分字段：注入层的 payload 类型比 CanvasConfig 宽松（烘焙构建里
  // platform / hideCjkFonts 可能缺席），默认值与 normalizeCanvas 保持一致。
  // 平台层只有两个值：auto = 按真实平台判定，none = 不参与。
  // 真实平台从 payload 带来（主线程与 Worker 用同一个），没带就现场探一次。
  const family: FontPlatform | 'none' = input.platform === 'none'
    ? 'none'
    : ((realPlatform ?? detectFontPlatform()) || 'none');

  const result: string[] = [];
  const seen = new Set<string>();
  const push = (fonts: readonly string[]) => {
    for (const font of fonts) {
      const key = font.toLowerCase();
      if (!font || seen.has(key)) continue;
      seen.add(key);
      result.push(font);
    }
  };

  if (family !== 'none') push(fontsForOtherPlatforms(family));
  if (input.hideCjkFonts !== false) push(CJK_VENDOR_FONTS);
  push(input.targetFonts || []);

  return result;
}
