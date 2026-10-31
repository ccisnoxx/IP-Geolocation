import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { workerPatch } from '../src/injected/worker-patch';
import type { WorkerPatchConfig } from '../src/injected/worker-patch';

/**
 * 在裸 vm 上下文里跑 Worker 补丁。
 *
 * 这个上下文**只有**标准内置对象（没有 jsdom、没有模块作用域）：补丁能跑通就说明
 * 它确实自包含 —— 不是靠 import 了 runtime.ts 里的工具函数才勉强工作的。
 */
function createWorkerContext(config: WorkerPatchConfig, beforePatch = ''): vm.Context {
  const context = vm.createContext({ console });
  vm.runInContext('globalThis.self = globalThis;', context);
  // 真实 WorkerNavigator：值全在原型上，实例零自有属性。用字面量会被自己的
  // 自有属性遮住原型 getter，测出来的是"补丁没生效"这种假失败。
  vm.runInContext(`
    globalThis.WorkerNavigator = function WorkerNavigator() {};
    const define = (key, value) => Object.defineProperty(WorkerNavigator.prototype, key, {
      get() { return value; }, enumerable: true, configurable: true
    });
    define('language', 'zh-CN');
    define('languages', ['zh-CN', 'zh']);
    define('userAgent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
    define('appVersion', '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
    define('platform', 'MacIntel');
    globalThis.navigator = new WorkerNavigator();
  `, context);
  // tsx 会用 esbuild 的 keepNames 把每个函数包成 __name(fn, "fn")，那个 helper 在模块
  // 作用域里。生产构建（vite）不开 keepNames，dist 里没有它（见下面的产物守卫）。
  // 这里按 esbuild 原样补一个，才能在测试环境里跑到和线上一致的等价代码。
  vm.runInContext(
    'globalThis.__name = function (fn, name) { try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch (e) {} return fn; };',
    context
  );
  if (beforePatch) vm.runInContext(beforePatch, context);
  // 最小的 message 通道替身：补丁只在"有 addEventListener 且有口令"时才挂监听，
  // 所以这里有没有它不影响旧用例；热更新用例靠 __dispatch 手动投递一条消息。
  vm.runInContext(`
    globalThis.__listeners = [];
    globalThis.addEventListener = function (type, listener) {
      if (type === 'message' && typeof listener === 'function') __listeners.push(listener);
    };
    globalThis.removeEventListener = function (type, listener) {
      if (type !== 'message') return;
      __listeners = __listeners.filter((item) => item !== listener);
    };
    globalThis.__dispatch = function (data) {
      const event = {
        data,
        stopped: false,
        stopImmediatePropagation() { this.stopped = true; }
      };
      for (const listener of __listeners.slice()) listener(event);
      return event;
    };
  `, context);
  vm.runInContext(`;(${workerPatch.toString()})(${JSON.stringify(config)});`, context);
  return context;
}

function evaluate<T = any>(context: vm.Context, code: string): T {
  return vm.runInContext(code, context) as T;
}

const TOKYO: WorkerPatchConfig = {
  timezone: 'Asia/Tokyo',
  language: 'ja-JP',
  languages: ['ja-JP', 'ja'],
  fontTargets: []
};

test('Worker 里的 navigator 跟着 payload 走', () => {
  const context = createWorkerContext(TOKYO);
  assert.equal(evaluate(context, 'navigator.language'), 'ja-JP');
  // 跨 realm 的数组原型不同，deepStrictEqual 会判不等，先摊到宿主 realm 再比
  assert.deepEqual([...evaluate<string[]>(context, 'navigator.languages')], ['ja-JP', 'ja']);

  // WebIDL 里是 FrozenArray<DOMString>：真机上 push 直接抛 TypeError，
  // 我们返回的普通数组同样不能是可写的 —— 否则第一步就能测出差异
  assert.equal(evaluate<boolean>(context, 'Object.isFrozen(navigator.languages)'), true);
  assert.throws(() => evaluate(context, 'navigator.languages.push("xx")'), /not extensible|read only/i);
  assert.deepEqual([...evaluate<string[]>(context, 'navigator.languages')], ['ja-JP', 'ja']);
});

test('Worker 的 navigator 补丁落在原型上，实例零自有属性', () => {
  const context = createWorkerContext(TOKYO);

  // 原生 WorkerNavigator 的实例没有自有属性；补在实例上会留下 language / languages
  assert.deepEqual([...evaluate<string[]>(context, 'Object.getOwnPropertyNames(navigator)')], []);

  const descriptor = evaluate<any>(
    context,
    'Object.getOwnPropertyDescriptor(WorkerNavigator.prototype, "language")'
  );
  assert.equal(descriptor.enumerable, true, 'WebIDL attribute 必须保持可枚举');
  assert.equal(descriptor.configurable, true);
  assert.equal(
    evaluate(context, 'String(Object.getOwnPropertyDescriptor(WorkerNavigator.prototype, "language").get)'),
    'function get language() { [native code] }'
  );
});

test('Worker 的 navigator.languages 是稳定引用', () => {
  const context = createWorkerContext(TOKYO);
  assert.equal(evaluate(context, 'navigator.languages === navigator.languages'), true);
  assert.equal(evaluate(context, 'Object.isFrozen(navigator.languages)'), true);
});

test('Worker 的 Date getter 用目标时区', () => {
  const context = createWorkerContext(TOKYO);
  const utcMidnight = Date.UTC(2026, 0, 1, 0, 0, 0);

  assert.equal(evaluate(context, `new Date(${utcMidnight}).getTimezoneOffset()`), -540);
  assert.equal(evaluate(context, `new Date(${utcMidnight}).getHours()`), 9);
  assert.equal(evaluate(context, `new Date(${utcMidnight}).getDate()`), 1);
  assert.equal(evaluate(context, `new Date(${utcMidnight}).getFullYear()`), 2026);
  assert.equal(evaluate(context, `new Date(${utcMidnight}).getYear()`), 126);
});

test('Worker 里的 Date setter 落在目标时区（只改 getter 会当场露馅）', () => {
  const context = createWorkerContext(TOKYO);
  const utcMidnight = Date.UTC(2026, 0, 1, 0, 0, 0);
  const tokyoMidnight = Date.UTC(2025, 11, 31, 15, 0, 0);

  // setHours(0,0,0,0) 之后 getHours() 必须是 0：这一条是旧实现最大的破绽
  const afterReset = evaluate<number>(context, `
    (() => {
      const d = new Date(${utcMidnight});
      d.setHours(0, 0, 0, 0);
      return d.getHours() === 0 ? d.getTime() : -1;
    })()
  `);
  assert.equal(afterReset, tokyoMidnight, 'setHours 要把时间落到东京零点');

  assert.equal(evaluate(context, `
    (() => { const d = new Date(${utcMidnight}); d.setDate(15); return d.getDate(); })()
  `), 15);

  assert.equal(evaluate(context, `
    (() => { const d = new Date(${utcMidnight}); d.setFullYear(2030); return d.getFullYear(); })()
  `), 2030);

  assert.equal(evaluate(context, `
    (() => { const d = new Date(${utcMidnight}); d.setMinutes(30); return d.getMinutes(); })()
  `), 30, '改的是墙上时间的分钟，不是 UTC 分钟');
});

test('Worker 里的 new Date(y, m, d) 按目标时区解释', () => {
  const context = createWorkerContext(TOKYO);
  const expected = Date.UTC(2025, 11, 31, 15, 0, 0);
  assert.equal(evaluate(context, 'new Date(2026, 0, 1).getTime()'), expected);
  assert.equal(evaluate(context, 'new Date(2026, 0, 1).getHours()'), 0);
  assert.equal(evaluate(context, 'new Date(2026, 0, 1).getDate()'), 1);
  // 无参 / 单参不能被改语义
  assert.equal(evaluate(context, `new Date(${Date.UTC(2026, 0, 1, 0, 0, 0)}).getTime()`), Date.UTC(2026, 0, 1, 0, 0, 0));
  assert.equal(evaluate(context, 'new Date(2026, 0, 1) instanceof Date'), true);
  assert.equal(evaluate(context, 'Date.prototype.constructor === Date'), true);
});

test('Worker 里的 Intl 默认时区与 locale 对齐', () => {
  const context = createWorkerContext(TOKYO);
  assert.equal(evaluate(context, 'new Intl.DateTimeFormat().resolvedOptions().timeZone'), 'Asia/Tokyo');
  assert.match(evaluate(context, 'new Intl.DateTimeFormat().resolvedOptions().locale'), /^ja/);
  assert.match(evaluate(context, 'new Intl.NumberFormat().resolvedOptions().locale'), /^ja/);

  // 显式传参要尊重调用方
  assert.equal(
    evaluate(context, 'new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions().timeZone'),
    'UTC'
  );
  // 静态方法不能因为包了一层就消失
  assert.equal(evaluate(context, 'typeof Intl.DateTimeFormat.supportedLocalesOf'), 'function');
});

test('Worker 里的 toString / toLocaleString 与 getHours 一致', () => {
  const context = createWorkerContext(TOKYO);
  const utcMidnight = Date.UTC(2026, 0, 1, 0, 0, 0);

  assert.match(evaluate(context, `new Date(${utcMidnight}).toString()`), /Thu Jan 01 2026 09:00:00 GMT\+0900/);
  assert.match(evaluate(context, `new Date(${utcMidnight}).toLocaleString('en-US', { hour12: false })`), /09:00:00/);
});

test('非法日期保持 NaN，不抛异常', () => {
  const context = createWorkerContext(TOKYO);
  assert.equal(Number.isNaN(evaluate(context, 'new Date(NaN).getHours()')), true);
  assert.equal(Number.isNaN(evaluate(context, 'new Date(NaN).getTimezoneOffset()')), true);
  assert.equal(Number.isNaN(evaluate(context, '(() => { const d = new Date(NaN); d.setHours(0); return d.getTime(); })()')), true);
});

test('没有可补丁的目标时不改任何东西', () => {
  const context = createWorkerContext({ timezone: null, language: null, languages: null, fontTargets: [] });
  assert.equal(evaluate(context, 'navigator.language'), 'zh-CN');
  assert.equal(evaluate(context, 'new Date(0).getTimezoneOffset()'), new Date(0).getTimezoneOffset());
  assert.equal(evaluate(context, 'new Intl.DateTimeFormat().resolvedOptions().timeZone'), new Intl.DateTimeFormat().resolvedOptions().timeZone);
});
test('补丁后的函数与原生的 name / length 一致', () => {
  const context = createWorkerContext(TOKYO);

  // name + length 是最廉价的一致性检查，任何一项对不上都会暴露"函数被换过"
  const expected: Array<[string, number]> = [
    ['setFullYear', 3], ['setMonth', 2], ['setDate', 1], ['setHours', 4],
    ['setMinutes', 3], ['setSeconds', 2], ['setMilliseconds', 1],
    ['getFullYear', 0], ['getHours', 0], ['getTimezoneOffset', 0],
    ['toString', 0], ['toLocaleString', 0]
  ];
  for (const [name, length] of expected) {
    assert.equal(evaluate(context, `Date.prototype.${name}.name`), name, `${name}.name`);
    assert.equal(evaluate(context, `Date.prototype.${name}.length`), length, `${name}.length`);
  }
  assert.equal(evaluate(context, 'Date.length'), 7);
  assert.equal(evaluate(context, 'Intl.DateTimeFormat.length'), 0);

  // toString 必须还是 [native code]
  assert.match(evaluate(context, 'Date.prototype.setHours.toString()'), /\[native code\]/);
  assert.match(evaluate(context, 'Date.toString()'), /\[native code\]/);
});

test('Worker 里的字符串日期按目标时区解释，非法日期保持 Invalid Date', () => {
  const context = createWorkerContext(TOKYO);

  // 无时区后缀 = 本地时间 → 东京本地 00:00 == UTC 前一天 15:00
  assert.equal(evaluate(context, "new Date('2026-01-01T00:00:00').toISOString()"), '2025-12-31T15:00:00.000Z');
  assert.equal(evaluate(context, "new Date('2026-01-01T00:00:00').getHours()"), 0);
  // 纯日期按规范是 UTC
  assert.equal(evaluate(context, "new Date('2026-01-01').getHours()"), 9);
  // 带时区标记的是绝对时间
  assert.equal(evaluate(context, "new Date('2026-01-01T00:00:00Z').getHours()"), 9);
  // Date.parse 与构造函数说同一句话
  assert.equal(
    evaluate(context, "Date.parse('2026-01-01T00:00:00')"),
    evaluate(context, "new Date('2026-01-01T00:00:00').getTime()")
  );

  // 非法日期三件套都必须是原生那一条，拼接会得到 "Invalid Date Invalid Date"
  assert.equal(evaluate(context, "new Date('nope').toString()"), 'Invalid Date');
  assert.equal(evaluate(context, "new Date('nope').toDateString()"), 'Invalid Date');
  assert.equal(evaluate(context, "new Date('nope').toTimeString()"), 'Invalid Date');
});

test('Worker 里的函数签名与原生同形（不用 Proxy）', () => {
  const context = createWorkerContext(TOKYO);
  assert.equal(evaluate(context, 'Date.prototype.setHours.toString()'), 'function setHours() { [native code] }');
  assert.equal(evaluate(context, 'Date.prototype.getHours.toString()'), 'function getHours() { [native code] }');
  assert.equal(evaluate(context, 'Function.prototype.toString.toString()'), 'function toString() { [native code] }');
  // 页面自己的函数不受影响
  assert.equal(
    evaluate(context, 'Function.prototype.toString.call(function pageFn(a) { return a; }).indexOf("pageFn") > 0'),
    true
  );
});

test('Worker 不接管 fonts.check（原生对系统字体本来就返回 true）', () => {
  const context = vm.createContext({ console });
  vm.runInContext('globalThis.self = globalThis;', context);
  vm.runInContext('globalThis.navigator = { language: "zh-CN", languages: ["zh-CN"] };', context);
  vm.runInContext(
    'globalThis.__name = function (fn, name) { try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch (e) {} return fn; };',
    context
  );
  // 一个会记账的假 FontFaceSet：被接管的话 calls 会增加
  vm.runInContext(
    'globalThis.calls = 0; globalThis.fonts = { check: function check(font) { globalThis.calls += 1; return true; } };'
      + 'globalThis.checkBefore = globalThis.fonts.check;',
    context
  );
  const config: WorkerPatchConfig = { ...TOKYO, fontTargets: ['Helvetica', 'Arial'] };
  vm.runInContext(`;(${workerPatch.toString()})(${JSON.stringify(config)});`, context);

  assert.equal(vm.runInContext('fonts.check("12px Helvetica")', context), true);
  assert.equal(vm.runInContext('globalThis.calls', context), 1, '必须落到原生实现上');
  assert.equal(vm.runInContext('fonts.check === globalThis.checkBefore', context), true, '函数本身不该被替换');
});

// ---------- Worker 里的字体度量：别名与字重 ----------

/** 建一个假 OffscreenCanvas 2D 上下文，原生实现按 font 串返回固定宽度 */
function createCanvasWorkerContext(fontTargets: string[]): vm.Context {
  return createWorkerContext(
    { timezone: null, language: null, languages: null, fontTargets },
    `
      globalThis.__widths = {};
      class FakeCtx {
        constructor() { this.font = '10px monospace'; }
        measureText(text) {
          // 原生行为：字体名存在于表里就用它的宽度，否则用 monospace 的
          const declared = (this.font.match(/"([^"]+)"/) || [])[1];
          const width = (declared && globalThis.__widths[declared]) || 100;
          return { width: width + text.length };
        }
      }
      globalThis.__widths['SimSun'] = 999;
      globalThis.__widths['宋体'] = 999;
      globalThis.__widths['PingFang SC'] = 777;
      // 列表外的字体：假定它真的装着，宽度与 monospace 不同
      globalThis.__widths['Helvetica'] = 555;
      globalThis.OffscreenCanvasRenderingContext2D = FakeCtx;
      globalThis.__nativeMeasureText = FakeCtx.prototype.measureText;
    `
  );
}

const measure = (context: vm.Context, font: string): number =>
  vm.runInContext(`(() => { const c = new OffscreenCanvasRenderingContext2D(); c.font = ${JSON.stringify(font)}; return c.measureText('x').width; })()`, context);

test('Worker 替换原型上的 measureText，实例不增加自有方法', () => {
  const context = createCanvasWorkerContext(['SimSun']);
  assert.equal(vm.runInContext('Object.prototype.hasOwnProperty.call(OffscreenCanvasRenderingContext2D.prototype, "measureText")', context), true);
  assert.equal(evaluate(context, 'OffscreenCanvasRenderingContext2D.prototype.measureText === __nativeMeasureText'), false);
  assert.equal(evaluate(context, 'Object.hasOwn(new OffscreenCanvasRenderingContext2D(), "measureText")'), false);
});

test('Worker 的 measureText 保留原生描述符的 enumerable', () => {
  const context = createWorkerContext(
    { timezone: null, language: null, languages: null, fontTargets: ['SimSun'] },
    `
      class FakeCtx { constructor() { this.font = '10px monospace'; } }
      Object.defineProperty(FakeCtx.prototype, 'measureText', {
        value: function () { return { width: 1 }; },
        writable: true,
        enumerable: true,
        configurable: true
      });
      globalThis.OffscreenCanvasRenderingContext2D = FakeCtx;
    `
  );
  assert.equal(
    evaluate(context, 'Object.getOwnPropertyDescriptor(OffscreenCanvasRenderingContext2D.prototype, "measureText").enumerable'),
    true
  );
});

test('Worker 里被伪装字体与 monospace 等宽（拉丁名）', () => {
  const context = createCanvasWorkerContext(['SimSun']);
  assert.equal(measure(context, '72px "SimSun", monospace'), measure(context, '72px monospace'));
});

test('Worker 里传入的是展开后的键：本地化名字同样命中', () => {
  // 主线程把 beans 展开成 ['simsun', '宋体', ...] 再交给 Worker
  const context = createCanvasWorkerContext(['simsun', '宋体']);
  assert.equal(measure(context, '72px "宋体", serif'), measure(context, '72px serif'));
  assert.equal(measure(context, '72px "SimSun", serif'), measure(context, '72px serif'));
});

test('Worker 里尾随字重不影响匹配', () => {
  const context = createCanvasWorkerContext(['pingfangsc']);
  assert.equal(measure(context, '72px "PingFang SC Light", monospace'), measure(context, '72px monospace'));
});

test('Worker 不误伤列表外的字体', () => {
  const context = createCanvasWorkerContext(['simsun', '宋体']);
  const declared = measure(context, '72px "Helvetica", monospace');
  const mono = measure(context, '72px monospace');
  assert.notEqual(declared, mono, 'Helvetica 不在列表里，应该走原生度量');
});

test('Worker 度量结束还原 font 串', () => {
  const context = createCanvasWorkerContext(['SimSun']);
  const value = vm.runInContext(`(() => {
    const c = new OffscreenCanvasRenderingContext2D();
    c.font = '72px "SimSun", monospace';
    c.measureText('x');
    return c.font;
  })()`, context);
  assert.match(value, /SimSun/);
});

// ---------- 绘制面：Worker 里的 fillText / strokeText ----------

/**
 * 主线程和 Worker 必须同时覆盖绘制，否则检测方换个执行上下文再问一次就露馅：
 * 主线程说"字体缺失"，Worker 里的 fillText 却仍按真实字形落像素。
 */
const CANVAS_SETUP = `
  globalThis.OffscreenCanvasRenderingContext2D = function OffscreenCanvasRenderingContext2D() {
    this.font = '10px monospace';
  };
  globalThis.__draws = [];
  OffscreenCanvasRenderingContext2D.prototype.measureText = function (text) {
    return { width: this.font.length + String(text).length };
  };
  OffscreenCanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
    __draws.push({ kind: 'fillText', font: this.font, argc: arguments.length });
  };
  OffscreenCanvasRenderingContext2D.prototype.strokeText = function (text, x, y, maxWidth) {
    __draws.push({ kind: 'strokeText', font: this.font, argc: arguments.length });
  };
`;

const FONT_CONFIG: WorkerPatchConfig = {
  timezone: 'Asia/Tokyo',
  language: 'ja-JP',
  languages: ['ja-JP', 'ja'],
  fontTargets: ['SimSun']
};

function readJson<T>(context: vm.Context, expression: string): T {
  return JSON.parse(evaluate<string>(context, `JSON.stringify(${expression})`)) as T;
}

test('Worker 的 fillText / strokeText 与 measureText 走同一条回落路径', () => {
  const context = createWorkerContext(FONT_CONFIG, CANVAS_SETUP);
  const result = readJson<{
    draws: Array<{ kind: string; font: string; argc: number }>;
    font: string;
    declared: string;
    measure: number;
    fallbackLength: number;
  }>(context, `(() => {
    const ctx = new OffscreenCanvasRenderingContext2D();
    const declared = '72px "SimSun", monospace';
    ctx.font = declared;
    const measure = ctx.measureText('汉').width;
    ctx.fillText('汉', 1, 2);
    ctx.strokeText('汉', 1, 2, 40);
    return {
      draws: __draws,
      font: ctx.font,
      declared: declared,
      measure: measure,
      fallbackLength: '72px monospace'.length
    };
  })()`);

  assert.deepEqual(result.draws.map((draw) => draw.font), ['72px monospace', '72px monospace']);
  assert.deepEqual(result.draws.map((draw) => draw.argc), [3, 4], 'maxWidth 只按实参个数转发');
  // 度量用的也是改写后的串，否则像素与宽度会对不上
  assert.equal(result.measure, result.fallbackLength + 1);
  // 读回仍是页面写进去的原串
  assert.equal(result.font, result.declared);
});

test('Worker 绘制方法的签名与原生同形（name / length / toString / enumerable）', () => {
  const context = createWorkerContext(FONT_CONFIG, CANVAS_SETUP);
  const meta = readJson<Record<string, { name: string; length: number; enumerable: boolean; source: string }>>(
    context,
    `(() => {
      const proto = OffscreenCanvasRenderingContext2D.prototype;
      const out = {};
      for (const key of ['fillText', 'strokeText']) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        out[key] = {
          name: proto[key].name,
          length: proto[key].length,
          enumerable: descriptor.enumerable,
          source: String(proto[key])
        };
      }
      return out;
    })()`
  );

  for (const key of ['fillText', 'strokeText']) {
    assert.equal(meta[key].name, key);
    assert.equal(meta[key].length, 4);
    assert.equal(meta[key].enumerable, true, 'WebIDL operation 在原型上是可枚举的');
    assert.equal(meta[key].source, `function ${key}() { [native code] }`);
  }
});

test('没有目标字体时 Worker 的绘制原样透传', () => {
  const context = createWorkerContext({ ...FONT_CONFIG, fontTargets: [] }, CANVAS_SETUP);
  const result = readJson<{ draws: Array<{ font: string; argc: number }>; declared: string }>(
    context,
    `(() => {
      const ctx = new OffscreenCanvasRenderingContext2D();
      const declared = '16px Arial';
      ctx.font = declared;
      ctx.fillText('x', 0, 0);
      return { draws: __draws, declared: declared };
    })()`
  );
  assert.equal(result.draws[0].font, result.declared);
  assert.equal(result.draws[0].argc, 3);
});

// ---------- 9 类 Intl 覆盖 ----------

/**
 * 主线程包了 9 类 Intl 构造器，Worker 只包 2 类的话，页面只要在 Worker 里问一句
 * `new Intl.Collator().resolvedOptions().locale` 就能看出"主线程被动过、Worker 没动"。
 * 这里逐类钉住默认 locale —— 少一类就红。
 */
test('Worker 的 9 类 Intl 构造器都跟着 payload 走', () => {
  const context = createWorkerContext(TOKYO);
  const expressions: Array<[string, string]> = [
    ['DateTimeFormat', 'new Intl.DateTimeFormat().resolvedOptions().locale'],
    ['NumberFormat', 'new Intl.NumberFormat().resolvedOptions().locale'],
    ['Collator', 'new Intl.Collator().resolvedOptions().locale'],
    ['RelativeTimeFormat', 'new Intl.RelativeTimeFormat().resolvedOptions().locale'],
    ['PluralRules', 'new Intl.PluralRules().resolvedOptions().locale'],
    ['ListFormat', 'new Intl.ListFormat().resolvedOptions().locale'],
    ['DisplayNames', 'new Intl.DisplayNames(undefined, { type: "language" }).resolvedOptions().locale'],
    ['Segmenter', 'new Intl.Segmenter().resolvedOptions().locale'],
    ['DurationFormat', 'new Intl.DurationFormat().resolvedOptions().locale']
  ];
  for (const [name, expression] of expressions) {
    // DurationFormat 需要较新的 V8（Node 23+ / Chrome 129+）；宿主没有就无从比较
    if (name === 'DurationFormat' && evaluate(context, `typeof Intl.${name}`) !== 'function') continue;
    assert.equal(evaluate(context, `typeof Intl.${name}`), 'function', `${name} 不存在`);
    assert.match(evaluate(context, expression), /^ja/, `${name} 的默认 locale 没跟着 payload`);
  }
});

test('Worker 的 Intl 构造器保留原型与静态方法（换壳不能换身份）', () => {
  const context = createWorkerContext(TOKYO);
  for (const name of ['Collator', 'PluralRules', 'Segmenter', 'ListFormat']) {
    assert.equal(evaluate(context, `Intl.${name}.prototype === Object.getPrototypeOf(new Intl.${name}())`), true, `${name}.prototype`);
    assert.equal(evaluate(context, `typeof Intl.${name}.supportedLocalesOf`), 'function', `${name}.supportedLocalesOf`);
  }
  // resolvedOptions 仍然来自真正的原生原型，不是自己重写的
  assert.match(evaluate(context, 'String(Intl.Collator.prototype.resolvedOptions)'), /native code/);
});

// ---------- 配置热更新 ----------

const HOT_ZONE = 'America/New_York';

test('Worker 热更新：带口令的关配置让所有入口退回原生', () => {
  const token = 'live-token-1';
  const context = createWorkerContext({ ...TOKYO, token });
  // 先确认补丁真的在
  assert.equal(evaluate(context, 'navigator.language'), 'ja-JP');
  assert.equal(evaluate(context, 'new Date(0).getTimezoneOffset()'), -540);

  const event = evaluate<any>(
    context,
    `__dispatch({ __vanishGeoWorkerConfig: ${JSON.stringify(token)}, config: { disabled: true, timezone: null, language: null, languages: null, fontTargets: [] } })`
  );
  assert.equal(event.stopped, true, '命中口令后要 stopImmediatePropagation，别让页面自己的监听器看到配置');

  // 全部回到原生值：navigator、Date、Intl 三处一起
  assert.equal(evaluate(context, 'navigator.language'), 'zh-CN');
  assert.deepEqual([...evaluate<string[]>(context, 'navigator.languages')], ['zh-CN', 'zh']);
  assert.equal(evaluate(context, 'new Date(0).getTimezoneOffset()'), new Date(0).getTimezoneOffset());
  assert.equal(
    evaluate(context, 'new Intl.DateTimeFormat().resolvedOptions().timeZone'),
    new Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  assert.equal(evaluate(context, 'new Intl.Collator().resolvedOptions().locale'), new Intl.Collator().resolvedOptions().locale);
});

test('Worker 热更新：token 不匹配或缺失的配置消息被丢弃', () => {
  const token = 'live-token-2';
  const context = createWorkerContext({ ...TOKYO, token });
  evaluate(context, `__dispatch({ __vanishGeoWorkerConfig: "guess", config: { disabled: true } })`);
  evaluate(context, `__dispatch({ config: { disabled: true } })`);
  evaluate(context, `__dispatch(null)`);
  assert.equal(evaluate(context, 'navigator.language'), 'ja-JP');
  assert.equal(evaluate(context, 'new Date(0).getTimezoneOffset()'), -540);
});

test('Worker 热更新：换时区与语言后新值立即生效', () => {
  const token = 'live-token-3';
  const context = createWorkerContext({ ...TOKYO, token });
  evaluate(
    context,
    `__dispatch({ __vanishGeoWorkerConfig: ${JSON.stringify(token)}, config: ${JSON.stringify({
      timezone: HOT_ZONE, language: 'en-US', languages: ['en-US', 'en'], fontTargets: []
    })} })`
  );
  assert.equal(evaluate(context, 'new Date(0).getTimezoneOffset()'), 300);
  assert.match(evaluate(context, 'new Date(0).toString()'), /GMT-0500/);
  assert.equal(evaluate(context, 'navigator.language'), 'en-US');
  assert.deepEqual([...evaluate<string[]>(context, 'navigator.languages')], ['en-US', 'en']);
  assert.equal(evaluate(context, 'new Intl.Collator().resolvedOptions().locale'), 'en-US');
});

test('Worker 创建时没有配置，之后仍能被接管（晚注入的兜底）', () => {
  const token = 'live-token-4';
  const context = createWorkerContext({ token });
  assert.equal(evaluate(context, 'navigator.language'), 'zh-CN');

  evaluate(
    context,
    `__dispatch({ __vanishGeoWorkerConfig: ${JSON.stringify(token)}, config: ${JSON.stringify({
      timezone: 'Asia/Tokyo', language: 'ja-JP', languages: ['ja-JP', 'ja'], fontTargets: []
    })} })`
  );
  assert.equal(evaluate(context, 'navigator.language'), 'ja-JP');
  assert.equal(evaluate(context, 'new Date(0).getTimezoneOffset()'), -540);
  assert.equal(evaluate(context, 'new Intl.DateTimeFormat().resolvedOptions().timeZone'), 'Asia/Tokyo');
});

test('Worker 热更新不改变 navigator.languages 的稳定引用语义', () => {
  const token = 'live-token-5';
  const context = createWorkerContext({ ...TOKYO, token });
  evaluate(context, 'globalThis.languagesBeforeUpdate = navigator.languages');
  evaluate(
    context,
    `__dispatch({ __vanishGeoWorkerConfig: ${JSON.stringify(token)}, config: ${JSON.stringify({
      timezone: 'Asia/Tokyo', language: 'ja-JP', languages: ['ja-JP', 'ja'], fontTargets: []
    })} })`
  );
  // 值没变 → 引用不能变（页面会缓存 navigator.languages 再比 ===）
  assert.equal(evaluate(context, 'navigator.languages === languagesBeforeUpdate'), true);
  assert.equal(evaluate(context, 'Object.isFrozen(navigator.languages)'), true);
});

// ---------- 原生语义 ----------

test('Worker 的 Date() 返回目标时区字符串，无时区或关闭后保持原生调用语义', () => {
  const context = createWorkerContext({ ...TOKYO, token: 'date-call' }, 'globalThis.nativeDateCall = Date;');
  assert.equal(evaluate(context, 'typeof Date()'), 'string');
  assert.match(evaluate(context, 'Date()'), /GMT\+0900/);
  assert.match(evaluate(context, 'Date(0)'), /GMT\+0900/);

  evaluate(context, '__dispatch({ __vanishGeoWorkerConfig: "date-call", config: { disabled: true } })');
  assert.equal(evaluate(context, 'typeof Date()'), 'string');
  assert.equal(evaluate(context, 'Date().slice(25)'), evaluate(context, 'nativeDateCall().slice(25)'));

  const languageOnly = createWorkerContext({ language: 'ja-JP', languages: ['ja-JP'] });
  assert.equal(evaluate(languageOnly, 'typeof Date()'), 'string');
});

test('Worker 的 Date 构造器保留子类语义（new.target 不能被吞掉）', () => {
  const context = createWorkerContext(TOKYO);
  assert.equal(evaluate(context, '(() => { class D extends Date {}; return new D() instanceof D; })()'), true);
  assert.equal(evaluate(context, '(() => { class D extends Date {}; return new D(0) instanceof Date; })()'), true);
  // 无参构造、字符串构造也要走同一条 new.target 路径
  assert.equal(evaluate(context, '(() => { class D extends Date {}; return new D("2026-01-01T00:00:00Z") instanceof D; })()'), true);
});

test('Worker 的 Date() 不调用页面后来覆盖的日期方法', () => {
  for (const method of [
    'toString', 'toDateString', 'toTimeString', 'valueOf', 'getTime',
    'getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCDay',
    'getUTCHours', 'getUTCMinutes', 'getUTCSeconds'
  ]) {
    const context = createWorkerContext(TOKYO);
    evaluate(context, `Date.prototype.${method} = () => { throw new Error('page override'); };`);
    assert.match(evaluate(context, 'Date()'), /GMT\+0900/);
  }
});

test('Worker 的 setFullYear 在 Invalid Date 上仍能成功（规范特例）', () => {
  const context = createWorkerContext(TOKYO);
  assert.equal(evaluate(context, 'Number.isFinite(new Date(NaN).setFullYear(2026))'), true);
  // 其余 setter 在 Invalid Date 上必须保持 NaN
  assert.equal(evaluate(context, 'Number.isNaN(new Date(NaN).setMonth(0))'), true);
});

// Worker 里的 Temporal / 默认 locale 入口：vm 上下文没有 Temporal，补丁前放一个记录入参的替身
const FAKE_TEMPORAL = `
  globalThis.__calls = [];
  const record = (key, result) => function (...args) { __calls.push({ key, args }); return result(...args); };
  const Now = {};
  for (const key of ['instant', 'timeZoneId', 'plainDateTimeISO', 'zonedDateTimeISO', 'plainDateISO', 'plainTimeISO']) {
    Object.defineProperty(Now, key, {
      value: record(key, (zone) => key === 'timeZoneId' ? 'Asia/Shanghai' : key + ':' + String(zone)),
      writable: true, enumerable: false, configurable: true
    });
  }
  globalThis.Temporal = { Now };
  for (const name of ['Instant', 'ZonedDateTime', 'Duration']) {
    const Type = function () {};
    Object.defineProperty(Type.prototype, 'toLocaleString', {
      value: record(name, () => name), writable: true, enumerable: false, configurable: true
    });
    Temporal[name] = Type;
  }
  globalThis.__last = (key) => __calls.filter((call) => call.key === key).pop();
`;

test('Worker 的 Temporal 跟着目标时区走，Instant 补时区、ZonedDateTime 只补 locale', () => {
  const context = createWorkerContext({ ...TOKYO, language: 'de-DE', languages: ['de-DE'] }, FAKE_TEMPORAL);
  assert.equal(evaluate(context, 'Temporal.Now.timeZoneId()'), 'Asia/Tokyo');
  assert.equal(evaluate(context, 'Temporal.Now.plainDateTimeISO()'), 'plainDateTimeISO:Asia/Tokyo');
  assert.equal(evaluate(context, 'Temporal.Now.zonedDateTimeISO("UTC")'), 'zonedDateTimeISO:UTC');
  evaluate(context, 'Temporal.Instant.prototype.toLocaleString.call({})');
  assert.equal(evaluate(context, '__last("Instant").args[0]'), 'de-DE');
  assert.equal(evaluate(context, '__last("Instant").args[1].timeZone'), 'Asia/Tokyo');
  evaluate(context, 'Temporal.ZonedDateTime.prototype.toLocaleString.call({})');
  assert.equal(evaluate(context, '__last("ZonedDateTime").args[0]'), 'de-DE');
  assert.equal(evaluate(context, '__last("ZonedDateTime").args[1]'), undefined);
  assert.equal(evaluate(context, 'Object.getOwnPropertyDescriptor(Temporal.Now, "timeZoneId").enumerable'), false);
  assert.equal(evaluate(context, 'Function.prototype.toString.call(Temporal.Now.timeZoneId)'), 'function timeZoneId() { [native code] }');
});

test('Worker 的 Number / String / DurationFormat 默认 locale 跟着目标语言走', () => {
  const context = createWorkerContext({ ...TOKYO, language: 'de-DE', languages: ['de-DE'] });
  assert.equal(evaluate(context, '(1234.5).toLocaleString()'), '1.234,5');
  assert.equal(evaluate(context, '(12345678n).toLocaleString()'), '12.345.678');
  assert.equal(evaluate(context, '(1234.5).toLocaleString("en-US")'), '1,234.5');
  if (evaluate(context, 'typeof Intl.DurationFormat') === 'function') {
    assert.equal(evaluate(context, 'new Intl.DurationFormat().resolvedOptions().locale'), 'de-DE');
  }
  const sv = createWorkerContext({ ...TOKYO, language: 'sv-SE', languages: ['sv-SE'] });
  assert.equal(evaluate(sv, '"ä".localeCompare("z")'), 1);
  const tr = createWorkerContext({ ...TOKYO, language: 'tr-TR', languages: ['tr-TR'] });
  assert.equal(evaluate(tr, '"i".toLocaleUpperCase()'), 'İ');
});

test('Worker 没有配置时 Temporal 与 locale 入口原样交还原生', () => {
  const context = createWorkerContext({ timezone: null, language: null, languages: null, fontTargets: [] }, FAKE_TEMPORAL);
  assert.equal(evaluate(context, 'Temporal.Now.timeZoneId()'), 'Asia/Shanghai');
  assert.equal(evaluate(context, 'Temporal.Now.plainDateTimeISO()'), 'plainDateTimeISO:undefined');
  assert.equal(evaluate(context, '(1234.5).toLocaleString()'), (1234.5).toLocaleString());
});

// ---------- 嵌套 Worker ----------

// vm 上下文没有 Worker / Blob / URL：放记录行为的替身。URL 只实现本用例需要的相对解析。
const NESTED_SETUP = `
  globalThis.__created = [];
  globalThis.__blobs = [];
  globalThis.location = { href: 'blob:https://example.com/parent-entry' };
  globalThis.URL = function URL(input, base) {
    const text = String(input);
    if (/^[a-z]+:/i.test(text)) { this.href = text; return; }
    if (!base || /^blob:/.test(base)) throw new TypeError('Invalid URL');
    this.href = String(base).replace(/[^/]*$/, '') + text;
  };
  URL.createObjectURL = function (blob) { __blobs.push(blob.text); return 'blob:fake/' + __blobs.length; };
  globalThis.Blob = function Blob(parts) { this.text = parts.join(''); };
  globalThis.Worker = function Worker(url, options) {
    this.url = url;
    this.options = options;
    this.posted = [];
    __created.push(this);
  };
  Worker.prototype.postMessage = function (message) { this.posted.push(message); };
`;
const NESTED_CONFIG: WorkerPatchConfig = { ...TOKYO, token: 'nest-token', baseUrl: 'https://example.com/w/parent.js' };

test('嵌套 Worker：入口换成带补丁的 blob，相对路径按原脚本地址解析', () => {
  const context = createWorkerContext(NESTED_CONFIG, NESTED_SETUP);
  evaluate(context, 'globalThis.__child = new Worker("child.js")');
  assert.equal(evaluate(context, '__child.url'), 'blob:fake/1');
  const body = evaluate<string>(context, '__blobs[0]');
  assert.match(body, /^"use strict";\(function workerPatch\(/, '入口仍是 strict 的具名函数表达式');
  assert.ok(body.includes('importScripts("https://example.com/w/child.js")'), '按原脚本地址解析，而不是 blob: 上的 location');
  const config = JSON.parse(body.slice(body.indexOf('})({') + 3, body.lastIndexOf(');\n')));
  assert.equal(config.timezone, 'Asia/Tokyo');
  assert.equal(config.language, 'ja-JP');
  assert.equal(config.token, 'nest-token', '子 Worker 认同一口令，才能收到转发的配置更新');
  assert.equal(config.baseUrl, 'https://example.com/w/child.js', '再往下一层也按子脚本地址解析');

  evaluate(context, 'new Worker("mod.js", { type: "module" })');
  assert.ok(evaluate<string>(context, '__blobs[1]').includes('await import("https://example.com/w/mod.js")'));
});

test('嵌套 Worker 构造器保持原生形状', () => {
  const context = createWorkerContext(NESTED_CONFIG, NESTED_SETUP);
  assert.equal(evaluate(context, 'new Worker("child.js") instanceof Worker'), true);
  assert.equal(evaluate(context, 'Worker.name'), 'Worker');
  assert.equal(evaluate(context, 'Worker.length'), 1);
  assert.equal(evaluate(context, 'Worker.prototype.constructor === Worker'), true);
  assert.equal(evaluate(context, 'Function.prototype.toString.call(Worker)'), 'function Worker() { [native code] }');
});

test('嵌套 Worker：带口令的配置更新转发给子 Worker，口令不对不转发', () => {
  const context = createWorkerContext(NESTED_CONFIG, NESTED_SETUP);
  evaluate(context, 'globalThis.__child = new Worker("child.js")');
  evaluate(context, '__dispatch({ __vanishGeoWorkerConfig: "guess", config: { disabled: true } })');
  assert.equal(evaluate(context, '__child.posted.length'), 0);
  evaluate(context, '__dispatch({ __vanishGeoWorkerConfig: "nest-token", config: { disabled: true } })');
  assert.equal(evaluate(context, '__child.posted.length'), 1);
  assert.equal(evaluate(context, '__child.posted[0].config.disabled'), true);

  // 关配置之后再建的子 Worker 直接走原生入口（解析过的绝对地址）
  evaluate(context, 'globalThis.__plain = new Worker("plain.js")');
  assert.equal(evaluate(context, '__plain.url'), 'https://example.com/w/plain.js');
});

test('嵌套 Worker 的入口源码可以独立运行：孙 Worker 拿到伪装值，并能继续往下嵌套', () => {
  const parent = createWorkerContext(NESTED_CONFIG, NESTED_SETUP);
  evaluate(parent, 'new Worker("child.js")');
  const body = evaluate<string>(parent, '__blobs[0]');

  // 新上下文 = 子 Worker 自己的全局：与 createWorkerContext 相同的 navigator / __name / 消息替身
  const child = vm.createContext({ console });
  vm.runInContext('globalThis.self = globalThis;', child);
  vm.runInContext(`
    globalThis.WorkerNavigator = function WorkerNavigator() {};
    Object.defineProperty(WorkerNavigator.prototype, 'language', { get() { return 'zh-CN'; }, enumerable: true, configurable: true });
    Object.defineProperty(WorkerNavigator.prototype, 'languages', { get() { return ['zh-CN']; }, enumerable: true, configurable: true });
    globalThis.navigator = new WorkerNavigator();
    globalThis.__name = function (fn, name) { try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch (e) {} return fn; };
    globalThis.addEventListener = function () {};
    globalThis.__imported = [];
    globalThis.importScripts = function (url) { __imported.push(url); };
  `, child);
  vm.runInContext(NESTED_SETUP, child);
  vm.runInContext(body, child);
  assert.equal(vm.runInContext('navigator.language', child), 'ja-JP');
  assert.equal(vm.runInContext('new Date(0).getTimezoneOffset()', child), -540);
  assert.deepEqual([...vm.runInContext('__imported', child)], ['https://example.com/w/child.js']);
  vm.runInContext('new Worker("grandchild.js")', child);
  assert.ok(vm.runInContext('__blobs[0]', child).includes('importScripts("https://example.com/w/grandchild.js")'));
});
