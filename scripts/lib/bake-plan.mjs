#!/usr/bin/env node
/*
 * 发布计划：纯函数，不碰进程、不写文件。
 *
 * 这样做是为了让"烘焙出来的配置对不对"能被测试直接断言 —— 上一版这套逻辑写死在
 * build-persona.mjs 里（一个立刻 execFileSync 跑 vite 的脚本），除了真构建一次之外
 * 没有任何办法知道它生成的配置长什么样。
 */

import { DEFAULT_PRESET_ACCURACY } from './presets.mjs';

/**
 * 默认启用域名，与扩展内置白名单同源。
 * @param {string[]} defaultDomains
 * @param {string} [raw] 逗号分隔
 */
export function resolveDomains(defaultDomains, raw) {
  const list = String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : [...defaultDomains];
}

function rulesFor(domains) {
  return domains.map((domain, index) => ({
    id: `rule-${index}`,
    domain,
    enabled: true,
    overrides: {
      language: { mode: 'inherit', value: null },
      timezone: { mode: 'inherit', value: null },
      geolocation: { mode: 'inherit', value: null }
    }
  }));
}

/**
 * 从内置 preset 生成烘焙配置。
 *
 * preset 与 persona 的差别只在"地理/语言/时区"的取值方式：preset 是仓库内置的
 * 几个城市，persona 来自 `~/.vanishgeo/personas/*.json`（由 IP 推导而来）。
 * 两者都收敛成同一份 SiteSpoofConfig 形状，走同一条烘焙路径。
 *
 * @param {{ id: string, geolocation: any, language: any, timezone: any }} preset
 * @param {{ domains: string[], debug?: boolean }} options
 */
export function configFromPreset(preset, options) {
  const language = preset.language || {};
  const locale = String(language.language || 'en-US');
  return {
    masterEnabled: true,
    debugMode: Boolean(options.debug),
    globalProfile: {
      language: {
        enabled: true,
        mode: 'preset',
        language: locale,
        languages: Array.isArray(language.languages) && language.languages.length
          ? [...language.languages]
          : [locale, locale.split('-')[0]],
        acceptLanguage: String(language.acceptLanguage || `${locale},${locale.split('-')[0]}`)
      },
      timezone: {
        enabled: true,
        mode: 'manual',
        timezone: String(preset.timezone?.timezone || 'UTC')
      },
      geolocation: {
        enabled: true,
        mode: 'manual',
        latitude: Number(preset.geolocation?.latitude),
        longitude: Number(preset.geolocation?.longitude),
        accuracy: Number(preset.geolocation?.accuracy ?? DEFAULT_PRESET_ACCURACY),
        country: String(preset.geolocation?.country || ''),
        randomize: false,
        randomRadiusMeters: 0,
        spoofPermission: true
      }
    },
    webRtc: { globalMode: 'strict' },
    // 字体伪装在 JS 层做不到自洽（FontFace local() / 真实渲染不走 measureText），
    // 默认关闭；想开的人自己在选项页打开（bridge 打开时改完即时生效）。
    canvas: { enabled: false, spoofFonts: false, platform: 'auto', hideCjkFonts: true, targetFonts: [] },
    rules: rulesFor(options.domains)
  };
}

/**
 * 从 persona 文件生成烘焙配置。persona 文件是扁平的：
 * `{ timezone, locale, acceptLanguage, latitude, longitude }`
 *
 * @param {{ timezone?: string, locale?: string, acceptLanguage?: string, latitude?: number, longitude?: number }} persona
 * @param {{ domains: string[], debug?: boolean }} options
 */
export function configFromPersona(persona, options) {
  const locale = String(persona.locale || 'en-US');
  const base = locale.split('-')[0];
  return {
    masterEnabled: true,
    debugMode: Boolean(options.debug),
    globalProfile: {
      language: {
        enabled: true,
        mode: 'preset',
        language: locale,
        languages: [locale, base],
        acceptLanguage: String(persona.acceptLanguage || `${locale},${base}`)
      },
      timezone: {
        enabled: true,
        mode: 'manual',
        timezone: String(persona.timezone || 'UTC')
      },
      geolocation: {
        enabled: true,
        mode: 'manual',
        latitude: Number(persona.latitude),
        longitude: Number(persona.longitude),
        accuracy: DEFAULT_PRESET_ACCURACY,
        country: '',
        randomize: false,
        randomRadiusMeters: 0,
        spoofPermission: true
      }
    },
    webRtc: { globalMode: 'strict' },
    canvas: { enabled: false, spoofFonts: false, platform: 'auto', hideCjkFonts: true, targetFonts: [] },
    rules: rulesFor(options.domains)
  };
}

/**
 * `vanishgeo-1.2.1-singapore.zip` / `vanishgeo-1.2.1-us-la-1-frozen.zip`
 *
 * 纯中文的 label（persona 常这么起名）清干净之后会是空串，这时退回到标签的稳定
 * 哈希而不是报错：文件名只是给人看的，不该因此挡住一次发布。
 */
export function releaseFileName({ version, label, frozen = false }) {
  const raw = String(label);
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = safe || `label-${stableHash(raw)}`;
  return `vanishgeo-${version}-${slug}${frozen ? '-frozen' : ''}.zip`;
}

/** djb2，够用来把不可打印的标签变成稳定短串 */
function stableHash(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 校验 build 出来的 runtime.js 真的烘焙过了。
 *
 * 这是流水线里最要紧的一道闸：交付一个"看起来正常、其实还是开发构建"的包，
 * 等于把首屏窗口原样发出去，而且看不出来。所以检查的是**产物内容**，不是退出码。
 *
 * @param {string} source runtime.js 的内容
 * @param {{ timezone: string, locale: string, version?: string, manifestVersion?: string, rules?: unknown[] }} expect
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function verifyBakedRuntime(source, expect) {
  const problems = [];

  if (/^\s*import\s/m.test(source)) {
    problems.push('runtime.js 里有 import 语句：MAIN world 是经典脚本，这会在页面里直接语法错误');
  }
  if (source.includes('__VANISHGEO_BAKED__')) {
    problems.push('runtime.js 里还留着 __VANISHGEO_BAKED__ 占位符：define 没生效，配置没有被烘焙');
  }
  if (expect.timezone && !source.includes(expect.timezone)) {
    problems.push(`runtime.js 里找不到时区 ${expect.timezone}：这是开发构建，首屏窗口还在`);
  }
  if (expect.locale && !source.includes(expect.locale)) {
    problems.push(`runtime.js 里找不到语言 ${expect.locale}：同上`);
  }
  if (expect.version && expect.manifestVersion && expect.version !== expect.manifestVersion) {
    problems.push(`manifest.json 版本 ${expect.manifestVersion} 与 package.json ${expect.version} 不一致`);
  }
  if (Array.isArray(expect.rules) && expect.rules.length === 0) {
    problems.push('rules/baked-language.json 是空的：首帧请求拿不到静态头，只能等 Service Worker 起来');
  }

  return { ok: problems.length === 0, problems };
}