import { resolveBakedPayload, type BakedRuntimePayload } from './baked-resolver';
import { installCanvasFontPatches, uninstallCanvasFontPatches } from './canvas-patch';
import { installLocalFontsFilter, uninstallLocalFontsFilter } from './local-fonts';
import { createCanvasFontState } from './canvas-state';
import { createDisguise } from './disguise';
import { defineNativeLike } from './define';
import { buildTargetFontKeys, resolveCanvasTargetFonts } from '../shared/font-aliases';
import { installGeolocation, refreshGeolocationWatchPositions, uninstallGeolocation } from './geolocation';
import { createSignalSpoof } from './signal-spoof';
import { needsLanguagePatch, needsLocalePatch } from './patch-needs';
import { workerPatch } from './worker-patch';
import type { WorkerFallbackReason } from '../shared/worker-coverage';

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
 * 5. 动态桥仍有未关闭的认证缺口；构建 nonce 仅作消息标识，frozen 构建关闭桥。
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

    // 本地字体清单是另一条路：canvas 伪装的是"量出来的宽度 + 画出来的像素"
    // （measureText 与 fillText / strokeText 走同一条回落路径），而 queryLocalFonts
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

  /**
   * 包装失败的上报通道。
   *
   * 端口在握手时收下（见文件末尾），这里只持有引用：拿到之前发生的失败没法上报，
   * 但那种情况只出现在"payload 还没到、补丁还没装"的窗口里，此时也谈不上包装失败。
   */
  let reportPort: MessagePort | null = null;
  /** 同一次文档里同一个 (原因, 脚本) 只报一次，避免循环建 Worker 的页面刷屏 */
  const reportedFallbacks = new Set<string>();

  /**
   * 配置热更新的口令，每个文档随机一份。
   *
   * Worker 的补丁入口是创建时烘焙进 blob 的，跑起来之后唯一的同步手段是 postMessage。
   * 页面同样能往这个 Worker 发消息，文档 token 用来过滤不匹配的配置消息。
   * 它处于页面共享的 MAIN / Worker 环境，不能作为扩展身份认证或抗页面干扰的证明。
   * token 只保存在这份闭包和 Worker 入口里，不进 DOM、不进 storage。
   */
  const workerConfigToken = (() => {
    const bytes = new Uint8Array(16);
    try {
      crypto.getRandomValues(bytes);
    } catch {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    let out = '';
    for (let index = 0; index < bytes.length; index += 1) out += bytes[index].toString(16).padStart(2, '0');
    return out;
  })();

  /**
   * 已创建 Worker 的登记表（配置变化时按它广播）。
   *
   * 优先 WeakRef：Worker 是页面持有的对象，扩展不该因为它曾经存在就把实例钉住。
   * 老宿主没有 WeakRef 时退回强引用，并用条数上限防止无限增长。
   */
  const workerRegistry: Array<{ deref: () => any }> = [];
  const WeakRefCtor: any = (globalThis as any).WeakRef;
  const WORKER_REGISTRY_LIMIT = 256;

  /** 入口地址里的 query / hash 可能带业务参数，回报时只留 origin + path */
  function workerScriptLabel(scriptURL: any): string {
    try {
      const url = new URL(String(scriptURL), location.href);
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return String(scriptURL);
    }
  }

  /**
   * CSP 拒绝 blob 时 Chrome 抛 SecurityError 并在消息里点名 Content Security Policy；
   * 其余构造失败（比如非法 URL）照实记，不硬套成 CSP。
   */
  function classifyWorkerFailure(error: any): WorkerFallbackReason {
    const name = error && error.name ? String(error.name) : '';
    const message = error && error.message ? String(error.message) : String(error || '');
    if (name === 'SecurityError' || /content security policy/i.test(message)) return 'csp-blocked';
    return 'construct-failed';
  }

  function reportWorkerFallback(scriptURL: any, reason: WorkerFallbackReason, error: any): void {
    try {
      if (!reportPort) return;
      const script = workerScriptLabel(scriptURL);
      const key = `${reason}|${script}`;
      if (reportedFallbacks.has(key) || reportedFallbacks.size >= 20) return;
      reportedFallbacks.add(key);
      const message = error && error.message ? String(error.message) : String(error || '');
      reportPort.postMessage({
        __vanishGeo: NONCE,
        kind: 'workerFallback',
        reason,
        script,
        message: message.slice(0, 300)
      });
    } catch { /* 端口可能已经关闭 */ }
  }

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
  function currentWorkerConfig(): {
    timezone: string | null;
    language: string | null;
    languages: string[] | null;
    fontTargets: string[];
    token: string;
  } {
    // 传**展开后**的键集合，而不是原始名字：别名表只在主线程维护一份，
    // Worker 里只需按同一套归一化规则比较，不用再背一份别名数据。
    const fontFamilies = state.canvasTargetFonts || [];
    const fontTargets = fontFamilies.length ? Array.from(buildTargetFontKeys(fontFamilies)) : [];
    return {
      timezone: state.timezone,
      language: state.language,
      languages: state.languages,
      fontTargets,
      token: workerConfigToken
    };
  }

  function currentWorkerPatchSource(): string {
    const config = currentWorkerConfig();
    if (!config.timezone && !config.language && !config.fontTargets.length) return '';
    return buildWorkerPatch(config);
  }

  /**
   * 新 Worker 建好之后：登记 + 立刻同步一次当前配置。
   *
   * 入口里已经烘焙了创建瞬间的同一份配置，但广播一次仍有意义 —— 它能覆盖"入口补丁
   * 已装、配置随后被改/被清空"的时序，并让 live 值与入口快照对齐。
   */
  function trackWorker(worker: any): any {
    try {
      workerRegistry.push(WeakRefCtor ? new WeakRefCtor(worker) : { deref: () => worker });
      if (workerRegistry.length > WORKER_REGISTRY_LIMIT) workerRegistry.shift();
    } catch { /* ignore */ }
    try {
      worker.postMessage({ __vanishGeoWorkerConfig: workerConfigToken, config: currentWorkerConfig() });
    } catch { /* ignore */ }
    return worker;
  }

  /**
   * 把当前配置广播给已创建的 Worker。
   *
   * `disabled` 发的是"关配置"：Worker 内所有补丁入口立即退回原生语义。这是关闭补丁
   * （站点被排除 / 总开关关闭）时存量 Worker 也能真正还原的唯一路径 —— 否则它们会
   * 一直拿着创建时的旧配置继续伪装，页面在主线程和 Worker 里各问一次就能对出来。
   */
  function broadcastWorkerConfig(disabled = false): void {
    if (!workerRegistry.length) return;
    const message = {
      __vanishGeoWorkerConfig: workerConfigToken,
      config: disabled
        ? { disabled: true, timezone: null, language: null, languages: null, fontTargets: [] as string[] }
        : currentWorkerConfig()
    };
    for (let index = workerRegistry.length - 1; index >= 0; index -= 1) {
      let worker: any = null;
      try { worker = workerRegistry[index].deref(); } catch { worker = null; }
      if (!worker) {
        workerRegistry.splice(index, 1);
        continue;
      }
      try {
        worker.postMessage(message);
      } catch {
        // 已终止 / 通道已关：从表里摘掉
        workerRegistry.splice(index, 1);
      }
    }
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
      /**
       * blob 入口是否被 CSP 拒绝。
       *
       * 真 Chrome 实测（worker-src 'self'）：`new Worker(blob:)` **不抛错**，只在稍后
       * 触发一次 error 事件，message 还是空的。也就是说"构造成功"根本不代表能跑 ——
       * 只靠 try/catch 的话，页面自己的 Worker 会直接坏掉，而我们既没回退也没记录。
       *
       * 取值：null = 探测还没回来；true = 被拒；false = 允许。
       * 探测未完成时构造走原生：宁可这一毫秒少伪装一次，也不把页面弄坏。
       */
      let blobWorkerBlocked: boolean | null = null;
      try {
        const probeUrl = URL.createObjectURL(new Blob(['self.postMessage(1);self.close();'], { type: 'text/javascript' }));
        const probe = new NativeWorker(probeUrl);
        let settled = false;
        const finish = (blocked: boolean) => {
          if (settled) return;
          settled = true;
          blobWorkerBlocked = blocked;
          try { probe.terminate(); } catch { /* ignore */ }
          try { URL.revokeObjectURL(probeUrl); } catch { /* ignore */ }
        };
        probe.onmessage = () => finish(false);
        probe.onerror = () => finish(true);
        // 探测本身卡住时按"允许"处理：保持原行为，别因为一次超时永久降级
        setTimeout(() => finish(false), 800);
      } catch {
        // 连探测 Worker 都建不出来：这个文档里 blob 入口用不了
        blobWorkerBlocked = true;
      }

      // construct: true —— 页面会 `new Worker(...)`，必须保持可构造 + 自有 prototype
      const wrapped = disguise(function (this: any, scriptURL: any, options?: any) {
        // 两段分开 catch：
        //  - 生成 blob 失败 → 根本没换入口，回退原生即可（blob-failed）
        //  - 换了入口、构造被 CSP 拒绝 → 页面原本能跑，现在必须回退且**说出来**
        if (blobWorkerBlocked === true) {
          // 探测已经确认 blob 被拒：直接原生入口，并且**说出来**（同一个脚本只报一次）
          reportWorkerFallback(scriptURL, 'csp-blocked', { message: 'blob worker entry blocked by CSP' });
          return new NativeWorker(scriptURL, options);
        }
        if (blobWorkerBlocked === null) {
          return new NativeWorker(scriptURL, options);
        }
        let patchedUrl: string | null = null;
        try {
          patchedUrl = makeWorkerUrl(scriptURL, options);
        } catch (error) {
          reportWorkerFallback(scriptURL, 'blob-failed', error);
          return new NativeWorker(scriptURL, options);
        }
        if (!patchedUrl) return new NativeWorker(scriptURL, options);
        try {
          // 登记 + 立刻同步配置：入口里烘焙的是创建瞬间的快照，之后只能靠消息更新
          return trackWorker(new NativeWorker(patchedUrl, options));
        } catch (error) {
          reportWorkerFallback(scriptURL, classifyWorkerFailure(error), error);
          return new NativeWorker(scriptURL, options);
        }
      }, 'Worker', 1, { construct: true });
      const restorePrototype = adoptPrototype(wrapped, NativeWorker);
      if (restorePrototype) undo.push(restorePrototype);
      replaceGlobal('Worker', wrapped);
    }

    // SharedWorker 故意**不包装**。
    //
    // 包装只能靠"换成带补丁前缀的 blob URL"，而 SharedWorker 的身份就是
    // (resolved URL, name)：blob URL 每次 createObjectURL 都是新的，于是
    //   1. 同一份 (脚本, name) 在不同文档里各建一个实例，跨文档共享语义当场消失
    //      （实测两个标签页各自 connections=1，真共享应该是 1 → 2）；
    //   2. worker 内部的相对 fetch / new Worker 基准变成 blob:，CSP 的
    //      worker-src / script-src 也可能直接拦下；
    //   3. 这些都不是能"修回去"的差异 —— 只能选择放弃共享语义或放弃伪装。
    //
    // 所以这里保留原生构造器：SharedWorker 读到的是**真实的** Date / Intl /
    // navigator，不是"一半伪装"的矛盾值。覆盖面见 shared/worker-coverage.ts，
    // 诊断页与文档都按 UNSUPPORTED 标注，不宣称覆盖。
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
    token: string;
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
    // 先通知存量 Worker 退回原生：它们是独立执行上下文，主线程这边还原了原型，
    // 但 Worker 里的补丁入口仍在跑，不广播就会出现"主线程已关、Worker 还在装"。
    broadcastWorkerConfig(true);
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

    const debug = Boolean(payload.debugMode);

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
    // 判定逻辑在 patch-needs.ts：navigator.language 相同不代表整层语言相同
    // （`en-US` 配 `["en-US","en"]` 首选语言一样、列表不同），所以两条都要比。
    const needLanguage = needsLanguagePatch(
      { language: state.language, languages: nextLanguages },
      { language: signals.native.language, languages: signals.native.languages }
    );
    const needLocale = needsLocalePatch({ language: state.language }, signals.native);

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
    // 补丁只装一次（见上面的 installedGeo），所以坐标变化要主动叫醒正在跑的 watch：
    // 否则页面得等到下一个心跳才知道位置换了。
    if (geolocationActive) refreshGeolocationWatchPositions();
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
    // 配置正在变化：已创建的 Worker 里那份 live 配置必须跟着换，否则页面对比主线程
    // 与本 Worker 的时区/语言就能发现两处不一致。这一步对新建 Worker 是幂等的。
    broadcastWorkerConfig();

    if (debug) {
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
  //    已知安全缺口：页面也能构造握手并从 ack 取得 nonce；构建常量随发行包公开。
  //    当前端口校验不能证明发送者身份，需重新设计隔离侧与 MAIN 的信任边界。
  //
  //    握手只收一次；这也意味着伪造的首次握手可能阻断合法桥。
  if (BRIDGE_ENABLED && NONCE) {
    const onHandshake = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = event.data;
      if (!data || typeof data !== 'object' || data.__vanishGeo !== 'handshake') return;
      const port = event.ports && event.ports[0];
      if (!port) return;
      window.removeEventListener('message', onHandshake);
      reportPort = port;
      // 回报通道：诊断页要显示"页面实际生效的字体层"。三张字表只存在于这个文件里
      // （注入层必须自包含），所以数字只能由这里给，不能在诊断页另算一份。
      // 该回报只用于诊断，不能把端口本身当作身份认证依据。
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
