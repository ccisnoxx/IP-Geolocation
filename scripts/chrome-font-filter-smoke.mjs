#!/usr/bin/env node
// 隔离资格/正式 dist 验证：只操作临时扩展与合成 loopback 配置，不修改用户 profile。
import assert from 'node:assert/strict';
import { build } from 'vite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { generateFontFilter, assertSelfContainedFunction } from '../build/self-contained-runtime.ts';
import { compileFontScripts } from '../src/background/font-scripts.ts';
import { createInitialConfig, createRule } from '../src/shared/config-model.ts';
import { VENDOR_SOFTWARE_FONT_FAMILIES } from '../src/shared/font-families.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let output;
let browserRestart = false;
let servicesIntegration = false;
let production = false;
let startupReadFailure = false;
let browserDisable = false;
let headed = false;
let persistentCold = false;
let httpSessionRestore = false;
for(let index=0;index<args.length;index++) {
  if(args[index]==='--output' && args[index+1]) output=args[++index];
  else if(args[index]==='--browser-restart') browserRestart=true;
  else if(args[index]==='--services-integration') servicesIntegration=true;
  else if(args[index]==='--production') production=true;
  else if(args[index]==='--startup-read-failure') startupReadFailure=true;
  else if(args[index]==='--browser-disable') browserDisable=true;
  else if(args[index]==='--headed') headed=true;
  else if(args[index]==='--persistent-cold') persistentCold=true;
  else if(args[index]==='--http-session-restore') httpSessionRestore=true;
  else throw new Error('参数：[--browser-restart | --services-integration | --production | --startup-read-failure | --browser-disable] [--headed] [--persistent-cold] [--http-session-restore] [--output <脱敏JSON>]');
}
if([browserRestart,servicesIntegration,production,startupReadFailure,browserDisable].filter(Boolean).length>1) throw new Error('冷启动、隔离接线、正式dist、启动故障与卡片停用须分开运行');
if(headed&&!browserDisable) throw new Error('--headed 当前仅用于 --browser-disable 独立对照');
if(persistentCold&&(!browserDisable||!headed)) throw new Error('--persistent-cold 需要 --browser-disable --headed');
if(httpSessionRestore&&!persistentCold) throw new Error('--http-session-restore 需要 --browser-disable --headed --persistent-cold');
const uiSignalDir=process.env.VG025_UI_SIGNAL_DIR;
if(persistentCold&&(!uiSignalDir||!existsSync(uiSignalDir))) throw new Error('正常UI冷启动模式需要本次临时交互信号目录');
const usesDist = production || startupReadFailure || browserDisable;
const pause = ms => new Promise(done => setTimeout(done, ms));
let phase = 'prepare';
async function until(read, accept = Boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (accept(result)) return result;
    await pause(100);
  }
  throw new Error('等待阶段超时');
}
const waitForNativeUi=step=>until(async()=>{await pause(400);return existsSync(join(uiSignalDir,step));},Boolean,180000);

async function fingerprintTree(directory) {
  const files=[];
  const visit=async(relative='')=>{
    for(const entry of await readdir(join(directory,relative),{withFileTypes:true})) {
      const path=relative?relative+'/'+entry.name:entry.name;
      if(entry.isDirectory()) await visit(path);
      else {
        assert.ok(entry.isFile(),'dist只允许普通文件与目录');
        files.push([path,createHash('sha256').update(await readFile(join(directory,path))).digest('hex')]);
      }
    }
  };
  await visit();files.sort(([left],[right])=>left.localeCompare(right));
  return {fileCount:files.length,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}

// 仅嵌入临时 worker 副本：人为拒绝 API，实际注册与成功撤销仍调用 Chrome 原生方法。
function startupReadFaultFixture() {
  const trace = { boot: crypto.randomUUID(), mode: null, started: 0, completed: 0, failures: [], successes: [],
    localReads: 0, sessionReads: 0, readFailures: 0, firstRegistryIds: null,
    revocations: [], nativeRevocations: 0, additions: 0, metadataFailures: 0 };
  globalThis.__vg025StartupReadTrace = trace;
  const readError = new Error('VG025_SYNTHETIC_STARTUP_READ');
  const localGet = chrome.storage.local.get.bind(chrome.storage.local);
  const sessionGet = chrome.storage.session.get.bind(chrome.storage.session);
  const modeReady = sessionGet('vg025StartupFaultMode').then(value => {
    trace.mode = value.vg025StartupFaultMode || 'none';
    return trace.mode;
  });
  const failRead = () => { trace.readFailures += 1; throw readError; };
  chrome.storage.local.get = (...args) => modeReady.then(mode => {
    trace.localReads += 1;
    if (mode === 'local-first' || mode === 'double-failure'
      || mode === 'local-config' && trace.localReads % 2 === 0) return failRead();
    return localGet(...args);
  });
  chrome.storage.session.get = (...args) => modeReady.then(mode => {
    trace.sessionReads += 1;
    return mode === 'session' ? failRead() : sessionGet(...args);
  });
  const sessionSet = chrome.storage.session.set.bind(chrome.storage.session);
  chrome.storage.session.set = async items => {
    const mode = await modeReady, metadata = items.runtimeSyncMetadata;
    if (metadata && (mode === 'font-prewrite' && metadata.pendingFontScopeChange
      || mode === 'font-checkpoint' && metadata.report.fontRuntime?.state === 'ready' && !metadata.pendingFontScopeChange)) {
      trace.metadataFailures += 1;
      throw new Error('VG030_SYNTHETIC_METADATA_WRITE');
    }
    return sessionSet(items);
  };
  const read = chrome.scripting.getRegisteredContentScripts.bind(chrome.scripting);
  chrome.scripting.getRegisteredContentScripts = (...args) => read(...args).then(scripts => {
    if (!args[0]?.ids && trace.firstRegistryIds === null) trace.firstRegistryIds = scripts.map(script => script.id);
    return scripts;
  });
  const revoke = chrome.scripting.unregisterContentScripts.bind(chrome.scripting);
  chrome.scripting.unregisterContentScripts = async (...args) => {
    trace.revocations.push(args[0]?.ids || []);
    if (await modeReady === 'double-failure') throw new Error('VG025_SYNTHETIC_REVOKE');
    await revoke(...args);
    trace.nativeRevocations += 1;
  };
  const register = chrome.scripting.registerContentScripts.bind(chrome.scripting);
  chrome.scripting.registerContentScripts = (...args) => { trace.additions += 1; return register(...args); };
  // 仅唤醒此临时 worker；不调用配置读取／对账消息，避免额外调用改变读取计数。
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'vg025-startup-fault-wake') port.postMessage({ ready: true });
  });
  return { observe(services) {
    const initialize = services.initializeExtension;
    services.initializeExtension = (...args) => {
      trace.started += 1;
      return initialize(...args).then(report => {
        trace.completed += 1;
        trace.successes.push({ font: report.fontRuntime, status: report.status, metadataError: report.metadataError });
        return report;
      }, error => {
        trace.completed += 1;
        trace.failures.push({ code: error?.code || null, originalReadError: error === readError,
          originalCause: error?.cause === readError,
          readReasonVisible: String(error?.message).includes(readError.message),
          cleanupUnconfirmed: /字体.*清理.*未.*确认/.test(String(error?.message)) });
        throw error;
      });
    };
  } };
}


const evidence = { task: 'VG-025', scope: 'isolated-fixed-font-candidate', result: 'BLOCKED', chrome: null,
  checks: {}, productionRecovery: 'AUTHORIZED_NOT_EXERCISED', cleanup: 'UNKNOWN', failure: null,
  limitations: ['单一当前Chrome，不等于Chrome138/其他OS或生产人工验收',
    '未验证DOM/local()/Worker/OffscreenCanvas字体路径，未申请新权限',
    '首次同源父页预污染和HTTPS矩阵未验证；未加载生产worker或恢复生产门禁',
    '浏览器冷启动需--browser-restart单独验证；当前CDP临时扩展重启后从清单消失，未取得资格'] };
if(servicesIntegration) {
  evidence.scope='isolated-services-integration-approved';
  evidence.limitations=['复用获准生产源码；另打包人工暂停变体作为负对照，未修改用户配置',
    '真实Chrome扩展上下文执行实际services/config-resolver/storage/UI状态模块；非生产worker事件或完整Options验收',
    '未授予userScripts：仅验证字体状态独立于语言权限阻断，未恢复语言/位置/Worker',
    '单一当前Chrome；不覆盖浏览器冷启动、Chrome138/其他OS或人工恢复授权'];
}
if(production) {
  evidence.scope='production-dist-font-registration';evidence.productionRecovery='AUTHORIZED';
  evidence.limitations=['实际dist的manifest、worker与font资产不改写，仅增加空白扩展管理驱动页',
    '使用独立临时profile及合成loopback规则，不读取用户配置或请求provider',
    '语言userScripts开关未开启，本轮仅验证字体与语言阻断独立',
    '不覆盖实际浏览器冷启动、Chrome138/其他OS、真实action Popup或完整人工验收'];
}
if(startupReadFailure) {
  evidence.scope='real-chrome-worker-startup-read-failure-and-font-recovery';
  evidence.followupTask='VG-030';
  evidence.productionRecovery='AUTHORIZED_TEST_FIXTURE';
  evidence.userProfileAccessed=false;
  evidence.siteRootCause='UNCONFIRMED';
  evidence.limitations=['独立临时Chrome/profile，使用实际dist后台函数与原始字体资产；仅临时worker注入API拒绝和结果观察，不是完全未改写dist',
    '读取及双重失败由worker内合成拒绝注入；成功注册/撤销、注册回读及新文档执行使用真实Chrome，不证明实际磁盘损坏或存储故障',
    '实际MV3 worker stop/wake，不覆盖浏览器冷启动、浏览器卡片停用、Chrome138/其他OS或用户Chrome现场根因',
    '仅合成loopback配置，不请求provider；Chrome自身后台网络未全量监控；Browser plugin not available，复用仓库隔离CDP执行器'];
}
if(browserDisable) {
  evidence.scope='unmodified-dist-browser-card-disable';
  evidence.browserMode=headed?'headed':'headless';
  evidence.headless=!headed;
  evidence.productionRecovery='AUTHORIZED';
  evidence.userProfileAccessed=false;
  evidence.siteRootCause='UNCONFIRMED';
  evidence.limitations=['全新临时Chrome/profile直接加载当前dist原路径，无插桩、无新增驱动页、无权限变更；控制面使用原有Options页',
    '内部总开关通过受保护管理消息切换；浏览器停用通过chrome://extensions对应卡片的可信鼠标点击并重新读取UI状态，不使用unload或管理API替代',
    '本轮未重启任何浏览器；不覆盖真正冷启动、Chrome138/其他OS或用户Chrome现场状态',
    '仅合成loopback探针，不请求provider；浏览器自身后台网络未全量监控；不保存用户路径、实际扩展ID、文档nonce或字体/设备原值'];
}
if(persistentCold) {
  evidence.scope='normal-ui-persistent-cold-font-lifecycle';
  evidence.limitations=['独立有界面CfT和临时profile，通过原生扩展管理页加载未插桩dist，不用Extensions.loadUnpacked或改写偏好文件',
    '只关闭/重启本次子进程，复用同一临时profile；冷启动后先采集HTTP首读和完整刷新，再打开管理页/Options',
    '新进程CDP就绪后创建HTTP探针，不覆盖浏览器自动恢复HTTP标签的更早时序、用户Chrome/profile或所有历史状态',
    '仅合成loopback配置，不请求provider；Chrome后台网络未全量监控，不保存用户路径、扩展ID、nonce或字体/设备原值'];
}
if(httpSessionRestore) {
  evidence.scope='normal-ui-automatic-http-session-restore';
  evidence.limitations=['独立有界面CfT和临时profile，正常UI加载当前未插桩dist并设置继续上次会话；不改写偏好文件',
    '恢复前只保留一个活动HTTP标签；正常退出后无启动URL、无restore强制开关、无Debugger暂停或自动附加，先收首inline自报告再连接CDP',
    '首inline同步保存字体API及转换回调调用栈；调用栈来源不是完整注册因果证明，晚附加Debugger缺失不能证明从未执行脚本',
    '仅本隔离环境三种会话状态，不覆盖用户普通Chrome/profile、全部历史/崩溃/后台惰性恢复、HTTPS、Chrome138及其他OS或完整人验',
    '仅合成loopback配置，不请求provider；Chrome后台网络未全量监控，不保存用户路径、扩展ID、nonce或字体/设备原值'];
}
const temporary = await mkdtemp(join(tmpdir(), 'vanishgeo-font-qualification-'));
const staged = join(temporary, 'extension');
const profile = join(temporary, 'profile');
let browser, socket;
const pending = new Map();
const debugScripts = new Map();
const executionContexts = new Map();
const deliveries = new Map();
const pageLoads = new Map();
const firstReports = new Map();
let expectedFontAssetUrl;
const restoreProbe = `(() => {
  const first=document.readyState==='loading'&&document.scripts.length===1;
  let firstFontStack='';
  const blocked=document.fonts.check({toString(){firstFontStack=new Error().stack;return '32px MiSans';}});
  const ctx=document.createElement('canvas').getContext('2d');
  const metrics=font=>{ctx.font=font;return [ctx.measureText('WWiiii字A').width]};
  return {first,blocked,firstFontStack,target:metrics('32px MiSans'),fallback:metrics('32px monospace'),
    measurementTarget:metrics('32px Courier New'),measurementFallback:metrics('32px sans-serif'),
    ordinaryCheck:document.fonts.check('32px Arial')};
})()`;
const probe = `(() => {
  const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 60;
  const ctx = canvas.getContext('2d');
  const metrics = font => { ctx.font = font; const m = ctx.measureText('WWiiii字A');
    return ['width','actualBoundingBoxLeft','actualBoundingBoxRight','actualBoundingBoxAscent','actualBoundingBoxDescent'].map(k=>m[k]); };
  const target = metrics('32px MiSans'); const fallback = metrics('32px monospace');
  const allowed = ['monospace','sans-serif','serif'].map(f => metrics('32px '+f));
  const ordinary = ['Arial','Times New Roman','Courier New','Unlisted Font'].map(f => metrics('32px "'+f+'"'));
  ctx.font = '24px MiSans'; ctx.fillText('WW字',2,32);ctx.strokeText('A',70,32);
  const pixels = Array.from(ctx.getImageData(0,0,180,60).data);
  const outcome = fn => {try {fn();return 'NO_ERROR';}catch(e){return e.name+':'+e.message;}};
  return { first: document.readyState === 'loading' && document.scripts.length === 1,
    target, fallback, allowed, ordinary, measurementTarget:ordinary[2],measurementFallback:allowed[1], pixels, image: canvas.toDataURL(),
    blocked: document.fonts.check('32px MiSans'), ordinaryCheck: document.fonts.check('32px Arial'),
    conversionErrors: [()=>ctx.measureText(),()=>ctx.measureText(Symbol('text')),
      ()=>ctx.measureText({[Symbol.toPrimitive](){return Symbol('text')}}),
      ()=>ctx.measureText({toString(){throw new RangeError('conversion')}})].map(outcome),
    fontCheckErrors: [()=>document.fonts.check(Symbol('font')),
      ()=>document.fonts.check({[Symbol.toPrimitive](){return Symbol('font')}}),
      ()=>document.fonts.check({toString(){return {}}}),
      ()=>document.fonts.check({toString(){throw new RangeError('conversion')}})].map(outcome),
    receiverError: outcome(()=>CanvasRenderingContext2D.prototype.measureText.call({},'x')),
    fontSyntaxError: outcome(()=>document.fonts.check('invalid font')),
    descriptor: ['measureText','fillText','strokeText','getImageData'].map(k=>{
      const d=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,k);
      return [d.enumerable,d.configurable,d.writable,d.value.name,d.value.length,Function.prototype.toString.call(d.value).includes('[native code]')];
    }), language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    device: [navigator.userAgent,navigator.hardwareConcurrency,navigator.deviceMemory,screen.width,screen.height],
    offscreen: typeof OffscreenCanvas==='function' ? new OffscreenCanvas(1,1).getContext('2d').measureText.toString() : null };
})()`;
const html = `<!doctype html><html><head><script nonce="fixture">globalThis.fontObservation = ${probe};
addEventListener('pageshow',e=>{globalThis.wasPersisted=e.persisted});</script></head><body>
<iframe src="/child"></iframe><iframe srcdoc="<p>unsupported</p>"></iframe><iframe></iframe></body></html>`;
const server = createServer((request, response) => {
  if(httpSessionRestore&&request.method==='POST'&&request.url==='/__vg025_first_read') {
    let body='';
    request.on('data',chunk=>{body+=chunk;if(body.length>8192)request.destroy()});
    request.on('end',()=>{
      try {
        const row=JSON.parse(body);
        if(row.nonce===deliveries.get(row.path)&&Object.keys(row).every(key=>['nonce','path','firstInlineObserved',
          'targetFontCheck','targetMetricsEqualMeasurementFallback','ordinaryFontCheck','firstStackContainsFontAsset',
          'firstStackContainsAnyExtensionSource'].includes(key))) {
          firstReports.set(row.nonce,{...row,receivedAt:Date.now()});
        }
        response.writeHead(204);response.end();
      } catch {response.writeHead(400);response.end();}
    });return;
  }
  if (request.url === '/csp') response.setHeader('Content-Security-Policy', "default-src 'none';script-src 'nonce-fixture';frame-src 'self';img-src data:");
  if(browserDisable) response.setHeader('Cache-Control','no-store');
  response.writeHead(200, { 'Content-Type': 'text/html' });
  let body = request.url.startsWith('/child') ? html.replace(/<iframe.*<\/body>/s,'</body>') : html;
  if(httpSessionRestore) body=body.replace(probe,restoreProbe);
  if(request.url === '/cross') body=html.replace(/<iframe.*<\/body>/s,
    `<iframe src="http://127.0.0.1:${server.address().port}/child?role=oopif"></iframe></body>`);
  if(request.url === '/tamper') body=body.replace('globalThis.fontObservation',
    'globalThis.fontExposureConfig={enabled:false,blockedFamilies:[]};globalThis.fontObservation');
  if(request.url.split('?')[0] === '/embedding') {
    const fault=new URL(request.url,'http://localhost').searchParams.get('fault');
    body=html.replace(/<iframe.*<\/body>/s,
      `<iframe src="http://localhost:${server.address().port}/child?role=late-font-iframe${fault?'&fault='+encodeURIComponent(fault):''}"></iframe></body>`);
  }
  if(browserDisable) {
    const nonce=randomUUID();deliveries.set(request.url,nonce);
    body=body.replace('globalThis.fontObservation',`globalThis.browserDisableDelivery=${JSON.stringify(nonce)};globalThis.fontObservation`);
    if(httpSessionRestore) body=body.replace("addEventListener('pageshow'",`(() => {
      const value=fontObservation;
      fetch('/__vg025_first_read',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({
        nonce:browserDisableDelivery,path:location.pathname,firstInlineObserved:value.first,targetFontCheck:value.blocked,
        targetMetricsEqualMeasurementFallback:JSON.stringify(value.measurementTarget)===JSON.stringify(value.measurementFallback),ordinaryFontCheck:value.ordinaryCheck,
        firstStackContainsFontAsset:value.firstFontStack.includes(${JSON.stringify(expectedFontAssetUrl||'no-extension-yet')}),
        firstStackContainsAnyExtensionSource:value.firstFontStack.includes('chrome-extension://')})});
    })();addEventListener('pageshow'`);
  }
  response.end(body);
});
try {
  const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  assert.ok(chrome && existsSync(chrome), '找不到指定的 Chrome，不回退到其他安装'); assert.equal(typeof WebSocket, 'function', '需要Node22+');
  if(usesDist) await cp(join(root,'dist'),staged,{recursive:true});
  else await mkdir(join(staged,'font-exposure'),{recursive:true});
  const font = await generateFontFilter();
  const fontSource = `(${assertSelfContainedFunction(font.code,'applyFixedFontFilter')})();\n`;
  if(usesDist) assert.equal(await readFile(join(staged,'font-exposure/filter.js'),'utf8'),fontSource);
  else await writeFile(join(staged,'font-exposure/filter.js'),fontSource);
  evidence.fontFilterSha256 = createHash('sha256').update(fontSource).digest('hex');
  if(browserDisable) {
    evidence.distFingerprint=await fingerprintTree(join(root,'dist'));
    assert.deepEqual(await fingerprintTree(staged),evidence.distFingerprint);
    evidence.distBackupMatchesSource=true;
    evidence.loadedCurrentDistDirectly=true;
  }
  if(startupReadFailure) {
    evidence.distFingerprint=await fingerprintTree(join(root,'dist'));
    const workerPath=join(staged,'background/service-worker.js');
    const worker=await readFile(workerPath,'utf8');
    const anchor='const services = createBackgroundServices(pageRuntimeSource, geolocationRuntimeSource);';
    assert.equal(worker.split(anchor).length,2,'实际worker服务入口必须唯一');
    const observed=anchor+'\n__vg025StartupReadFixture.observe(services);';
    const prefix=`const __vg025StartupReadFixture = (${startupReadFaultFixture.toString()})();\n`;
    const instrumented=prefix+worker.replace(anchor,observed);
    assert.equal(instrumented.slice(prefix.length).replace(observed,anchor),worker);
    await writeFile(workerPath,instrumented);
    evidence.compiledWorkerSha256=createHash('sha256').update(worker).digest('hex');
    evidence.instrumentationOnlyAroundUnchangedWorkerBody=true;
    assert.deepEqual(JSON.parse(await readFile(join(staged,'manifest.json'),'utf8')),
      JSON.parse(await readFile(join(root,'dist/manifest.json'),'utf8')));
    evidence.manifestAndPermissionsUnchanged=true;
  }
  if(!usesDist) {
  const controlBuild = await build({root, configFile:false, publicDir:false, logLevel:'silent',
    build:{write:false, target:'es2020', minify:false, rollupOptions:{
      input:resolve(root,'src/background/font-scripts.ts'), preserveEntrySignatures:'strict',output:{format:'es'}
    }} });
  assert.ok(!Array.isArray(controlBuild) && 'output' in controlBuild);
  const controlChunks=controlBuild.output.filter(item=>item.type==='chunk');
  assert.equal(controlChunks.length,1);assert.equal(controlChunks[0].imports.length,0);
  await writeFile(join(staged,'font-control.js'),controlChunks[0].code);
  if(servicesIntegration) {
    const entry=join(temporary,'services-entry.js');
    await writeFile(entry,`export {createBackgroundServices} from ${JSON.stringify(resolve(root,'src/background/services.ts'))};\nexport {renderFontRuntimeStatus} from ${JSON.stringify(resolve(root,'src/shared/runtime-sync.ts'))};`);
    for(const approved of [false,true]) {
      const built=await build({root,configFile:false,publicDir:false,logLevel:'silent',plugins:[{
        name:'isolated-font-approval-candidate',transform(code,id) {
          if(!approved && id.endsWith('/src/background/font-scripts.ts')) return code.replace(
            'FONT_FILTER_PRODUCTION_APPROVED = true','FONT_FILTER_PRODUCTION_APPROVED = false');
        }
      }],build:{write:false,target:'es2020',minify:false,rollupOptions:{input:entry,preserveEntrySignatures:'strict',output:{format:'es'}}}});
      assert.ok(!Array.isArray(built)&&'output'in built);
      const chunks=built.output.filter(item=>item.type==='chunk');assert.equal(chunks.length,1);
      await writeFile(join(staged,approved?'candidate-services.js':'production-gated-services.js'),chunks[0].code);
    }
  }
  await writeFile(join(staged,'qualification.html'),'<!doctype html><title>Qualification control</title>');
  // 独立MV3资格扩展，不加载生产worker或用户档案，只用既有权限子集。
  await writeFile(join(staged, 'manifest.json'), JSON.stringify({manifest_version:3,name:'Font qualification',version:'1.0',
    permissions:servicesIntegration?['scripting','storage','tabs','privacy']:['scripting','storage'],
    host_permissions:['http://localhost/*','http://127.0.0.1/*'],web_accessible_resources:[]}));
  }
  // 普通production模式只新增空白驱动页；启动故障模式另有上方的临时插桩与合成状态准备。
  if(!browserDisable) await writeFile(join(staged,'qualification.html'),'<!doctype html><title>Qualification control</title>');
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done)});
  const origin = `http://localhost:${server.address().port}`;
  phase = 'chrome-startup';
  const launchArgs=[...(headed?[]:['--headless=new']),'--site-per-process',...(persistentCold?[]:['--enable-unsafe-extension-debugging']),'--remote-debugging-port=0',
    `--user-data-dir=${profile}`,'--disable-background-networking','--no-first-run','--no-default-browser-check','about:blank'];
  browser = spawn(chrome,launchArgs,{stdio:'ignore'});
  const port = await until(async()=>{
    if(browser.exitCode!==null||browser.signalCode) throw new Error('浏览器提前退出');
    try{return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}
  });
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  evidence.chrome = version.Browser;
  if(process.env.CHROME_EXPECTED_VERSION) {
    evidence.expectedChromeVersion=process.env.CHROME_EXPECTED_VERSION;
    assert.equal(version.Browser,`Chrome/${process.env.CHROME_EXPECTED_VERSION}`,'隔离浏览器必须匹配指定的完整版本');
    evidence.expectedChromeVersionMatched=true;
  }
  if(browserDisable) {
    const protocol=await (await fetch(`http://127.0.0.1:${port}/json/protocol`)).json();
    const debuggerDomain=protocol.domains.find(domain=>domain.domain==='Debugger');
    assert.ok(debuggerDomain.commands.some(command=>command.name==='getScriptSource'));
    assert.ok(debuggerDomain.events.some(event=>event.name==='scriptParsed'));
    evidence.sourceCollectionProtocolVerified=true;
    if(headed) {
      const browserDomain=protocol.domains.find(domain=>domain.domain==='Browser');
      assert.ok(browserDomain.commands.find(command=>command.name==='getWindowForTarget')?.parameters.some(parameter=>parameter.name==='targetId'));
      assert.ok(browserDomain.commands.find(command=>command.name==='getWindowBounds')?.parameters.some(parameter=>parameter.name==='windowId'));
      evidence.headedWindowProtocolVerified=true;
      if(persistentCold) assert.ok(browserDomain.commands.some(command=>command.name==='close'));
    }
  }
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if(browserDisable&&message.sessionId) {
      if(message.method==='Debugger.scriptParsed') {
        const scripts=debugScripts.get(message.sessionId)||[];
        scripts.push(message.params);debugScripts.set(message.sessionId,scripts);
      } else if(message.method==='Runtime.executionContextCreated') {
        const contexts=executionContexts.get(message.sessionId)||new Map();
        contexts.set(message.params.context.id,message.params.context);executionContexts.set(message.sessionId,contexts);
      } else if(message.method==='Runtime.executionContextDestroyed') {
        executionContexts.get(message.sessionId)?.delete(message.params.executionContextId);
      } else if(message.method==='Runtime.executionContextsCleared') executionContexts.delete(message.sessionId);
      else if(message.method==='Page.loadEventFired') pageLoads.set(message.sessionId,(pageLoads.get(message.sessionId)||0)+1);
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) {
      const error = new Error('Chrome 协议拒绝操作');
      error.protocol = { method: request.method, code: message.error.code,
        detail: message.error.message.replaceAll(temporary, '<temporary>').replaceAll(root, '<workspace>')
          .replace(/\/Users\/[^\s:]+/g, '<user-path>').replace(/[a-p]{32}/g, '<extension>').slice(0, 240) };
      request.fail(error);
    }
    else request.done(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error('Chrome 协议超时')); }, 15000);
    pending.set(id, { done, fail, timer, method });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const attach = async targetId => {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    return sessionId;
  };
  const evaluate = async (sessionId, expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) {
      const error = new Error('扩展或fixture表达式失败');
      error.probe = { type: result.exceptionDetails.exception?.className || 'Unknown' };
      throw error;
    }
    return result.result.value;
  };
  const page = async url => {
    const collectBeforeNavigation=browserDisable&&/^https?:/.test(url);
    const { targetId } = await send('Target.createTarget', { url:collectBeforeNavigation?'about:blank':url });
    const sessionId = await attach(targetId);
    if(collectBeforeNavigation) {
      await send('Page.enable',{},sessionId);
      await send('Debugger.enable',{},sessionId);
      const previousLoads=pageLoads.get(sessionId)||0;
      await send('Page.navigate',{url},sessionId);
      await until(()=>pageLoads.get(sessionId)>previousLoads);
    }
    const expectedUrl = new URL(url).href;
    await until(() => evaluate(sessionId, `document.readyState === 'complete' && location.href === ${JSON.stringify(expectedUrl)}`));
    return { targetId, sessionId };
  };

  let id;
  if(persistentCold) {
    phase='normal-ui-install';
    const marker='VG025-COLD-'+randomUUID().slice(0,8);
    const identityPage=await page('about:blank');
    await evaluate(identityPage.sessionId,`document.title=${JSON.stringify(marker)};true`);
    const installer=await page('chrome://extensions/');
    const empty=await evaluate(installer.sessionId,`(() => {
      let count=0;const visit=root=>{for(const element of root.querySelectorAll('*')) {
        if(element.tagName==='EXTENSIONS-ITEM'&&element.data?.name==='VanishGeo')count++;
        if(element.shadowRoot)visit(element.shadowRoot);
      }};visit(document);return count===0;
    })()`);
    assert.equal(empty,true,'新profile安装前不得已有VanishGeo卡片');
    console.log('VG025_NORMAL_UI_INSTALL_READY ownedBrowserPid='+browser.pid+' marker='+marker);
    await waitForNativeUi('install-complete');
    const installed=await until(async()=>{
      await pause(400);
      return evaluate(installer.sessionId,`(() => {
        const cards=[];const visit=root=>{for(const element of root.querySelectorAll('*')) {
          if(element.tagName==='EXTENSIONS-ITEM'&&element.data?.name==='VanishGeo')cards.push(element.data);
          if(element.shadowRoot)visit(element.shadowRoot);
        }};visit(document);
        if(cards.length!==1)return null;
        const card=cards[0];return {id:card.id,path:card.path,location:card.location,state:card.state};
      })()`);
    },Boolean,180000);
    assert.equal(installed.path,join(root,'dist'),'正常UI安装必须来自当前dist原路径');
    assert.equal(installed.location,'UNPACKED');assert.equal(installed.state,'ENABLED');
    id=installed.id;
    evidence.normalUiInstall={method:'extension-manager-native-folder-picker',packagePathMatchesCurrentDist:true,location:'UNPACKED',initialState:'ENABLED',cdpLoadUnpackedUsed:false,noVanishGeoCardAtInitialUiRead:true,nativeUiCompletionSignalReceived:true};
    evidence.checks.normalUiInstallOriginalDistVerified=true;
    if(httpSessionRestore) {
      phase='normal-ui-session-restore-setting';
      await page('chrome://settings/onStartup');
      console.log('VG025_NATIVE_SESSION_RESTORE_SETTING_REQUIRED');
      await waitForNativeUi('session-restore-setting-complete');
      evidence.sessionRestoreSetting={method:'native-settings-on-startup',continueWhereLeftOffVisiblyConfirmed:true,
        preferenceFileWrittenByRunner:false,forcedRestoreFlag:false};
    }
  } else ({id}=await send('Extensions.loadUnpacked', { path: browserDisable?join(root,'dist'):staged }));
  // 任意扩展包内页面提供scripting控制面，没有页面配置桥。
  const control = await page(`chrome-extension://${id}/${browserDisable?'options/options.html':'qualification.html'}`);
  if(headed) {
    const {windowId}=await send('Browser.getWindowForTarget',{targetId:control.targetId});
    const {bounds}=await send('Browser.getWindowBounds',{windowId});
    const positiveDimensions=bounds.width>0&&bounds.height>0;
    assert.ok(positiveDimensions&&['normal','maximized','fullscreen'].includes(bounds.windowState),'有界面模式必须存在未最小化的浏览器窗口');
    evidence.headedWindow={targetWindowFound:true,windowState:bounds.windowState,positiveDimensions};
  }
  const loadControl=session=>evaluate(session,`import(chrome.runtime.getURL('font-control.js')).then(module=>{globalThis.fontControl=module;return true})`);
  if(!usesDist) await loadControl(control.sessionId);
  const sync = async (session, desired) => {
    const result=await evaluate(session,`fontControl.syncFontScriptRegistration(${JSON.stringify(desired)})`);
    assert.equal(result.status,'ok');
  };
  const baselinePage = await page(origin + '/baseline');
  const sample = session => evaluate(session, 'globalThis.fontObservation');
  const baseline = await sample(baselinePage.sessionId);
  // 将本机字体加载为每个目标的合成别名，保证未安装的字体也有可探测正对照。
  // 重现目标站点的三种通用字体宽度比较；结果仅保存布尔，不保存本机字体库存。
  const scanFixedFonts = session => evaluate(session, `(async()=>{
    const families=${JSON.stringify(VENDOR_SOFTWARE_FONT_FAMILIES)};
    await Promise.all(families.map(async family=>{
      const face=new FontFace(family,'local("Arial"), local("Liberation Sans")');
      document.fonts.add(await face.load());
    }));
    const ctx=document.createElement('canvas').getContext('2d');
    const text='中文字体检测ABCabc012';
    return families.map(family=>{
      const widths=['monospace','sans-serif','serif'].map(generic=>{
        ctx.font='72px '+generic;const base=ctx.measureText(text).width;
        ctx.font='72px "'+family+'", '+generic;
        const font=ctx.font;const width=ctx.measureText(text).width;
        return {detected:Math.abs(width-base)>.5,restored:ctx.font===font};
      });
      return {loaded:document.fonts.check('72px "'+family+'"'),
        detected:widths.some(value=>value.detected),restored:widths.every(value=>value.restored)};
    });
  })()`);
  const scanMeasurementPolicy = (session, iframe = false) => evaluate(session, `(async()=>{
    const realm=${iframe ? 'frames[0]' : 'window'};
    const doc=realm.document;
    const family='VanishGeoMeasurementProbe';
    const face=new realm.FontFace(family,'local("Courier New"), local("Liberation Mono")');
    doc.fonts.add(await face.load());
    const ctx=doc.createElement('canvas').getContext('2d'),text='中文字体检测ABCabc012';
    const rows=['monospace','sans-serif','serif'].map(generic=>{
      ctx.font='72px '+generic;const base=ctx.measureText(text).width;
      ctx.font='72px "'+family+'", '+generic;const font=ctx.font;
      return {detected:Math.abs(ctx.measureText(text).width-base)>.5,restored:ctx.font===font};
    });
    ctx.font='72px sans-serif';const fallback=ctx.measureText(text).width;
    ctx.font='72px "'+family+'"';const font=ctx.font;
    const metrics=ctx.measureText(text);
    return {detected:rows.some(row=>row.detected),restored:rows.every(row=>row.restored)&&ctx.font===font,
      namedOnlyUsesSans:metrics.width===fallback,nativeMetrics:metrics instanceof realm.TextMetrics,
      unlistedCheckVisible:doc.fonts.check('72px "'+family+'"')};
  })()`);
  assert.equal(baseline.first, true); assert.equal(baseline.blocked, true);
  assert.notDeepEqual(baseline.target, baseline.fallback);
  evidence.checks.nativePositiveControl = true;
  const config = createInitialConfig(); config.masterEnabled = true; config.fontExposure.enabled = true;
  config.rules = [createRule('localhost')];
  const scripts = compileFontScripts(config);
  if(browserDisable) {
    const extensionOrigin=`chrome-extension://${id}`;
    const assetUrl=extensionOrigin+'/font-exposure/filter.js';
    expectedFontAssetUrl=assetUrl;
    const message=async request=>{
      const response=await evaluate(control.sessionId,`chrome.runtime.sendMessage(${JSON.stringify(request)})`);
      assert.ok(response&&response.status!=='error','实际后台管理消息必须成功');return response;
    };
    const readCardExpression=`(() => {
      const find=(root,predicate)=>{for(const element of root.querySelectorAll('*')) {
        if(predicate(element))return element;
        if(element.shadowRoot){const found=find(element.shadowRoot,predicate);if(found)return found;}
      }};
      const card=find(document,element=>element.tagName==='EXTENSIONS-ITEM'&&(element.id===${JSON.stringify(id)}||element.data?.id===${JSON.stringify(id)}));
      if(!card)return null;
      const toggle=card.shadowRoot?.querySelector('#enableToggle');
      if(!toggle)return {cardFound:true,toggleFound:false,toggleIds:Array.from(card.shadowRoot?.querySelectorAll('cr-toggle')||[],element=>element.id)};
      toggle.scrollIntoView({block:'center'});const rect=toggle.getBoundingClientRect();
      return {cardFound:true,toggleFound:true,identityMatched:card.data?.id===${JSON.stringify(id)},name:card.data?.name,
        state:card.data?.state,checked:toggle.checked,disabled:toggle.disabled,x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    })()`;
    let manager=await page('chrome://extensions/');
    const readCard=async()=>{
      const card=await evaluate(manager.sessionId,readCardExpression);
      if(!card?.toggleFound) evidence.cardDiagnostic=card||{cardFound:false};
      return card;
    };
    const safeCard=card=>({identityMatched:card.identityMatched,name:card.name,state:card.state,checked:card.checked,disabled:card.disabled});
    const clickCard=async checked=>{
      const before=await until(readCard,card=>card?.toggleFound);
      assert.equal(before.identityMatched,true);assert.equal(before.disabled,false);
      assert.equal(before.checked,!checked,'卡片必须处于预期的相反状态');
      if(persistentCold) {
        console.log('VG025_NATIVE_CARD_TOGGLE_REQUIRED checked='+checked);
        await waitForNativeUi(checked?'card-on':'card-off');
        return until(readCard,card=>card?.checked===checked&&card.identityMatched);
      }
      await send('Target.activateTarget',{targetId:manager.targetId});
      for(const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{
        type,x:before.x,y:before.y,button:'left',clickCount:1
      },manager.sessionId);
      return until(readCard,card=>card?.checked===checked&&card.identityMatched);
    };
    const inspectFont=async (document,lateAttach=false)=>{
      // 恢复首读依靠同步inline快照；晚附加可能不回放已执行的MAIN脚本，缺事件不能证明没有注入。
      await send('Page.enable',{},document.sessionId);
      await send('Debugger.enable',{},document.sessionId);
      const observation=await sample(document.sessionId);
      const facts=await evaluate(document.sessionId,`(() => {
        let stack='';document.fonts.check({toString(){stack=new Error().stack;return '32px MiSans';}});
        return {nonce:globalThis.browserDisableDelivery,path:location.pathname,
          stackContainsFontAsset:stack.includes(${JSON.stringify(assetUrl)}),
          ordinaryIframeCheck:frames[0].fontObservation.blocked};
      })()`);
      const frame=(await send('Page.getFrameTree',{},document.sessionId)).frameTree.frame;
      const contexts=executionContexts.get(document.sessionId)||new Map();
      const context=[...contexts.values()].filter(value=>value.auxData?.isDefault&&value.auxData.frameId===frame.id).at(-1);
      assert.ok(context,'必须取得当前顶层文档MAIN context');
      const frameContexts=new Set([...contexts.values()].filter(value=>value.auxData?.frameId===frame.id).map(value=>value.id));
      const parsed=(debugScripts.get(document.sessionId)||[]).filter(script=>frameContexts.has(script.executionContextId)&&script.url===assetUrl);
      const sources=await Promise.all(parsed.map(script=>send('Debugger.getScriptSource',{scriptId:script.scriptId},document.sessionId)));
      if(!lateAttach&&observation.blocked===false&&(!sources.length||sources.some(value=>value.scriptSource.trim()!==fontSource.trim()))) {
        evidence.sourceDiagnostic={fontScriptsInAllContexts:(debugScripts.get(document.sessionId)||[])
          .filter(script=>script.url.includes('font-exposure')).map(script=>({isMainContext:script.executionContextId===context.id,
            contextKnown:contexts.has(script.executionContextId),inCurrentTopFrame:frameContexts.has(script.executionContextId),isExpectedUrl:script.url===assetUrl})),
          sources:sources.map(value=>({prefix:value.scriptSource.slice(0,100),
            suffix:value.scriptSource.slice(-200).replaceAll(extensionOrigin,'<extension>'),
            rawSha256:createHash('sha256').update(value.scriptSource).digest('hex')}))};
      }
      assert.equal(facts.nonce,deliveries.get(facts.path),'文档必须对应新的本机HTTP响应');
      assert.equal(observation.first,true,'必须在首inline采样');
      return {freshHttpResponseConfirmed:true,firstInlineObserved:true,targetFontCheck:observation.blocked,
        targetMetricsEqualMeasurementFallback:JSON.stringify(observation.measurementTarget)===JSON.stringify(observation.measurementFallback),
        ordinaryIframeCheck:facts.ordinaryIframeCheck,stackContainsFontAsset:facts.stackContainsFontAsset,
        fontAssetParsedInTopDocument:parsed.length>0,
        parsedFontAssetMatchesDist:sources.length?sources.every(value=>value.scriptSource.trim()===fontSource.trim()):null,
        ...(httpSessionRestore?{firstStackContainsFontAsset:observation.firstFontStack.includes(assetUrl),
          firstStackContainsAnyExtensionSource:observation.firstFontStack.includes('chrome-extension://'),
          sourceCollectionTiming:lateAttach?'after-automatic-restored-first-inline':'debugger-enabled-before-navigation'}:{})};
    };
    const filtered=row=>row.targetFontCheck===false&&row.targetMetricsEqualMeasurementFallback&&row.ordinaryIframeCheck===false
      &&row.stackContainsFontAsset&&row.fontAssetParsedInTopDocument&&row.parsedFontAssetMatchesDist;
    const native=row=>row.targetFontCheck===true&&!row.targetMetricsEqualMeasurementFallback&&row.ordinaryIframeCheck===true
      &&!row.stackContainsFontAsset&&!row.fontAssetParsedInTopDocument;
    const earlyFiltered=row=>row.firstInlineObserved&&row.targetFontCheck===false&&row.targetMetricsEqualMeasurementFallback
      &&row.ordinaryFontCheck&&row.firstStackContainsFontAsset&&row.firstStackContainsAnyExtensionSource;
    const earlyNative=row=>row.firstInlineObserved&&row.targetFontCheck===true&&!row.targetMetricsEqualMeasurementFallback
      &&row.ordinaryFontCheck&&!row.firstStackContainsFontAsset&&!row.firstStackContainsAnyExtensionSource;
    const fullReload=async document=>{
      await send('Page.enable',{},document.sessionId);
      const previousNonce=await evaluate(document.sessionId,'globalThis.browserDisableDelivery');
      const previousLoads=pageLoads.get(document.sessionId)||0;
      debugScripts.set(document.sessionId,[]);
      await send('Page.reload',{ignoreCache:true},document.sessionId);
      await until(()=>pageLoads.get(document.sessionId)>previousLoads);
      assert.notEqual(await evaluate(document.sessionId,'globalThis.browserDisableDelivery'),previousNonce,'完整刷新必须获得新文档响应');
      return inspectFont(document);
    };
    const coldRestartAndProbe=async role=>{
      phase='persistent-cold-'+role;
      const record={role,observationOrder:[]};
      (evidence.coldStarts??=[]).push(record);
      // 退出前关闭管理页，避免会话恢复的Options先触发配置对账。
      const retained=await page(httpSessionRestore?origin+'/restore-'+role:'about:blank');
      const restoreUrl=httpSessionRestore?origin+'/restore-'+role:null;
      const oldNonce=httpSessionRestore?await evaluate(retained.sessionId,'browserDisableDelivery'):null;
      if(httpSessionRestore) {
        await until(()=>firstReports.get(oldNonce));
        await send('Target.activateTarget',{targetId:retained.targetId});
      }
      for(const target of (await send('Target.getTargets')).targetInfos) {
        if(target.type==='page'&&target.targetId!==retained.targetId) await send('Target.closeTarget',{targetId:target.targetId});
      }
      const remaining=(await send('Target.getTargets')).targetInfos;
      assert.ok(!remaining.some(target=>target.type==='page'&&(target.url.startsWith(extensionOrigin)||target.url.startsWith('chrome://extensions'))));
      record.managementPagesClosedBeforeExit=true;
      if(httpSessionRestore) {
        assert.equal(remaining.filter(target=>target.type==='page').length,1);
        assert.equal(remaining.find(target=>target.type==='page').url,restoreUrl);
        record.onlyActiveHttpTabRetainedBeforeExit=true;
      }
      const previous=browser;
      const onMessage=socket.onmessage;
      await send('Browser.close');
      await until(()=>previous.exitCode!==null||previous.signalCode);
      assert.equal(previous.exitCode,0,'冷启动前浏览器必须正常退出');assert.equal(previous.signalCode,null);
      record.previousProcessExitedNormally=true;record.observationOrder.push('previous-process-exited');
      assert.equal(pending.size,0);
      socket.onmessage=null;socket.close();
      debugScripts.clear();executionContexts.clear();pageLoads.clear();
      await rm(join(profile,'DevToolsActivePort'),{force:true});
      // 自动恢复路径不传启动URL，不新建/导航标签，也不在首读前附加或暂停renderer。
      const restartedAt=Date.now();
      browser=spawn(chrome,httpSessionRestore?launchArgs.slice(0,-1):launchArgs,{stdio:'ignore'});
      const restartedPort=await until(async()=>{
        if(browser.exitCode!==null||browser.signalCode)throw new Error('冷启动浏览器提前退出');
        try{return(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}
      });
      const restarted=await(await fetch(`http://127.0.0.1:${restartedPort}/json/version`)).json();
      assert.equal(restarted.Browser,evidence.chrome);assert.notEqual(browser.pid,previous.pid);
      let firstReport;
      if(httpSessionRestore) {
        firstReport=await until(()=>[...firstReports.values()].find(row=>row.path==='/restore-'+role&&row.nonce!==oldNonce&&row.receivedAt>=restartedAt),Boolean,30000);
        assert.equal(firstReport.nonce,deliveries.get('/restore-'+role));
        assert.equal(firstReport.firstInlineObserved,true);
        const {nonce,path,receivedAt,...sanitized}=firstReport;
        record.earlyFirstInlineReport={...sanitized,freshHttpResponseConfirmed:true,
          receivedBeforeCdpConnection:true,receivedAfterNewProcessSpawn:true};
        record.observationOrder.push('automatic-http-restoration-first-inline-report-received');
        record.noStartupUrlOrForcedRestoreFlag=true;
        record.noTargetCreatedOrNavigatedBeforeFirstReport=true;
        record.noDebuggerAttachOrPauseBeforeFirstReport=true;
      }
      socket=new WebSocket(restarted.webSocketDebuggerUrl);
      await new Promise((done,fail)=>{socket.onopen=done;socket.onerror=fail});socket.onmessage=onMessage;
      record.newProcessAndSameVersionConfirmed=true;record.sameTemporaryProfileReused=true;
      record.observationOrder.push('new-process-cdp-ready');
      const startupTargets=(await send('Target.getTargets')).targetInfos;
      record.optionsOrManagerPageBeforeProbe=startupTargets.some(target=>target.type==='page'&&(target.url.startsWith(extensionOrigin)||target.url.startsWith('chrome://extensions')));
      assert.equal(record.optionsOrManagerPageBeforeProbe,false,'冷启动首探针前不得已打开Options或管理页');
      let first;
      if(httpSessionRestore) {
        const target=await until(async()=>(await send('Target.getTargets')).targetInfos.find(value=>value.type==='page'&&value.url===restoreUrl));
        first={targetId:target.targetId,sessionId:await attach(target.targetId)};
        await until(()=>evaluate(first.sessionId,'document.readyState==="complete"&&Boolean(frames[0]?.fontObservation)'));
        assert.equal(await evaluate(first.sessionId,'browserDisableDelivery'),firstReport.nonce);
        record.automaticallyRestoredTargetConfirmed=true;
      } else first=await page(origin+'/cold-'+role+'-new');
      record.firstDocument=await inspectFont(first,httpSessionRestore);record.observationOrder.push('first-http-probe-captured');
      record.fullReload=await fullReload(first);record.observationOrder.push('full-http-reload-captured');
      if(httpSessionRestore) {
        record.newDocument=await inspectFont(await page(origin+'/after-restoration-'+role));
        record.observationOrder.push('new-http-document-captured');
      }
      const {windowId}=await send('Browser.getWindowForTarget',{targetId:first.targetId});
      const {bounds}=await send('Browser.getWindowBounds',{windowId});
      assert.ok(bounds.width>0&&bounds.height>0&&['normal','maximized','fullscreen'].includes(bounds.windowState));
      record.headedWindowState=bounds.windowState;
      manager=await page('chrome://extensions/');
      const card=await until(readCard,value=>value?.toggleFound&&value.identityMatched);
      record.card=safeCard(card);record.observationOrder.push('extension-card-read');
      record.sameExtensionRetained=true;
      return record;
    };
    phase='card-disable-native-control';
    const nativeRow=await inspectFont(baselinePage);assert.ok(native(nativeRow),'原生及来源采集正对照必须有效');
    evidence.observations={native:nativeRow};
    const initialCard=await until(readCard,card=>card?.toggleFound);
    assert.equal(initialCard.checked,true);assert.equal(initialCard.identityMatched,true);
    evidence.cardStates={initial:safeCard(initialCard)};
    phase='card-disable-internal-enable';
    config.globalProfile.language.enabled=false;config.globalProfile.timezone.enabled=false;
    const enabled=await message({action:'setSiteConfig',config});
    assert.equal(enabled.syncReport.fontRuntime.state,'ready');assert.equal(enabled.syncReport.fontRuntime.registeredRuleCount,1);
    let internalDocument=await page(origin+'/internal-switch-document');
    const enabledRow=await inspectFont(internalDocument);
    evidence.observations.internalEnabled=enabledRow;
    assert.ok(filtered(enabledRow),'开启后必须观测到当前包内字体源码及过滤');
    evidence.checks.enabledFilterAndMatchingAssetConfirmed=true;
    if(httpSessionRestore) {
      const cold=await coldRestartAndProbe('enabled-control');
      assert.equal(cold.card.state,'ENABLED');assert.equal(cold.card.checked,true);
      assert.ok(earlyFiltered(cold.earlyFirstInlineReport),'自动恢复开启正对照首inline必须已过滤并捕获字体来源');
      assert.equal(cold.firstDocument.targetFontCheck,false);assert.equal(cold.firstDocument.firstStackContainsFontAsset,true);
      assert.ok(filtered(cold.fullReload));assert.ok(filtered(cold.newDocument));
      Object.assign(control,await page(extensionOrigin+'/options/options.html'));
      cold.observationOrder.push('options-opened-after-probes');
      const persisted=await message({action:'getSiteConfig'});
      assert.equal(persisted.config.masterEnabled,true);assert.deepEqual(persisted.config.rules,config.rules);
      assert.equal(persisted.syncReport.fontRuntime.state,'ready');
      cold.persistedConfig={masterEnabled:true,rulesPreserved:true,font:persisted.syncReport.fontRuntime};
      evidence.checks.enabledAutomaticRestorationEarlySourcePositiveControl=true;
      evidence.checks.enabledRestorationReloadAndNewDocumentMatchCurrentDist=true;
      internalDocument=await page(origin+'/internal-switch-after-enabled-restoration');
    }
    phase='card-disable-internal-off';
    const internalOff=await message({action:'setExtensionEnabled',enabled:false});
    assert.equal(internalOff.config.masterEnabled,false);assert.equal(internalOff.syncReport.fontRuntime.state,'disabled');
    assert.equal(internalOff.syncReport.fontRuntime.registeredRuleCount,0);
    const internalCard=await readCard();assert.equal(internalCard.checked,true);
    evidence.cardStates.internalMasterOff=safeCard(internalCard);
    evidence.internalOffReport={masterEnabled:false,font:internalOff.syncReport.fontRuntime,browserCardStillEnabled:true};
    const internalNew=await inspectFont(await page(origin+'/internal-off-new'));
    const internalReload=await fullReload(internalDocument);
    evidence.observations.internalOffNew=internalNew;evidence.observations.internalOffReload=internalReload;
    evidence.checks.internalMasterOffNewDocumentNative=native(internalNew);
    evidence.checks.internalMasterOffFullReloadNative=native(internalReload);
    if(persistentCold) {
      const cold=await coldRestartAndProbe('internal-off');
      assert.equal(cold.card.state,'ENABLED');assert.equal(cold.card.checked,true);
      Object.assign(control,await page(extensionOrigin+'/options/options.html'));
      cold.observationOrder.push('options-opened-after-probes');
      const persisted=await message({action:'getSiteConfig'});
      assert.equal(persisted.config.masterEnabled,false);assert.equal(persisted.config.fontExposure.enabled,true);
      assert.deepEqual(persisted.config.rules,internalOff.config.rules);
      assert.equal(persisted.syncReport.fontRuntime.state,'disabled');assert.equal(persisted.syncReport.fontRuntime.registeredRuleCount,0);
      cold.persistedConfig={masterEnabled:false,fontSwitchEnabled:true,rulesPreserved:true,font:persisted.syncReport.fontRuntime};
      evidence.checks.internalOffColdNewDocumentNative=native(cold.firstDocument);
      evidence.checks.internalOffColdFullReloadNative=native(cold.fullReload);
      evidence.checks.internalOffColdExtensionAndConfigPreserved=true;
      if(httpSessionRestore) {
        assert.ok(earlyNative(cold.earlyFirstInlineReport),'内部关闭后自动恢复首inline不得出现过滤或字体栈来源');
        assert.ok(native(cold.newDocument));
        evidence.checks.internalOffAutomaticRestoreFirstInlineNative=true;
        evidence.checks.internalOffNewDocumentAfterAutomaticRestoreNative=true;
      }
    }
    phase='card-disable-restore-master-on';
    const restored=await message({action:'setExtensionEnabled',enabled:true});
    assert.equal(restored.config.masterEnabled,true);assert.equal(restored.syncReport.fontRuntime.state,'ready');
    const cardDocument=await page(origin+'/browser-card-document');
    const beforeCardOff=await inspectFont(cardDocument);assert.ok(filtered(beforeCardOff));
    evidence.observations.beforeBrowserCardOff=beforeCardOff;
    evidence.masterEnabledImmediatelyBeforeBrowserDisable=true;
    phase='card-disable-trusted-ui';
    await clickCard(false);
    manager=await page('chrome://extensions/');
    const disabledCard=await until(readCard,card=>card?.checked===false&&card.identityMatched&&/disabled/i.test(card.state||''));
    evidence.cardStates.browserDisabled=safeCard(disabledCard);
    evidence.browserDisableMethod=persistentCold?'native-extension-card-and-fresh-manager-state':'extension-card-trusted-pointer-and-fresh-manager-state';
    evidence.checks.browserCardDisabledStateConfirmed=true;
    evidence.workerTargetPresentAfterCardDisable=(await send('Target.getTargets')).targetInfos.some(target=>target.type==='service_worker'&&target.url===extensionOrigin+'/background/service-worker.js');
    evidence.oldDocumentRetainsHookBeforeReload=await evaluate(cardDocument.sessionId,'document.fonts.check("32px MiSans")===false');
    phase='card-disable-new-and-reloaded-documents';
    const cardNew=await inspectFont(await page(origin+'/browser-disabled-new'));
    const cardReload=await fullReload(cardDocument);
    evidence.observations.browserDisabledNew=cardNew;evidence.observations.browserDisabledReload=cardReload;
    evidence.checks.browserCardOffNewDocumentNative=native(cardNew);
    evidence.checks.browserCardOffFullReloadNative=native(cardReload);
    evidence.browserDisableOutcome=native(cardNew)&&native(cardReload)?'NO_INJECTION_OBSERVED':'FILTER_OR_SCRIPT_EVIDENCE_REMAINS';
    if(persistentCold) {
      const cold=await coldRestartAndProbe('card-disabled');
      assert.equal(cold.card.state,'DISABLED');assert.equal(cold.card.checked,false);
      cold.workerTargetPresent=(await send('Target.getTargets')).targetInfos.some(target=>target.type==='service_worker'&&target.url===extensionOrigin+'/background/service-worker.js');
      assert.equal(cold.workerTargetPresent,false);
      cold.optionsOpenedWhileDisabled=false;
      evidence.checks.cardDisabledColdNewDocumentNative=native(cold.firstDocument);
      evidence.checks.cardDisabledColdFullReloadNative=native(cold.fullReload);
      evidence.checks.cardDisabledColdExtensionAndStatePreserved=true;
      if(httpSessionRestore) {
        assert.ok(earlyNative(cold.earlyFirstInlineReport),'卡片停用后自动恢复首inline不得出现过滤或字体栈来源');
        assert.ok(native(cold.newDocument));
        evidence.checks.cardDisabledAutomaticRestoreFirstInlineNative=true;
        evidence.checks.cardDisabledNewDocumentAfterAutomaticRestoreNative=true;
      }
    }
    phase='card-disable-reenable-control';
    await clickCard(true);
    Object.assign(control,await page(extensionOrigin+'/options/options.html'));
    const reenabled=await message({action:'getSiteConfig'});
    assert.equal(reenabled.config.masterEnabled,true);assert.equal(reenabled.syncReport.fontRuntime.state,'ready');
    const reenabledRow=await inspectFont(await page(origin+'/browser-reenabled'));
    assert.ok(filtered(reenabledRow));
    evidence.observations.browserReenabled=reenabledRow;
    evidence.masterEnabledAfterBrowserReenable=reenabled.config.masterEnabled;
    evidence.cardStates.reenabled=safeCard(await readCard());
    evidence.checks.browserReenablePreservesMasterAndRestoresFilter=true;
    if(persistentCold) {
      assert.equal(reenabled.config.fontExposure.enabled,true);assert.deepEqual(reenabled.config.rules,restored.config.rules);
      const cold=evidence.coldStarts.at(-1);
      cold.observationOrder.push('card-reenabled','options-opened-after-reenable','config-read-after-reenable');
      cold.internalMasterPreservedAfterReenable=true;cold.rulesPreservedAfterReenable=true;
      evidence.checks[httpSessionRestore?'normalUiInstallRetainedAcrossThreeAutomaticRestarts':'normalUiInstallRetainedAcrossBothColdStarts']=true;
    }
    assert.deepEqual(await fingerprintTree(staged),evidence.distFingerprint);
    assert.deepEqual(await fingerprintTree(join(root,'dist')),evidence.distFingerprint);
    evidence.backupDistCopyUnchangedAfterRun=true;evidence.sourceDistUnchangedAfterRun=true;
    evidence.checks.exactUninstrumentedDistVerified=true;
  } else if(startupReadFailure) {
    phase='startup-fault-baseline';
    const workerUrl=`chrome-extension://${id}/background/service-worker.js`;
    const currentWorker=()=>until(async()=> (await send('Target.getTargets')).targetInfos.find(target=>target.type==='service_worker'&&target.url===workerUrl));
    let worker=await currentWorker();
    let workerSession=await attach(worker.targetId);
    const readTrace=()=>evaluate(workerSession,'globalThis.__vg025StartupReadTrace');
    await until(readTrace,trace=>trace?.started>0&&trace.completed===trace.started&&trace.mode==='none');
    // VG-029恢复后启动清理也会核验定位namespace；本测试正常启用用户开关，不绕过权限。
    const details=await page('chrome://extensions/?id='+id);
    const toggle='(() => {const find=root=>{for(const n of root.querySelectorAll("*")){if(n.id==="allow-user-scripts")return n;if(n.shadowRoot){const v=find(n.shadowRoot);if(v)return v}}};const t=find(document)?.shadowRoot?.querySelector("cr-toggle");if(!t)return null;t.scrollIntoView({block:"center"});const r=t.getBoundingClientRect();return {checked:t.checked,disabled:t.disabled,x:r.x+r.width/2,y:r.y+r.height/2}})()';
    const beforeSwitch=await until(()=>evaluate(details.sessionId,toggle));
    assert.equal(beforeSwitch.checked,false);assert.equal(beforeSwitch.disabled,false);
    await send('Target.activateTarget',{targetId:details.targetId});
    for(const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{
      type,x:beforeSwitch.x,y:beforeSwitch.y,button:'left',clickCount:1
    },details.sessionId);
    await until(()=>evaluate(details.sessionId,toggle),value=>value?.checked===true);
    await send('Target.closeTarget',{targetId:details.targetId});
    evidence.checks.normalAllowUserScriptsUiEnabled=true;
    const registered=()=>evaluate(control.sessionId,'chrome.scripting.getRegisteredContentScripts()');
    const other={...scripts[0],id:'vg025-other-owned-control',matches:['http://127.0.0.1/*'],excludeMatches:[]};
    const disabled=structuredClone(config);disabled.masterEnabled=false;
    const setFixture=async (mode, value=disabled)=>evaluate(control.sessionId,`Promise.all([
      chrome.storage.local.set({siteSpoofConfig:${JSON.stringify(value)},vanishgeoRulesInitialized:true}),
      chrome.storage.session.set({vg025StartupFaultMode:${JSON.stringify(mode)}})
    ]).then(()=>true)`);
    const restartWorker=async()=>{
      const previous=await currentWorker();
      const previousBoot=(await readTrace()).boot;
      await send('ServiceWorker.enable',{},control.sessionId);
      await send('ServiceWorker.stopAllWorkers',{},control.sessionId);
      await until(async()=> !(await send('Target.getTargets')).targetInfos.some(target=>target.targetId===previous.targetId));
      await evaluate(control.sessionId,`new Promise(resolve=>{
        const port=chrome.runtime.connect({name:'vg025-startup-fault-wake'});
        port.onMessage.addListener(()=>{port.disconnect();resolve(true)});
      })`);
      worker=await currentWorker();
      workerSession=await attach(worker.targetId);
      // Chrome 可复用 opaque Target ID；以实际结束及新启动闭包标识判断，不依赖 ID 变化。
      await until(readTrace,trace=>Boolean(trace?.boot&&trace.boot!==previousBoot));
      (evidence.workerLifecycle ||= []).push({oldTargetDisappeared:true,freshWorkerBootObserved:true,
        targetIdReused:worker.targetId===previous.targetId});
    };
    await evaluate(control.sessionId,`chrome.scripting.registerContentScripts(${JSON.stringify([other])})`);
    const otherBefore=(await registered()).find(script=>script.id===other.id);
    assert.ok(otherBefore);
    evidence.startupCases=[];
    let lastOldDocument;
    for(const mode of ['local-first','local-config','session','double-failure']) {
      phase='startup-fault-prepare-'+mode;
      await setFixture(mode);
      await evaluate(control.sessionId,`chrome.scripting.registerContentScripts(${JSON.stringify(scripts)})`);
      const before=await registered();
      assert.ok(before.some(script=>script.id===scripts[0].id));
      assert.deepEqual(before.find(script=>script.id===other.id),otherBefore);
      const oldDocument=await page(origin+'/startup-'+mode+'-before');
      assert.equal((await sample(oldDocument.sessionId)).blocked,false,'故障前真实注册须执行字体过滤');
      lastOldDocument=oldDocument;
      const metadataBefore=await evaluate(control.sessionId,'chrome.storage.session.get("runtimeSyncMetadata")');
      phase='startup-fault-worker-'+mode;
      await restartWorker();
      const trace=await until(readTrace,value=>value?.mode===mode&&value.failures.length>0&&value.completed===value.started);
      evidence.startupDiagnostic={mode,started:trace.started,completed:trace.completed,
        localReads:trace.localReads,sessionReads:trace.sessionReads,readFailures:trace.readFailures,
        registryRoles:trace.firstRegistryIds?.map(value=>value===scripts[0].id?'owned':value===other.id?'other':'unexpected'),
        revocationRoles:trace.revocations.map(ids=>ids.map(value=>value===scripts[0].id?'owned':'unexpected')),
        nativeRevocations:trace.nativeRevocations,additions:trace.additions,failures:trace.failures,successes:trace.successes};
      assert.ok(trace.readFailures>0);
      assert.equal(trace.successes.length,0,'启动失败不得返回成功报告');
      assert.ok(trace.firstRegistryIds.includes(scripts[0].id),'新worker必须实际读到预置所属注册，不能以注册在重启时消失冒充清理');
      assert.ok(trace.firstRegistryIds.includes(other.id));
      assert.ok(trace.revocations.length>0);
      assert.ok(trace.revocations.every(ids=>ids.length>0&&ids.every(value=>value===scripts[0].id)),'不得扩大撤销命名空间');
      assert.equal(trace.additions,0);
      const after=await registered();
      assert.deepEqual(after.find(script=>script.id===other.id),otherBefore);
      const double=mode==='double-failure';
      assert.equal(after.some(script=>script.id===scripts[0].id),double);
      if(double) {
        assert.equal(trace.nativeRevocations,0);
        assert.ok(trace.failures.every(error=>error.code==='font-scripts-sync-failed'&&error.originalCause
          &&error.readReasonVisible&&error.cleanupUnconfirmed&&!error.originalReadError));
      } else {
        assert.ok(trace.nativeRevocations>0);
        assert.ok(trace.failures.every(error=>error.originalReadError&&error.readReasonVisible));
      }
      assert.deepEqual(await evaluate(control.sessionId,'chrome.storage.local.get("siteSpoofConfig").then(value=>value.siteSpoofConfig)'),disabled);
      assert.deepEqual(await evaluate(control.sessionId,'chrome.storage.session.get("runtimeSyncMetadata")'),metadataBefore);
      const fresh=await page(origin+'/startup-'+mode+'-after');
      const freshObservation=await sample(fresh.sessionId);
      assert.equal(freshObservation.first,true);
      assert.equal(freshObservation.blocked,!double,'新文档应反映真实撤销结果');
      assert.equal((await sample(oldDocument.sessionId)).blocked,false,'已执行hook的旧文档仍是旧快照');
      const foreignDocument=await page(origin.replace('localhost','127.0.0.1')+'/startup-'+mode+'-other');
      assert.equal((await sample(foreignDocument.sessionId)).blocked,false,'其他ID保留且继续实际执行同一字体文件');
      evidence.startupCases.push({mode,actualWorkerStoppedAndWoken:true,readFailureInjected:true,
        observedFailureCodes:[...new Set(trace.failures.map(error=>error.code))],
        nativeRevocationCount:trace.nativeRevocations,
        ownedRegistrationObservedBeforeCleanup:true,otherIdAndSignaturePreserved:true,
        revocationScopeRestricted:true,nativeRevocationConfirmed:!double,ownedRegistrationRetained:double,
        originalErrorPreserved:double?trace.failures.every(error=>error.originalCause):trace.failures.every(error=>error.originalReadError),
        doubleFailureVisible:double?trace.failures.every(error=>error.code==='font-scripts-sync-failed'&&error.cleanupUnconfirmed&&error.readReasonVisible):null,
        noSuccessReport:true,noRegistrationAdds:true,configAndMetadataUnchanged:true,
        freshDocumentNative:!double,oldDocumentSnapshotRetained:true,otherIdStillExecutesFontFile:true});
      evidence.checks['actualStartupReadFailure_'+mode]=true;
      delete evidence.startupDiagnostic;
    }
    phase='startup-fault-recovery';
    await setFixture('none');
    await restartWorker();
    const recovery=await until(readTrace,value=>value?.mode==='none'&&value.successes.length>0&&value.completed===value.started);
    assert.equal(recovery.failures.length,0);
    assert.ok(recovery.firstRegistryIds.includes(scripts[0].id));
    assert.ok(recovery.nativeRevocations>0);
    assert.ok(recovery.successes.every(report=>report.font.state==='disabled'&&report.font.registeredRuleCount===0));
    assert.deepEqual(await registered(),[otherBefore]);
    const recovered=await sample((await page(origin+'/startup-recovered')).sessionId);
    assert.equal(recovered.first,true);assert.equal(recovered.blocked,true);
    assert.equal((await sample(lastOldDocument.sessionId)).blocked,false);
    evidence.checks.actualWorkerRecoveryClearsResidualOwnedRegistration=true;

    // VG-030：配置保持开启，实际读取失败清理后新开的文档必须补录重载债。
    await evaluate(control.sessionId,`chrome.scripting.unregisterContentScripts({ids:[${JSON.stringify(other.id)}]})`);
    const active=structuredClone(config);
    active.globalProfile.geolocation.enabled=false;
    active.globalProfile.language.enabled=false;
    active.globalProfile.timezone.enabled=false;
    const readMetadata=()=>evaluate(control.sessionId,'chrome.storage.session.get("runtimeSyncMetadata").then(value=>value.runtimeSyncMetadata)');
    const hasFontDebt=urls=>evaluate(control.sessionId,`(async()=>{
      const metadata=(await chrome.storage.session.get('runtimeSyncMetadata')).runtimeSyncMetadata;
      const tabs=await chrome.tabs.query({});
      return ${JSON.stringify(urls)}.every(url=>{
        const tab=tabs.find(tab=>tab.url===url);
        return tab&&metadata.pendingReloads.some(item=>item.tabId===tab.id&&item.surfaces?.includes('font'));
      });
    })()`);
    const latestFont=trace=>trace.successes.at(-1)?.font;
    evidence.fontRecoveryCases=[];
    for(const mode of ['local-first','local-config','session']) {
      phase='font-recovery-active-'+mode;
      await setFixture('none',active);await restartWorker();
      await until(readTrace,value=>value?.mode==='none'&&latestFont(value)?.state==='ready'&&value.completed===value.started);
      await setFixture(mode,active);await restartWorker();
      await until(readTrace,value=>value?.mode===mode&&value.failures.length>0&&value.completed===value.started);
      assert.equal((await registered()).filter(script=>script.id.startsWith('vanishgeo-font-exposure-')).length,0);
      const topUrl=origin+'/font-recovery-'+mode;
      const embedUrl=origin.replace('localhost','127.0.0.1')+'/embedding?fault='+mode;
      const top=await page(topUrl), embedding=await page(embedUrl);
      const childUrl=origin+'/child?role=late-font-iframe&fault='+mode;
      const embeddingSample=async()=>{
        const target=await until(async()=> (await send('Target.getTargets')).targetInfos
          .find(target=>target.type==='iframe'&&target.url===childUrl));
        return until(()=>sampleChild(target));
      };
      const sampleChild=async target=>sample(await attach(target.targetId));
      assert.equal((await sample(top.sessionId)).blocked,true);
      assert.equal((await embeddingSample()).blocked,true);
      assert.equal(await hasFontDebt([topUrl,embedUrl]),false,'恢复前不能已有这两个新建标签页的债');
      phase='font-recovery-register-'+mode;
      await setFixture('none',active);await restartWorker();
      const restored=await until(readTrace,value=>value?.mode==='none'&&value.successes.length>0&&value.completed===value.started);
      assert.deepEqual(latestFont(restored),{state:'ready',registeredRuleCount:1,reloadRequired:true});
      assert.equal(await hasFontDebt([topUrl,embedUrl]),true,'匹配顶层和只命中iframe的标签页都应补录font债');
      assert.equal((await readMetadata()).pendingFontScopeChange,undefined);
      assert.deepEqual(await evaluate(control.sessionId,'chrome.storage.local.get("siteSpoofConfig").then(value=>value.siteSpoofConfig)'),active);
      assert.equal((await sample(top.sessionId)).blocked,true,'恢复注册不能热更新旧文档');
      assert.equal((await embeddingSample()).blocked,true);
      const reload=async target=>{
        await send('Page.enable',{},target.sessionId);await send('Page.reload',{ignoreCache:true},target.sessionId);
        await until(()=>sample(target.sessionId),value=>value?.first&&value.blocked===false);
      };
      await reload(top);
      await send('Page.enable',{},embedding.sessionId);
      const oldLoader=(await send('Page.getFrameTree',{},embedding.sessionId)).frameTree.frame.loaderId;
      await send('Page.reload',{ignoreCache:true},embedding.sessionId);
      await until(async()=> (await send('Page.getFrameTree',{},embedding.sessionId)).frameTree.frame.loaderId!==oldLoader);
      await until(()=>evaluate(embedding.sessionId,'document.readyState==="complete"'));
      assert.equal((await embeddingSample()).blocked,false);
      assert.equal((await sample(embedding.sessionId)).blocked,true,'未匹配顶层保持原生');
      const filtered=await sample(top.sessionId);
      assert.deepEqual(filtered.measurementTarget,filtered.measurementFallback);
      assert.deepEqual(filtered.allowed,baseline.allowed);
      assert.equal(filtered.ordinaryCheck,baseline.ordinaryCheck);
      evidence.fontRecoveryCases.push({mode,actualWorkerRestart:true,ownedCleanupVerified:true,configUnchanged:true,
        freshDocumentNativeDuringFailure:true,unmatchedTopWithMatchedIframe:true,
        readyWithReloadRequired:true,bothTabsHaveFontDebt:true,oldSnapshotsRetainedUntilReload:true,
        topAndIframeFilteredAfterReload:true,genericMetricsAndOrdinaryCheckPreserved:true});
      evidence.checks['fontRecoveryReloadDebt_'+mode]=true;
    }
    for(const mode of ['font-prewrite','font-checkpoint']) {
      phase='font-recovery-write-'+mode;
      await evaluate(control.sessionId,`chrome.scripting.unregisterContentScripts({ids:[${JSON.stringify(scripts[0].id)}]})`);
      await setFixture(mode,active);await restartWorker();
      const trace=await until(readTrace,value=>value?.mode===mode&&value.successes.length>0&&value.completed===value.started);
      assert.ok(trace.metadataFailures>0);
      const prewrite=mode==='font-prewrite';
      assert.equal(latestFont(trace).state,prewrite?'sync-failed':'ready');
      assert.equal(trace.successes.at(-1).status,'partial');
      assert.equal((await registered()).some(script=>script.id===scripts[0].id),!prewrite);
      if(prewrite) assert.equal(trace.additions,0);
      else assert.equal((await readMetadata()).pendingFontScopeChange,true,'最终checkpoint失败后预写标记必须仍在Chrome session');
      const url=origin+'/font-recovery-write-'+mode;
      await page(url);
      await setFixture('none',active);await restartWorker();
      const recovered=await until(readTrace,value=>value?.mode==='none'&&value.successes.length>0&&value.completed===value.started);
      assert.equal(latestFont(recovered).reloadRequired,true);
      assert.equal(await hasFontDebt([url]),true);
      assert.equal((await readMetadata()).pendingFontScopeChange,undefined);
      evidence.checks[prewrite?'fontPrewriteFailureBlocksActualRegistration':'fontCheckpointFailureRetainsWindowAcrossWorkerRestart']=true;
    }
  } else if(production) {
    phase='production-worker-registration';
    const message=async request=>{
      const result=await evaluate(control.sessionId,`chrome.runtime.sendMessage(${JSON.stringify(request)})`);
      assert.ok(result && result.status!=='error');return result;
    };
    const save=value=>message({action:'setSiteConfig',config:value});
    const registered=()=>evaluate(control.sessionId,'chrome.scripting.getRegisteredContentScripts()');
    config.globalProfile.language.enabled=false;config.globalProfile.timezone.enabled=false;
    const saved=await save(config);
    evidence.initialRegistration={status:saved.syncReport.status,page:saved.syncReport.pageRuntime,font:saved.syncReport.fontRuntime};
    phase='production-worker-font-status';
    assert.deepEqual(saved.syncReport.fontRuntime,{state:'ready',registeredRuleCount:1,reloadRequired:true});
    phase='production-worker-language-status';
    assert.equal(saved.syncReport.pageRuntime.state,'switch-required');
    assert.equal(saved.syncReport.status,'partial');
    const actualScripts=await registered();assert.equal(actualScripts.length,1);
    for(const key of ['id','matches','excludeMatches','js','world','runAt','allFrames','persistAcrossSessions']) {
      phase='production-worker-registration-'+key;
      const emptyArrayDefault=key==='excludeMatches';
      assert.deepEqual(actualScripts[0][key] ?? (emptyArrayDefault?[]:undefined),scripts[0][key],key);
    }
    phase='production-earliest-inline-baseline';
    evidence.checks.actualDistWorkerRegistersFixedFileAndReportsIndependentStatus=true;
    const filtered=await page(origin+'/production-filtered');const current=await sample(filtered.sessionId);
    assert.equal(current.first,true);assert.equal(current.blocked,false);assert.deepEqual(current.target,current.allowed[1]);
    assert.notDeepEqual(baseline.ordinary[2],baseline.allowed[1],'具名字体须有首inline原生差异正对照');
    assert.ok(current.ordinary.every(value=>JSON.stringify(value)===JSON.stringify(current.allowed[1])));
    assert.deepEqual(current.allowed,baseline.allowed);
    evidence.checks.topMeasurementAllowlistAtFirstInline=true;
    for(const key of ['conversionErrors','fontCheckErrors','allowed','ordinaryCheck','pixels','image','receiverError','fontSyntaxError','descriptor','language','timezone','device','offscreen']) assert.deepEqual(current[key],baseline[key],key);
    evidence.checks.actualDistEarliestInlineAndNativeBaseline=true;
    phase='production-fixed-font-width-scan';
    const nativeFonts=await scanFixedFonts(baselinePage.sessionId);
    const filteredFonts=await scanFixedFonts(filtered.sessionId);
    assert.equal(nativeFonts.length,43);assert.equal(filteredFonts.length,43);
    assert.ok(nativeFonts.every(row=>row.loaded&&row.detected&&row.restored),'全部目标须有真实字体正对照');
    assert.ok(filteredFonts.every(row=>!row.loaded&&!row.detected&&row.restored),'全部目标须同时屏蔽存在性及宽度探测');
    evidence.fixedFontScan={total:43,addedChineseFamilies:27,genericFamilies:3,
      nativePositiveControl:true,filteredExistenceAndWidths:true,fontRestored:true};
    evidence.checks.actualDistAll43FontsBlockedAgainstSiteWidthProbe=true;
    phase='production-measurement-allowlist';
    const nativePolicy=await scanMeasurementPolicy(baselinePage.sessionId);
    const topPolicy=await scanMeasurementPolicy(filtered.sessionId);
    const iframePolicy=await scanMeasurementPolicy(filtered.sessionId,true);
    assert.ok(nativePolicy.detected&&!nativePolicy.namedOnlyUsesSans&&nativePolicy.unlistedCheckVisible);
    assert.deepEqual(topPolicy,{detected:false,restored:true,namedOnlyUsesSans:true,nativeMetrics:true,unlistedCheckVisible:true});
    assert.deepEqual(iframePolicy,nativePolicy,'iframe中的未知字体继续原生测量');
    evidence.measurementAllowlist={families:['monospace','sans-serif','serif'],
      unknownFontNativePositiveControl:true,topUnknownFontSuppressed:true,iframeUnknownFontRemainsNative:true,
      unlistedFontCheckUnchanged:true,nativeTextMetricsAndFontRestore:true};
    evidence.checks.actualDistTopOnlyMeasurementAllowlistAndUnchangedCheck=true;
    assert.equal(await evaluate(filtered.sessionId,'frames[0].fontObservation.first&&frames[0].fontObservation.blocked===false'),true);
    const iframeFirst=await evaluate(filtered.sessionId,'frames[0].fontObservation');
    assert.deepEqual(iframeFirst.target,iframeFirst.fallback,'iframe已知字体仍按原名单回退monospace');
    assert.deepEqual(iframeFirst.ordinary,baseline.ordinary,'iframe其他具名字体保持原生');
    assert.equal(await evaluate(filtered.sessionId,'frames[1].document.fonts.check("32px MiSans")&&frames[2].document.fonts.check("32px MiSans")'),true);
    assert.equal((await sample((await page(origin+'/csp')).sessionId)).blocked,false);
    evidence.checks.actualDistIframeUnsupportedDocumentsAndCsp=true;
    const negative=await page(origin.replace('localhost','127.0.0.1')+'/production-negative');
    assert.equal((await sample(negative.sessionId)).blocked,true);
    assert.ok((await scanFixedFonts(negative.sessionId)).every(row=>row.loaded&&row.detected&&row.restored));
    assert.deepEqual(await scanMeasurementPolicy(negative.sessionId),nativePolicy);
    evidence.checks.actualDistAll43FontsNativeOutsideAllowlist=true;
    evidence.checks.actualDistUnmatchedOriginStaysNative=true;
    for(const gate of ['font-switch','site-rule']) {
      const off=structuredClone(config);
      if(gate==='font-switch') off.fontExposure.enabled=false;
      else off.rules[0].enabled=false;
      await save(off);assert.equal((await registered()).length,0);
      assert.deepEqual(await scanMeasurementPolicy((await page(origin+'/production-'+gate+'-off')).sessionId),nativePolicy);
    }
    evidence.checks.actualDistFontSwitchAndSiteRuleGateKeepNative=true;
    const custom=structuredClone(config);custom.fontExposure.mode='custom';
    const customSaved=await save(custom);
    assert.equal(customSaved.syncReport.fontRuntime.state,'custom-paused');assert.equal((await registered()).length,0);
    assert.equal(await evaluate(filtered.sessionId,'document.fonts.check("32px MiSans")'),false);
    assert.equal((await sample((await page(origin+'/production-custom')).sessionId)).blocked,true);
    evidence.checks.actualDistCustomNotDispatchedAndOldHookRetained=true;
    await save(config);
    const workerUrl=`chrome-extension://${id}/background/service-worker.js`;
    const oldWorker=await until(async()=> (await send('Target.getTargets')).targetInfos.find(target=>target.type==='service_worker'&&target.url===workerUrl));
    await send('ServiceWorker.enable',{},control.sessionId);
    await send('ServiceWorker.stopAllWorkers',{},control.sessionId);
    await until(async()=> !(await send('Target.getTargets')).targetInfos.some(target=>target.targetId===oldWorker.targetId));
    const resumed=await message({action:'reconcileRuntime'});
    const newWorker=await until(async()=> (await send('Target.getTargets')).targetInfos.find(target=>target.type==='service_worker'&&target.url===workerUrl));
    assert.notEqual(newWorker.targetId,oldWorker.targetId);
    assert.equal(resumed.syncReport.fontRuntime.state,'ready');assert.equal((await registered()).length,1);
    evidence.checks.actualMv3WorkerStoppedAndWokenRegistrationRestored=true;
    const stagedManifest=JSON.parse(await readFile(join(staged,'manifest.json'),'utf8'));
    stagedManifest.version += '.1';await writeFile(join(staged,'manifest.json'),JSON.stringify(stagedManifest));
    await send('Target.closeTarget',{targetId:control.targetId});
    assert.equal((await send('Extensions.loadUnpacked',{path:staged})).id,id);
    Object.assign(control,await page(`chrome-extension://${id}/qualification.html`));
    await until(()=>evaluate(control.sessionId,'chrome.scripting.getRegisteredContentScripts().then(s=>s.length===1)'));
    const updated=await message({action:'getSiteConfig'});
    assert.equal(updated.config.fontExposure.mode,'vendor-software');assert.equal(updated.syncReport.fontRuntime.state,'ready');
    assert.equal((await sample((await page(origin+'/production-updated')).sessionId)).blocked,false);
    evidence.checks.actualExtensionUpdateRestoresWithoutReregistrationFromDriver=true;
    const disabled=await message({action:'setExtensionEnabled',enabled:false});
    assert.equal(disabled.syncReport.fontRuntime.state,'disabled');assert.equal(disabled.syncReport.fontRuntime.reloadRequired,true);
    assert.equal((await registered()).length,0);
    const disabledPage=await page(origin+'/production-disabled');
    assert.equal((await sample(disabledPage.sessionId)).blocked,true);
    assert.ok((await scanFixedFonts(disabledPage.sessionId)).every(row=>row.loaded&&row.detected&&row.restored));
    assert.deepEqual(await scanMeasurementPolicy(disabledPage.sessionId),nativePolicy);
    evidence.checks.actualDistAll43FontsNativeWhenDisabled=true;
    await send('Page.reload',{},filtered.sessionId);
    await until(()=>evaluate(filtered.sessionId,'document.readyState==="complete"&&fontObservation.blocked===true'));
    evidence.checks.actualDistDisableAndSameUrlReloadRestoreNative=true;
  } else if(servicesIntegration) {
    phase='actual-services-integration';
    config.fontExposure.enabled=false;
    config.globalProfile.language.enabled=false;config.globalProfile.timezone.enabled=false;
    await evaluate(control.sessionId,`(async()=>{
      await chrome.storage.local.set({siteSpoofConfig:${JSON.stringify(config)},siteRulesInitialized:true});
      globalThis.gatedModule=await import(chrome.runtime.getURL('production-gated-services.js'));
      globalThis.candidateModule=await import(chrome.runtime.getURL('candidate-services.js'));
      globalThis.fontServices=candidateModule.createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');
      return true;
    })()`);
    const run=expression=>evaluate(control.sessionId,expression);
    const save=async value=>run(`fontServices.saveSiteConfig(${JSON.stringify(value)})`);
    const readScripts=()=>run('chrome.scripting.getRegisteredContentScripts()');
    const enabled=structuredClone(config);enabled.fontExposure.enabled=true;
    const first=await save(enabled);
    assert.deepEqual(first.syncReport.fontRuntime,{state:'ready',registeredRuleCount:1,reloadRequired:true});
    assert.equal(first.syncReport.pageRuntime.state,'permission-required');
    assert.equal(first.syncReport.pageRuntime.reloadRequired,false);
    assert.equal(first.syncReport.status,'partial');
    assert.equal((await readScripts()).length,1);
    assert.equal(await evaluate(baselinePage.sessionId,'document.fonts.check("32px MiSans")'),true);
    const firstFiltered=await page(origin+'/services-enabled');
    assert.equal((await sample(firstFiltered.sessionId)).first,true);
    assert.equal((await sample(firstFiltered.sessionId)).blocked,false);
    evidence.checks.actualServicesSaveRegisterAndIndependentReload=true;
    const restarted=await run(`(async()=>{globalThis.fontServices=candidateModule.createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}');return fontServices.initializeExtension()})()`);
    assert.deepEqual(restarted.fontRuntime,first.syncReport.fontRuntime);
    evidence.checks.newServiceInstanceReadsActualRegistrationAndDebt=true;
    assert.equal(await run(`(()=>{const el=document.createElement('p');candidateModule.renderFontRuntimeStatus(el,${JSON.stringify(restarted)});
      return el.dataset.fontRuntime==='ready'&&el.textContent.includes('仅覆盖 measureText() 和 FontFaceSet.check()')&&el.textContent.includes('当前页面实际值尚未验证')})()`),true);
    evidence.checks.actualFontUiRendererReportsLimitedCoverage=true;
    const custom=structuredClone(enabled);custom.fontExposure.mode='custom';
    const customResult=await save(custom);
    assert.equal(customResult.syncReport.fontRuntime.state,'custom-paused');
    assert.equal(customResult.syncReport.fontRuntime.reloadRequired,true);
    assert.equal((await readScripts()).length,0);
    assert.equal(await evaluate(firstFiltered.sessionId,'document.fonts.check("32px MiSans")'),false);
    const nativeCustom=await page(origin+'/services-custom');
    assert.equal((await sample(nativeCustom.sessionId)).blocked,true);
    const debtBefore=await run('chrome.storage.session.get("runtimeSyncMetadata").then(v=>v.runtimeSyncMetadata.pendingReloads)');
    custom.fontExposure.blockedFamilies=['Synthetic Custom Font'];await save(custom);
    assert.deepEqual(await run('chrome.storage.session.get("runtimeSyncMetadata").then(v=>v.runtimeSyncMetadata.pendingReloads)'),debtBefore);
    evidence.checks.customRevokesNewDocumentsRetainsOldHooksAndNoExtraDebt=true;
    const expanded={...enabled,rules:[...enabled.rules,createRule('127.0.0.1')]};
    await save(expanded);
    const scoped=await page(origin.replace('localhost','127.0.0.1')+'/services-scope');
    assert.equal((await sample(scoped.sessionId)).blocked,false);
    await save(enabled);
    assert.equal((await sample((await page(origin.replace('localhost','127.0.0.1')+'/services-revoked')).sessionId)).blocked,true);
    assert.equal(await evaluate(scoped.sessionId,'document.fonts.check("32px MiSans")'),false);
    evidence.checks.actualServicesAllowlistScopeRevocation=true;
    phase='services-disable-window-new-iframe';
    // 在实际 services 的旧注册撤销调用前暂停，真实新建 iframe-only 命中文档。
    await run(`(()=>{const revoke=chrome.scripting.unregisterContentScripts;
      chrome.scripting.unregisterContentScripts=async function(...args){
        await new Promise(done=>{globalThis.releaseFontRevoke=done});
        return Reflect.apply(revoke,chrome.scripting,args);
      };
      globalThis.restoreFontRevoke=()=>{chrome.scripting.unregisterContentScripts=revoke};
      globalThis.pendingFontDisable=fontServices.setExtensionEnabled(false);return true;
    })()`);
    await until(()=>run('typeof releaseFontRevoke === "function"'));
    const lateParentUrl=origin.replace('localhost','127.0.0.1')+'/embedding';
    const lateParent=await page(lateParentUrl);
    assert.equal((await sample(lateParent.sessionId)).blocked,true);
    const lateChildUrl=origin+'/child?role=late-font-iframe';
    const lateTarget=await until(async()=> (await send('Target.getTargets')).targetInfos.find(target=>target.type==='iframe'&&target.url===lateChildUrl));
    const lateSession=await attach(lateTarget.targetId);
    const lateSample=await until(()=>sample(lateSession));
    assert.equal(lateSample.first,true);assert.equal(lateSample.blocked,false);
    const disabled=await run('(async()=>{releaseFontRevoke();const result=await pendingFontDisable;restoreFontRevoke();return result})()');
    assert.equal(disabled.syncReport.fontRuntime.state,'disabled');assert.equal(disabled.syncReport.fontRuntime.reloadRequired,true);
    assert.equal(await run(`(async()=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===${JSON.stringify(lateParentUrl)});
      const meta=(await chrome.storage.session.get('runtimeSyncMetadata')).runtimeSyncMetadata;
      return meta.pendingReloads.some(item=>item.tabId===tab.id&&item.surfaces.includes('font'))&&!meta.pendingFontScopeChange;
    })()`),true);
    assert.equal(await evaluate(lateSession,'document.fonts.check("32px MiSans")'),false);
    evidence.checks.disableWindowNewIframeTabConservativelyNeedsReload=true;
    assert.equal((await readScripts()).length,0);
    assert.equal((await sample((await page(origin+'/services-disabled')).sessionId)).blocked,true);
    evidence.checks.actualServicesMasterDisableNewDocumentsNative=true;
    await save(enabled);
    const gated=await run(`gatedModule.createBackgroundServices('function applyLanguageTimezoneRuntime() {}', 'function applyGeolocationRuntime() {}').initializeExtension()`);
    assert.equal(gated.fontRuntime.state,'paused');assert.equal(gated.fontRuntime.registeredRuleCount,0);
    assert.equal((await readScripts()).length,0);
    evidence.checks.syntheticPausedGateRevokesApprovedRegistrations=true;
  } else {
  phase = 'register';
  await sync(control.sessionId,scripts);
  assert.equal(await evaluate(control.sessionId, '(async()=>{const s=await chrome.scripting.getRegisteredContentScripts();return s.length===1&&s[0].js[0]==="font-exposure/filter.js"&&s[0].world==="MAIN"})()'), true);
  const filtered = await page(origin + '/filtered');
  const current = await sample(filtered.sessionId);
  assert.equal(current.first,true); assert.equal(current.blocked,false); assert.deepEqual(current.target,current.allowed[1]);
  evidence.checks.earliestInlineTargetFilter = true;
  phase = 'loaded-target-font';
  const shorthands = ['calc(16px + 16px) MiSans', 'italic 700 32px MiSans', 'oblique 12deg 32px MiSans',
    '32px/1.5 MiSans', '32px / 1.5 MiSans', 'small-caps 32px MiSans'];
  const loadedWidth = session => evaluate(session, `(async()=>{
    const face=new FontFace('MiSans','local("Arial"), local("Liberation Sans")');
    await face.load();document.fonts.add(face);const c=document.createElement('canvas').getContext('2d');
    c.font='32px MiSans, monospace';const w=c.measureText('WWiiii字A').width;
    const check = value => {try{return {value:document.fonts.check(value)}}catch(error){return {error:error.name}}};
    const shorthand=${JSON.stringify(shorthands)}.map(check);
    const ordinaryShorthand=${JSON.stringify(shorthands)}.map(font=>check(font.replace('MiSans','Arial')));
    c.font='32px monospace';return {shorthand,ordinaryShorthand,width:w,fallback:c.measureText('WWiiii字A').width,check:document.fonts.check('32px MiSans'),escapedCheck:document.fonts.check('32px "Mi'+String.fromCharCode(92)+'53 ans"')};
  })()`);
  const nativeLoaded=await loadedWidth(baselinePage.sessionId),filteredLoaded=await loadedWidth(filtered.sessionId);
  assert.notEqual(nativeLoaded.width,nativeLoaded.fallback);assert.equal(nativeLoaded.check,true);
  assert.equal(filteredLoaded.width,filteredLoaded.fallback);assert.equal(filteredLoaded.check,false);
  assert.equal(nativeLoaded.escapedCheck,true);assert.equal(filteredLoaded.escapedCheck,false);
  evidence.checks.loadedTargetFontPositiveControl=true;
  phase='css-shorthand';
  assert.ok(nativeLoaded.shorthand.every(row=>row.value===true));
  evidence.shorthandBypassCount=filteredLoaded.shorthand.filter(row=>row.value===true).length;
  assert.ok(filteredLoaded.shorthand.every(row=>row.value===false));
  assert.deepEqual(filteredLoaded.ordinaryShorthand,nativeLoaded.ordinaryShorthand);
  evidence.checks.nativeCssShorthandParsing=true;
  for(const key of ['conversionErrors','fontCheckErrors','allowed','ordinaryCheck','pixels','image','receiverError','fontSyntaxError','descriptor','language','timezone','device','offscreen']) {
    phase='native-baseline-'+key;
    if(key==='conversionErrors' && JSON.stringify(current[key])!==JSON.stringify(baseline[key]))
      evidence.conversionErrorMismatch={actual:current[key],expected:baseline[key]};
    assert.deepEqual(current[key],baseline[key],key);
  }
  evidence.checks.nativeCanvasAllowedFontsAndDeviceBaseline = true;
  assert.equal(await evaluate(filtered.sessionId, 'frames[0].fontObservation.first && frames[0].fontObservation.blocked===false'),true);
  assert.equal(await evaluate(filtered.sessionId, 'frames[1].document.fonts.check("32px MiSans") && frames[2].document.fonts.check("32px MiSans")'),true);
  evidence.checks.httpIframeAndUnsupportedDocuments = true;
  const csp = await page(origin + '/csp');
  assert.equal((await sample(csp.sessionId)).blocked,false); evidence.checks.strictCsp = true;
  const unmatched = await page(origin.replace('localhost','127.0.0.1') + '/negative');
  assert.deepEqual((await sample(unmatched.sessionId)).target,baseline.target);
  assert.equal((await sample(unmatched.sessionId)).blocked,true); evidence.checks.unmatchedOrigin = true;
  phase='candidate-scope-update';
  const expanded={...config,rules:[...config.rules,createRule('127.0.0.1')]};
  await sync(control.sessionId,compileFontScripts(expanded));
  const nowMatched=await page(origin.replace('localhost','127.0.0.1')+'/new-scope');
  assert.equal((await sample(nowMatched.sessionId)).blocked,false);
  const cross=await page(origin+'/cross');
  const childUrl=origin.replace('localhost','127.0.0.1')+'/child?role=oopif';
  const oopif=await until(async()=> (await send('Target.getTargets')).targetInfos.find(target=>target.type==='iframe'&&target.url===childUrl));
  const childSession=await attach(oopif.targetId);
  const childSample=await until(()=>sample(childSession));
  assert.equal(childSample.first,true);assert.equal(childSample.blocked,false);
  assert.deepEqual(childSample.target,childSample.fallback);
  evidence.checks.actualCrossSiteOopifEarliestFilter=true;
  await sync(control.sessionId,scripts);
  const nowRevoked=await page(origin.replace('localhost','127.0.0.1')+'/revoked-scope');
  assert.equal((await sample(nowRevoked.sessionId)).blocked,true);
  evidence.checks.sharedReconcilerScopeUpdateAndRevoke=true;
  phase='disable-commit-window';
  // 实际保存合成关闭配置后，刻意停在对账前，观测Chrome旧注册窗口；无生产授权旁路。
  const disabledConfig={...config,masterEnabled:false};
  await evaluate(control.sessionId,`chrome.storage.local.set({qualificationConfig:${JSON.stringify(disabledConfig)}})`);
  assert.equal(await evaluate(control.sessionId,'chrome.storage.local.get("qualificationConfig").then(v=>v.qualificationConfig.masterEnabled)'),false);
  const duringDisable=await page(origin+'/disable-before-reconcile');
  assert.equal((await sample(duringDisable.sessionId)).blocked,false);
  await sync(control.sessionId,compileFontScripts(disabledConfig));
  const afterDisable=await page(origin+'/disable-after-reconcile');
  assert.equal((await sample(afterDisable.sessionId)).blocked,true);
  evidence.checks.disableWindowUsesOldSnapshotUntilSync=true;
  await sync(control.sessionId,scripts);
  phase='page-config-tampering';
  const tampered=await page(origin+'/tamper');
  assert.equal((await sample(tampered.sessionId)).blocked,false);
  assert.equal((await sample(tampered.sessionId)).first,true);
  assert.equal(await evaluate(tampered.sessionId,`(()=>{
    const p=CSSStyleDeclaration.prototype;
    const set=Object.getOwnPropertyDescriptor(p,'setProperty'),get=Object.getOwnPropertyDescriptor(p,'getPropertyValue');
    const create=document.createElement;
    let calls=0;
    try {
      Object.defineProperty(p,'setProperty',{...set,value:function(){calls++;throw new Error('page setter')}});
      Object.defineProperty(p,'getPropertyValue',{...get,value:function(){calls++;throw new Error('page getter')}});
      document.createElement=function(){calls++;throw new Error('page factory')};
      return document.fonts.check('calc(16px + 16px) MiSans')===false&&document.fonts.check('32px Arial')===true&&calls===0;
    } finally {Object.defineProperty(p,'setProperty',set);Object.defineProperty(p,'getPropertyValue',get);document.createElement=create;}
  })()`),true);
  evidence.checks.pageConfigAndParserTamperingDoNotReconfigureFilter=true;
  phase='document-open-retains-snapshot';
  const retained=await page(origin+'/open-filtered');
  assert.equal(await evaluate(retained.sessionId, `(()=>{const check=document.fonts.check;
    document.open();document.write('<!doctype html><title>same global</title>');document.close();
    return document.fonts.check===check&&document.fonts.check('32px MiSans')===false;
  })()`),true); evidence.checks.documentOpenRetainsExistingHook=true;
  phase = 'descriptor-tampering';
  assert.equal(await evaluate(filtered.sessionId, `(()=>{
    const p=CanvasRenderingContext2D.prototype;const original=p.measureText;
    const fake=function(){return {width:123}};Object.defineProperty(p,'measureText',{value:fake});
    const kept=p.measureText===fake;delete p.measureText;const removed=!Object.hasOwn(p,'measureText');
    Object.defineProperty(p,'measureText',{value:original,writable:false,configurable:false});Object.freeze(p);
    return kept&&removed&&p.measureText===original;
  })()`),true);
  assert.equal((await sample(csp.sessionId)).blocked,false); evidence.checks.descriptorContinuityAndRealmIsolation = true;
  phase = 'unregister';
  await sync(control.sessionId,[]);
  assert.equal(await evaluate(control.sessionId,'chrome.scripting.getRegisteredContentScripts().then(s=>s.length)'),0);
  assert.equal(await evaluate(csp.sessionId,'document.fonts.check("32px MiSans")'),false);
  const disabled = await page(origin + '/disabled'); assert.equal((await sample(disabled.sessionId)).blocked,true);
  await send('Page.reload',{},csp.sessionId);
  await until(()=>evaluate(csp.sessionId,'document.readyState==="complete"&&fontObservation.blocked'));
  evidence.checks.disableRetainsOldHooksReloadRestoresNative = true;
  phase='bfcache-snapshot';
  // 重新注册用于获得带hook的可缓存文档，撤销后返回时必须识别实际BFCache hit。
  await sync(control.sessionId,scripts);
  const cached=await page(origin+'/cached');
  await send('Page.enable',{},cached.sessionId);
  const history=await send('Page.getNavigationHistory',{},cached.sessionId);
  const entry=history.entries[history.currentIndex].id;
  await send('Page.navigate',{url:origin+'/away'},cached.sessionId);
  await until(()=>evaluate(cached.sessionId,'document.readyState==="complete"&&location.pathname==="/away"'));
  await sync(control.sessionId,[]);
  await send('Page.navigateToHistoryEntry',{entryId:entry},cached.sessionId);
  await until(()=>evaluate(cached.sessionId,'document.readyState==="complete"&&location.pathname==="/cached"'));
  assert.equal(await evaluate(cached.sessionId,'wasPersisted'),true);
  assert.equal(await evaluate(cached.sessionId,'document.fonts.check("32px MiSans")'),false);
  evidence.checks.actualBfcacheRetainsOldSnapshot=true;
  phase='extension-update';
  const manifest=JSON.parse(await readFile(join(staged,'manifest.json'),'utf8'));manifest.version='1.1';
  await writeFile(join(staged,'manifest.json'),JSON.stringify(manifest));
  await send('Target.closeTarget',{targetId:control.targetId});
  assert.equal((await send('Extensions.loadUnpacked',{path:staged})).id,id);
  const updatedControl=await page(`chrome-extension://${id}/qualification.html`);
  assert.equal(await evaluate(updatedControl.sessionId,'chrome.runtime.getManifest().version'),'1.1');
  await loadControl(updatedControl.sessionId);
  await sync(updatedControl.sessionId,[]);
  await sync(updatedControl.sessionId,scripts);
  const updated=await page(origin+'/updated');assert.equal((await sample(updated.sessionId)).blocked,false);
  evidence.checks.extensionUpdateAndExplicitReregistration=true;
  await sync(updatedControl.sessionId,[]);
  phase='document-open';
  const opened=await page(origin+'/open');
  assert.equal(await evaluate(opened.sessionId, `(()=>{const fn=document.fonts.check;
    document.open();document.write('<!doctype html><title>replacement</title>');document.close();
    return document.fonts.check===fn&&document.fonts.check('32px MiSans')===true;
  })()`),true);
  // 此文档在撤销后创建；document.open 不会重新恢复已撤销的注册。
  evidence.checks.documentOpenAfterDisableNative=true;
  if(browserRestart) {
  phase='browser-restart-registration';
  await sync(updatedControl.sessionId,scripts);
  const onMessage=socket.onmessage;
  socket.close();
  const exited=new Promise(done=>browser.once('exit',done));
  browser.kill('SIGTERM');await exited;
  await rm(join(profile,'DevToolsActivePort'),{force:true});
  browser=spawn(chrome,['--headless=new','--site-per-process','--enable-unsafe-extension-debugging','--remote-debugging-port=0',
    `--user-data-dir=${profile}`,'--disable-background-networking','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
  const restartedPort=await until(async()=>{
    if(browser.exitCode!==null||browser.signalCode)throw new Error('浏览器提前退出');
    try{return(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}
  });
  evidence.browserRestart={launched:true};
  const restartedVersion=await(await fetch(`http://127.0.0.1:${restartedPort}/json/version`)).json();
  assert.equal(restartedVersion.Browser,evidence.chrome);
  socket=new WebSocket(restartedVersion.webSocketDebuggerUrl);
  await new Promise((done,fail)=>{socket.onopen=done;socket.onerror=fail});socket.onmessage=onMessage;
  // 不再loadUnpacked或register；先观察浏览器从相同临时profile自动恢复的注册。
  evidence.browserRestart.transportReady=true;
  const restartedProtocol=await(await fetch(`http://127.0.0.1:${restartedPort}/json/protocol`)).json();
  if(restartedProtocol.domains.find(domain=>domain.domain==='Extensions')?.commands.some(command=>command.name==='getExtensions')) {
    const inventory=await send('Extensions.getExtensions');
    evidence.browserRestart.extensionPresent=inventory.extensions.some(extension=>extension.id===id);
  }
  const {targetId:recoveredTargetId}=await send('Target.createTarget',{url:`chrome-extension://${id}/qualification.html`});
  const recoveredSession=await attach(recoveredTargetId);
  evidence.browserRestart.extensionPageAccessible=await evaluate(recoveredSession,`Boolean(globalThis.chrome?.runtime?.id===${JSON.stringify(id)})`);
  assert.equal(evidence.browserRestart.extensionPageAccessible,true);
  const recoveredControl={targetId:recoveredTargetId,sessionId:recoveredSession};
  await until(()=>evaluate(recoveredControl.sessionId,'document.readyState==="complete"'));
  await loadControl(recoveredControl.sessionId);
  assert.equal(await evaluate(recoveredControl.sessionId,'chrome.scripting.getRegisteredContentScripts().then(s=>s.length)'),1);
  const cold=await page(origin+'/cold-new-document');
  assert.equal((await sample(cold.sessionId)).first,true);assert.equal((await sample(cold.sessionId)).blocked,false);
  await sync(recoveredControl.sessionId,scripts);
  await sync(recoveredControl.sessionId,[]);
  evidence.checks.nativeRegistrationSurvivesActualBrowserRestart=true;
  }
  }
  evidence.result = browserDisable&&Object.values(evidence.checks).some(value=>!value)?'FAIL':'PASS';
  if(evidence.result==='FAIL') {
    evidence.failure={phase:'browser-card-disable-observations',kind:'behavior',reason:'关闭后的新文档或完整刷新仍存在字体过滤／脚本来源证据'};
    process.exitCode=1;
  }
} catch(error) {
  evidence.failure = {phase,kind:error.code==='ERR_ASSERTION'?'assertion':'environment-or-automation',
    reason:error.code==='ERR_ASSERTION'?'断言未满足':error.message?.replaceAll(root,'<workspace>').replaceAll(temporary,'<temporary>').slice(0,180)};
  if(error.protocol)evidence.failure.protocol=error.protocol;
  if(error.probe)evidence.failure.probe=error.probe;
  if((startupReadFailure||browserDisable)&&error.code==='ERR_ASSERTION') evidence.failure.assertion=error.message.split('\n')[0]
    .replaceAll(root,'<workspace>').replaceAll(temporary,'<temporary>').replace(/[a-p]{32}/g,'<extension>').slice(0,180);
  process.exitCode=2;
} finally {
  for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('探针关闭')); }
  pending.clear(); socket?.close();
  if (browser && browser.exitCode === null && !browser.signalCode) {
    const exited = new Promise(done => browser.once('exit', done));
    browser.kill('SIGTERM');
    const force = setTimeout(() => browser.kill('SIGKILL'), 5000);
    await exited; clearTimeout(force);
  }
  if (server.listening) await new Promise(done => server.close(done));
  await rm(temporary, { recursive: true, force: true });
  evidence.cleanup = 'PASS';
  if (output) await writeFile(resolve(output), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
}
