import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generateRuntime, generatePageRuntime, generateBlobWorkerRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';
import { normalizeConfig, normalizeRule } from '../src/shared/config-model';
import { getEffectiveProfile, migrateLegacyConfig, validateConfig } from '../src/shared/config-resolver';

let runtime: string;
let pageRuntime: string;
let blobWorkerRuntime: string;
before(async () => {
  const [full, page, blob] = await Promise.all([generateRuntime(), generatePageRuntime(), generateBlobWorkerRuntime()]);
  runtime = assertSelfContainedFunction(full.code, 'applyVanishGeoRuntime');
  pageRuntime = assertSelfContainedFunction(page.code, 'applyLanguageTimezoneRuntime');
  blobWorkerRuntime = assertSelfContainedFunction(blob.code, 'applyBlobWorkerRuntime');
});

function realm(mode: 'strict' | 'compatible', worker = false, language = true, timezone: boolean | string = true) {
  const blobs: string[] = [];
  class MockBlob { constructor(parts: string[]) { blobs.push(parts.join('')); } }
  const url = class extends URL {
    static createObjectURL() { return 'blob:fixture'; }
    static revokeObjectURL() {}
  };
  const context = vm.createContext({ console, URL: url, Blob: MockBlob, addEventListener() {}, location: { href: 'https://example.test/' }, Worker: function Worker() {} });
  vm.runInContext(`this.self=this; this.window=this;
    class Navigator {get language(){return 'en-US'} get languages(){return ['en-US']}}
    this.navigator=new Navigator();
    this.nativeDate=Date; this.nativeDTF=Intl.DateTimeFormat; this.nativeNF=Intl.NumberFormat;
    this.nativeDateLocale=Date.prototype.toLocaleString;
    this.nativeDateMethods=Object.fromEntries(['toLocaleString','toLocaleDateString','toLocaleTimeString'].map(k=>[k,Date.prototype[k]]));
    this.nativeIntl={...Intl}; for(const k of Object.getOwnPropertyNames(Intl)) this.nativeIntl[k]=Intl[k];
  `, context);
  vm.runInContext(runtime, context);
  context.payload = { intlMode: mode, extensionEnabled: true,
    languageConfig: { enabled: language, language: 'fr-FR', languages: ['fr-FR'] },
    timezoneConfig: { enabled: Boolean(timezone), mode: 'manual', timezone: typeof timezone === 'string' ? timezone : 'Europe/Paris' } };
  vm.runInContext(`applyVanishGeoRuntime(payload); new Worker('/fixture.js')`, context);
  if (!worker) return context;
  const workerContext = vm.createContext({ console });
  vm.runInContext(`this.self=this; class Navigator {get language(){return 'en-US'} get languages(){return ['en-US']}};
    this.navigator=new Navigator(); this.nativeDate=Date; this.nativeDTF=Intl.DateTimeFormat; this.nativeNF=Intl.NumberFormat;
    this.nativeDateLocale=Date.prototype.toLocaleString;
    this.nativeDateMethods=Object.fromEntries(['toLocaleString','toLocaleDateString','toLocaleTimeString'].map(k=>[k,Date.prototype[k]]));
    this.nativeIntl={...Intl}; for(const k of Object.getOwnPropertyNames(Intl)) this.nativeIntl[k]=Intl[k];`, workerContext);
  vm.runInContext(blobs[0].slice(0, blobs[0].lastIndexOf('\nimportScripts(')), workerContext);
  return workerContext;
}
const read = (context: vm.Context, source: string) => JSON.parse(vm.runInContext(`JSON.stringify(${source})`, context));

function constructorRealm(mode: 'strict' | 'compatible', target: '生产页面' | '生产 Blob Worker' | '维护 Worker', timezone = 'Europe/Paris') {
  if (target === '维护 Worker') return realm(mode, true, true, timezone);
  const context = vm.createContext({ console, location: { href: 'https://example.test/', protocol: 'https:' }, origin: 'https://example.test' });
  vm.runInContext(`this.self=this; this.nativeDate=Date;
    this.nativeIntl=Object.fromEntries(Object.getOwnPropertyNames(Intl).map(k=>[k,Intl[k]]));`, context);
  const source = target === '生产页面' ? pageRuntime : blobWorkerRuntime;
  vm.runInContext(`(${source})(${JSON.stringify({ language: { language: 'fr-FR', languages: ['fr-FR'] }, timezone, intlMode: mode })})`, context);
  return context;
}

for (const target of ['生产页面', '生产 Blob Worker', '维护 Worker'] as const) {
  for (const mode of ['strict', 'compatible'] as const) {
    test(`${target} ${mode} Date 保留零/单/多参数子类与原生直接调用合同`, () => {
      const value = read(constructorRealm(mode, target), `(() => {
        class DerivedDate extends Date {}
        const before=Date.now();
        const dates=[[],[1768478400123],[2024,0,15,12,34,56,789]].map(args=>{
          const date=Reflect.construct(DerivedDate,args);
          return {derived:date instanceof DerivedDate, date:date instanceof Date,
            prototype:Object.getPrototypeOf(date)===DerivedDate.prototype, time:date.getTime(),
            local:[date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds()]};
        });
        const calls=[()=>Date(),()=>Date(Symbol('ignored')),()=>Date.call(Object.create(Date.prototype),Symbol('ignored'))]
          .map(call=>{try{return {type:typeof call()}}catch(error){return {error:error.name}}});
        return {before,after:Date.now(),dates,calls};
      })()`);
      for (const date of value.dates) {
        assert.equal(date.derived, true);
        assert.equal(date.date, true);
        assert.equal(date.prototype, true);
      }
      assert.ok(value.dates[0].time >= value.before && value.dates[0].time <= value.after);
      assert.equal(value.dates[1].time, 1768478400123);
      assert.equal(value.dates[2].time, Date.UTC(2024, 0, 15, 11, 34, 56, 789));
      assert.deepEqual(value.dates[2].local, [2024, 0, 15, 12, 34, 56, 789]);
      assert.deepEqual(value.calls, [{ type: 'string' }, { type: 'string' }, { type: 'string' }]);
    });

    test(`${target} ${mode} Intl 构造保留子类、必须 new 和可调用构造器合同`, () => {
      const value = read(constructorRealm(mode, target), `(() => {
        const names=['DateTimeFormat','NumberFormat','Collator','RelativeTimeFormat','ListFormat','PluralRules','DisplayNames','Segmenter'];
        return names.filter(name=>typeof Intl[name]==='function').map(name=>{
          const Ctor=Intl[name], options=name==='DisplayNames'?{type:'region'}:undefined;
          class Derived extends Ctor {}
          const instance=new Derived('en-US',options);
          const call=C=>{try{const instance=Reflect.apply(C,undefined,['en-US',options]);return {locale:instance.resolvedOptions().locale}}catch(error){return {error:error.name}}};
          return {name,derived:instance instanceof Derived,prototype:Object.getPrototypeOf(instance)===Derived.prototype,
            locale:instance.resolvedOptions().locale,call:call(Ctor),nativeCall:call(nativeIntl[name]),
            expectedLocale:new nativeIntl[name](${JSON.stringify(mode === 'strict' ? 'fr-FR' : 'en-US')},options).resolvedOptions().locale};
        });
      })()`);
      for (const result of value) {
        assert.equal(result.derived, true, result.name);
        assert.equal(result.prototype, true, result.name);
        assert.equal(result.locale, result.expectedLocale, result.name);
        if (['DateTimeFormat', 'NumberFormat', 'Collator'].includes(result.name)) {
          assert.equal(result.call.locale, result.expectedLocale, result.name);
        } else {
          assert.deepEqual(result.nativeCall, { error: 'TypeError' }, result.name);
          assert.deepEqual(result.call, result.nativeCall, result.name);
        }
      }
    });

    test(`${target} ${mode} Intl.call 保留原生 legacy receiver 与重复初始化异常`, () => {
      const value = read(constructorRealm(mode, target), `['DateTimeFormat','NumberFormat','Collator'].map(name=>{
        const observe=(Ctor,locale)=>{
          const receiver=Object.create(Ctor.prototype), instance=Reflect.apply(Ctor,receiver,[locale]);
          let repeated;try{Reflect.apply(Ctor,receiver,[locale]);repeated='none'}catch(error){repeated=error.name}
          const plain={}; const fresh=Reflect.apply(Ctor,plain,[locale]);
          return {same:instance===receiver, repeated,plainSame:fresh===plain,locale:instance.resolvedOptions().locale};
        };
        return {name,actual:observe(Intl[name],'en-US'),native:observe(nativeIntl[name],${JSON.stringify(mode === 'strict' ? 'fr-FR' : 'en-US')})};
      })`);
      for (const result of value) {
        assert.equal(result.actual.same, result.native.same, result.name);
        assert.equal(result.actual.repeated, result.native.repeated, result.name);
        assert.equal(result.actual.plainSame, result.native.plainSame, result.name);
        assert.equal(result.actual.locale, result.native.locale, result.name);
      }
    });

    test(`${target} ${mode} 已有 0..99 年日期保持 epoch/墙钟年/偏移，数字构造仍映射 1900 年`, () => {
      const value = read(constructorRealm(mode, target, 'UTC'), `(() => {
        const years=[0,1,9,50,99,100];
        return {dates:years.map(year=>{
          const iso=String(year).padStart(4,'0')+'-01-15T12:34:56.789Z';
          const date=new Date(iso), original=new nativeDate(iso);
          return {year,time:date.getTime(),nativeTime:original.getTime(),iso:date.toISOString(),
            stringYear:date.toString().split(' ')[3],dateStringYear:date.toDateString().split(' ')[3],
            local:[date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds()],offset:date.getTimezoneOffset()};
        }),numeric:years.slice(0,-1).map(year=>[new Date(year,0,15).getTime(),Date.UTC(year,0,15),nativeDate.UTC(year,0,15)])};
      })()`);
      for (const date of value.dates) {
        assert.equal(date.time, date.nativeTime);
        assert.equal(date.iso, `${String(date.year).padStart(4, '0')}-01-15T12:34:56.789Z`);
        assert.equal(date.stringYear, String(date.year).padStart(4, '0'));
        assert.equal(date.dateStringYear, String(date.year).padStart(4, '0'));
        assert.deepEqual(date.local, [date.year, 0, 15, 12, 34, 56, 789]);
        assert.equal(date.offset, 0);
      }
      for (const [constructed, utc, nativeUTC] of value.numeric) {
        assert.equal(constructed, nativeUTC);
        assert.equal(utc, nativeUTC);
      }
    });
  }
}

for (const worker of [false, true]) {
  for (const mode of ['strict', 'compatible'] as const) {
    test(`${worker ? '序列化 worker' : '页面'} ${mode} 默认/显式 Intl 与 Date locale 结果一致`, () => {
      const context = realm(mode, worker);
      const value = read(context, `(() => {
        const d=new Date(1768478400000), explicit=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',hour:'2-digit',hourCycle:'h23'});
        return {defaults:Intl.DateTimeFormat().resolvedOptions(), explicit:explicit.resolvedOptions(),
          hour:explicit.format(d), expectedHour:new nativeDTF('en-US',{timeZone:'UTC',hour:'2-digit',hourCycle:'h23'}).format(d),
          number:Intl.NumberFormat('en-US').resolvedOptions().locale, defaultNumber:Intl.NumberFormat().resolvedOptions().locale,
          offsets:[new Date(Date.UTC(2024,0,15,12)).getTimezoneOffset(),new Date(Date.UTC(2024,6,15,12)).getTimezoneOffset()],
          date:d.toLocaleString('en-US',{timeZone:'UTC'}),nativeDate:nativeDateLocale.call(d,'en-US',{timeZone:'UTC'}),
          partialLocale:Intl.DateTimeFormat('en-US').resolvedOptions(),partialZone:Intl.DateTimeFormat(undefined,{timeZone:'UTC'}).resolvedOptions()};
      })()`);
      assert.equal(value.defaults.locale, 'fr-FR');
      assert.equal(value.defaults.timeZone, 'Europe/Paris');
      assert.equal(value.defaultNumber, 'fr-FR');
      assert.deepEqual(value.offsets, [-60, -120]);
      assert.equal(value.explicit.locale, mode === 'compatible' ? 'en-US' : 'fr-FR');
      assert.equal(value.explicit.timeZone, mode === 'compatible' ? 'UTC' : 'Europe/Paris');
      assert.equal(value.number, mode === 'compatible' ? 'en-US' : 'fr-FR');
      assert.equal(value.partialLocale.locale, mode === 'compatible' ? 'en-US' : 'fr-FR');
      assert.equal(value.partialLocale.timeZone, 'Europe/Paris');
      assert.equal(value.partialZone.locale, 'fr-FR');
      assert.equal(value.partialZone.timeZone, mode === 'compatible' ? 'UTC' : 'Europe/Paris');
      if (mode === 'compatible') { assert.equal(value.hour, value.expectedHour); assert.equal(value.date, value.nativeDate); }
      else { assert.notEqual(value.hour, value.expectedHour); assert.notEqual(value.date, value.nativeDate); }
    });
  }
  test(`${worker ? 'worker' : '页面'} compatible 保留原生 locale/option 读取、显式异常及未启用信号`, () => {
    const context = realm('compatible', worker);
    const value = read(context, `(() => {
      let reads=0; const options=Object.freeze(Object.defineProperty({},'timeZone',{get(){reads++;return 'UTC'}}));
      const inherited=Object.create({timeZone:'UTC'}), missing=Object.freeze({timeZone:undefined});
      const getters=Intl.DateTimeFormat('en-US',options).resolvedOptions();
      const errors=[()=>Intl.DateTimeFormat(null),()=>Intl.DateTimeFormat('bad_locale'),()=>Intl.DateTimeFormat('en-US',null),()=>Intl.DateTimeFormat('en-US',{timeZone:'Invalid/Zone'}),()=>Intl.DateTimeFormat('en-US',{get timeZone(){throw new SyntaxError('fixture')}})].map(f=>{try{f();return 'none'}catch(e){return e.name}});
      const constructors=['NumberFormat','Collator','RelativeTimeFormat','ListFormat','PluralRules','DisplayNames','Segmenter'].filter(k=>typeof Intl[k]==='function').map(k=>[k,new Intl[k]('en-US',k==='DisplayNames'?{type:'region'}:undefined).resolvedOptions().locale,new nativeIntl[k]('en-US',k==='DisplayNames'?{type:'region'}:undefined).resolvedOptions().locale]);
      const date=new Date(1768478400000);
      return {reads,getters,errors,constructors,inherited:Intl.DateTimeFormat('en-US',inherited).resolvedOptions().timeZone,
        missing:Intl.DateTimeFormat(undefined,missing).resolvedOptions().timeZone,
        empty:Intl.DateTimeFormat([]).resolvedOptions().locale, nativeEmpty:new nativeDTF([]).resolvedOptions().locale,
        methods:['toLocaleString','toLocaleDateString','toLocaleTimeString'].map(k=>[k,date[k]('en-US',{timeZone:'UTC'}),nativeDateMethods[k].call(date,'en-US',{timeZone:'UTC'})]),
        prototypeDefault:(()=>{Object.defineProperty(Object.prototype,'hour',{value:'invalid-fixture',configurable:true});
          try {return Intl.DateTimeFormat().resolvedOptions().timeZone;} finally {delete Object.prototype.hour;}})()};
    })()`);
    assert.equal(value.reads, 1);
    assert.equal(value.getters.timeZone, 'UTC');
    assert.equal(value.inherited, 'UTC');
    assert.equal(value.missing, 'Europe/Paris');
    assert.equal(value.empty, value.nativeEmpty);
    assert.deepEqual(value.errors, ['TypeError', 'RangeError', 'TypeError', 'RangeError', 'SyntaxError']);
    for (const [name, locale, native] of value.constructors) assert.equal(locale, native, name);
    for (const [method, actual, native] of value.methods) assert.equal(actual, native, method);
    assert.equal(value.prototypeDefault, 'Europe/Paris');
    const off = realm('compatible', worker, false, false);
    assert.equal(read(off, `Intl.DateTimeFormat().resolvedOptions().timeZone`), read(off, `new nativeDTF().resolvedOptions().timeZone`));
    assert.equal(read(off, `Intl.NumberFormat().resolvedOptions().locale`), read(off, `new nativeNF().resolvedOptions().locale`));
  });
}

test('模式缺省 strict、当前 schema 无损幂等归一化，compatible 进入 payload，非法显式模式拒绝', () => {
  const config = normalizeConfig({ rules: [normalizeRule({ domain: 'example.test' })] });
  const old = JSON.parse(JSON.stringify(config)); delete old.intlMode;
  // Intl 模式加入前是 schema v2；缺失 v3 核心字段应由外部验证拒绝。
  old.schemaVersion = 2;
  const migrated = migrateLegacyConfig({ siteSpoofConfig: old });
  assert.equal((migrated as any).intlMode, 'strict');
  assert.deepEqual(migrateLegacyConfig({ siteSpoofConfig: migrated }), migrated);
  assert.deepEqual(migrated, { ...old, schemaVersion: 3, intlMode: 'strict' });
  const compatible = normalizeConfig({ ...config, intlMode: 'compatible', globalProfile: { ...config.globalProfile,
    timezone: { enabled: true, mode: 'manual', timezone: 'Europe/Paris' }, geolocation: { ...config.globalProfile.geolocation, enabled: false } } } as any);
  assert.equal((getEffectiveProfile(compatible, 'example.test').payload as any).intlMode, 'compatible');
  assert.equal(validateConfig({ ...config, intlMode: 'typo' } as any).ok, false);
});
