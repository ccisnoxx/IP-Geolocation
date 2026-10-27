/**
 * 平台声称对应的请求头取值。
 *
 * 这张表与 `src/injected/navigator-patch.ts` 里的 `CLAIM_VALUES` **必须一致** ——
 * 注入层改 JS 可见值，这里改 `Sec-CH-UA-*` / `User-Agent`，两边说的不是同一句话
 * 就白改了。不能直接 import 那份：注入脚本与后台一旦共享模块，Rollup 会把模块抽成
 * 独立 chunk，`injected/runtime.js` 里出现 `import`，MAIN world 的经典脚本直接语法错误。
 * 所以各自持有一份，由 `tests/platform-claim.test.ts` 比对两者相等。
 */

export type Claim = 'mac' | 'windows' | 'linux';

export interface PlatformHeaderValues {
  uaToken: string;
  platform: string;
  uaDataPlatform: string;
  platformVersion: string;
  architecture: string;
}

export const CLAIM_HEADER_VALUES: Record<Claim, PlatformHeaderValues> = {
  mac: {
    uaToken: 'Macintosh; Intel Mac OS X 10_15_7',
    platform: 'MacIntel',
    uaDataPlatform: 'macOS',
    platformVersion: '14.6.0',
    architecture: 'arm'
  },
  windows: {
    uaToken: 'Windows NT 10.0; Win64; x64',
    platform: 'Win32',
    uaDataPlatform: 'Windows',
    platformVersion: '15.0.0',
    architecture: 'x86'
  },
  linux: {
    uaToken: 'X11; Linux x86_64',
    platform: 'Linux x86_64',
    uaDataPlatform: 'Linux',
    platformVersion: '6.5.0',
    architecture: 'x86'
  }
};

/** 服务worker里能读到宿主浏览器的真实 UA；测试环境没有 navigator，退回一个 Chrome 样式串 */
export function realUserAgent(): string {
  const scope = globalThis as any;
  const ua = scope.navigator && scope.navigator.userAgent;
  // Node 21+ 也有 navigator，值是 "Node.js/24"：只认浏览器形态的 UA，
  // 否则测试环境会把 User-Agent 头写成 Node.js，跟页面里的 Chrome 直接矛盾。
  if (typeof ua === 'string' && /^Mozilla\/\S+ \([^)]*\)/.test(ua)) return ua;
  return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
}

/** 只替换第一个括号里的操作系统段，Chrome 版本保持真话 */
export function rewriteUserAgent(ua: string, uaToken: string): string {
  const source = String(ua || '');
  const match = /\(([^)]*)\)/.exec(source);
  if (!match) return source;
  return source.slice(0, match.index) + `(${uaToken})` + source.slice(match.index + match[0].length);
}

export interface HeaderOperation {
  header: string;
  operation: 'set';
  value: string;
}

/**
 * 一个声称要写进请求头的全部头。
 *
 * 低熵的 `Sec-CH-UA-Platform` 浏览器默认就会发；高熵的 platform-version / arch /
 * bitness / model 只有站点发过 `Accept-CH` 才会发。DNR 没法按请求动态决定，
 * 所以一律 set：宁可多几个头，也不能让站点要到的高熵值和 UA 对不上。
 */
export function buildPlatformHeaders(
  claim: string,
  overrides: { version?: string; architecture?: string } | null,
  ua: string
): HeaderOperation[] {
  if (claim !== 'mac' && claim !== 'windows' && claim !== 'linux') return [];
  const base = CLAIM_HEADER_VALUES[claim as Claim];
  const version = (overrides && overrides.version ? overrides.version : '').trim() || base.platformVersion;
  const architecture = (overrides && overrides.architecture ? overrides.architecture : '').trim() || base.architecture;

  return [
    { header: 'User-Agent', operation: 'set', value: rewriteUserAgent(ua, base.uaToken) },
    { header: 'Sec-CH-UA-Platform', operation: 'set', value: `"${base.uaDataPlatform}"` },
    { header: 'Sec-CH-UA-Platform-Version', operation: 'set', value: `"${version}"` },
    { header: 'Sec-CH-UA-Arch', operation: 'set', value: `"${architecture}"` },
    { header: 'Sec-CH-UA-Bitness', operation: 'set', value: '"64"' },
    { header: 'Sec-CH-UA-Model', operation: 'set', value: '""' },
    // 结构化字段布尔：?0 表示不是 WOW64 子环境
    { header: 'Sec-CH-UA-WoW64', operation: 'set', value: '?0' }
  ];
}