import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { generatePageRuntime, generateFontFilter, assertSelfContainedFunction } from '../build/self-contained-runtime';
import { createDocumentController } from '../src/injected/runtime-modules/document-controller';
import { defineRuntimeProperty } from '../src/injected/runtime-modules/registry';
import { parseFontUpdate, parseGeolocationUpdate, createPageUpdateParser } from '../src/injected/runtime-modules/runtime-update';

function context() {
  const realm = vm.createContext({ crypto: webcrypto, console: { warn() {} } }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`
    this.origin='https://example.test'; this.location={protocol:'https:',href:origin+'/'};
    this.messages=[]; const handlers=new Map();
    this.postMessage=data=>messages.push(data);
    this.addEventListener=(type,fn)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn)};
    this.removeEventListener=(type,fn)=>handlers.get(type)?.delete(fn);
    this.emit=(type,event)=>{for(const fn of [...handlers.get(type)||[]])fn(event)};
    class Navigator {get language(){return 'en-US'} get languages(){return ['en-US','en']}}
    this.navigator=new Navigator();
    this.NativeDate=Date; this.nativeHours=Date.prototype.getHours; this.nativeParse=Date.parse;
    this.NativeDTF=Intl.DateTimeFormat; this.NativeNF=Intl.NumberFormat; this.originalDTF=new NativeDTF('en-US',{timeZone:'UTC'});
    this.nativeResolved=Intl.DateTimeFormat.prototype.resolvedOptions;
    this.nativeLanguage=Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get;
  `, realm);
  const run = (code: string) => vm.runInContext(code, realm);
  const update = (surface: string, payload: unknown, sequence: number) => {
    realm.updateData = { kind: 'vg-live-update-v1', surface, sequence, payloadText: JSON.stringify(payload) };
    run(`updateData.nonce=messages.find(message=>message.surface===updateData.surface).nonce; emit('message',{source:globalThis,origin,data:updateData})`);
  };
  return { realm, run, update };
}

test('生产页面控制器更新/清除语言Date/Intl，旧函数透传原生，已有formatter保持构造值', async () => {
  const source = assertSelfContainedFunction((await generatePageRuntime()).code, 'applyLanguageTimezoneRuntime');
  const p = context();
  const payload = { intlMode: 'strict', language: { language: 'fr-FR', languages: ['fr-FR', 'fr'] }, timezone: 'Pacific/Honolulu' };
  p.run(`(${source})(${JSON.stringify(payload)})`);
  assert.equal(p.run('navigator.language'), 'fr-FR');
  assert.equal(p.run('Object.isFrozen(navigator.languages) && navigator.languages===navigator.languages'), true);
  assert.equal(p.run('Date.prototype.constructor===Date'), true);
  assert.equal(p.run('Intl.DateTimeFormat.prototype.resolvedOptions===nativeResolved'), true);
  assert.equal(p.run('originalDTF.resolvedOptions().timeZone'), 'UTC');
  p.run(`this.oldDate=Date;this.oldParse=Date.parse;this.oldHours=Date.prototype.getHours;
    this.oldLocale=Intl.NumberFormat;this.oldFormatter=new Intl.DateTimeFormat();this.oldLanguages=navigator.languages;`);
  p.update('page', payload, 1);
  assert.equal(p.run('oldLanguages===navigator.languages'), true);
  p.update('page', { intlMode: 'compatible', language: { language: 'de-DE', languages: ['de-DE'] }, timezone: 'Europe/Berlin' }, 2);
  assert.equal(p.run('navigator.language'), 'de-DE');
  assert.equal(p.run('new Intl.DateTimeFormat().resolvedOptions().timeZone'), 'Europe/Berlin');
  assert.equal(p.run('oldFormatter.resolvedOptions().timeZone'), 'Pacific/Honolulu');
  assert.equal(p.run(`oldHours.call(new NativeDate(0))===nativeHours.call(new NativeDate(0))`), true);
  assert.equal(p.run(`oldParse('2024-03-10T02:30')===nativeParse('2024-03-10T02:30')`), true);
  assert.equal(p.run(`oldDate.parse('2024-03-10T02:30')===nativeParse('2024-03-10T02:30')`), true);
  assert.equal(p.run('new oldLocale().resolvedOptions().locale'), p.run('new NativeNF().resolvedOptions().locale'));
  p.update('page', null, 3);
  assert.equal(p.run('Date===NativeDate && Date.prototype.getHours===nativeHours && Intl.DateTimeFormat===NativeDTF'), true);
  assert.equal(p.run('navigator.language'), 'en-US');
  // 旧消息、非法值都不能覆盖已清除状态。
  p.update('page', payload, 2);
  p.update('page', { ...payload, timezone: 'invalid/timezone' }, 4);
  assert.equal(p.run('Date===NativeDate && navigator.language==="en-US"'), true);
  p.update('page', payload, 5);
  assert.equal(p.run('navigator.language'), 'fr-FR');
});

test('清除不覆盖页面后写descriptor，清理异常仍继续恢复其他属性并显式失败', () => {
  const owner = { value() { return 'native'; }, other() { return 'native-other'; } };
  const root = globalThis as any;
  const controller = createDocumentController<number>(root, state => {
    defineRuntimeProperty(root, state, owner, 'value', { configurable: true, writable: true, value() { return 'patched'; } });
    defineRuntimeProperty(root, state, owner, 'other', { configurable: true, writable: true, value() { return 'patched-other'; } });
    state.cleanup.push(() => { throw new Error('synthetic cleanup failure'); });
  });
  controller.update(1);
  const cached = owner.other;
  owner.value = () => 'page-owned';
  assert.throws(() => controller.update(null), /清理未完成/);
  assert.equal(owner.value(), 'page-owned');
  assert.equal(owner.other(), 'native-other');
  assert.equal(cached(), 'native-other');
});

test('最小更新边界拒绝非法类型及枚举，并去掉未知原型/配置字段', () => {
  const parse = createPageUpdateParser(globalThis as any);
  assert.throws(() => parse({ intlMode: 'bad' }));
  assert.throws(() => parse({ intlMode: 'strict', language: { language: 'en-US', languages: [''] } }));
  assert.throws(() => parse({ intlMode: 'strict', timezone: '+02:00' }));
  assert.throws(() => parseFontUpdate({ enabled: true, mode: 'layered', blockedFamilies: [], layers: { platform: 'windows', hideCjkFonts: true } }));
  assert.throws(() => parseGeolocationUpdate({ latitude: 120, longitude: 23 }));
  const value = JSON.parse('{"intlMode":"strict","__proto__":{"timezone":"Synthetic"},"config":{"secret":"synthetic"}}');
  assert.deepEqual(parse(value), { intlMode: 'strict' });
  assert.deepEqual(parseGeolocationUpdate({ unavailable: true, config: 'not-forwarded' }), { unavailable: true });
});

test('生产字体控制器更新名单并清除Canvas/queryLocalFonts，check始终原生', async () => {
  const source = assertSelfContainedFunction((await generateFontFilter()).code, 'applyFixedFontFilter');
  const p = context();
  p.run(`class CanvasRenderingContext2D {
    constructor(){this._font='16px Arial'} get font(){return this._font} set font(v){this._font=v}
    measureText(text){return {font:this.font,text:String(text)}}
  };this.CanvasRenderingContext2D=CanvasRenderingContext2D;
  this.OffscreenCanvasRenderingContext2D=CanvasRenderingContext2D;
  this.ctx=new CanvasRenderingContext2D();this.nativeMeasure=CanvasRenderingContext2D.prototype.measureText;
  this.document={fonts:{check(){return true}}};this.nativeCheck=document.fonts.check;
  this.queryLocalFonts=()=>Promise.resolve([{family:'Arial',fullName:'Arial',postscriptName:'ArialMT'}]);this.nativeQuery=queryLocalFonts;`);
  p.run(`(${source})({enabled:true,mode:'custom',blockedFamilies:['Arial']})`);
  assert.equal(p.run(`ctx.measureText('x').font`), '16px "__vg_absent__"');
  assert.equal((await p.run('queryLocalFonts()')).length, 0);
  assert.equal(p.run('document.fonts.check===nativeCheck'), true);
  p.update('font', { enabled: true, mode: 'custom', blockedFamilies: ['SimSun'] }, 1);
  assert.equal(p.run(`ctx.measureText('x').font`), '16px Arial');
  assert.equal((await p.run('queryLocalFonts()')).length, 1);
  p.update('font', null, 2);
  assert.equal(p.run('CanvasRenderingContext2D.prototype.measureText===nativeMeasure && queryLocalFonts===nativeQuery'), true);
});


test('冻结persona入口不建立实时消息监听，公开握手不能改写固定快照', async () => {
  const source=assertSelfContainedFunction((await generatePageRuntime(undefined,false)).code,'applyLanguageTimezoneRuntime');
  const p=context();p.run(`(${source})({intlMode:'strict',language:{language:'fr-FR',languages:['fr-FR']},timezone:'Europe/Paris'})`);
  assert.equal(p.run('messages.length'),0);
  p.run(`emit('message',{source:globalThis,origin,data:{kind:'vg-live-ready-v1'}})`);
  assert.equal(p.run('messages.length'),0);assert.equal(p.run('navigator.language'),'fr-FR');
});
