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

test('Worker 补丁自包含：裸上下文里能直接执行', () => {
  const context = createWorkerContext(TOKYO);
  assert.equal(evaluate(context, 'typeof Date'), 'function');
});

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
    `
  );
}

const measure = (context: vm.Context, font: string): number =>
  vm.runInContext(`(() => { const c = new OffscreenCanvasRenderingContext2D(); c.font = ${JSON.stringify(font)}; return c.measureText('x').width; })()`, context);

test('Worker 只补一次：补丁后 measureText 落在原型上', () => {
  const context = createCanvasWorkerContext(['SimSun']);
  assert.equal(vm.runInContext('Object.prototype.hasOwnProperty.call(OffscreenCanvasRenderingContext2D.prototype, "measureText")', context), true);
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
