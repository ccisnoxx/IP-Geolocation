import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generateRuntime, assertSelfContainedFunction } from '../build/self-contained-runtime';
import { normalizeConfig, normalizeRule } from '../src/shared/config-model';
import { getEffectiveProfile, migrateLegacyConfig, validateConfig } from '../src/shared/config-resolver';

let runtime: string;
before(async () => { runtime = assertSelfContainedFunction((await generateRuntime()).code, 'applyVanishGeoRuntime'); });

function realm(mode: 'strict' | 'compatible', worker = false, language = true, timezone = true) {
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
    this.nativeDTF=Intl.DateTimeFormat; this.nativeNF=Intl.NumberFormat;
    this.nativeDateLocale=Date.prototype.toLocaleString;
    this.nativeDateMethods=Object.fromEntries(['toLocaleString','toLocaleDateString','toLocaleTimeString'].map(k=>[k,Date.prototype[k]]));
    this.nativeIntl={...Intl}; for(const k of Object.getOwnPropertyNames(Intl)) this.nativeIntl[k]=Intl[k];
  `, context);
  vm.runInContext(runtime, context);
  context.payload = { intlMode: mode, extensionEnabled: true,
    languageConfig: { enabled: language, language: 'fr-FR', languages: ['fr-FR'], acceptLanguage: 'fr-FR' },
    timezoneConfig: { enabled: timezone, mode: 'manual', timezone: 'Europe/Paris' } };
  vm.runInContext(`applyVanishGeoRuntime(payload,'intl-test'); new Worker('/fixture.js')`, context);
  if (!worker) return context;
  const workerContext = vm.createContext({ console });
  vm.runInContext(`this.self=this; class Navigator {get language(){return 'en-US'} get languages(){return ['en-US']}};
    this.navigator=new Navigator(); this.nativeDTF=Intl.DateTimeFormat; this.nativeNF=Intl.NumberFormat;
    this.nativeDateLocale=Date.prototype.toLocaleString;
    this.nativeDateMethods=Object.fromEntries(['toLocaleString','toLocaleDateString','toLocaleTimeString'].map(k=>[k,Date.prototype[k]]));
    this.nativeIntl={...Intl}; for(const k of Object.getOwnPropertyNames(Intl)) this.nativeIntl[k]=Intl[k];`, workerContext);
  vm.runInContext(blobs[0].slice(0, blobs[0].lastIndexOf('\nimportScripts(')), workerContext);
  return workerContext;
}
const read = (context: vm.Context, source: string) => JSON.parse(vm.runInContext(`JSON.stringify(${source})`, context));

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

test('模式缺省 strict、v2 无损幂等转换，compatible 进入 payload，非法显式模式拒绝', () => {
  const config = normalizeConfig({ rules: [normalizeRule({ domain: 'example.test' })] });
  const old = JSON.parse(JSON.stringify(config)); delete old.intlMode;
  const migrated = migrateLegacyConfig({ siteSpoofConfig: old });
  assert.equal((migrated as any).intlMode, 'strict');
  assert.deepEqual(migrateLegacyConfig({ siteSpoofConfig: migrated }), migrated);
  assert.deepEqual(migrated, { ...old, intlMode: 'strict' });
  const compatible = normalizeConfig({ ...config, intlMode: 'compatible', globalProfile: { ...config.globalProfile,
    timezone: { enabled: true, mode: 'manual', timezone: 'Europe/Paris' }, geolocation: { ...config.globalProfile.geolocation, enabled: false } } } as any);
  assert.equal((getEffectiveProfile(compatible, 'example.test').payload as any).intlMode, 'compatible');
  assert.equal(validateConfig({ ...config, intlMode: 'typo' } as any).ok, false);
});
