import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createDisguise } from '../src/injected/disguise';
import { workerPatch } from '../src/injected/worker-patch';

/**
 * 「原生形状」的反射面。
 *
 * 补丁层一直声称"页面分辨不出来"，但可观测的东西不止 `Function.prototype.toString`
 * 的输出和描述符 flags：
 *
 *   Object.getOwnPropertyNames(Function.prototype.toString)   // 原生 ['length','name']
 *   Reflect.construct(function () {}, [], Function.prototype.toString)  // 原生 TypeError
 *
 * 普通函数表达式（尤其 sloppy 代码里的）会多出自有 `prototype` / `arguments` / `caller`，
 * 而且能被当成 newTarget —— 三行反射就能确认 `toString` 被换过。下面的用例钉住这三件事。
 */

const NATIVE = (() => {
  // 取一份干净的参照物：测试进程自己的内建函数（tsx 以 ESM 跑，本模块是 strict，
  // 所以这里拿到的是"原生内建"的形状，而不是被补丁改过的对象）。
  const toString = Function.prototype.toString;
  return {
    toString,
    own: Object.getOwnPropertyNames(toString),
    descriptor: Object.getOwnPropertyDescriptor(Function.prototype, 'toString')
  };
})();

function isConstructible(value: unknown): boolean {
  // `typeof Function` 是构造器类型，不是被 lint 拦的 `Function` 接口
  const newTarget = value as typeof Function;
  try {
    Reflect.construct(function () { /* probe */ }, [], newTarget);
    return true;
  } catch {
    return false;
  }
}

test('toString 补丁自身：own keys / 可构造性 / 描述符 flags 与原生内建一致', () => {
  const disguise = createDisguise();
  try {
    disguise(function fakeGetHours() { /* fake */ }, 'getHours', 0);
    const patched = Function.prototype.toString;
    assert.notEqual(patched, NATIVE.toString);

    assert.deepEqual(Object.getOwnPropertyNames(patched), NATIVE.own);
    assert.deepEqual(Object.getOwnPropertySymbols(patched), Object.getOwnPropertySymbols(NATIVE.toString));
    assert.equal(isConstructible(patched), false, '原生 Function.prototype.toString 不可构造');
    assert.throws(() => Reflect.construct(function () { /* probe */ }, [], patched), TypeError);

    const descriptor = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');
    assert.deepEqual(
      {
        writable: descriptor?.writable,
        enumerable: descriptor?.enumerable,
        configurable: descriptor?.configurable
      },
      {
        writable: NATIVE.descriptor?.writable,
        enumerable: NATIVE.descriptor?.enumerable,
        configurable: NATIVE.descriptor?.configurable
      }
    );

    // 伪装后的签名仍然对
    assert.equal(patched.toString(), 'function toString() { [native code] }');
    assert.equal(patched.name, 'toString');
    assert.equal(patched.length, 0);
  } finally {
    disguise.uninstall();
  }
});

test('方法形状的伪装：name / length 描述符与原生原型方法同形', () => {
  const disguise = createDisguise();
  try {
    const shaped = disguise(function fakeGetHours(this: any) { return 1; }, 'getHours', 0);
    const nativeMethod = Date.prototype.getHours;
    assert.deepEqual(Object.getOwnPropertyNames(shaped), Object.getOwnPropertyNames(nativeMethod));
    for (const key of ['name', 'length'] as const) {
      const a = Object.getOwnPropertyDescriptor(shaped, key);
      const b = Object.getOwnPropertyDescriptor(nativeMethod, key);
      assert.deepEqual(
        { writable: a?.writable, enumerable: a?.enumerable, configurable: a?.configurable },
        { writable: b?.writable, enumerable: b?.enumerable, configurable: b?.configurable },
        `${key} 的描述符 flags`
      );
    }
  } finally {
    disguise.uninstall();
  }
});

test('构造器形状：own keys 不夹带 arguments / caller（strict 语义）', () => {
  const disguise = createDisguise();
  try {
    function FakeDate(this: any) { /* fake */ }
    const ctor = disguise(FakeDate, 'Date', 7, { construct: true });
    const own = Object.getOwnPropertyNames(ctor);
    assert.deepEqual(own, ['length', 'name', 'prototype']);
    assert.equal(isConstructible(ctor), true);
    // 原生构造器同样有 length / name / prototype —— 差的只是后两样的 flags，由调用点自己对齐
    assert.equal(Object.prototype.hasOwnProperty.call(ctor, 'arguments'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(ctor, 'caller'), false);
  } finally {
    disguise.uninstall();
  }
});

/**
 * Worker 补丁是 `toString()` 后塞进 blob 的独立经典脚本：blob 自己的 strict 状态决定
 * 里面每个函数的反射形状。runtime.ts 因此给 blob 加了 `"use strict";` 前缀。
 *
 * 这里把两条路径都跑一遍，证明前缀确实是必要条件 —— 少了它，Worker 里的
 * `Function.prototype.toString` 会多出自有 `arguments` / `caller`。
 */

const WORKER_PREAMBLE = `
  globalThis.self = globalThis;
  globalThis.__name = function (fn, name) {
    try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch (error) {}
    return fn;
  };
  globalThis.WorkerNavigator = function WorkerNavigator() {};
  const define = (key, value) => Object.defineProperty(WorkerNavigator.prototype, key, {
    get() { return value; }, enumerable: true, configurable: true
  });
  define('language', 'zh-CN');
  define('languages', ['zh-CN', 'zh']);
  define('userAgent', 'Mozilla/5.0');
  globalThis.navigator = new WorkerNavigator();
`;

function runWorkerPatch(prefix: string): vm.Context {
  const context = vm.createContext({ console });
  vm.runInContext(WORKER_PREAMBLE, context);
  const config = { timezone: 'Asia/Tokyo', language: 'ja-JP', languages: ['ja-JP', 'ja'], fontTargets: [] };
  vm.runInContext(`${prefix}(${workerPatch.toString()})(${JSON.stringify(config)});`, context);
  return context;
}

const probe = (context: vm.Context, expression: string): any => vm.runInContext(expression, context);

test('Worker blob 带 "use strict" 时，函数对象的反射形状与原生一致', () => {
  const context = runWorkerPatch('"use strict";');
  assert.equal(probe(context, 'Object.getOwnPropertyNames(Function.prototype.toString).join(",")'), 'length,name');
  assert.equal(probe(context, 'Object.getOwnPropertyNames(Date.prototype.getHours).join(",")'), 'length,name');
  // 构造器是唯一原样透传（{ construct: true }）的路径：sloppy 下它会立刻多出
  // arguments / caller，strict 下才和原生一样只剩 length / name / prototype + 静态方法。
  assert.equal(probe(context, 'Object.getOwnPropertyNames(Date).join(",")'), 'length,name,prototype,now,parse,UTC');
  assert.equal(
    probe(context, `(function () {
      try { Reflect.construct(function () {}, [], Function.prototype.toString); return 'no-throw'; }
      catch (error) { return error.name; }
    })()`),
    'TypeError'
  );
  assert.equal(probe(context, 'Function.prototype.toString.toString()'), 'function toString() { [native code] }');
});

test('Worker blob 少了 "use strict" 就会露出 arguments / caller（前缀的必要性）', () => {
  const context = runWorkerPatch('');
  const own = String(probe(context, 'Object.getOwnPropertyNames(Date).join(",")'));
  assert.ok(own.includes('arguments'), `sloppy 下应出现 arguments：${own}`);
  assert.ok(own.includes('caller'), `sloppy 下应出现 caller：${own}`);

  // 方法形状的替换物在两种模式下都干净 —— 说明"形状"这件事两层都要做：
  // 光把实现改成方法不够，构造器一路必须靠 strict。
  assert.equal(probe(context, 'Object.getOwnPropertyNames(Function.prototype.toString).join(",")'), 'length,name');
});
test('disguise 的防御分支：未安装时 uninstall 直接返回，冻结的实现不炸', () => {
  const disguise = createDisguise();
  // 没伪装过就 uninstall：必须是 no-op，不能把 nativeToString 再写一遍
  const native = Function.prototype.toString;
  disguise.uninstall();
  assert.equal(Function.prototype.toString, native);

  // 构造器路径原样透传 impl：impl 被冻结时 name/length 改不动，只能吞掉
  const frozen = Object.freeze(function Frozen() { /* fake */ });
  const shaped = disguise(frozen, 'Frozen', 0, { construct: true });
  assert.equal(shaped, frozen, '构造器路径原样透传，不做二次包装');
  disguise.uninstall();
});
