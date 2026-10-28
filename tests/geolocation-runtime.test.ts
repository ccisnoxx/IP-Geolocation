import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { generateGeolocationRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';
import type { GeolocationPayload } from '../src/shared/types';

let runtime: string;
before(async () => {
  runtime = assertSelfContainedFunction((await generateGeolocationRuntime()).code, 'applyGeolocationRuntime');
});
const payload: GeolocationPayload = {
  latitude: 12, longitude: 23, accuracy: 25, randomize: false, randomRadiusMeters: 500, spoofPermission: true
};

function page(overrides: Record<string, unknown> = {}) {
  let id = 1;
  const timers = new Map<number, () => void>();
  const periodic = new Map<number, () => void>();
  const callbackErrors: unknown[] = [];
  const context = vm.createContext({
    EventTarget, Event, console, crypto: webcrypto,
    setTimeout(callback: () => void, delay = 0) { const token = id++; (delay >= 3000 ? periodic : timers).set(token, callback); return token; },
    clearTimeout(token: number) { timers.delete(token); periodic.delete(token); },
    ...overrides
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`
    this.window = this; this.self = this;
    this.messages=[]; this.postMessage=data=>messages.push(data);
    this.location = { protocol: 'https:', href: 'https://example.test/' };
    this.origin = 'https://example.test'; this.isSecureContext = true; this.closed = false;
    this.now = 10000; Date.now = () => now;
    class LifecycleTarget {
      constructor() { this.listeners = new Map(); }
      addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
      }
      removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
      emit(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
    }
    const lifecycle = new LifecycleTarget();
    this.addEventListener = lifecycle.addEventListener.bind(lifecycle);
    this.removeEventListener = lifecycle.removeEventListener.bind(lifecycle);
    this.emit = lifecycle.emit.bind(lifecycle);
    this.document = new LifecycleTarget(); document.visibilityState = 'visible';
    this.policyAllowed = true;
    document.permissionsPolicy = { allowsFeature(name) { if (name !== 'geolocation') throw Error('feature'); return policyAllowed; } };
    this.nativePositionCalls = 0; this.nativeWatchCalls = 0; this.nativeClearCalls = 0;
    const geoBrands = new WeakSet();
    class Geolocation {
      constructor() { geoBrands.add(this); }
      getCurrentPosition(success, error, options) {
        if (!geoBrands.has(this)) throw new TypeError('Geolocation receiver');
        nativePositionCalls++; globalThis.nativeSuccess=success; globalThis.nativeError=error; globalThis.nativeOptions=options; return 'native-position';
      }
      watchPosition(success, error, options) {
        if (!geoBrands.has(this)) throw new TypeError('Geolocation receiver');
        nativeWatchCalls++; globalThis.nativeSuccess=success; globalThis.nativeError=error; globalThis.nativeOptions=options; return 4321;
      }
      clearWatch(id) {
        if (!geoBrands.has(this)) throw new TypeError('Geolocation receiver');
        nativeClearCalls++; globalThis.lastNativeClear=+id>>0;
      }
    }
    this.Geolocation = Geolocation;
    this.foreignGeo = new Geolocation();
    const slots = new WeakMap();
    class GeolocationCoordinates {}
    class GeolocationPosition {}
    for (const [prototype, names] of [[GeolocationCoordinates.prototype, ['latitude','longitude','accuracy','altitude','altitudeAccuracy','heading','speed']],
      [GeolocationPosition.prototype, ['coords','timestamp']]]) {
      for (const name of names) Object.defineProperty(prototype, name, { configurable: true, enumerable: true,
        get() { if (!slots.has(this)) throw new TypeError('native slot'); return slots.get(this)[name]; } });
      Object.defineProperty(prototype, 'toJSON', { configurable: true, writable: true, enumerable: true,
        value: function toJSON() { if (!slots.has(this)) throw new TypeError('native slot'); return {...slots.get(this)}; } });
    }
    this.nativeLatitude = Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get;
    this.realCoordinates = Object.create(GeolocationCoordinates.prototype); slots.set(realCoordinates, {latitude: 41});
    class GeolocationPositionError {}
    this.GeolocationCoordinates = GeolocationCoordinates;
    this.GeolocationPosition = GeolocationPosition;
    this.GeolocationPositionError = GeolocationPositionError;
    const statusSlots = new WeakMap();
    class PermissionStatus extends EventTarget {
      constructor(state, name) { super(); statusSlots.set(this, { state, name, onchange: null }); }
      get state() { if (!statusSlots.has(this)) throw new TypeError('status receiver'); return statusSlots.get(this).state; }
      get name() { if (!statusSlots.has(this)) throw new TypeError('status receiver'); return statusSlots.get(this).name; }
      get onchange() { if (!statusSlots.has(this)) throw new TypeError('status receiver'); return statusSlots.get(this).onchange; }
      set onchange(value) { if (!statusSlots.has(this)) throw new TypeError('status receiver'); statusSlots.get(this).onchange = value; }
    }
    this.PermissionStatus = PermissionStatus;
    this.nativePermissionState = 'denied'; this.queryFailure = null; this.queryCalls = 0;
    class Permissions {
      query(desc) {
        if (this !== navigator.permissions) return Promise.reject(new TypeError('permissions receiver'));
        queryCalls++;
        const name = String(desc.name);
        if (queryFailure) return Promise.reject(queryFailure);
        if (name === 'midi') desc.sysex;
        this.lastStatus = new PermissionStatus(name === 'geolocation' ? nativePermissionState : 'prompt', name);
        return Promise.resolve(this.lastStatus);
      }
    }
    this.Permissions = Permissions;
    this.navigator = { geolocation: new Geolocation(), permissions: new Permissions() };
    this.nativeQuery = Permissions.prototype.query;
    this.nativeGet = Geolocation.prototype.getCurrentPosition;
    this.nativeWatch = Geolocation.prototype.watchPosition;
    this.nativeClear = Geolocation.prototype.clearWatch;
    this.originalDescriptors = Object.getOwnPropertyDescriptors(Geolocation.prototype);
    this.originalReflect = Reflect.get; this.originalToString = Function.prototype.toString;
    this.originalGlobals = [...Reflect.ownKeys(globalThis), 'originalGlobals'];
  `, context);
  const run = (source: string) => vm.runInContext(source, context);
  return {
    context, run, timers, periodic, callbackErrors,
    install(config = payload) { context.payload = { ...config }; run(`(${runtime})(payload)`); },
    update(config: GeolocationPayload | null, sequence: number) {
      context.updateData = { kind: 'vg-live-update-v1', surface: 'geolocation', payloadText: JSON.stringify(config), sequence };
      run(`updateData.nonce=messages.find(message=>message.surface==='geolocation').nonce;emit('message',{source:globalThis,origin,data:updateData})`);
    },
    async flush() {
      for (let n = 0; n < 100; n++) {
        for (let m = 0; m < 6; m++) await Promise.resolve();
        const next = timers.entries().next();
        if (next.done) return;
        timers.delete(next.value[0]);
        try { next.value[1](); } catch (error) { callbackErrors.push(error); }
      }
      throw new Error('定位任务未收敛');
    }
  };
}

test('固定专用 graph 自包含，不安装其他 surface 或页面 marker', async () => {
  const generated = await generateGeolocationRuntime();
  assert.ok(generated.dependencies.some(file => file.endsWith('/geolocation-entry.ts')));
  assert.ok(generated.dependencies.every(file => !/surfaces\/(?:navigator|intl-date|font-exposure|workers)\.ts|\/worker\//.test(file)));
  const p = page(); p.install();
  assert.deepEqual(Array.from(p.run('Reflect.ownKeys(globalThis).filter(key => !originalGlobals.includes(key))')), ['payload']);
  assert.equal(p.run('Reflect.get === originalReflect && Function.prototype.toString === originalToString'), true);
});

test('仅原生 API 存在且 secure 的普通非 opaque HTTP(S) 文档安装', () => {
  for (const setup of [
    "location.protocol = 'about:'", "origin = 'null'", 'isSecureContext = false',
    'delete navigator.geolocation', 'delete globalThis.document'
  ]) {
    const p = page(); p.run(setup); p.install();
    assert.equal(p.run('Geolocation.prototype.getCurrentPosition === nativeGet'), true, setup);
    assert.equal(p.run('Object.hasOwn(navigator, "geolocation")'), !setup.includes('delete navigator.geolocation'));
  }
});

test('外来 Geolocation prototype 不安装，实例 own shadow 不作为原生品牌检查来源', async () => {
  const p = page();
  p.run(`this.foreignPrototype={
    getCurrentPosition(){return 'foreign'}, watchPosition(){return 1}, clearWatch(){}
  }; navigator.geolocation=Object.create(foreignPrototype); this.foreignOriginal=foreignPrototype.getCurrentPosition;`);
  p.install();
  assert.equal(p.run('foreignPrototype.getCurrentPosition === foreignOriginal'), true);
  const q = page();
  q.run(`navigator.geolocation.clearWatch=() => {}; navigator.geolocation.getCurrentPosition=() => 'own-shadow';`);
  q.install();
  assert.throws(() => q.run(`Geolocation.prototype.getCurrentPosition.call({}, () => {})`), /receiver/);
  q.run(`this.results=[]; Geolocation.prototype.getCurrentPosition.call(navigator.geolocation, p => results.push(p));`);
  await q.flush(); assert.equal(q.run('results[0].coords.latitude'), 12);
  assert.equal(q.run('nativePositionCalls'), 0);
});

test('方法 descriptor/函数形状、非法 receiver 与合法其他实例原生透传', () => {
  const p = page(); p.install();
  for (const method of ['getCurrentPosition', 'watchPosition', 'clearWatch']) {
    const values = p.run(`(() => {
      const before = originalDescriptors.${method}; const after = Object.getOwnPropertyDescriptor(Geolocation.prototype, '${method}');
      return [after.enumerable === before.enumerable, after.configurable === before.configurable,
        after.writable === before.writable, after.value.name === before.value.name, after.value.length === before.value.length,
        Object.hasOwn(navigator.geolocation, '${method}')];
    })()`);
    assert.deepEqual(Array.from(values), [true, true, true, true, true, false]);
    assert.throws(() => p.run(`navigator.geolocation.${method}.call({}, () => {})`), /receiver/);
    assert.throws(() => p.run(`new navigator.geolocation.${method}(() => {})`), /constructor/);
  }
  assert.equal(p.run('navigator.geolocation.getCurrentPosition.call(foreignGeo, () => {})'), 'native-position');
  assert.equal(p.run('navigator.geolocation.watchPosition.call(foreignGeo, () => {})'), 4321);
  assert.equal(p.run('nativePositionCalls'), 1);
  assert.equal(p.run('nativeWatchCalls'), 1);
});

test('WebIDL 参数按排序读取并单次转换，callback 与数值转换错误同步暴露', async () => {
  const p = page(); p.install();
  p.run(`this.reads = []; this.results = [];
    navigator.geolocation.getCurrentPosition(p => results.push(p), e => results.push(e), {
      get enableHighAccuracy() { reads.push('high'); return {}; },
      get maximumAge() { reads.push('age'); return { valueOf() { reads.push('age-number'); return Infinity; } }; },
      get timeout() { reads.push('timeout'); return { valueOf() { reads.push('timeout-number'); return 0.5; } }; }
    });`);
  assert.deepEqual(Array.from(p.run('reads')), ['high', 'age', 'age-number', 'timeout', 'timeout-number']);
  assert.equal(p.run('results.length'), 0);
  await p.flush();
  assert.equal(p.run('results[0].code'), 3);
  for (const args of ['', 'null', '() => {}, {}', '() => {}, null, 1', '() => {}, null, { maximumAge: 1n }', '() => {}, null, {timeout: Symbol()}']) {
    assert.throws(() => p.run(`navigator.geolocation.getCurrentPosition(${args})`), /function|dictionary|BigInt|Symbol/);
  }
  assert.throws(() => p.run('navigator.geolocation.clearWatch()'), /watch id/);
  assert.equal(p.run('nativePositionCalls + nativeWatchCalls'), 0);
});

test('异步任务、缓存 age/精度匹配与 timeout=0；返回对象使用原型 getter 和私有字段', async () => {
  const p = page(); p.install();
  p.run(`this.results=[];
    navigator.geolocation.getCurrentPosition(p => results.push(p), e => results.push(e));
    Promise.resolve().then(() => results.push('microtask'));`);
  await Promise.resolve();
  assert.deepEqual(Array.from(p.run('results')), ['microtask']);
  await p.flush();
  assert.equal(p.run('results[1].coords.latitude'), 12);
  assert.equal(p.run('Object.getPrototypeOf(results[1]) === GeolocationPosition.prototype'), true);
  assert.equal(p.run('Object.getPrototypeOf(results[1].coords) === GeolocationCoordinates.prototype'), true);
  assert.equal(p.run('Object.isExtensible(results[1]) && Object.isExtensible(results[1].coords)'), true);
  assert.equal(p.run('Reflect.ownKeys(results[1]).length + Reflect.ownKeys(results[1].coords).length'), 0);
  assert.throws(() => p.run(`'use strict'; results[1].coords.latitude = 99`), /getter/);
  assert.equal(p.run(`Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get.call(results[1].coords)`), 12);
  assert.equal(p.run('realCoordinates.latitude'), 41);
  assert.throws(() => p.run('nativeLatitude.call(results[1].coords)'), /slot/);
  assert.throws(() => p.run(`Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get.call({})`), /slot/);
  assert.deepEqual(JSON.parse(p.run('JSON.stringify(results[1])')).coords, {
    latitude: 12, longitude: 23, accuracy: 25, altitude: null, altitudeAccuracy: null, heading: null, speed: null
  });
  p.run(`navigator.geolocation.getCurrentPosition(p => results.push(p), e => results.push(e), { timeout: 0, maximumAge: 100 });`);
  await p.flush(); assert.equal(p.run('results[1] === results[2]'), true);
  p.run(`navigator.geolocation.getCurrentPosition(p => results.push(p), e => results.push(e), { timeout: 0, maximumAge: 100, enableHighAccuracy: true });`);
  await p.flush(); assert.equal(p.run('results[3].code'), 3);
  p.run(`now += 100; navigator.geolocation.getCurrentPosition(p => results.push(p), e => results.push(e), { timeout: 0, maximumAge: 100 });`);
  await p.flush(); assert.equal(p.run('results[4].code'), 3);
  p.run(`navigator.geolocation.getCurrentPosition(p => results.push(p), e => results.push(e), {timeout: Infinity});`);
  await p.flush(); assert.equal(p.run('results[5].coords.latitude'), 12);
});

test('success 抛错保持可见且不调用 error；同文档随机位置和输入快照固定', async () => {
  const p = page(); p.install({ ...payload, randomize: true });
  p.run(`this.samples=[]; this.errorCount=0;
    navigator.geolocation.getCurrentPosition(position => { samples.push(position.coords); throw Error('callback failure'); }, () => errorCount++);
    payload.latitude=70; payload.randomRadiusMeters=90000;
    navigator.geolocation.getCurrentPosition(position => samples.push(position.coords));`);
  await p.flush();
  assert.equal(p.callbackErrors.length, 1); assert.match(String(p.callbackErrors[0]), /callback failure/);
  assert.equal(p.run('errorCount'), 0);
  assert.equal(p.run('samples[0].latitude === samples[1].latitude && samples[0].longitude === samples[1].longitude'), true);
  assert.ok(Math.abs(p.run('samples[0].latitude') - 12) < 0.01);
});

test('spoofPermission=false 委托原生授权及传感器，只替换成功坐标并保留参数和错误', async () => {
  const p = page(); p.install({ ...payload, spoofPermission: false });
  p.run(`this.results=[]; this.options={timeout:500}; this.failure={code:1,message:'native denial'};
    this.onError=e=>results.push(e);
    this.returned=navigator.geolocation.getCurrentPosition(p=>results.push(p), onError, options);`);
  assert.equal(p.run('nativePositionCalls'), 1);
  assert.equal(p.run('nativeOptions === options && typeof nativeError === "function"'), true);
  assert.equal(p.run('returned'), 'native-position');
  p.run(`nativeError(failure)`);
  assert.equal(p.run('results[0] === failure'), true);
  p.run(`nativeSuccess({coords:{latitude:87,longitude:64}})`);
  assert.equal(p.run('results[1].coords.latitude'), 12);
  assert.equal(p.run('results[1].coords.longitude'), 23);
  assert.equal(p.run('queryCalls'), 0);
  assert.equal(p.run('Permissions.prototype.query === nativeQuery'), true);
});

test('原生watch返回原生ID、保留回调节奏并用原生clearWatch取消', async () => {
  const p = page(); p.install({ ...payload, spoofPermission: false });
  p.run(`this.samples=[]; this.id=navigator.geolocation.watchPosition(p=>samples.push(p.coords.latitude));`);
  assert.equal(p.run('id'), 4321);
  assert.equal(p.run('nativeWatchCalls'), 1);
  p.run(`nativeSuccess({}); nativeSuccess({}); navigator.geolocation.clearWatch(id);`);
  assert.deepEqual(Array.from(p.run('samples')), [12,12]);
  assert.equal(p.run('nativeClearCalls'), 1);
  assert.equal(p.timers.size + p.periodic.size, 0);
});

test('权限查询完全保留原生方法、真实状态、对象身份与拒绝', async () => {
  const p = page(); p.install();
  assert.equal(p.run('Permissions.prototype.query === nativeQuery'), true);
  const status = await p.run(`navigator.permissions.query({name:'geolocation'})`);
  p.context.status = status;
  assert.equal(p.run('status === navigator.permissions.lastStatus'), true);
  assert.equal(status.state, 'denied');
  p.run(`queryFailure=Error('native failure')`);
  await assert.rejects(p.run(`navigator.permissions.query({name:'geolocation'})`), /native failure/);
  await assert.rejects(p.run(`navigator.permissions.query.call({}, {name:'geolocation'})`), /receiver/);
});

test('Permissions-Policy 优先拒绝且 query 异常不伪装成 granted', async () => {
  const p = page(); p.install(); p.run(`policyAllowed=false; this.results=[];
    navigator.geolocation.getCurrentPosition(p => results.push(p), e => results.push(e));`);
  await p.flush(); assert.equal(p.run('results[0].code'), 1);
  const status = await p.run(`navigator.permissions.query({name:'geolocation'})`); assert.equal(status.state, 'denied');
  p.run(`queryFailure=Error('permission unavailable')`);
  await assert.rejects(p.run(`navigator.permissions.query({name:'geolocation'})`), /permission unavailable/);
  assert.equal(p.run('nativePositionCalls + nativeWatchCalls'), 0);
});

test('合成watch初次、等待任务中及回调内取消均不再交付', async () => {
  const p = page(); p.install();
  p.run(`this.count=0; this.id=navigator.geolocation.watchPosition(()=>count++); navigator.geolocation.clearWatch(id);`);
  await p.flush(); assert.equal(p.run('count'), 0);
  p.run(`this.id=navigator.geolocation.watchPosition(()=>count++);`);
  const first=p.timers.entries().next().value!; p.timers.delete(first[0]); first[1]();
  p.run(`navigator.geolocation.clearWatch(id)`);
  await p.flush(); assert.equal(p.run('count'), 0);
  p.run(`this.id=navigator.geolocation.watchPosition(()=>{count++; navigator.geolocation.clearWatch(id)});`);
  await p.flush(); assert.equal(p.run('count'), 1);
  assert.equal(p.periodic.size, 0);
});

test('options getter 重入 watch 分配独立 ID，clearWatch 只取消对应请求', async () => {
  for (const cancelled of ['inner', 'outer']) {
    const p = page(); p.install();
    p.run(`this.calls=[];
      this.outerId=navigator.geolocation.watchPosition(() => calls.push('outer'), null, {
        get timeout() {
          globalThis.innerId=navigator.geolocation.watchPosition(() => calls.push('inner'));
          return Infinity;
        }
      });`);
    assert.notEqual(p.run('innerId'), p.run('outerId'));
    p.run(`navigator.geolocation.clearWatch(${cancelled}Id)`);
    await p.flush();
    const expected = cancelled === 'inner' ? 'outer' : 'inner';
    assert.deepEqual(Array.from(p.run('calls')), [expected]);
    p.run(`navigator.geolocation.clearWatch(${expected}Id);
      document.visibilityState='hidden'; document.emit('visibilitychange');
      document.visibilityState='visible'; document.emit('visibilitychange');`);
    await p.flush();
    assert.deepEqual(Array.from(p.run('calls')), [expected]);
  }
});

test('watch 隐藏/冻结/BFCache 暂停恢复同快照，周期交付稳定坐标，退出清理监听', async () => {
  const p = page(); p.install();
  p.run(`this.samples=[]; this.id=navigator.geolocation.watchPosition(p => samples.push(p.coords.latitude));`);
  await p.flush(); assert.equal(p.run('samples.length'), 1); assert.equal(p.timers.size, 0);
  assert.equal(p.periodic.size, 1);
  p.run(`emit('pageshow',{persisted:false})`); await p.flush(); assert.equal(p.run('samples.length'), 1);
  p.run(`document.visibilityState='hidden'; document.emit('visibilitychange');
    navigator.geolocation.getCurrentPosition(p => samples.push(p.coords.latitude));`);
  await p.flush(); assert.equal(p.run('samples.length'), 1);
  p.run(`document.emit('freeze'); document.visibilityState='visible'; document.emit('visibilitychange');`);
  await p.flush(); assert.equal(p.run('samples.length'), 1);
  p.run(`document.emit('resume'); document.emit('resume')`); await p.flush(); assert.equal(p.run('samples.length'), 3);
  p.run(`emit('pagehide',{persisted:true});`); await p.flush(); assert.equal(p.run('samples.length'), 3);
  p.run(`emit('pageshow',{persisted:true}); emit('pageshow',{persisted:true});`);
  await p.flush(); assert.equal(p.run('samples.length'), 4); assert.equal(p.timers.size, 0);
  assert.deepEqual(Array.from(p.run('samples')), [12,12,12,12]);
  p.run(`emit('pagehide',{persisted:false}); emit('pageshow',{persisted:true});`);
  await p.flush(); assert.equal(p.run('samples.length'), 4);
  assert.equal(p.run('Array.from(document.listeners.values()).every(set => set.size===0)'), true);
});

test('回调任务交付前隐藏、clearWatch 或 iframe 移除均阻止交付', async () => {
  for (const action of [
    `document.visibilityState='hidden'; document.emit('visibilitychange')`,
    `navigator.geolocation.clearWatch(id)`,
    `frameElement.isConnected=false`
  ]) {
    const p = page(); p.run(`this.frameElement={isConnected:true}`); p.install();
    p.run(`this.count=0; this.id=navigator.geolocation.watchPosition(() => count++);`);
    const first = p.timers.entries().next().value!; p.timers.delete(first[0]); first[1]();
    for (let n=0;n<6;n++) await Promise.resolve();
    assert.equal(p.timers.size, 1);
    p.run(action); await p.flush(); assert.equal(p.run('count'), 0, action);
  }
});

test('定位热更新保留已交付对象的坐标快照，关闭还原方法并取消原生watch和未交付请求', async () => {
  const p = page(); p.install();
  p.run(`this.results=[];navigator.geolocation.getCurrentPosition(value=>results.push(value));`);
  await p.flush();
  p.update({ ...payload, latitude: 15 }, 1);
  assert.equal(p.run('results[0].coords.latitude'), 12);
  p.run(`navigator.geolocation.getCurrentPosition(value=>results.push(value));`);
  await p.flush();
  assert.equal(p.run('results[1].coords.latitude'), 15);
  p.update({ ...payload, spoofPermission: false }, 2);
  p.run(`this.errors=[];this.count=0;this.watch=navigator.geolocation.watchPosition(()=>count++);
    navigator.geolocation.getCurrentPosition(()=>count++,error=>errors.push(error.code));`);
  p.update(null, 3);
  p.run(`nativeSuccess({})`);
  await p.flush();
  assert.equal(p.run('count'), 0);
  assert.deepEqual(Array.from(p.run('errors')), [2]);
  assert.equal(p.run('lastNativeClear'), 4321);
  assert.equal(p.run('Geolocation.prototype.getCurrentPosition===nativeGet && Geolocation.prototype.watchPosition===nativeWatch'), true);
  assert.equal(p.run('results[0].coords.latitude'), 12);
  assert.equal(p.run('results[0].toJSON().coords.latitude'), 12);
  assert.equal(p.run('results[1].coords.toJSON().latitude'), 15);
});


test('合成oneshot在隐藏时遇到更新或关闭，恢复可见后恰好一次失败，退出则不回调', async () => {
  for (const next of [null, { ...payload, latitude: 15 }]) {
    const p = page(); p.install();
    p.run(`document.visibilityState='hidden';document.emit('visibilitychange');this.count=0;this.errors=[];
      navigator.geolocation.getCurrentPosition(()=>count++,error=>errors.push(error.code));`);
    p.update(next, 1); await p.flush();
    assert.equal(p.run('errors.length'), 0);
    p.run(`document.visibilityState='visible';document.emit('visibilitychange')`); await p.flush();
    assert.equal(p.run('count'), 0); assert.deepEqual(Array.from(p.run('errors')), [2]);
    p.run(`document.emit('visibilitychange')`); await p.flush(); assert.equal(p.run('errors.length'), 1);
  }
  const p = page();p.install();p.run(`this.count=0;navigator.geolocation.getCurrentPosition(()=>count++,()=>count++);emit('pagehide',{persisted:false})`);
  await p.flush(); assert.equal(p.run('count'), 0);
});


test('取消oneshot的真正回调前隐藏或退出仍阻止交付，首个error隐藏后其余等待恢复', async () => {
  const p = page();p.install();
  p.run(`this.errors=[];navigator.geolocation.getCurrentPosition(()=>{},error=>{errors.push(error.code);document.visibilityState='hidden';document.emit('visibilitychange')});
    navigator.geolocation.getCurrentPosition(()=>{},error=>errors.push(error.code));`);
  p.update(null, 1); await p.flush(); assert.deepEqual(Array.from(p.run('errors')), [2]);
  p.run(`document.visibilityState='visible';document.emit('visibilitychange')`);await p.flush();assert.deepEqual(Array.from(p.run('errors')), [2,2]);
  for (const event of [`document.visibilityState='hidden';document.emit('visibilitychange')`, `emit('pagehide',{persisted:false})`]) {
    const r = page(); r.install();r.run(`this.count=0;navigator.geolocation.getCurrentPosition(()=>count++,()=>count++)`);
    r.update(null, 1);r.run(event);await r.flush();assert.equal(r.run('count'), 0);
  }
});


test('首次桥返回相同定位配置不重装方法，不取消首屏已建立的watch或oneshot', async () => {
  const p = page(); p.install();
  p.run(`this.originalWatch=Geolocation.prototype.watchPosition;this.values=[];this.errors=[];
    navigator.geolocation.watchPosition(value=>values.push(value.coords.latitude),error=>errors.push(error.code));
    navigator.geolocation.getCurrentPosition(value=>values.push(value.coords.latitude),error=>errors.push(error.code));`);
  p.update(payload, 1);
  assert.equal(p.run('Geolocation.prototype.watchPosition===originalWatch'), true);
  await p.flush();assert.deepEqual(Array.from(p.run('values')), [12,12]);assert.equal(p.run('errors.length'),0);
});
