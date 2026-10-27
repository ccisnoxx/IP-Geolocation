import { resolveBakedPayload, type BakedRuntimePayload } from './baked-resolver';
import { installCanvasFontPatches } from './canvas-patch';
import { createDisguise } from './disguise';
import {
  buildTargetFontKeys,
  isTargetFontFamily,
  normalizeFontFamily,
  resolveCanvasTargetFonts
} from '../shared/font-aliases';
import { installGeolocation } from './geolocation';
import { createSignalSpoof } from './signal-spoof';
import { workerPatch } from './worker-patch';

/**
 * MAIN world 注入层。
 *
 * 设计约束（每一条都对应一种可被页面直接读出的检测）：
 * 1. 不留任何 window 全局：状态全部在闭包里；
 * 2. 不替换任何"看起来不是原生"的函数：被替换的实现一律用 Proxy 包一层，
 *    `Function.prototype.toString` 仍输出 `[native code]`；
 * 3. 不破坏恒等关系：`Date.prototype.constructor === Date`、
 *    `navigator.geolocation.getCurrentPosition === Geolocation.prototype.getCurrentPosition`
 *    这类等式必须继续成立，所以只 patch 原型、不 patch 实例；
 * 4. 首屏一致：payload 在构建期烘焙（`__VANISHGEO_BAKED__`），document_start 同步应用，
 *    不存在"先真值后假值"的窗口；
 * 5. 不留可被页面伪造的通道：动态更新走构建期随机 nonce，persona 构建直接关闭。
 */

type RuntimePayload = BakedRuntimePayload & {
  enabled?: boolean;
  latitude?: number | null;
  longitude?: number | null;
};

interface RuntimeState {
  timezone: string | null;
  language: string | null;
  languages: string[] | null;
  geolocation: BakedRuntimePayload['geolocation'];
  debug: boolean;
  installedCanvas: boolean;
  canvasTargetFonts: string[] | null;
  installedWorker: boolean;
}

const BAKED = typeof __VANISHGEO_BAKED__ === 'object' && __VANISHGEO_BAKED__
  ? (__VANISHGEO_BAKED__ as { config: any; lastLocation: any })
  : null;
const NONCE = typeof __VANISHGEO_NONCE__ === 'string' ? __VANISHGEO_NONCE__ : '';
const BRIDGE_ENABLED = typeof __VANISHGEO_BRIDGE__ === 'boolean' ? __VANISHGEO_BRIDGE__ : true;

(function () {
  const NativeDate = Date;
  const disguise = createDisguise();

  const state: RuntimeState = {
    timezone: null,
    language: null,
    languages: null,
    geolocation: null,
    debug: false,
    installedCanvas: false,
    canvasTargetFonts: null,
    installedWorker: false
  };

  const signals = createSignalSpoof({
    timezone: () => state.timezone,
    language: () => state.language,
    languages: () => state.languages,
    disguise
  });

  function define(target: any, key: string, value: any): void {
    try {
      Object.defineProperty(target, key, { value, writable: true, enumerable: false, configurable: true });
    } catch {
      try {
        target[key] = value;
      } catch { /* ignore */ }
    }
  }

  // ---------- canvas / fonts ----------

  // 归一化必须与别名表（shared/font-aliases）完全一致，否则 "苹方-简" 这种
  // 本地化名字会和 "PingFang SC" 对不上，只按拉丁名匹配会漏掉一整类探测。
  const fontFamilyKey = normalizeFontFamily;

  function splitFontFamilies(familyList: string): string[] {
    const families: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaped = false;
    for (const char of familyList) {
      if (escaped) { current += char; escaped = false; continue; }
      if (char === '\\') { current += char; escaped = true; continue; }
      if ((char === '"' || char === "'") && !quote) { quote = char; current += char; continue; }
      if (quote && char === quote) { quote = null; current += char; continue; }
      if (char === ',' && !quote) {
        if (current.trim()) families.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) families.push(current.trim());
    return families;
  }

  const FONT_SIZE_PATTERN = /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;

  let targetFontKeys = new Set<string>();

  function fallbackFont(font: string): string | null {
    if (!font || targetFontKeys.size === 0) return null;
    const sizeMatch = font.match(FONT_SIZE_PATTERN);
    if (!sizeMatch || sizeMatch.index === undefined) return null;
    const familyStart = sizeMatch.index + sizeMatch[0].length;
    const prefix = font.slice(0, familyStart).trim();
    const families = splitFontFamilies(font.slice(familyStart).trim());
    if (!families.length) return null;
    const kept = families.filter((family) => !isTargetFontFamily(family, targetFontKeys));
    if (kept.length === families.length) return null;
    return `${prefix} ${kept.length ? kept.join(', ') : 'monospace'}`;
  }

  function installCanvas(config: BakedRuntimePayload['canvasConfig'], targetFonts: string[]): void {
    // 展开别名：声明 "PingFang SC" 之后，苹方-简 / 苹方 / PingFang SC Light 一并命中
    targetFontKeys = buildTargetFontKeys(targetFonts);
    // state.canvasTargetFonts 由 applySpoof 统一维护（要区分 spoofFonts 开关）
    if (!config.spoofFonts || state.installedCanvas) return;
    state.installedCanvas = true;

    // 两种 2D 上下文都要补：`<canvas>` 和 `new OffscreenCanvas()`。后者是真实
    // 检测脚本最常用的绕过方式（只补前者时一行就绕过去了）。
    installCanvasFontPatches(globalThis, { fallbackFont, disguise, define });

    // FontFaceSet.prototype.check 故意不接管。
    //
    // 原生实现测的是"FontFaceSet 里有没有匹配的字体面"，对系统字体名一律返回 true
    // （不管装没装）。旧代码让被伪装的字体返回 false，等于凭空造出一个真机不会出现
    // 的取值 —— 检测方只要问一句 `document.fonts.check('12px Helvetica')` 就够了。
  }

  // ---------- Worker ----------

  /** 让 `X.prototype.constructor === X` 继续成立：共享原生原型，并把 constructor 指回来 */
  function adoptPrototype(wrapper: any, Native: any): void {
    try {
      Object.defineProperty(wrapper, 'prototype', { value: Native.prototype, writable: false });
    } catch { /* ignore */ }
    try {
      Object.defineProperty(Native.prototype, 'constructor', {
        value: wrapper, writable: true, enumerable: false, configurable: true
      });
    } catch { /* ignore */ }
  }

  /**
   * 每次创建 Worker 时**按当前 state 现算**补丁源码。
   *
   * 旧实现把 patchSource 在 installWorker 里算好一次就冻住：页面先加载、配置后到
   * （动态通道本身就是这个时序）时，早先创建的那个 Worker 包装器会一直用装载瞬间
   * 的空配置。更糟的是它在没有可补丁目标时先把 installedWorker 置了 true，
   * 之后真有配置了也不会再装。
   */
  function currentWorkerPatchSource(): string {
    // 传**展开后**的键集合，而不是原始名字：别名表只在主线程维护一份，
    // Worker 里只需按同一套归一化规则比较，不用再背一份别名数据。
    const fontFamilies = state.canvasTargetFonts || [];
    const fontTargets = fontFamilies.length ? Array.from(buildTargetFontKeys(fontFamilies)) : [];
    if (!state.timezone && !state.language && !fontTargets.length) return '';
    return buildWorkerPatch({
      timezone: state.timezone,
      language: state.language,
      languages: state.languages,
      fontTargets
    });
  }

  function installWorker(): void {
    if (state.installedWorker) return;
    state.installedWorker = true;

    /** 生成带补丁前缀的 blob URL；没有可补丁的目标时返回 null，调用方走原生路径 */
    const makeWorkerUrl = (scriptURL: string | URL, options?: WorkerOptions): string | null => {
      const patchSource = currentWorkerPatchSource();
      if (!patchSource) return null;

      const sourceUrl = new URL(String(scriptURL), location.href).href;
      const isModule = options && typeof options === 'object' && options.type === 'module';
      const body = isModule
        ? `${patchSource}\nawait import(${JSON.stringify(sourceUrl)});`
        : `${patchSource}\nimportScripts(${JSON.stringify(sourceUrl)});`;
      return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    };

    const NativeWorker = (globalThis as any).Worker;
    if (typeof NativeWorker === 'function') {
      const wrapped = disguise(function (this: any, scriptURL: any, options?: any) {
        try {
          const patchedUrl = makeWorkerUrl(scriptURL, options);
          if (!patchedUrl) return new NativeWorker(scriptURL, options);
          return new NativeWorker(patchedUrl, options);
        } catch {
          return new NativeWorker(scriptURL, options);
        }
      }, 'Worker', 1);
      adoptPrototype(wrapped, NativeWorker);
      define(globalThis as any, 'Worker', wrapped);
    }

    const NativeSharedWorker = (globalThis as any).SharedWorker;
    if (typeof NativeSharedWorker === 'function') {
      const wrapped = disguise(function (this: any, scriptURL: any, optionsOrName?: any) {
        try {
          const options = optionsOrName && typeof optionsOrName === 'object' ? optionsOrName : undefined;
          const patchedUrl = makeWorkerUrl(scriptURL, options);
          if (!patchedUrl) return new NativeSharedWorker(scriptURL, optionsOrName);
          return new NativeSharedWorker(patchedUrl, optionsOrName);
        } catch {
          return new NativeSharedWorker(scriptURL, optionsOrName);
        }
      }, 'SharedWorker', 1);
      adoptPrototype(wrapped, NativeSharedWorker);
      define(globalThis as any, 'SharedWorker', wrapped);
    }
  }

  /** 当前状态下的 Worker 补丁源码。每次 new Worker 都重新生成，见 installWorker。 */
  function buildWorkerPatch(config: {
    timezone: string | null;
    language: string | null;
    languages: string[] | null;
    fontTargets: string[];
  }): string {
    return `;(${workerPatch.toString()})(${JSON.stringify(config)});`;
  }

  // ---------- 应用 ----------

  function applySpoof(payload: RuntimePayload): void {
    if (!payload) return;
    if ((payload as any).extensionEnabled === false || payload.enabled === false) return;

    state.debug = Boolean(payload.debugMode);

    const timezoneConfig = payload.timezoneConfig || { enabled: false, mode: 'auto', timezone: '' };
    const nextTimezone = timezoneConfig.enabled === false
      ? null
      : (timezoneConfig.mode === 'manual' && timezoneConfig.timezone ? timezoneConfig.timezone : payload.timezone || null);

    const languageConfig = payload.languageConfig && payload.languageConfig.enabled ? payload.languageConfig : null;
    const nextLanguage = languageConfig && languageConfig.language ? languageConfig.language : null;
    const nextLanguages = languageConfig
      ? (Array.isArray(languageConfig.languages) && languageConfig.languages.length
        ? languageConfig.languages.slice()
        : [languageConfig.language])
      : null;

    state.timezone = nextTimezone;
    state.language = nextLanguage;
    state.languages = nextLanguages;
    state.geolocation = payload.geolocation || null;

    // 只有原生值与目标值不一致时才打补丁
    const needTimezone = Boolean(state.timezone) && state.timezone !== signals.native.timeZone;
    const needLanguage = Boolean(state.language) && state.language !== signals.native.language;
    const needLocale = Boolean(state.language) && state.language !== signals.native.locale;

    if (needLanguage) signals.installLanguage();
    // toLocaleString 一族必须和 Intl 一起处理：只改语言、不改时区时（TZ 已经对了）
    // 漏掉这里就会出现 Intl= en-US、Date.prototype.toLocaleString() = 系统 locale 的
    // 不一致 —— 页面拿两者一比就知道被动过。
    if (needTimezone || needLocale) signals.installDateMethods();
    if (needTimezone) signals.installDateConstructor();
    if (needTimezone || needLocale) signals.installIntl();
    if (state.geolocation) {
      installGeolocation({
        get: () => state.geolocation,
        disguise,
        now: () => NativeDate.now()
      });
    }
    const canvasConfig = payload.canvasConfig && payload.canvasConfig.enabled ? payload.canvasConfig : null;
    // 三层在这里合并成最终列表：平台层（platform，auto 用本机真实平台）+ 中文层
    // （hideCjkFonts）+ 手动层（targetFonts）。放在注入层做，是为了让 background
    // 不必引用 font-aliases（否则注入脚本会被打成 chunk，MAIN world 里跑不起来）。
    const canvasTargets = canvasConfig
      ? resolveCanvasTargetFonts(canvasConfig, null)
      : [];
    // 字体目标要跟着当前 payload 走：canvas 被关掉以后 Worker 里不该继续按老列表伪造
    state.canvasTargetFonts = canvasConfig && canvasConfig.spoofFonts ? canvasTargets.slice() : [];
    if (canvasConfig) installCanvas(canvasConfig, canvasTargets);
    const needCanvas = Boolean(canvasConfig && canvasConfig.spoofFonts && canvasTargets.length);
    if (needTimezone || needLanguage || needLocale || needCanvas) installWorker();

    if (state.debug) {
      console.log('[VanishGeo] applied', {
        timezone: state.timezone,
        language: state.language,
        native: signals.native,
        patched: { timezone: needTimezone, language: needLanguage, locale: needLocale }
      });
    }
  }

  // 1) 构建期烘焙：document_start 同步生效，首屏脚本读到的就是目标值
  if (BAKED && BAKED.config) {
    try {
      const payload = resolveBakedPayload(BAKED.config, location.hostname, BAKED.lastLocation || null);
      if (payload) applySpoof(payload as RuntimePayload);
    } catch { /* ignore */ }
  }

  // 2) 动态更新：content script 在 document_start 发一条握手，把私有 MessagePort
  //    递进来，之后 payload 全走端口。
  //
  //    旧做法是把 nonce 和 payload 一起 `window.postMessage` 出去 —— 页面在自己的
  //    `message` 监听器里能读到两者，等于把伪装的写权限交给了页面。端口只有两端
  //    持有，页面观察不到也拿不到；端口消息里再校验 nonce，抢到端口也伪造不了。
  //
  //    握手只收一次：收下端口立刻摘掉 window 监听器，之后不存在可观测的握手。
  if (BRIDGE_ENABLED && NONCE) {
    const onHandshake = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = event.data;
      if (!data || typeof data !== 'object' || data.__vanishGeo !== 'handshake') return;
      const port = event.ports && event.ports[0];
      if (!port) return;
      window.removeEventListener('message', onHandshake);
      port.onmessage = (message: MessageEvent) => {
        const payload: any = message.data;
        if (!payload || typeof payload !== 'object' || payload.__vanishGeo !== NONCE) return;
        try {
          applySpoof(payload.payload);
        } catch { /* ignore */ }
      };
      port.start();
      port.postMessage({ __vanishGeo: 'ack', nonce: NONCE });
    };
    window.addEventListener('message', onHandshake);
  }
})();