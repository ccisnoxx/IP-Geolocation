#!/usr/bin/env node
// 实际 dist、正常安装与用户脚本开关；只在独立临时 profile 和 HTTP 回环中验收。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.argv[2], '--output');
const output = resolve(process.argv[3]);
assert.ok(!existsSync(output), '保留已有原始证据，请选择新输出文件');
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const controlFile = process.env.VG038_CONTROL_FILE;
assert.ok(controlFile, '需要临时 VG038_CONTROL_FILE');
const temporary = await mkdtemp(join(tmpdir(), 'vg038-chrome-'));
const profile = join(temporary, 'profile'), dist = join(root, 'dist');
const evidence = {
  task: 'VG-038', status: 'IN_PROGRESS', chrome: null, completed: false,
  environment: { os: process.platform, arch: process.arch, realChrome: true, headed: true,
    temporaryProfile: true, personalProfileAccessed: false, installation: 'normal UI',
    userScriptsSwitch: 'normal UI', fixtureTraffic: 'HTTP loopback only',
    browserBackgroundTraffic: 'not fully monitored' },
  checks: [], observations: {}, errors: [], cleanup: 'PENDING',
  limitations: ['不代表HTTPS、其他OS、完整重启/BFCache或任意故障注入矩阵',
    '生产观测不手工注入运行时、不修改生产API；旧bootstrap及无关注册仅在临时profile中通过Chrome API建立无副作用夹具',
    '旧文档和Worker保持快照，撤销注册只约束后续文档；HTTP(S)/SharedWorker未恢复']
};
const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
const safeMessage = error => String(error.message).replaceAll(temporary, '<temporary>').replaceAll(root, '<project>');
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(read, accept = Boolean, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await pause(80); }
  throw new Error('OBSERVATION_TIMEOUT');
}
async function fingerprint() {
  const hash = createHash('sha256');
  async function visit(path = '') {
    for (const entry of (await readdir(join(dist, path), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (!path && entry.name === '_metadata') continue;
      const name = join(path, entry.name);
      if (entry.isDirectory()) await visit(name); else { hash.update(name); hash.update(await readFile(join(dist, name))); }
    }
  }
  await visit(); return hash.digest('hex');
}
async function check(name, operation) {
  try { await operation(); evidence.checks.push({ name, passed: true }); }
  catch (error) { evidence.checks.push({ name, passed: false, error: safeMessage(error) }); console.error('CHECK_FAIL', name); }
}
function realmProbe() {
  const signal = () => ({
    language: navigator.language, languages: Array.from(navigator.languages),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    winter: new Date(Date.UTC(2026,0,15)).getTimezoneOffset(),
    summer: new Date(Date.UTC(2026,6,15)).getTimezoneOffset()
  });
  const before = Date.now();
  class DerivedDate extends Date {}
  const dates = [[], [1768478400123], [2024,0,15,12,34,56,789]].map(args => {
    const date = Reflect.construct(DerivedDate, args);
    return { derived: date instanceof DerivedDate, prototype: Object.getPrototypeOf(date) === DerivedDate.prototype,
      time: date.getTime(), local: [date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds()] };
  });
  const dateCalls = [() => Date(), () => Date(Symbol()), () => Date.call(Object.create(Date.prototype),Symbol())]
    .map(call => { try { return typeof call(); } catch(error) { return error.name; } });
  function Custom() {}
  const custom = Reflect.construct(Date, [0], Custom);
  const names = ['DateTimeFormat','NumberFormat','Collator','RelativeTimeFormat','ListFormat','PluralRules','DisplayNames','Segmenter'];
  const constructors = names.filter(name => typeof Intl[name] === 'function').map(name => {
    const Ctor = Intl[name], options = name === 'DisplayNames' ? { type: 'region' } : name === 'DateTimeFormat' ? { timeZone: 'UTC' } : undefined;
    class Derived extends Ctor {}
    const value = new Derived('en-US',options);
    let call; try { call = { locale: Reflect.apply(Ctor, undefined, ['en-US',options]).resolvedOptions().locale }; }
    catch(error) { call = { error: error.name }; }
    let legacy;
    if (['DateTimeFormat','NumberFormat','Collator'].includes(name)) {
      const receiver = Object.create(Ctor.prototype), result = Reflect.apply(Ctor,receiver,['en-US',options]);
      let repeated; try { Reflect.apply(Ctor,receiver,['en-US',options]); repeated = 'none'; } catch(error) { repeated = error.name; }
      legacy = { same: result === receiver, repeated };
    }
    return { name, derived: value instanceof Derived, prototype: Object.getPrototypeOf(value) === Derived.prototype,
      locale: value.resolvedOptions().locale, timeZone: name === 'DateTimeFormat' ? value.resolvedOptions().timeZone : null, call, legacy };
  });
  const years = [0,1,9,50,99,100].map(year => {
    const iso = String(year).padStart(4,'0') + '-01-15T12:34:56.789Z', date = new Date(iso);
    return { year, iso: date.toISOString(), time: date.getTime(), offset: date.getTimezoneOffset(),
      local: [date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds()],
      dateString: date.toDateString(), string: date.toString() };
  });
  const numeric = [0,1,50,99].map(year => [year,new Date(year,0,15).getTime(),Date.UTC(year,0,15)]);
  return { signal: signal(), before, after: Date.now(), dates, dateCalls, custom: { prototype: Object.getPrototypeOf(custom) === Custom.prototype, time: Date.prototype.getTime.call(custom) },
    constructors, years, numeric,
    explicit: Intl.DateTimeFormat('en-US',{timeZone:'UTC'}).resolvedOptions(),
    sharedSource: typeof SharedWorker === 'function' ? Function.prototype.toString.call(SharedWorker) : null };
}
function nativeLocaleReference() {
  return Object.fromEntries(['en-US','fr-FR'].map(locale => [locale, Object.fromEntries(
    ['DateTimeFormat','NumberFormat','Collator','RelativeTimeFormat','ListFormat','PluralRules','DisplayNames','Segmenter']
      .filter(name => typeof Intl[name] === 'function')
      .map(name => [name,new Intl[name](locale,name === 'DisplayNames' ? {type:'region'} : undefined).resolvedOptions().locale])
  )]));
}
function startChain(types) {
  const type = types[0], rest = types.slice(1), urls = [];
  const make = source => { const url = URL.createObjectURL(new Blob([source],{type:'text/javascript'})); urls.push(url); return url; };
  const dependency = type === 'module' ? make('export const first=(' + realmProbe.toString() + ')();') : null;
  const source = (dependency ? 'import {first as dependency} from ' + JSON.stringify(dependency) + ';' : '') +
    'const realmProbe=' + realmProbe.toString() + ';const first=realmProbe();const startChain=' + startChain.toString() + ';' +
    'onmessage=async event=>{try{const rest=' + JSON.stringify(rest) + ';const child=rest.length?await startChain(rest):[];' +
    'postMessage({records:[{type:' + JSON.stringify(type) + ',first,dependency:' + (dependency ? 'dependency' : 'first') + ',echo:event.data},...child]})}' +
    'catch(error){postMessage({error:error.name+":"+error.message})}};';
  const url = make(source); let worker;
  return new Promise((resolve,reject) => {
    const cleanup = () => { clearTimeout(timer); worker?.terminate(); urls.forEach(url => URL.revokeObjectURL(url)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('WORKER_TIMEOUT')); },10000);
    try {
      worker = new Worker(url,{type});
      worker.onmessage = event => { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.records); };
      worker.onerror = event => { event.preventDefault(); cleanup(); reject(new Error('worker-error')); };
      worker.postMessage('early-message'); URL.revokeObjectURL(url);
    } catch(error) { cleanup(); reject(error); }
  });
}
async function blobCases() {
  const chains = [];
  for (const parent of ['classic','module']) for (const child of ['classic','module']) {
    try { chains.push({ chain: [parent,child,child === 'classic' ? 'module' : 'classic'], records: await startChain([parent,child,child === 'classic' ? 'module' : 'classic']) }); }
    catch(error) { chains.push({ chain: [parent,child], error: error.message }); }
  }
  return chains;
}
async function lifecycleCases() {
  const rows = [];
  for (const type of ['classic','module']) for (const kind of ['error','revoked','terminate']) {
    const source = kind === 'error' ? 'throw new Error("synthetic worker error")' : 'postMessage("unexpected-message")';
    const url = URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    if (kind === 'revoked') URL.revokeObjectURL(url);
    let worker, timer;
    const result = await new Promise(resolve => {
      try {
        worker = new Worker(url,{type});
        worker.onmessage = () => { clearTimeout(timer); resolve('message'); };
        worker.onerror = event => { event.preventDefault(); clearTimeout(timer); resolve('worker-error'); };
        if (kind === 'terminate') { worker.terminate(); timer = setTimeout(() => resolve('terminated-without-message'),400); }
        else timer = setTimeout(() => resolve('timeout'),6000);
        URL.revokeObjectURL(url);
      } catch(error) { resolve(error.name); }
    });
    worker?.terminate(); clearTimeout(timer); URL.revokeObjectURL(url); rows.push({type,kind,result});
  }
  return rows;
}
let server, browser, socket, options, extensionId, sequence = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve,reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP_TIMEOUT:' + method)); },20000);
    pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params,sessionId}));
  });
}
async function evaluate(target, expression) {
  const result = await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},target.sessionId);
  assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description?.split('\n')[0] || 'PAGE_EXCEPTION');
  return result.result.value;
}
async function page(url) {
  const target = {targetId:(await send('Target.createTarget',{url:'about:blank'})).targetId};
  Object.assign(target,await send('Target.attachToTarget',{targetId:target.targetId,flatten:true}));
  await send('Page.enable',{},target.sessionId);
  await send('Page.navigate',{url},target.sessionId);
  await until(() => evaluate(target,'document.readyState==="complete" && location.href===' + JSON.stringify(url)));
  return target;
}
const close = target => send('Target.closeTarget',{targetId:target.targetId});
async function message(request) {
  const response = await evaluate(options,'chrome.runtime.sendMessage(' + JSON.stringify(request) + ')');
  assert.ok(response && response.status !== 'error',response?.message || 'MANAGEMENT_MESSAGE_FAILED');
  return response;
}
async function registrationSummary() {
  return evaluate(options,'(async()=>({user:(await chrome.userScripts.getScripts()).map(s=>({id:s.id,matches:s.matches,excludeMatches:s.excludeMatches})),content:(await chrome.scripting.getRegisteredContentScripts()).map(s=>({id:s.id,matches:s.matches})),dynamic:(await chrome.declarativeNetRequest.getDynamicRules()).map(r=>r.id),session:(await chrome.declarativeNetRequest.getSessionRules()).map(r=>r.id)}))()');
}
async function checkRealm(label, value, want, locale, explicitZone) {
  await check(label + ':signals',() => assert.deepEqual(value.signal,want));
  await check(label + ':Date-subclass-and-call',() => {
    assert.ok(value.dates.every(date => date.derived && date.prototype));
    assert.ok(value.dates[0].time >= value.before && value.dates[0].time <= value.after);
    assert.equal(value.dates[1].time,1768478400123);
    assert.deepEqual(value.dates[2].local,[2024,0,15,12,34,56,789]);
    assert.deepEqual(value.dateCalls,['string','string','string']);
    assert.deepEqual(value.custom,{prototype:true,time:0});
  });
  await check(label + ':Intl-constructor-set',() => assert.deepEqual(value.constructors.map(item=>item.name),evidence.observations.native.constructors.map(item=>item.name)));
  await check(label + ':Intl-explicit-timezone',() => assert.equal(value.explicit.timeZone,explicitZone));
  for (const item of value.constructors) await check(label + ':Intl-' + item.name,() => {
    assert.ok(item.derived && item.prototype);
    assert.equal(item.locale,evidence.observations.nativeLocales[locale][item.name]);
    if(item.name === 'DateTimeFormat') assert.equal(item.timeZone,explicitZone);
    const native = evidence.observations.native.constructors.find(row => row.name === item.name);
    assert.deepEqual(item.legacy,native.legacy);
    if (['DateTimeFormat','NumberFormat','Collator'].includes(item.name)) assert.equal(item.call.locale,item.locale);
    else assert.deepEqual(item.call,native.call);
  });
  if (want.timeZone === 'UTC') await check(label + ':years-0-through-99',() => {
    for (const item of value.years) {
      assert.deepEqual(item.local,[item.year,0,15,12,34,56,789]);
      assert.equal(item.offset,0);
      assert.equal(item.iso,String(item.year).padStart(4,'0') + '-01-15T12:34:56.789Z');
      assert.equal(item.dateString.split(' ').at(-1),String(item.year).padStart(4,'0'));
      assert.equal(item.string.split(' ')[3],String(item.year).padStart(4,'0'));
    }
    for (const [year,constructed,utc] of value.numeric) { assert.equal(constructed,Date.UTC(year,0,15)); assert.equal(utc,Date.UTC(year,0,15)); }
  });
}
async function runProduction(origin, otherOrigin) {
  const configs = [
    {name:'strict',mode:'strict',language:'fr-FR',timezone:'Europe/Paris',winter:-60,summer:-120},
    {name:'compatible',mode:'compatible',language:'en-US',timezone:'America/Los_Angeles',winter:480,summer:420},
    {name:'ancient-UTC',mode:'compatible',language:'en-US',timezone:'UTC',winter:0,summer:0}
  ];
  let config = (await message({action:'getSiteConfig'})).config;
  config.globalProfile.geolocation.enabled = false; config.fontExposure.enabled = false; config.webRtc = {globalMode:'default'};
  config.rules = [{id:'vg038-loopback',domain:'localhost',enabled:true}]; config.masterEnabled = true;
  let retained, retainedSnapshot;
  for (const phase of configs) {
    config.intlMode = phase.mode;
    config.globalProfile.language = {enabled:true,mode:'custom',language:phase.language,languages:[phase.language,phase.language.split('-')[0]]};
    config.globalProfile.timezone = {enabled:true,mode:'manual',timezone:phase.timezone};
    const saved = await message({action:'setSiteConfig',config}); config = saved.config;
    await check(phase.name + ':production-registration',() => { assert.equal(saved.syncReport.pageRuntime.state,'ready'); assert.equal(saved.syncReport.components.headers.status,'ok'); });
    const target = await page(origin + '/probe');
    const row = await evaluate(target,'({first:early,live:realmProbe(),token,sharedSource:realmProbe().sharedSource})');
    row.chains = await evaluate(target,'blobCases()');
    const want = {language:phase.language,languages:config.globalProfile.language.languages,locale:phase.language,timeZone:phase.timezone,winter:phase.winter,summer:phase.summer};
    await checkRealm(phase.name + ':first-page',row.first,want,phase.mode === 'strict' ? phase.language : 'en-US',phase.mode === 'strict' ? phase.timezone : 'UTC');
    await check(phase.name + ':explicit-Intl-options',() => {
      assert.equal(row.live.explicit.locale,phase.mode === 'strict' ? phase.language : 'en-US');
      assert.equal(row.live.explicit.timeZone,phase.mode === 'strict' ? phase.timezone : 'UTC');
      assert.equal(row.sharedSource,evidence.observations.native.sharedSource);
    });
    for (const chain of row.chains) {
      const label = phase.name + ':Blob-' + chain.chain.join('>');
      await check(label + ':three-levels-and-early-message',() => { assert.equal(chain.records?.length,3); assert.ok(chain.records.every(record => record.echo === 'early-message')); });
      for (const [index,record] of (chain.records || []).entries()) {
        await checkRealm(label + ':' + index,record.first,want,phase.mode === 'strict' ? phase.language : 'en-US',phase.mode === 'strict' ? phase.timezone : 'UTC');
        await check(label + ':' + index + ':module-dependency-first',() => assert.deepEqual(record.dependency.signal,want));
        if(record.type === 'module') await checkRealm(label + ':' + index + ':module-dependency',record.dependency,want,phase.mode === 'strict' ? phase.language : 'en-US',phase.mode === 'strict' ? phase.timezone : 'UTC');
      }
    }
    evidence.observations[phase.name] = row;
    if (phase.name === 'compatible') {
      const lifecycle = await evaluate(target,'lifecycleCases()');
      evidence.observations.lifecycle = lifecycle;
      for (const item of lifecycle) await check('Blob:' + item.type + ':' + item.kind,() => assert.equal(item.result,item.kind === 'terminate' ? 'terminated-without-message' : 'worker-error'));
    }
    if (phase.name === 'ancient-UTC') { retained = target; retainedSnapshot = row; } else await close(target);
    await save();
  }
  // 顶层未匹配、子帧匹配；只改时区，不借语言头变化制造重载窗口。
  const parent = await page(otherOrigin + '/parent');
  const before = await until(() => evaluate(parent,'childObservation || null'));
  const tabId = await evaluate(options,'chrome.tabs.query({}).then(t=>t.find(v=>v.url===' + JSON.stringify(otherOrigin + '/parent') + ').id)');
  const headersBefore = await evaluate(options,'chrome.declarativeNetRequest.getDynamicRules()');
  config.globalProfile.timezone.timezone = 'America/Los_Angeles';
  const changed = await message({action:'setSiteConfig',config}); config = changed.config;
  const metadata = await evaluate(options,'chrome.storage.session.get("runtimeSyncMetadata").then(v=>v.runtimeSyncMetadata)');
  const after = await evaluate(parent,'sampleChild()');
  const parentBefore = await evaluate(parent,'({token,signal:realmProbe().signal})');
  await check('iframe:timezone-only-change-reload-debt',() => {
    assert.equal(before.signal.timeZone,'UTC'); assert.equal(before.signal.language,'en-US');
    assert.equal(changed.syncReport.pageRuntime.reloadRequired,true);
    assert.ok(metadata.pendingReloads.some(item => item.tabId === tabId && item.surfaces?.includes('page')));
    assert.deepEqual(after.signal,before.signal);
    assert.equal(after.token,before.token);
    assert.deepEqual(parentBefore.signal,evidence.observations.native.signal);
  });
  await check('iframe:timezone-change-keeps-DNR',async() => assert.deepEqual(await evaluate(options,'chrome.declarativeNetRequest.getDynamicRules()'),headersBefore));
  const optionsTimeOrigin = await evaluate(options,'performance.timeOrigin');
  await send('Page.reload',{},options.sessionId);
  await until(()=>evaluate(options,'performance.timeOrigin!==' + JSON.stringify(optionsTimeOrigin) + ' && document.getElementById("webrtcPolicyStatus")?.textContent.includes("控制级别：")'));
  const text = await evaluate(options,'document.getElementById("runtimeSyncStatus").textContent');
  await check('iframe:visible-reload-guidance',() => assert.match(text,/已有受影响页面需完整重载（reload）或关闭后重新打开/));
  await send('Page.reload',{},parent.sessionId);
  const reloaded = await until(() => evaluate(parent,'childObservation || null'),row => row?.token && row.token !== before.token);
  await check('iframe:full-reload-adopts-new-timezone',() => {
    assert.equal(reloaded.signal.timeZone,'America/Los_Angeles'); assert.equal(reloaded.signal.winter,480);
    assert.notEqual(reloaded.token,before.token);
  });
  evidence.observations.iframe = {topMatched:false,tabDebtRecorded:true,before,after,reloaded,visibleReloadText:text};
  // 同时启用定位和固定字体以验证各注册命名空间的正常关闭；不调用位置传感器。
  config.globalProfile.geolocation = {...config.globalProfile.geolocation,enabled:true,mode:'manual',latitude:0,longitude:0,accuracy:50,spoofPermission:true};
  config.fontExposure.enabled = true; config.fontExposure.mode = 'vendor-software';
  await message({action:'setSiteConfig',config});
  await evaluate(options,'(async()=>{await chrome.userScripts.register([{id:"vg038-unrelated-userscript",matches:["http://localhost/*"],js:[{code:"void 0"}]}]);await chrome.scripting.registerContentScripts([{id:"vg038-unrelated-content",matches:["http://localhost/*"],js:["content/content.js"]},{id:"vanishgeo-runtime-init",matches:["http://localhost/*"],js:["content/content.js"]}])})()');
  const registrationsBefore = await registrationSummary();
  const disabled = await message({action:'setExtensionEnabled',enabled:false});
  const registrationsAfter = await registrationSummary();
  await check('disabled:all-owned-registrations-cleared-and-unrelated-kept',() => {
    assert.ok(registrationsBefore.user.some(s=>s.id.startsWith('vanishgeo-language-timezone-')));
    assert.ok(registrationsBefore.user.some(s=>s.id.startsWith('vanishgeo-geolocation-')));
    assert.ok(registrationsBefore.content.some(s=>s.id.startsWith('vanishgeo-font-exposure-')));
    assert.deepEqual(registrationsAfter.user.map(s=>s.id),['vg038-unrelated-userscript']);
    assert.deepEqual(registrationsAfter.content.map(s=>s.id),['vg038-unrelated-content']);
    assert.equal(registrationsAfter.dynamic.filter(id=>id>=40000&&id<=49999).length,0);
    assert.equal(disabled.syncReport.pageRuntime.state,'disabled'); assert.equal(disabled.syncReport.geolocationRuntime.state,'disabled');
    assert.equal(disabled.syncReport.fontRuntime.state,'disabled'); assert.equal(disabled.syncReport.components.headers.status,'ok');
  });
  const old = await evaluate(retained,'({probe:realmProbe(),token})');
  const oldChains = await evaluate(retained,'blobCases()');
  await check('disabled:old-document-and-new-Blob-retain-document-snapshot',() => {
    assert.equal(old.token,retainedSnapshot.token); assert.deepEqual(old.probe.signal,retainedSnapshot.first.signal);
    assert.equal(oldChains.length,4); assert.ok(oldChains.every(row=>row.records?.length===3&&row.records.every(record=>record.first.signal.timeZone==='UTC')));
  });
  await send('Page.reload',{},retained.sessionId);
  const fresh = await until(() => evaluate(retained,'({probe:realmProbe(),token})'),row=>row.token && row.token !== old.token);
  const freshChains = await evaluate(retained,'blobCases()');
  await check('disabled:full-reload-restores-native-page-and-Blob',() => {
    assert.deepEqual(fresh.probe.signal,evidence.observations.native.signal);
    assert.ok(freshChains.every(row=>row.records?.length===3&&row.records.every(record=>JSON.stringify(record.first.signal)===JSON.stringify(evidence.observations.native.signal))));
  });
  const offNew = await page(origin+'/probe');
  const nativeNew = await evaluate(offNew,'early');
  await check('disabled:new-document-native',()=>assert.deepEqual(nativeNew.signal,evidence.observations.native.signal));
  const enabled = await message({action:'setExtensionEnabled',enabled:true});
  await check('reenabled:existing-native-document-not-hot-updated',async()=>{
    assert.equal(enabled.syncReport.pageRuntime.state,'ready');
    assert.deepEqual((await evaluate(offNew,'realmProbe()')).signal,evidence.observations.native.signal);
  });
  await send('Page.reload',{},offNew.sessionId);
  const restored = await until(()=>evaluate(offNew,'realmProbe()'),row=>row.signal.timeZone==='America/Los_Angeles');
  await check('reenabled:full-reload-restores-language-timezone-and-Blob',async()=>{
    assert.equal(restored.signal.language,'en-US'); assert.equal(restored.signal.timeZone,'America/Los_Angeles');
    const chains = await evaluate(offNew,'blobCases()');
    assert.ok(chains.every(row=>row.records?.length===3&&row.records.every(record=>record.first.signal.timeZone==='America/Los_Angeles')));
  });
  evidence.observations.switching = {registrationsBefore,registrationsAfter,disabledReport:disabled.syncReport,oldSnapshot:old.probe.signal,
    afterReload:fresh.probe.signal,newDocument:nativeNew.signal,reenabled:restored.signal};
  await message({action:'setExtensionEnabled',enabled:false});
  await evaluate(options,'(async()=>{await chrome.userScripts.unregister({ids:["vg038-unrelated-userscript"]});await chrome.scripting.unregisterContentScripts({ids:["vg038-unrelated-content"]})})()');
  evidence.completed = true;
}
let phase = 'prepare';
try {
  evidence.distSha256 = await fingerprint();
  evidence.sourceCommit = (await import('node:child_process')).execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const core = ['src/background/services.ts','src/background/page-scripts.ts','src/injected/runtime-modules/surfaces/intl-date.ts','src/injected/runtime-modules/worker/intl-date.ts'];
  evidence.sourceFiles = Object.fromEntries(await Promise.all(core.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
  server = createServer((request,response)=>{
    const pathname = new URL(request.url,'http://localhost').pathname;
    response.setHeader('Cache-Control','no-store'); response.setHeader('Content-Type','text/html; charset=utf-8');
    const port = server.address().port;
    const base = '<!doctype html><meta charset="utf-8"><title>VG-038 Chrome regression</title><script>const realmProbe=' + realmProbe.toString() + ';const token=crypto.randomUUID();const early=realmProbe();const startChain=' + startChain.toString() + ';const blobCases=' + blobCases.toString() + ';const lifecycleCases=' + lifecycleCases.toString() + ';</script><pre id="result">VG-038 observation fixture</pre>';
    if (pathname === '/parent') response.end(base + '<script>let childObservation=null;let receive;addEventListener("message",e=>{if(e.origin!==' + JSON.stringify('http://localhost:'+port) + '||e.source!==document.querySelector("iframe").contentWindow)return;childObservation=e.data;if(receive){receive(e.data);receive=null}});function sampleChild(){return new Promise(resolve=>{receive=resolve;document.querySelector("iframe").contentWindow.postMessage("sample","http://localhost:'+port+'")})}</script><iframe src="http://localhost:'+port+'/child"></iframe>');
    else if (pathname === '/child') response.end(base + '<script>function report(){parent.postMessage({signal:realmProbe().signal,token},"http://127.0.0.1:'+port+'")}addEventListener("message",e=>{if(e.source===parent&&e.data==="sample")report()});report()</script>');
    else if (pathname === '/probe') response.end(base);
    else {response.writeHead(404);response.end('Not Found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://localhost:'+server.address().port, otherOrigin = 'http://127.0.0.1:'+server.address().port;
  browser = spawn(chrome,['--remote-debugging-port=0','--user-data-dir='+profile,'--disable-background-networking','--disable-component-update','--no-proxy-server','--no-first-run','--no-default-browser-check','chrome://extensions/'],{stdio:'ignore'});
  let launchError;
  browser.once('error',error=>{launchError=error});
  const port = await until(async()=>{if(launchError)throw new Error('CHROME_START_FAILED:'+launchError.code);if(browser.exitCode!==null)throw new Error('CHROME_EXITED');try{return(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]}catch(error){if(error.code!=='ENOENT')throw error}});
  const version = await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();
  evidence.chrome = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  socket.onmessage = event => {const item=JSON.parse(event.data), p=pending.get(item.id);if(p){clearTimeout(p.timer);pending.delete(item.id);item.error?p.reject(new Error(item.error.message)):p.resolve(item.result)}};
  await writeFile(controlFile,JSON.stringify({port,profile,dist,origin,otherOrigin,browserPid:browser.pid})+'\n');
  const native = await page(origin+'/probe');
  evidence.observations.native = await evaluate(native,'early');
  evidence.observations.nativeLocales = await evaluate(native,'('+nativeLocaleReference.toString()+')()');
  await close(native);
  phase = 'await-normal-install';
  console.log('BROWSER_READY',evidence.chrome,'Install dist and enable Allow User Scripts using normal UI. Commands: installed, finish');
  await save();
  const input = createInterface({input:process.stdin});
  for await (const line of input) {
    if (line.trim() === 'finish') {input.close();break;}
    if (line.trim() !== 'installed') continue;
    try {
      phase = 'verify-normal-install';
      const infos = (await send('Target.getTargets')).targetInfos;
      const worker = infos.find(target=>target.type==='service_worker'&&target.url.startsWith('chrome-extension://'));
      assert.ok(worker,'需要正常安装实际dist');extensionId = new URL(worker.url).host;
      const details = await page('chrome://extensions/?id='+extensionId);
      const allowed = await evaluate(details,'(()=>{const visit=root=>{for(const el of root.querySelectorAll("*")){if(el.id==="allow-user-scripts")return el.shadowRoot?.querySelector("cr-toggle")?.checked===true;if(el.shadowRoot){const found=visit(el.shadowRoot);if(found!==undefined)return found}}};return visit(document)===true})()');
      assert.equal(allowed,true,'需要正常UI开启Allow User Scripts');await close(details);
      options = await page('chrome-extension://'+extensionId+'/options/options.html');
      await until(()=>evaluate(options,'document.getElementById("webrtcPolicyStatus")?.textContent.includes("控制级别：")'));
      phase = 'production-regression';await runProduction(origin,otherOrigin);await save();
      console.log('REGRESSION_COMPLETE',evidence.checks.filter(row=>row.passed).length+'/'+evidence.checks.length);
    } catch(error) {evidence.errors.push({phase,error:error.name,code:error.code||null,message:safeMessage(error)});await save();console.error('COMMAND_FAILED',phase,safeMessage(error));}
  }
  await check('dist-unchanged-during-browser-validation',async()=>assert.equal(await fingerprint(),evidence.distSha256));
  evidence.status = !evidence.completed ? 'BLOCKED' : !evidence.errors.length && evidence.checks.every(row=>row.passed) ? 'PASS' : 'FAIL';
} catch(error) {
  evidence.errors.push({phase,error:error.name,code:error.code||null,message:safeMessage(error)});
  evidence.status='BLOCKED';console.error('RUN_BLOCKED',phase,error.name);
} finally {
  try {await save()} catch(error) {evidence.status='BLOCKED';evidence.errors.push({phase:'evidence-write',error:error.name,code:error.code||null,message:safeMessage(error)})}
  let exited = !browser?.pid;
  if (browser?.pid) {
    if (socket?.readyState===WebSocket.OPEN) {try{await send('Browser.close')}catch{}}
    try {await until(()=>browser.exitCode!==null||browser.signalCode,Boolean,5000);exited=true}
    catch {browser.kill('SIGTERM');try{await until(()=>browser.exitCode!==null||browser.signalCode,Boolean,5000);exited=true}catch{}}
  }
  socket?.close();
  for(const value of pending.values()){clearTimeout(value.timer);value.reject(new Error('CDP_CLOSED'))}pending.clear();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  if(exited)await rm(temporary,{recursive:true,force:true});
  await rm(controlFile,{force:true});
  evidence.cleanup={browserMainExited:exited,temporaryProfileRemoved:!existsSync(temporary),serverClosed:!server?.listening};
  if(!Object.values(evidence.cleanup).every(Boolean))evidence.status='FAIL';
  try {await save()} catch(error) {evidence.status='BLOCKED';console.error('EVIDENCE_WRITE_FAILED',error.name)}
  console.log('FINISHED',evidence.status,evidence.checks.length);process.exitCode=evidence.status==='PASS'?0:2;
}
