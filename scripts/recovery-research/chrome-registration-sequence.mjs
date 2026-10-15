#!/usr/bin/env node
// VG-021 P0-F：仅临时扩展、非敏感合成位；不导入生产 runtime 或配置。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--output', '参数：--output <脱敏JSON>');
assert.equal(typeof WebSocket, 'function', '需要 Node22+');
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(read, accept = Boolean) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await sleep(40); }
  throw new Error('VG-021 状态等待超时');
}
const sha = value => createHash('sha256').update(value).digest('hex');
const programs = new Map();
const cellName = '__vg021Cell';
// global 方案故意保持可观察，测试其来源信任；lexical 方案检查不同文件实际共享范围。
for (const kind of ['global', 'lexical']) {
  const cell = kind === 'global' ? `globalThis.${cellName}` : '__vg021Lex';
  const declaration = kind === 'global' ? `${cell}=` : `let ${cell}=`;
  for (const size of [4, 32]) programs.set(`${kind}-begin${size}.js`, `${declaration}{bits:[],size:${size},microAt:null};queueMicrotask(()=>{${cell}.microAt=${cell}.bits.length;});`);
  for (const bit of [0, 1]) programs.set(`${kind}-${bit}.js`, `${cell}.bits.push(${bit});`);
  for (let position=0;position<4;position++) for (const bit of [0,1]) programs.set(`${kind}-p${position}-${bit}.js`, `${cell}.bits.push(${bit});`);
  programs.set(`${kind}-end.js`, `(()=>{const c=${cell};if(c.bits.length!==c.size||c.bits.some(b=>b!==0&&b!==1))return;const bits=c.bits.join('');const language=bits==='0110'?'qaa-QM':bits==='1001'?'qab-QM':'qac-QM';Object.defineProperty(Navigator.prototype,'language',{configurable:true,get:()=>language});globalThis.__vg021Commit={bits,size:c.size};})();`);
}
programs.set('fixed.js', "Object.defineProperty(Navigator.prototype,'language',{configurable:true,get:()=> 'qaa-QM'});");
const sequence = (bits, kind = 'global') => [`${kind}-begin${bits.length}.js`, ...bits.split('').map(b => `${kind}-${b}.js`), `${kind}-end.js`];
const positioned = (bits, kind = 'global') => [`${kind}-begin4.js`, ...bits.split('').map((b,i)=>`${kind}-p${i}-${b}.js`), `${kind}-end.js`];
const snapshot = `(()=>({language:navigator.language,commit:globalThis.__vg021Commit??null,assembled:globalThis.__vg021Cell?.bits.join('')??(typeof __vg021Lex==='undefined'?null:__vg021Lex.bits.join('')),microAt:globalThis.__vg021Cell?.microAt??null,lexicalMicroAt:typeof __vg021Lex==='undefined'?null:__vg021Lex.microAt,setterCalls:globalThis.__vg021SetterCalls??0,lexicalAttack:globalThis.__vg021LexicalAttack??false,microAttack:globalThis.__vg021MicroAttack??null}))()`;
const inline = code => `<script nonce="vg021">${code}</script>`;
const htmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const jsString = value => JSON.stringify(value).replaceAll('<', '\\u003c');
function documentFixture(key, kind) {
  // 首个 head inline 立即读取；预期不送入页面。证据属于受控 fixture 的实际观测。
  return `<head>${inline(`globalThis.__vg021First=${snapshot};addEventListener('load',()=>{globalThis.__vg021Load=${snapshot};fetch('/sample',{method:'POST',body:JSON.stringify({key:${jsString(key)},kind:${jsString(kind)},first:globalThis.__vg021First,load:globalThis.__vg021Load})});});`)}</head><body></body>`;
}
const samples = new Map(), held = new Map(), released = new Set();
// 普通页面能力：父页在初始 blank 上预置 setter，再 document.open/write；不使用 CDP preload。
const seedAttack = `
w.__vg021SetterCalls=0;
Object.defineProperty(w,'__vg021Cell',{configurable:true,get(){return this.__vg021Backing;},set(c){
 this.__vg021SetterCalls++;this.__vg021Backing=c;
 c.bits.push=function(bit){this[this.length]=1-bit;return this.length;};
}});
// 若 lexical 状态跨文件共享，父页可在其 document.open 重用前通过普通 eval 查找已知绑定。
try{w.eval("if(typeof __vg021Lex!=='undefined'){__vg021Lex.bits.push=function(b){this[this.length]=1-b;return this.length;};globalThis.__vg021LexicalAttack=true;}");}catch{}
`;
function hostFixture(key, manual = false, micro = false) {
  const child = documentFixture(key, 'blank');
  const manualSource = ['global-begin4.js', 'global-0.js', 'global-1.js', 'global-1.js', 'global-0.js', 'global-end.js'].map(p => programs.get(p)).join('\n');
  return `<head>${inline(`globalThis.__vg021First=${snapshot};`)}</head><body>${inline(`
const f=document.createElement('iframe');
${micro ? `queueMicrotask(()=>{const w=f.contentWindow;if(!w)return;w.__vg021MicroAttack={globalBitsBefore:w.__vg021Cell?.bits.length??null,lexicalBitsBefore:null};if(w.__vg021Cell)w.__vg021Cell.bits.push=function(b){this[this.length]=1-b;return this.length;};try{w.eval("if(typeof __vg021Lex!=='undefined'){__vg021MicroAttack.lexicalBitsBefore=__vg021Lex.bits.length;__vg021Lex.bits.push=function(b){this[this.length]=1-b;return this.length;};}");}catch{}});` : ''}
document.body.appendChild(f);const w=f.contentWindow;
${seedAttack}
w.document.open();${manual ? `w.eval(${jsString(manualSource)});` : ''}
w.document.write(${jsString(child)});w.document.close();
`)}</body>`;
}
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/sample' && req.method === 'POST') {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { const row = JSON.parse(body); samples.set(`${row.key}:${row.kind}`, row); res.end('ok'); }); return;
  }
  const key = url.searchParams.get('case');
  let html = documentFixture(key, 'top');
  if (url.pathname === '/top') {
    html += `<iframe src="/child?case=${key}"></iframe><iframe srcdoc="${htmlEscape(documentFixture(key, 'srcdoc'))}"></iframe>`;
    html += inline(`const f=document.createElement('iframe');document.body.appendChild(f);f.contentDocument.open();f.contentDocument.write(${jsString(documentFixture(key, 'blank'))});f.contentDocument.close();`);
  } else if (url.pathname === '/child') html = documentFixture(key, 'iframe');
  else if (url.pathname === '/host' || url.pathname === '/microhost') html = hostFixture(key,false,url.pathname==='/microhost');
  else if (url.pathname === '/manual') html = hostFixture(key, true);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/csp') res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-vg021'; connect-src 'self'");
  const respond = () => res.end(html);
  if (url.pathname === '/held' && !released.has(key)) held.set(key, respond); else respond();
});
const temp = await mkdtemp(join(tmpdir(), 'vg021-sequence-'));
const requests = new Map();
let child, socket;
try {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const origin = `http://localhost:${server.address().port}`;
  const extension = join(temp, 'extension'); await mkdir(extension);
  const manifest = {manifest_version:3,name:'VG021 isolated file sequence',version:'1.0',permissions:['scripting','tabs','storage'],host_permissions:['http://localhost/*'],web_accessible_resources:[]};
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(extension, 'control.html'), '<title>VG021 controller</title>');
  for (const [name, source] of programs) await writeFile(join(extension, name), source);
  const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  assert.ok(chrome, '需要 Chrome');
  child = spawn(chrome, ['--headless=new','--enable-unsafe-extension-debugging','--remote-debugging-port=0',`--user-data-dir=${join(temp,'profile')}`,'--disable-background-networking','--no-first-run','--no-default-browser-check','--no-proxy-server','about:blank'], {stdio:'ignore'});
  let launchFailed = false; child.once('error', () => { launchFailed = true; });
  const port = await until(async () => { assert.equal(launchFailed, false, 'Chrome启动失败'); try { return (await readFile(join(temp,'profile/DevToolsActivePort'),'utf8')).split('\n')[0]; } catch { return null; } });
  const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let id = 0;
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const sequenceId = ++id;
    const timer = setTimeout(() => { requests.delete(sequenceId); fail(new Error(`VG-021 CDP超时：${method}`)); }, 20000);
    requests.set(sequenceId, {done, fail, timer}); socket.send(JSON.stringify({id:sequenceId,method,params,sessionId}));
  });
  socket.onmessage = event => {
    const message = JSON.parse(event.data), pending = requests.get(message.id); if (!pending) return;
    requests.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.fail(new Error(`VG-021 CDP调用失败：${message.error.code}`)); else pending.done(message.result);
  };
  const {id:extensionId} = await send('Extensions.loadUnpacked', {path:extension});
  const {targetId} = await send('Target.createTarget', {url:`chrome-extension://${extensionId}/control.html`});
  const {sessionId} = await send('Target.attachToTarget', {targetId,flatten:true});
  const evaluate = async (expression, session = sessionId) => {
    const result = await send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true}, session);
    assert.ok(!result.exceptionDetails, 'VG-021 控制/观测表达式异常'); return result.result.value;
  };
  await until(() => evaluate('document.readyState'), value => value === 'complete');
  const register = async files => {
    await evaluate('chrome.scripting.unregisterContentScripts()');
    if (files) return evaluate(`chrome.scripting.registerContentScripts([{id:'sequence',matches:['http://localhost/*'],js:${JSON.stringify(files)},runAt:'document_start',world:'MAIN',allFrames:true,matchOriginAsFallback:true,persistAcrossSessions:false}]).then(async()=>({accepted:true,registeredJs:(await chrome.scripting.getRegisteredContentScripts())[0].js}),()=>({accepted:false}))`);
    return {accepted:true};
  };
  let caseNumber = 0;
  const tabs = new Set();
  async function navigate(path = '/top', kinds = ['top','iframe','srcdoc','blank'], hostname = 'localhost') {
    const key = `c${++caseNumber}`;
    const url = origin.replace('localhost', hostname) + path + '?case=' + key;
    const tab = await evaluate(`chrome.tabs.create({url:${JSON.stringify(url)}})`); tabs.add(tab.id);
    if (path === '/held') return {key,tab};
    await until(() => kinds.every(kind => samples.has(`${key}:${kind}`)));
    const later=await readNow(tab,true);
    return {key,tab,observations:kinds.map(kind=>({...samples.get(`${key}:${kind}`),now:later.find(row=>row.kind===kind).value}))};
  }
  async function readNow(tab, allFrames=false) {
    const current = await evaluate(`chrome.tabs.get(${tab.id})`);
    const targets = await send('Target.getTargets');
    const target = targets.targetInfos.find(t => t.type === 'page' && t.url === current.url);
    assert.ok(target, '需要当前页面target');
    const attached = await send('Target.attachToTarget', {targetId:target.targetId,flatten:true});
    const expression=allFrames ? `[{kind:'top',value:${snapshot}},...Array.from(document.querySelectorAll('iframe'),f=>({kind:f.hasAttribute('src')?'iframe':f.hasAttribute('srcdoc')?'srcdoc':'blank',value:f.contentWindow.eval(${jsString(snapshot)})}))]` : snapshot;
    try { return await evaluate(expression, attached.sessionId); }
    finally { await send('Target.detachFromTarget', {sessionId:attached.sessionId}); }
  }
  const cases = [];
  // 比较仅在驱动内进行，不持久化原生实际语言。
  const sanitize = (row, expected) => ({kind:row.kind,first:{languageMatches:row.first.language===expected,bits:row.first.commit?.bits??null},load:{languageMatches:row.load.language===expected,bits:row.load.commit?.bits??null},postLoad:{languageMatches:row.now.language===expected,bits:row.now.commit?.bits??null},assembledBits:row.now.assembled,microtaskAfterBits:row.now.microAt??row.now.lexicalMicroAt,setterCalls:row.now.setterCalls,lexicalAttack:row.now.lexicalAttack,microAttack:row.now.microAttack});
  async function observe(name, files, expected = 'qaa-QM', path = '/top', kinds) {
    const registration = await register(files);
    if (!registration.accepted) { cases.push({name,registrationAccepted:false}); console.log(`VG-021 ${name}: registration rejected`); return null; }
    const run = await navigate(path, kinds);
    cases.push({name,registrationAccepted:true,fileCount:files?.length??0,registeredJs:registration.registeredJs??[],observations:run.observations.map(row=>sanitize(row,expected))});
    console.log(`VG-021 ${name}: first=${run.observations.filter(row=>row.first.language===expected).length}/${run.observations.length}`);
    return run;
  }
  const native = await observe('native', null);
  assert.ok(native.observations.every(row=>!row.first.commit && row.first.language!=='qaa-QM'), '原生对照异常');
  const fixed = await observe('fixed-main-control', ['fixed.js']);
  assert.ok(fixed.observations.every(row=>row.first.language==='qaa-QM'), '固定MAIN正向对照未成立');
  await observe('duplicate-global-4bit', sequence('0110'));
  await observe('duplicate-lexical-4bit', sequence('0110','lexical'));
  const shared = await observe('positioned-global-4bit', positioned('0110'));
  const lexical = await observe('positioned-lexical-4bit', positioned('0110','lexical'));
  const selected = shared?.observations[0].first.commit?.bits==='0110' ? 'global' : lexical?.observations[0].first.commit?.bits==='0110' ? 'lexical' : null;
  if (selected) {
    const reverse = await observe('selection-changed-4bit', positioned('1001',selected), 'qab-QM');
    assert.ok(reverse.observations.every(row=>row.first.commit?.bits==='1001'), '配置选择切换失败');
    await observe('repeat-32bit', sequence('01100110011001100110011001100110',selected),'qac-QM','/page',['top']);
    await observe('strict-csp', positioned('0110',selected),'qaa-QM','/csp',['top']);
    await observe('incomplete-sequence', [`${selected}-begin4.js`,`${selected}-0.js`,`${selected}-end.js`],'qaa-QM','/page',['top']);
    await observe('same-origin-parent-global',positioned('0110'),'qaa-QM','/host',['blank']);
    await observe('same-origin-parent-lexical',positioned('0110','lexical'),'qaa-QM','/host',['blank']);
    await observe('parent-microtask-global',positioned('0110'),'qaa-QM','/microhost',['blank']);
    await observe('parent-microtask-lexical',positioned('0110','lexical'),'qaa-QM','/microhost',['blank']);
    await observe('attack-positive-control',null,'qab-QM','/manual',['blank']);
    // 存量文档不会因注册更新或注销被撤销；这与新文档分开采集。
    await register(positioned('0110',selected));
    const old = await navigate('/page',['top']);
    await evaluate(`chrome.scripting.updateContentScripts([{id:'sequence',js:${JSON.stringify(positioned('1001',selected))}}])`);
    const updated = await navigate('/page',['top']);
    const oldAfterUpdate = await readNow(old.tab);
    await evaluate('chrome.scripting.unregisterContentScripts()');
    const updatedAfterUnregister = await readNow(updated.tab);
    const removed = await navigate('/page',['top']);
    cases.push({name:'update-unregister-completed',oldDocumentRetainedA:oldAfterUpdate.language==='qaa-QM',newDocumentB:updated.observations[0].first.language==='qab-QM',existingDocumentRetainedB:updatedAfterUnregister.language==='qab-QM',newDocumentUninstalled:removed.observations[0].first.commit===null});
    // 禁用保存与注销并非同一事务：用受控窗口验证，绝不称自然发生频率。
    await register(positioned('0110',selected));
    await evaluate('chrome.storage.local.set({syntheticEnabled:false})');
    const duringGap = await navigate('/page',['top']);
    await evaluate('chrome.scripting.unregisterContentScripts()');
    const afterGap = await navigate('/page',['top']);
    cases.push({name:'storage-disable-before-unregister',controlledGap:true,disabledPersisted:await evaluate('chrome.storage.local.get("syntheticEnabled").then(v=>v.syntheticEnabled===false)'),oldSequenceInstalled:duringGap.observations[0].first.language==='qaa-QM',afterUnregisterUninstalled:afterGap.observations[0].first.commit===null});
    for (const operation of ['update','unregister']) {
      await register(positioned('0110',selected));
      const run = await navigate('/held',['top']);
      await until(()=>held.has(run.key));
      if (operation==='update') await evaluate(`chrome.scripting.updateContentScripts([{id:'sequence',js:${JSON.stringify(positioned('1001',selected))}}])`);
      else await evaluate('chrome.scripting.unregisterContentScripts()');
      released.add(run.key);held.get(run.key)();held.delete(run.key);
      await until(()=>samples.has(`${run.key}:top`));
      const row=samples.get(`${run.key}:top`);
      cases.push({name:`inflight-${operation}`,responseHeadersHeldUntilApiCompleted:true,oldA:row.first.language==='qaa-QM',newB:row.first.language==='qab-QM',uninstalled:row.first.commit===null});
    }
    await register(positioned('0110',selected));
    const nonmatch = await navigate('/page',['top'],'127.0.0.1');
    cases.push({name:'nonmatching-origin',uninstalled:nonmatch.observations[0].first.commit===null});
  }
  await register(null);
  for (const tabId of tabs) await evaluate(`chrome.tabs.remove(${tabId})`);
  const globalAttack = cases.find(row=>row.name==='same-origin-parent-global')?.observations?.[0];
  const gap = cases.find(row=>row.name==='storage-disable-before-unregister');
  const evidence = {task:'VG-021',stage:'P0-F',collection:'COMPLETE',browser:version.Browser,platform:process.platform,arch:process.arch,node:process.version,
    source:{path:'scripts/recovery-research/chrome-registration-sequence.mjs',sha256:sha(await readFile(fileURLToPath(import.meta.url)))},extension:{manifest,programCount:programs.size,programBytes:[...programs.values()].reduce((n,v)=>n+Buffer.byteLength(v),0),programs:[...programs].map(([path,source])=>({path,sha256:sha(source),bytes:Buffer.byteLength(source)}))},
    productionChanged:false,productionRestored:false,sequenceExpression:selected?'OBSERVED':'NOT_ESTABLISHED',globalAssemblerTampered:!!globalAttack&&globalAttack.setterCalls>0&&globalAttack.first.bits==='1001',revocationGapObserved:gap?.oldSequenceInstalled??false,
    sampling:{earliest:'head首个inline同步读取',load:'load回调同步读取',postLoad:'load样本到达后CDP读取当前target/同源子帧，不使用executeScript重新选址'},
    productionDecision:'NO_GO',cases,
    limitations:['仅Chrome本机构建和有限fixture，不证明数组执行原子性或其他版本','toy语言getter/合成位，不是完整payload、resolver、runtime或生产恢复验收','最多32位/34文件定向观察，不代表Chrome最大容量或任意字符串可编码','父页攻击由普通网页能力实施；观测来自受控fixture，不把页面报告当可信授权','在途导航只覆盖响应头提交前更新；BFCache/renderer队列与P2最终绑定未验证','存量hook不因注销撤销；storage/注册窗口为受控反例，不统计自然频率','无真实IP/位置/凭据/原生语言/doc或tab ID写入JSON，无provider/STUN/WAR/生产代码变更']};
  await writeFile(args[1],JSON.stringify(evidence,null,2)+'\n');
  console.log(`VG-021 collection COMPLETE; sequence=${evidence.sequenceExpression}; production=NO_GO`);
} finally {
  for (const request of requests.values()) { clearTimeout(request.timer); request.fail(new Error('VG-021 研究结束')); } requests.clear();socket?.close();
  if (child?.pid && child.exitCode===null) {const ended=new Promise(done=>child.once('exit',done));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await ended;clearTimeout(timer);}
  server.closeAllConnections();await new Promise(done=>server.close(done));
  await rm(temp,{recursive:true,force:true});
}
