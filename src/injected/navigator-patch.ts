/**
 * 平台声称层：改写 navigator 上与操作系统有关的那几个值。
 *
 * 为什么需要它：字体层可以说"这台机器没有 mac 字体"，但只要 UA 还是
 * `Macintosh; Intel Mac OS X`，任何做交叉校验的指纹库都会把这两条摆在一起看。
 * 于是"声称平台"必须同时落到 UA / UA-CH 上，两边才是一套说法。
 *
 * 这里只管 **JS 可见值**；同一套声称要写进 `Sec-CH-UA-*` 请求头，那是
 * `src/background/dnr.ts` 的事，两边共用 `platformClaimValues()` 的映射表，
 * 免得一个地方写 `"macOS"`、另一个地方写 `MacIntel`。
 *
 * 保真原则：
 *   - UA 只替换括号里的操作系统段，Chrome 版本原样保留 —— 版本是真话，
 *     谎报版本会立刻和 `Sec-CH-UA`（brands）打架。
 *   - `navigator.platform` 用各平台真实取值（`MacIntel` / `Win32` / `Linux x86_64`）。
 *   - `userAgentData.getHighEntropyValues()` 返回的形状、字段顺序、Promise 语义都按
 *     原生来；只给 hint 里要的键，多给键同样是痕迹。
 */

import type { PlatformClaim } from '../shared/types';

type Claim = Exclude<PlatformClaim, 'auto'>;

export interface PlatformClaimValues {
  /** UA 括号内的操作系统段 */
  uaToken: string;
  /** navigator.platform */
  platform: string;
  /** navigator.userAgentData.platform / Sec-CH-UA-Platform */
  uaDataPlatform: string;
  /** Sec-CH-UA-Platform-Version 的默认值 */
  platformVersion: string;
  /** Sec-CH-UA-Arch 的默认值 */
  architecture: string;
}

const CLAIM_VALUES: Record<Claim, PlatformClaimValues> = {
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

/**
 * 把声称翻译成要写进 UA / UA-CH / 请求头的具体值。
 *
 * `version` / `architecture` 允许用户覆盖：Windows 10 应该是 `10.0.0`，
 * Apple Silicon 是 `arm`、Intel Mac 是 `x86` —— 这些只有用户知道。
 */
export function platformClaimValues(
  claim: string | null | undefined,
  overrides: { version?: string; architecture?: string } | null = {}
): PlatformClaimValues | null {
  if (claim !== 'mac' && claim !== 'windows' && claim !== 'linux') return null;
  const base = CLAIM_VALUES[claim as Claim];
  const version = (overrides && overrides.version ? String(overrides.version) : '').trim();
  const architecture = (overrides && overrides.architecture ? String(overrides.architecture) : '').trim();
  return {
    ...base,
    platformVersion: version || base.platformVersion,
    architecture: architecture || base.architecture
  };
}

/** 从真实 UA 里剥掉操作系统段，再插入目标段；非 Chrome 风格 UA 原样返回 */
export function rewriteUserAgent(ua: string, values: PlatformClaimValues): string {
  const source = String(ua || '');
  const match = /\(([^)]*)\)/.exec(source);
  if (!match) return source;
  // 只换第一个括号（平台段），后面还有 "(KHTML, like Gecko)" 之类不能动
  return source.slice(0, match.index) + `(${values.uaToken})` + source.slice(match.index + match[0].length);
}

/**
 * getHighEntropyValues 的返回体。
 *
 * 原生行为：只要请求的 hint 出现在结果里，其余绝不出现；`fullVersionList`
 * 与 `brands` 同为 `{brand, version}` 数组。这里按 hint 逐个填。
 */
export function buildHighEntropyValues(
  hints: string[],
  values: PlatformClaimValues,
  real: {
    brands?: Array<{ brand: string; version: string }>;
    uaFullVersion?: string;
    bitness?: string;
    model?: string;
    wow64?: boolean;
    fullVersionList?: Array<{ brand: string; version: string }>;
  }
): Record<string, unknown> {
  const requested = new Set(Array.isArray(hints) ? hints.map(String) : []);
  const result: Record<string, unknown> = {};
  if (requested.has('platform')) result.platform = values.uaDataPlatform;
  if (requested.has('platformVersion')) result.platformVersion = values.platformVersion;
  if (requested.has('architecture')) result.architecture = values.architecture;
  if (requested.has('model')) result.model = real.model ?? '';
  if (requested.has('uaFullVersion')) result.uaFullVersion = real.uaFullVersion ?? '';
  if (requested.has('fullVersionList')) result.fullVersionList = real.fullVersionList ?? real.brands ?? [];
  if (requested.has('bitness')) result.bitness = real.bitness ?? '64';
  if (requested.has('wow64')) result.wow64 = real.wow64 ?? false;
  return result;
}

export interface NavigatorPatchDeps {
  /** 伪装成原生函数（toString → [native code]） */
  disguise: (fn: (...args: any[]) => any, name: string, length: number) => any;
  /** 定义不可枚举属性 */
  define: (target: any, key: string, value: any) => void;
}

export interface NavigatorPatchState {
  /** 原生 getter 缓存，取消伪装时要换回去 */
  restored: boolean;
}

const PATCHED_KEYS = ['userAgent', 'appVersion', 'platform'] as const;

/**
 * 第一次打补丁时抓下来的原生描述符。
 *
 * 撤销时必须换回**这一份**，而不是"本次调用开始时看到的描述符"——第二次 apply
 * 时看到的是我们自己上次装的 getter，照着它恢复等于什么都没做（关掉开关后
 * UA 仍然是上一次的伪装值，比不关更可疑）。
 */
const originalDescriptors = new WeakMap<object, Map<string, PropertyDescriptor>>();

function rememberOriginal(proto: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (!descriptor) return;
  let saved = originalDescriptors.get(proto);
  if (!saved) {
    saved = new Map();
    originalDescriptors.set(proto, saved);
  }
  if (!saved.has(key)) saved.set(key, descriptor);
}

function restoreOriginals(proto: object): void {
  const saved = originalDescriptors.get(proto);
  if (!saved) return;
  for (const [key, descriptor] of saved) {
    try { Object.defineProperty(proto, key, descriptor); } catch { /* ignore */ }
  }
  originalDescriptors.delete(proto);
}

/**
 * 安装 / 更新 / 撤销 navigator 补丁。
 *
 * 传 `claim = null` 表示撤销：把原型上的原生 getter 换回去。配置改成"不声称"以后
 * 页面必须能回到原生值，否则关掉开关反而更可疑。
 */
export function installNavigatorPatch(
  scope: any,
  claim: string | null | undefined,
  overrides: { version?: string; architecture?: string } | null,
  deps: NavigatorPatchDeps
): boolean {
  const nav = scope && scope.navigator;
  if (!nav) return false;
  const values = platformClaimValues(claim, overrides);

  // Navigator.prototype 上挂着原生 getter；实例上不能留自有属性
  const proto = Object.getPrototypeOf(nav) || nav;
  const descriptors: Record<string, PropertyDescriptor | undefined> = {};
  for (const key of PATCHED_KEYS) descriptors[key] = Object.getOwnPropertyDescriptor(proto, key);

  const readNative = (key: string): string => {
    const getter = descriptors[key] && descriptors[key]!.get;
    if (getter) {
      try { return String(getter.call(nav)); } catch { /* fall through */ }
    }
    try { return String(nav[key]); } catch { return ''; }
  };

  if (!values) {
    // 撤销：换回第一次打补丁之前抓到的原生描述符
    restoreOriginals(proto);
    return true;
  }

  const nativeUserAgent = readNative('userAgent');
  const spoofedUserAgent = rewriteUserAgent(nativeUserAgent, values);

  const installGetter = (key: string, compute: () => string) => {
    rememberOriginal(proto, key, descriptors[key]);
    const existing = Object.getOwnPropertyDescriptor(proto, key);
    // 已经是我们的 getter（第二次 apply）时不要重复包一层
    if (existing && (existing.get as any) && (existing.get as any).__vanishGeoGetter) {
      (existing.get as any).__vanishGeoValue = compute;
      return;
    }
    const getter = deps.disguise(function () { return compute(); }, `get ${key}`, 0);
    try {
      (getter as any).__vanishGeoGetter = true;
      (getter as any).__vanishGeoValue = compute;
      Object.defineProperty(proto, key, { get: getter, configurable: true, enumerable: true });
    } catch { /* ignore */ }
  };

  installGetter('userAgent', () => spoofedUserAgent);
  // appVersion 就是 UA 去掉 "Mozilla/" 前缀，跟着一起变才不矛盾
  installGetter('appVersion', () => spoofedUserAgent.replace(/^Mozilla\//, ''));
  installGetter('platform', () => values.platform);

  // ---- userAgentData ----
  const uaData = nav.userAgentData;
  if (uaData) {
    const uaDataProto = Object.getPrototypeOf(uaData) || uaData;
    const nativePlatform = Object.getOwnPropertyDescriptor(uaDataProto, 'platform');
    const nativeGetHigh = uaDataProto.getHighEntropyValues;
    const nativeToJSON = uaDataProto.toJSON;

    if (nativePlatform && nativePlatform.get) {
      const getter = deps.disguise(function () { return values.uaDataPlatform; }, 'get platform', 0);
      try { Object.defineProperty(uaDataProto, 'platform', { get: getter, configurable: true, enumerable: true }); } catch { /* ignore */ }
    }

    if (typeof nativeGetHigh === 'function') {
      const brands = Array.isArray(uaData.brands) ? uaData.brands.map((item: any) => ({ brand: String(item.brand), version: String(item.version) })) : [];
      const patched = deps.disguise(function (this: any, hints: string[]) {
        const base = typeof nativeGetHigh === 'function' ? nativeGetHigh.call(uaData, Array.isArray(hints) ? hints : []) : Promise.resolve({});
        return Promise.resolve(base).then((real: any) => {
          const fixed = buildHighEntropyValues(hints || [], values, {
            brands,
            uaFullVersion: real && real.uaFullVersion,
            bitness: real && real.bitness,
            model: real && real.model,
            wow64: real && real.wow64,
            fullVersionList: real && real.fullVersionList
          });
          // 原生结果里我们不打算改的键照原样带出去（比如 requested 之外的字段）
          return { ...(real || {}), ...fixed };
        });
      }, 'getHighEntropyValues', 1);
      try { Object.defineProperty(uaDataProto, 'getHighEntropyValues', { value: patched, writable: true, configurable: true, enumerable: false }); } catch { /* ignore */ }
    }

    if (typeof nativeToJSON === 'function') {
      const patchedJson = deps.disguise(function (this: any) {
        const base = nativeToJSON.call(uaData) || {};
        return { ...base, platform: values.uaDataPlatform };
      }, 'toJSON', 0);
      try { Object.defineProperty(uaDataProto, 'toJSON', { value: patchedJson, writable: true, configurable: true, enumerable: false }); } catch { /* ignore */ }
    }
  }

  return true;
}