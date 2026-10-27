import { resolveBakedPayload, type BakedRuntimePayload } from './baked-resolver';
import { installCanvasFontPatches, uninstallCanvasFontPatches } from './canvas-patch';
import { installLocalFontsFilter, uninstallLocalFontsFilter } from './local-fonts';
import { createCanvasFontState } from './canvas-state';
import { createDisguise } from './disguise';
import { defineNativeLike } from './define';
import { buildTargetFontKeys, resolveCanvasTargetFonts } from '../shared/font-aliases';
import { installGeolocation, uninstallGeolocation } from './geolocation';
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
  /** 定位启用但坐标解析不出来：安装 deny 补丁，返回 POSITION_UNAVAILABLE */
  geolocationDenied: boolean;
  installedGeo: boolean;
  debug: boolean;
  installedCanvas: boolean;
  canvasTargetFonts: string[] | null;
  /** 诊断回报用：当前生效的字体层配置（不含字表本身） */
  canvasConfig: { platform?: string; hideCjkFonts?: boolean } | null;
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
    geolocationDenied: false,
    installedGeo: false,
    debug: false,
    installedCanvas: false,
    canvasTargetFonts: null,
    canvasConfig: null,
    installedWorker: false
  };

  const signals = createSignalSpoof({
    timezone: () => state.timezone,
    language: () => state.language,
    languages: () => state.languages,
    disguise
  });

  function define(target: any, key: string, value: any): void {
    defineNativeLike(target, key, value);
  }

  // ---------- canvas / fonts ----------

  // 目标集合与"补丁是否安装"分开维护：补丁只装一次，目标集合每份 payload 都要更新。
  // 否则关掉 canvas 之后主线程仍按旧字表隐藏，Worker 已经恢复原生，两边对不上。
  const canvasFonts = createCanvasFontState();

  // 运行期补丁的还原栈。模块级补丁（signal / geolocation / canvas / local-fonts）
  // 各自维护一份，这里只管 runtime 自己装的 Worker 包装器。
  const restores: Array<() => void> = [];

  function installCanvas(config: BakedRuntimePayload['canvasConfig']): void {
    if (!config.spoofFonts || state.installedCanvas) return;
    state.installedCanvas = true;

    // 两种 2D 上下文都要补：`<canvas>` 和 `new OffscreenCanvas()`。后者是真实
    // 检测脚本最常用的绕过方式（只补前者时一行就绕过去了）。
    installCanvasFontPatches(globalThis, { fallbackFont: canvasFonts.fallbackFont, disguise, define });

    // 本地字体清单是另一条路：canvas 只伪装"量出来的宽度"，而 queryLocalFonts
    // 直接枚举本机全部字体（实测 667 条，含 24 条 PingFang）。不滤掉它，上面三层
    // 字表全部白做 —— 而且它没有阈值、没有误差，比 canvas 量测更硬。
    installLocalFontsFilter(globalThis, {
      isHidden: ({ family, fullName, postscriptName }) => [family, fullName, postscriptName]
        .some((name) => typeof name === 'string' && canvasFonts.isTarget(name)),
      disguise
    });

    // FontFaceSet.prototype.check 故意不接管。
    //
    // 原生实现测的是"FontFaceSet 里有没有匹配的字体面"，对系统字体名一律返回 true
    // （不管装没装）。旧代码让被伪装的字体返回 false，等于凭空造出一个真机不会出现
    // 的取值 —— 检测方只要问一句 `document.fonts.check('12px Helvetica')` 就够了。
  }

  // ---------- Worker ----------

  /** 让 `X.prototype.constructor === X` 继续成立：共享原生原型，并把 constructor 指回来 */
  function adoptPrototype(wrapper: any, Native: any): (() => void) | null {
    let constructorDescriptor: PropertyDescriptor | undefined;
    try {
      constructorDescriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'constructor');
    } catch { /* ignore */ }
    try {
      Object.defineProperty(wrapper, 'prototype', { value: Native.prototype, writable: false });
    } catch { /* ignore */ }
    try {
      Object.defineProperty(Native.prototype, 'constructor', {
        value: wrapper, writable: true, enumerable: false, configurable: true
      });
    } catch { /* ignore */ }
    return () => {
      try {
        if (constructorDescriptor) Object.defineProperty(Native.prototype, 'constructor', constructorDescriptor);
        else delete Native.prototype.constructor;
      } catch { /* ignore */ }
    };
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

  function installWorker(): (() => void) | null {
    if (state.installedWorker) return null;
    const undo: Array<() => void> = [];

    /** 替换 globalThis 上的构造器，返回还原闭包（原属性不存在时删除） */
    const replaceGlobal = (key: string, value: any): void => {
      let descriptor: PropertyDescriptor | undefined;
      try { descriptor = Object.getOwnPropertyDescriptor(globalThis, key); } catch { /* ignore */ }
      define(globalThis as any, key, value);
      undo.push(() => {
        try {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else delete (globalThis as any)[key];
        } catch { /* ignore */ }
      });
    };

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
      const restorePrototype = adoptPrototype(wrapped, NativeWorker);
      if (restorePrototype) undo.push(restorePrototype);
      replaceGlobal('Worker', wrapped);
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
      const restorePrototype = adoptPrototype(wrapped, NativeSharedWorker);
      if (restorePrototype) undo.push(restorePrototype);
      replaceGlobal('SharedWorker', wrapped);
    }

    if (!undo.length) return null;
    state.installedWorker = true;
    return () => {
      while (undo.length) {
        const restore = undo.pop();
        try { restore?.(); } catch { /* ignore */ }
      }
      state.installedWorker = false;
    };
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

  /**
   * 解析烘焙配置用的主机名。
   *
   * about:blank / about:srcdoc 没有 hostname，用 referrer 落到父页面的规则上；
   * 否则子框架装了 runtime 也拿不到 payload，父页面一读 contentWindow 就是原生值。
   * 这里不 import `shared/frame-url`：runtime 与 content 同时引用会让 Rollup 抽出一个
   * 共享 chunk，而 MAIN world 的经典脚本不能有 import。桥那边用共享实现，这边保持
   * 自包含（与 canvas / worker 的处理方式一致）。
   */
  function effectiveHostname(): string {
    if (location.hostname) return location.hostname;
    try {
      return new URL(document.referrer).hostname;
    } catch {
      return '';
    }
  }

  // ---------- 应用 ----------

  /**
   * 还原所有补丁。
   *
   * 这是"烘焙包里的排除站点 / 关总开关"能生效的关键：静态 content_scripts 会在
   * document_start 先应用烘焙值，桥随后拿到 `matched: false` 时下发 clear，
   * 这里把原型/全局构造器逐项放回原生。已经存在于页面闭包里的旧引用收不回来，
   * 但之后所有新读取都是原生值。
   */
  function uninstallAll(): void {
    while (restores.length) {
      const restore = restores.pop();
      try { restore?.(); } catch { /* ignore */ }
    }
    // 模块级补丁：各自按安装顺序的逆序还原，没装过的是 no-op
    try { signals.uninstall(); } catch { /* ignore */ }
    try { uninstallGeolocation(); } catch { /* ignore */ }
    try { uninstallCanvasFontPatches(globalThis); } catch { /* ignore */ }
    try { uninstallLocalFontsFilter(globalThis); } catch { /* ignore */ }
    // 最后再还原 toString：上面若有个别还原失败（描述符被锁），至少不会让残留的
    // 包装函数立刻露出源码。正常路径上此时已经没有任何被伪装的函数了。
    try { disguise.uninstall(); } catch { /* ignore */ }

    state.timezone = null;
    state.language = null;
    state.languages = null;
    state.geolocation = null;
    state.geolocationDenied = false;
    state.installedGeo = false;
    state.debug = false;
    state.installedCanvas = false;
    state.installedWorker = false;
    state.canvasTargetFonts = [];
    state.canvasConfig = null;
    canvasFonts.setTargets([]);
  }

  function applySpoof(payload: RuntimePayload): void {
    // clear 是显式指令；null 同样按 clear 处理（后台用 payload: null 表示"这个站点
    // 现在不该有伪装"）。两种情况都必须先还原，否则排除/关闭后旧补丁会一直留着。
    if (!payload || (payload as any).clear === true) {
      uninstallAll();
      return;
    }
    if ((payload as any).extensionEnabled === false || payload.enabled === false) {
      uninstallAll();
      return;
    }

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
    state.geolocationDenied = Boolean(payload.geolocationDenied);

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
    // 定位有三种状态：spoof（有坐标）、deny（启用但解析不出来）、off（不接管）。
    // 前两种都需要装补丁；从 deny/spoof 切到 off 时必须卸载，否则 get() 返回 null
    // 会被 geolocation.ts 当成 deny —— 关掉定位反而把站点拒了。
    const geolocationActive = Boolean(state.geolocation || state.geolocationDenied);
    if (geolocationActive && !state.installedGeo) {
      state.installedGeo = installGeolocation({
        get: () => (state.geolocationDenied ? { deny: true as const } : state.geolocation),
        disguise,
        now: () => NativeDate.now()
      });
    } else if (!geolocationActive && state.installedGeo) {
      uninstallGeolocation();
      state.installedGeo = false;
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
    state.canvasConfig = canvasConfig
      ? { platform: canvasConfig.platform, hideCjkFonts: canvasConfig.hideCjkFonts }
      : null;
    // 先更新目标集合，再装补丁：第一帧 measureText 就要看到正确的字表。
    // canvas 关闭 / spoofFonts 关闭时这里是空集合，等于立即恢复原生度量。
    canvasFonts.setTargets(state.canvasTargetFonts);
    if (canvasConfig) installCanvas(canvasConfig);
    const needCanvas = Boolean(canvasConfig && canvasConfig.spoofFonts && canvasTargets.length);
    if (needTimezone || needLanguage || needLocale || needCanvas) {
      const restoreWorker = installWorker();
      if (restoreWorker) restores.push(restoreWorker);
    }

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
      const payload = resolveBakedPayload(BAKED.config, effectiveHostname(), BAKED.lastLocation || null);
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
      // 回报通道：诊断页要显示"页面实际生效的字体层"。三张字表只存在于这个文件里
      // （注入层必须自包含），所以数字只能由这里给，不能在诊断页另算一份。
      // 端口是私有的，页面看不到这条消息。
      const report = () => {
        try {
          port.postMessage({
            __vanishGeo: NONCE,
            kind: 'fontLayers',
            layers: {
              count: state.canvasTargetFonts ? state.canvasTargetFonts.length : 0,
              platform: (state.canvasConfig && state.canvasConfig.platform) || 'auto',
              hideCjkFonts: Boolean(state.canvasConfig && state.canvasConfig.hideCjkFonts)
            }
          });
        } catch { /* 端口已关闭 */ }
      };
      port.onmessage = (message: MessageEvent) => {
        const payload: any = message.data;
        if (!payload || typeof payload !== 'object' || payload.__vanishGeo !== NONCE) return;
        try {
          applySpoof(payload.payload);
          report();
        } catch { /* ignore */ }
      };
      port.start();
      port.postMessage({ __vanishGeo: 'ack', nonce: NONCE });
    };
    window.addEventListener('message', onHandshake);
  }
})();