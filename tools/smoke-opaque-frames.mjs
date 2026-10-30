#!/usr/bin/env node
/* 普通 blob/data 导航与真实 BFCache 回归；filesystem 导航与裸浏览器对照。
 * 不构造扩展握手或伪造配置，不解除浏览器的导航限制。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, sendRuntimeMessage, sleep, waitFor } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.length ? value.join('=') : true];
}));
const extensionPath = resolve(String(argv.extension || process.env.VANISHGEO_EXTENSION || 'dist'));
const results = [];
const evidence = { versions: [], filesystem: [], navigation: [], bfcache: [], recovery: [] };
let collectFailure;
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
}
const matches = (value, expected) => value?.language === expected.language && value?.timezone === expected.timezone;
const server = createServer(async (req, res) => {
  try {
    const path = resolve(ROOT, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(`${ROOT}${sep}fixtures${sep}`)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': extname(path) === '.js' ? 'text/javascript' : 'text/html; charset=utf-8' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const url = (host = 'localhost', query = '') => `http://${host}:${port}/fixtures/opaque/top.html${query}`;
const OTHER = `http://localhost:${port}/fixtures/bfcache/other.html`;
const frameKinds = ['blob', 'data', 'nested-data'];

async function browser(withExtension, run) {
  const profile = mkdtempSync(join(tmpdir(), 'vanishgeo-opaque-'));
  const previous = process.env.VANISHGEO_EXTENSION;
  delete process.env.VANISHGEO_EXTENSION;
  if (withExtension && process.env.VANISHGEO_LEGACY_EXTENSION === '1') process.env.VANISHGEO_EXTENSION = extensionPath;
  let chrome;
  let cdp;
  try {
    chrome = await launchChrome({ userDataDir: profile, args: ['--host-resolver-rules=MAP localhost 127.0.0.1, MAP child.localhost 127.0.0.1'] });
    cdp = await CDP.connect(chrome.websocketUrl);
    evidence.versions.push({ withExtension, ...(await cdp.send('Browser.getVersion')) });
    const extensionId = withExtension ? await loadExtension(cdp, extensionPath) : null;
    await run(cdp, extensionId);
  } finally {
    if (previous === undefined) delete process.env.VANISHGEO_EXTENSION;
    else process.env.VANISHGEO_EXTENSION = previous;
    cdp?.close();
    killChrome(chrome?.child);
    for (let n = 0; chrome?.child.exitCode === null && chrome?.child.signalCode === null && n < 40; n++) await sleep(100);
    if (!chrome || chrome.child.exitCode !== null || chrome.child.signalCode !== null) rmSync(profile, { recursive: true, force: true });
  }
}
const snapshot = (cdp, page) => evaluate(cdp, page.sessionId, `({ ...__opaque, top: {language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone} })`);
async function ready(cdp, page, predicate, label) {
  let last;
  try {
    return await waitFor(async () => {
      last = await snapshot(cdp, page);
      return predicate(last) ? last : null;
    }, { label, timeout: 15000 });
  } catch (error) {
    evidence.failure = { label, last, tree: await cdp.send('Page.getFrameTree', {}, page.sessionId) };
    if (collectFailure) evidence.failure.browser = await collectFailure();
    console.error(JSON.stringify({ label, top: last?.top, reports: Object.fromEntries(Object.entries(last?.reports || {}).map(([k, v]) => [k, { language: v.language, timezone: v.timezone }])) }));
    throw error;
  }
}

async function filesystem(cdp, withExtension) {
  const page = await openPageStable(cdp, url('localhost', '?filesystem=1'));
  const logs = [];
  const off = cdp.on((message) => {
    if (message.sessionId === page.sessionId && message.method === 'Log.entryAdded') logs.push(message.params.entry.text);
  });
  try {
    await cdp.send('Log.enable', {}, page.sessionId);
    const value = await ready(cdp, page, (s) => s.filesystemError || s.reports.filesystem ||
      (s.filesystemUrl && logs.some((text) => /Not allowed to.*filesystem:|filesystem:.*(blocked|not allowed)/i.test(text))), 'filesystem 导航结果或浏览器明确拒绝');
    const blocked = Boolean(value.filesystemUrl && !value.reports.filesystem && logs.some((text) => /Not allowed to.*filesystem:|filesystem:.*(blocked|not allowed)/i.test(text)));
    const record = { withExtension, attemptedUrl: value.filesystemUrl, error: value.filesystemError, blocked, report: value.reports.filesystem, logs };
    evidence.filesystem.push(record);
    return record;
  } finally { off(); }
}

try {
  let native;
  let nativeFilesystem;
  await browser(false, async (cdp) => {
    const page = await openPageStable(cdp, url());
    const state = await ready(cdp, page, (s) => frameKinds.every((kind) => s.reports[kind]), '裸浏览器 blob/data/nested 探针');
    native = state.top;
    check('裸浏览器 blob/data/nested 正常加载并取得原生基线', frameKinds.every((kind) => matches(state.reports[kind], native)));
    nativeFilesystem = await filesystem(cdp, false);
  });
  await browser(true, async (cdp, extensionId) => {
    const options = await openPageStable(cdp, `chrome-extension://${extensionId}/options/options.html`);
    const send = async (message) => {
      const response = await sendRuntimeMessage(cdp, options.sessionId, message);
      if (response?.status !== 'ok') throw new Error(`${message.action}: ${JSON.stringify(response)}`);
      return response;
    };
    const base = (await send({ action: 'getSiteConfig' })).config;
    // 旁观真实 runtime 请求的浏览器 sender；不伪造消息、不响应、不改变路由行为。
    let worker;
    let workerSession;
    const senderHistory = [];
    const attachObserver = async () => {
      worker = await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find((target) =>
        target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`)), { label: '扩展 worker' });
      ({ sessionId: workerSession } = await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true }));
      await evaluate(cdp, workerSession, `globalThis.__opaqueBrowserSenders = [];
        globalThis.__opaqueSenderObserver = (request, sender) => {
          if (request?.action === 'getPayloadForUrl' && sender.tab && sender.documentId) {
            __opaqueBrowserSenders.push({ tabId:sender.tab.id, frameId:sender.frameId, documentId:sender.documentId, url:sender.url, source:'runtime-sender' });
          }
        };
        chrome.runtime.onMessage.addListener(__opaqueSenderObserver); true`);
    };
    const detachObserver = async () => {
      senderHistory.push(...await evaluate(cdp, workerSession, '__opaqueBrowserSenders'));
      await evaluate(cdp, workerSession, 'chrome.runtime.onMessage.removeListener(__opaqueSenderObserver); delete globalThis.__opaqueSenderObserver; delete globalThis.__opaqueBrowserSenders; true');
      await cdp.send('Target.detachFromTarget', { sessionId: workerSession });
      workerSession = null;
    };
    await attachObserver();
    let fixturePage;
    try {
    const tokyo = { language: 'ja-JP', timezone: 'Asia/Tokyo' };
    const paris = { language: 'fr-FR', timezone: 'Europe/Paris' };
    const la = { language: 'ja-JP', timezone: 'America/Los_Angeles' };
    const childRule = { domain: 'child.localhost', enabled: true, overrides: {
      language: { mode: 'override', value: { enabled: true, mode: 'preset', language: 'fr-FR', languages: ['fr-FR', 'fr'], acceptLanguage: 'fr-FR,fr;q=0.9' } },
      timezone: { mode: 'override', value: { enabled: true, mode: 'manual', timezone: 'Europe/Paris' } }
    } };
    const config = (timezone = tokyo.timezone, enabled = true) => ({ ...base, masterEnabled: true, rules: [{ domain: 'localhost', enabled }, childRule], globalProfile: {
      ...base.globalProfile,
      language: { enabled: true, mode: 'preset', language: 'ja-JP', languages: ['ja-JP', 'ja'], acceptLanguage: 'ja-JP,ja;q=0.9' },
      timezone: { enabled: true, mode: 'manual', timezone },
      geolocation: { ...base.globalProfile.geolocation, enabled: false }
    } });
    const save = async (value) => { await send({ action: 'setSiteConfig', config: value }); };
    const metadata = async (pageUrl) => {
      const observed = await evaluate(cdp, options.sessionId, `chrome.tabs.query({}).then(async tabs => {
      const tab = tabs.find(tab => tab.url === ${JSON.stringify(pageUrl)});
      if (!tab) throw new Error('fixture tab missing');
      const frames = await chrome.webNavigation.getAllFrames({tabId: tab.id});
      const documents = await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},world:'ISOLATED',func:()=>location.href});
      return { tabId:tab.id, frames:[...frames, ...documents.filter(item => !frames.some(frame => frame.frameId === item.frameId)).map(item => ({frameId:item.frameId,documentId:item.documentId,url:item.result,source:'scripting-discovery'}))] };
    })`, { awaitPromise: true });
      const senders = [...senderHistory, ...(workerSession ? await evaluate(cdp, workerSession, '__opaqueBrowserSenders') : [])];
      const state = await snapshot(cdp, fixturePage);
      // 页面探针只筛选当前普通 fixture 的 href；身份仍取自 Chrome sender，绝不取 probe 自报 ID。
      const currentUrls = new Set(Object.values(state.reports).map(report => report.href));
      const latest = new Map();
      for (const sender of senders) if (sender.tabId === observed.tabId) latest.set(sender.frameId, sender);
      for (const sender of latest.values()) {
        if (currentUrls.has(sender.url) && !observed.frames.some(frame => frame.frameId === sender.frameId)) observed.frames.push(sender);
      }
      return observed.frames;
    };
    collectFailure = async () => ({ frames: await metadata(url()), probes: await evaluate(cdp, options.sessionId, `chrome.tabs.query({}).then(async tabs => {
      const tab = tabs.find(tab => tab.url === ${JSON.stringify(url())});
      const frames = await chrome.webNavigation.getAllFrames({tabId:tab.id});
      return Promise.all(frames.filter(f => f.parentDocumentId && !frames.some(p => p.documentId === f.parentDocumentId)).map(async child => {
        try { return await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[child.parentDocumentId]},world:'ISOLATED',func:()=>({url:location.href,parentUrl:parent.location.href})}); }
        catch (error) { return {frameId:child.parentFrameId,documentId:child.parentDocumentId,error:String(error)}; }
      }));
    })`, {awaitPromise:true}) });
    await save(config());
    const fs = await filesystem(cdp, true);
    if (nativeFilesystem.blocked) {
      check('filesystem 两个浏览器均明确拒绝导航（不计作扩展覆盖）', fs.blocked,
        `native=${nativeFilesystem.blocked} extension=${fs.blocked}`);
      console.log('· filesystem 导航：浏览器不支持，未执行该文档内的更新/导航/BFCache 检查');
    } else {
      check('filesystem 正常文档继承规则', matches(fs.report, tokyo), JSON.stringify(fs));
    }
    const page = await openPageStable(cdp, url());
    fixturePage = page;
    const initial = await ready(cdp, page, (s) => frameKinds.every((kind) => matches(s.reports[kind], tokyo)), '三类 opaque frame 首次生效');
    for (const kind of frameKinds) check(`${kind} 继承父域语言及时区`, matches(initial.reports[kind], tokyo));
    const firstMetadata = await metadata(url());
    const blobDocument = firstMetadata.find(f => f.url.startsWith('blob:'));
    evidence.programmaticBlobProbe = (await collectFailure()).probes;
    check('浏览器发现 blob 文档，nested data 的父 documentId 指向该文档', blobDocument?.documentId && firstMetadata.some(f => f.url.startsWith('data:') && f.parentDocumentId === blobDocument.documentId));

    // 同一个 iframe 元素先跨到独立子域，再回到新的 opaque 文档。
    for (const kind of ['blob', 'data']) {
      const old = (await snapshot(cdp, page)).reports[kind];
      const oldMeta = await metadata(url());
      await evaluate(cdp, page.sessionId, `__navigateOpaque(${JSON.stringify(kind)}, 'http')`, { awaitPromise: true });
      const web = await ready(cdp, page, (s) => s.reports[kind]?.href.startsWith('http:') && matches(s.reports[kind], paris), `${kind} 转到独立子域`);
      const webMeta = await metadata(url());
      await evaluate(cdp, page.sessionId, `__navigateOpaque(${JSON.stringify(kind)})`, { awaitPromise: true });
      const opaque = await ready(cdp, page, (s) => s.reports[kind]?.href.startsWith(`${kind}:`) && matches(s.reports[kind], tokyo), `${kind} 新文档继承父域`);
      const newMeta = await metadata(url());
      const before = oldMeta.find((f) => f.url === old.href);
      const middle = webMeta.find((f) => f.url === web.reports[kind].href);
      const after = newMeta.find((f) => f.url === opaque.reports[kind].href);
      const identity = before && middle && after && before.frameId === middle.frameId && middle.frameId === after.frameId
        && before.documentId !== middle.documentId && middle.documentId !== after.documentId && before.documentId !== after.documentId;
      check(`${kind} 同 frame 跨导航更换 documentId、按新文档生效`, identity && old.token !== opaque.reports[kind].token);
      evidence.navigation.push({ kind, before, middle, after });
    }
    await save(config(la.timezone));
    const hot = await ready(cdp, page, (s) => frameKinds.every((kind) => matches(s.reports[kind], la)), 'opaque 时区热更新');
    for (const kind of frameKinds) check(`${kind} 已创建文档热更新`, matches(hot.reports[kind], la));

    // 顶层 A→B→back，必须由真实 pageshow.persisted 及稳定 documentId 证明命中缓存。
    for (const changed of [false, true]) {
      const before = await snapshot(cdp, page);
      const beforeMeta = await metadata(url());
      await cdp.send('Page.navigate', { url: OTHER }, page.sessionId);
      await waitFor(() => evaluate(cdp, page.sessionId, `location.href === ${JSON.stringify(OTHER)}`), { label: '离开 opaque 页' });
      if (changed) await save(config(tokyo.timezone));
      await evaluate(cdp, page.sessionId, 'history.back()');
      const expected = changed ? tokyo : la;
      const after = await ready(cdp, page, (s) => s.token === before.token && s.persisted && frameKinds.every((k) => s.reports[k]?.persisted && matches(s.reports[k], expected)), 'opaque BFCache 恢复及值校准');
      const afterMeta = await metadata(url());
      check(`BFCache ${changed ? '冻结时配置已变' : '配置未变'}：顶层与三个 frame 真实恢复`, after.persisted && frameKinds.every((k) => before.reports[k].token === after.reports[k].token && after.reports[k].shows > before.reports[k].shows));
      check(`BFCache ${changed ? '已变' : '未变'}：documentId 保持，当前可查父边无冲突`, beforeMeta.every((f) => afterMeta.some((n) => n.frameId === f.frameId && n.documentId === f.documentId && (n.parentDocumentId === undefined || n.parentDocumentId === f.parentDocumentId))));
      console.log(`· BFCache ${changed ? '已变' : '未变'}：${afterMeta.filter(f => f.source === 'scripting-discovery').length} 个文档由 scripting 发现；另有 ${afterMeta.filter(f => f.source === 'runtime-sender').length} 个身份来自浏览器 sender，父规则重新解析`);
      evidence.bfcache.push({ changed, before, after, beforeMeta, afterMeta });
    }
    // 清除只关闭时区，避免 DNR 的语言变化主动刷新标签页掩盖同文档 clear。
    const beforeClear = await snapshot(cdp, page);
    const clear = config(tokyo.timezone);
    clear.globalProfile.timezone.enabled = false;
    await save(clear);
    const cleared = await ready(cdp, page, (s) => frameKinds.every((k) => s.reports[k]?.timezone === native.timezone), '同文档时区 clear');
    for (const kind of frameKinds) check(`${kind} clear 恢复原生时区，语言保留`, cleared.reports[kind].timezone === native.timezone && cleared.reports[kind].language === tokyo.language && cleared.reports[kind].token === beforeClear.reports[kind].token);

    const restartWorker = async (record) => {
          const versions = new Map();
          const offVersions = cdp.on(message => {
            if (message.sessionId === options.sessionId && message.method === 'ServiceWorker.workerVersionUpdated') {
              for (const version of message.params.versions) versions.set(version.versionId, version);
            }
          });
          try {
            await cdp.send('ServiceWorker.enable', {}, options.sessionId);
            const version = await waitFor(() => [...versions.values()].find(v => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && v.runningStatus === 'running'), { label: '扩展 SW version' });
            record.oldWorker = worker.targetId;
            await detachObserver();
            await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId }, options.sessionId);
            await waitFor(async () => !(await cdp.send('Target.getTargets')).targetInfos.some(t => t.targetId === record.oldWorker), { label: '旧扩展 SW 已停止' });
            // 用管理页正常消息唤醒；不重载扩展或页面，不修改后台内存或浏览器限制。
            await send({ action: 'getSiteConfig' });
            await attachObserver();
            record.newWorker = worker.targetId;
            check(`${record.stage}：SW 真实停止后由普通消息唤醒新实例`, record.newWorker !== record.oldWorker);
          } finally {
            offVersions();
            await cdp.send('ServiceWorker.disable', {}, options.sessionId);
          }
    };
    if (argv.recovery) {
      const stages = argv.recovery === 'all' ? ['restart', 'eviction', 'quota'] : [String(argv.recovery)];
      for (const stage of stages) {
        if (!['restart', 'eviction', 'quota'].includes(stage)) throw new Error(`unknown recovery stage: ${stage}`);
        await save(config());
        let before = await ready(cdp, page, s => frameKinds.every(k => matches(s.reports[k], tokyo)), '恢复测试基线');
        let beforeMeta = await metadata(url());
        const currentKinds = stage === 'quota' ? [...frameKinds, 'quota-data'] : frameKinds;
        const evidenceUsage = () => evaluate(cdp, options.sessionId, `chrome.storage.session.get(null).then(async stored => { const keys=Object.keys(stored).filter(k=>k.startsWith('vanishgeo.frame-')); return {keys:keys.length,bytes:await chrome.storage.session.getBytesInUse(keys)}; })`, { awaitPromise:true });
        const record = { stage, before, beforeMeta, evidenceBefore:await evidenceUsage() };
        evidence.recovery.push(record);
        try {
        if (stage === 'restart') {
          await restartWorker(record);
        } else if (stage === 'eviction') {
          // 同一普通 iframe 顺序创建 505 个 data 文档；观察到真实应用后再继续，
          // 使两个 500 项 FIFO 都淘汰初始文档，不直接触碰生产缓存或降低上限。
          for (let index = 0; index < 505; index++) {
            await sleep(70); // 遵守浏览器导航速率限制，不使用禁用保护的启动参数。
            await evaluate(cdp, page.sessionId, `(() => {
              if (!window.__opaqueChurnListener) {
                window.__opaqueChurnListener = event => { if (event.data?.fixture === 'opaque-cache-churn') __opaque.churn = event.data; };
                addEventListener('message', __opaqueChurnListener);
              }
              let frame = document.getElementById('opaque-churn');
              if (!frame) { frame=document.createElement('iframe'); frame.id='opaque-churn'; document.body.appendChild(frame); }
              const html = '<script>setInterval(()=>parent.postMessage({fixture:"opaque-cache-churn",index:${index},language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone},"*"),5);<\/script>';
              frame.src='data:text/html,'+encodeURIComponent(html);
            })()`);
            await waitFor(() => evaluate(cdp, page.sessionId, `__opaque.churn?.index === ${index} && __opaque.churn.language === 'ja-JP' && __opaque.churn.timezone === 'Asia/Tokyo'`), { interval: 10, timeout: 15000, label: `普通 data 文档 ${index} 已生效` });
            if ((index + 1) % 100 === 0) console.log(`· 普通 data 导航淘汰进度 ${index + 1}/505`);
          }
          await evaluate(cdp, page.sessionId, "document.getElementById('opaque-churn').remove(); removeEventListener('message', __opaqueChurnListener); delete window.__opaqueChurnListener");
          record.churnDocuments = 505;
          check('505 个普通 data 文档均实际生效，超过两个 500 项内存缓存上限', true);
          record.evidenceAfter = await evidenceUsage();
          check('普通历史导航不增加后台父边持久状态', record.evidenceAfter.keys === record.evidenceBefore.keys && record.evidenceAfter.bytes === record.evidenceBefore.bytes);
        } else {
          record.quota = await evaluate(cdp, options.sessionId, `(async () => {
            const name='vanishgeo.opaque-regression.quota-fill';
            let low=0, high=chrome.storage.session.QUOTA_BYTES, rejections=0, error='';
            const before=await chrome.storage.session.getBytesInUse(null);
            while (low < high) {
              const middle=Math.ceil((low+high)/2);
              try { await chrome.storage.session.set({[name]:'x'.repeat(middle)}); low=middle; }
              catch (failure) { rejections++; error=String(failure); high=middle-1; }
            }
            return {before,after:await chrome.storage.session.getBytesInUse(null),fillerLength:low,rejections,error};
          })()`, { awaitPromise:true });
          check('真实10MB共享session配额已触发浏览器拒绝', record.quota.rejections > 0 && /quota|QUOTA_BYTES/i.test(record.quota.error));
          // 创建新文档，证明配额已满时仍能签发新父边证据；不降低生产配额或删其他key。
          await evaluate(cdp, page.sessionId, "__navigateOpaque('quota-data','data')", {awaitPromise:true});
          before = await ready(cdp, page, s => currentKinds.every(k => matches(s.reports[k],tokyo)), '真实配额耗尽后新data仍能生效');
          beforeMeta = await metadata(url());
          record.fresh = before;
          check('配额耗尽后新data文档正常继承父规则', matches(before.reports['quota-data'],tokyo));
          await restartWorker(record);
        }
        await save(config(la.timezone));
        const updated = await ready(cdp, page, s => currentKinds.every(k => matches(s.reports[k], la)), `${stage} 后全部 opaque 更新`);
        const updatedMeta = await metadata(url());
        check(`${stage} 后 blob/data/nested-data 同文档热更新`, currentKinds.every(k => updated.reports[k].token === before.reports[k].token)
          && beforeMeta.every(f => updatedMeta.some(n => n.frameId === f.frameId && n.documentId === f.documentId)));
        record.updated = updated;
        record.updatedMeta = updatedMeta;
        // 再冻结 A、在 B 修改配置后恢复；恢复时缺失导航状态，不能只证明活动页更新。
        await cdp.send('Page.navigate', { url: OTHER }, page.sessionId);
        await waitFor(() => evaluate(cdp, page.sessionId, `location.href === ${JSON.stringify(OTHER)}`), { label: '恢复测试离开 A' });
        await save(config(tokyo.timezone));
        await evaluate(cdp, page.sessionId, 'history.back()');
        const restored = await ready(cdp, page, s => s.token === before.token && s.persisted && currentKinds.every(k => s.reports[k]?.persisted && matches(s.reports[k], tokyo)), `${stage} 后真实 BFCache 恢复`);
        check(`${stage} 后 BFCache 保持原文档并应用当前配置`, currentKinds.every(k => restored.reports[k].token === before.reports[k].token));
        record.restored = restored;
        const clearAgain = config(); clearAgain.globalProfile.timezone.enabled = false;
        await save(clearAgain);
        const clearedAgain = await ready(cdp, page, s => currentKinds.every(k => s.reports[k]?.timezone === native.timezone && s.reports[k]?.language === tokyo.language), `${stage} 后同文档 clear`);
        check(`${stage} 后全部 opaque 同文档 clear 并保留语言`, currentKinds.every(k => clearedAgain.reports[k].token === before.reports[k].token));
        record.cleared = clearedAgain;
        } finally {
          if (stage === 'quota') await evaluate(cdp,options.sessionId,`chrome.storage.session.remove('vanishgeo.opaque-regression.quota-fill')`,{awaitPromise:true});
        }
      }
    }
    } finally {
      if (workerSession) await detachObserver();
    }
  });
} finally {
  await new Promise((done) => server.close(done));
  if (argv.evidence) writeFileSync(String(argv.evidence), `${JSON.stringify({ results, evidence }, null, 2)}\n`);
}
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exitCode = failed.length ? 1 : 0;
