// Canvas 字体伪装用的平台字体表与替换映射。
// 目标：让"声称是 macOS 的机器"量不出 Windows 专有字体，反之亦然；量宽改用对端平台的等价字体，
// 于是 Canvas 指纹与声称的平台一致，而不是把字体一律抹成 monospace（那样本身就很显眼）。

export type CanvasFontPlatform = 'windows' | 'macos';

/** 只在 Windows 上随系统存在的字体（大小写不敏感比较）。 */
export const WINDOWS_ONLY_FAMILIES = [
  'Segoe UI', 'Segoe UI Variable', 'Segoe UI Emoji', 'Tahoma', 'Microsoft Sans Serif', 'Calibri',
  'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel', 'Verdana', 'Trebuchet MS', 'Georgia',
  'Comic Sans MS', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype',
  'Franklin Gothic Medium', 'Gill Sans MT', 'Century Gothic', 'MS Gothic', 'Meiryo', 'Yu Gothic',
  'Microsoft YaHei', 'SimSun', 'SimHei', 'NSimSun', 'KaiTi', 'FangSong'
];

/** 只在 macOS 上随系统存在的字体。 */
export const MACOS_ONLY_FAMILIES = [
  'Helvetica Neue', 'Helvetica', 'San Francisco', '.SF NS Text', '.SF NS Display', 'Menlo', 'Monaco',
  'Geneva', 'Lucida Grande', 'Avenir', 'Avenir Next', 'Optima', 'Futura', 'Baskerville', 'Hoefler Text',
  'Charter', 'Didot', 'PingFang SC', 'PingFang TC', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN',
  'Songti SC', 'Heiti SC', 'STHeiti', 'Apple SD Gothic Neo'
];

/** 对端平台的等价字体：量宽接近、视觉族一致。 */
export const WINDOWS_TO_MACOS: Record<string, string> = {
  'segoe ui': 'Helvetica Neue', 'segoe ui variable': 'Helvetica Neue', 'segoe ui emoji': 'Apple Color Emoji',
  tahoma: 'Geneva', 'microsoft sans serif': 'Helvetica', calibri: 'Helvetica Neue', cambria: 'Charter',
  candara: 'Optima', consolas: 'Menlo', constantia: 'Baskerville', corbel: 'Futura', verdana: 'Verdana',
  'trebuchet ms': 'Trebuchet MS', georgia: 'Georgia', 'comic sans ms': 'Comic Sans MS', impact: 'Impact',
  'lucida console': 'Monaco', 'lucida sans unicode': 'Lucida Grande', 'palatino linotype': 'Palatino',
  'franklin gothic medium': 'Helvetica Neue', 'gill sans mt': 'Gill Sans', 'century gothic': 'Avenir',
  'ms gothic': 'Hiragino Kaku Gothic ProN', meiryo: 'Hiragino Sans', 'yu gothic': 'Hiragino Sans',
  'microsoft yahei': 'PingFang SC', simsun: 'Songti SC', simhei: 'Heiti SC', nsimsun: 'Songti SC',
  kaiti: 'Songti SC', fangsong: 'Songti SC'
};

export const MACOS_TO_WINDOWS: Record<string, string> = {
  'helvetica neue': 'Segoe UI', helvetica: 'Arial', 'san francisco': 'Segoe UI', '.sf ns text': 'Segoe UI',
  '.sf ns display': 'Segoe UI', menlo: 'Consolas', monaco: 'Lucida Console', geneva: 'Tahoma',
  'lucida grande': 'Lucida Sans Unicode', avenir: 'Century Gothic', 'avenir next': 'Century Gothic',
  optima: 'Candara', futura: 'Corbel', baskerville: 'Constantia', 'hoefler text': 'Cambria',
  charter: 'Cambria', didot: 'Cambria', 'pingfang sc': 'Microsoft YaHei', 'pingfang tc': 'Microsoft YaHei',
  'hiragino sans': 'Meiryo', 'hiragino kaku gothic pron': 'MS Gothic', 'songti sc': 'SimSun',
  'heiti sc': 'SimHei', stheiti: 'SimHei', 'apple sd gothic neo': 'Malgun Gothic'
};

export function canvasFontReplacementMap(platform: CanvasFontPlatform): Record<string, string> {
  return platform === 'macos' ? WINDOWS_TO_MACOS : MACOS_TO_WINDOWS;
}

/** 该平台上"不该存在"的字体名单；量宽与 check() 都要按它判定。 */
export function canvasImpossibleFamilies(platform: CanvasFontPlatform): string[] {
  return platform === 'macos' ? [...WINDOWS_ONLY_FAMILIES] : [...MACOS_ONLY_FAMILIES];
}
