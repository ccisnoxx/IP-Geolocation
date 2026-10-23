// 本轮人工执行的配置切换命令；通过既有普通保存接口写入，不是只读命令。
// 仅有off与restore两步；同时关闭四项后，等代理完成网页采样再恢复。
console.log(JSON.stringify(await (async () => {
  const phase = 'off';
  if (location.href !== chrome.runtime.getURL('options/options.html')) throw new Error('请在VanishGeo选项页顶层Console执行');
  function canonical(v) { return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v; }
  async function hash(v) { const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v))));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join(''); }
  const hashes = {"baseline": "9b91892532a67c2fc2e356c733bc712eb4bd84757d11055475f726f91e558c17", "off": "b5ff0f1808dce3c3be8cffc0595db4e9177a8d33ab70e9107f2b2589bba8c7dc", "restore": "a489d3c7cc1600d5ca6e4386e1859287178aa823fca233ea78e14787241e0aca"};
  const probeUrl = "http://127.0.0.1:57113/parent";
  async function snapshot() {
  const [u,c,d,s,local,session,rtc,loopbackTabs]=await Promise.all([chrome.userScripts.getScripts(),chrome.scripting.getRegisteredContentScripts(),chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules(),chrome.storage.local.get('siteSpoofConfig'),chrome.storage.session.get('runtimeSyncMetadata'),chrome.privacy.network.webRTCIPHandlingPolicy.get({}),chrome.tabs.query({url:'http://127.0.0.1/*'})]);
  const config=local.siteSpoofConfig, r=session.runtimeSyncMetadata?.report;
  if(!config||config.schemaVersion!==3||!r||!Array.isArray(session.runtimeSyncMetadata.pendingReloads)) throw new Error('配置或同步报告尚未确认');
  const probe=loopbackTabs.filter(x=>x.url===probeUrl);
  const owned=d.filter(x=>x.id>=40000&&x.id<=49999).sort((a,b)=>a.id-b.id);
  return {config, summary: {configHash:await hash(config),profileHash:await hash(config.exitLocationProfiles),masterEnabled:config.masterEnabled,webRtcMode:config.webRtc.globalMode,rtcPolicy:rtc.value,rtcControl:rtc.levelOfControl,
    verified:config.exitLocationProfiles.filter(x=>x.verification==='verified').length,bound:config.rules.filter(x=>x.exitLocationProfileId!==null).length,
    probeTabs:probe.length,probePageDebt:session.runtimeSyncMetadata.pendingReloads.filter(x=>probe.some(t=>t.id===x.tabId)&&(!x.surfaces||x.surfaces.includes('page'))).length,
    page:u.filter(x=>x.id.startsWith('vanishgeo-language-timezone-')).length,geo:u.filter(x=>x.id.startsWith('vanishgeo-geolocation-')).length,font:c.filter(x=>x.id.startsWith('vanishgeo-font-exposure-')).length,
    legacy:c.filter(x=>x.id==='vanishgeo-runtime-init').length,dynamic:owned.length,session:s.filter(x=>x.id>=30000&&x.id<=39999).length,headerHash:await hash(owned),
    pageState:r.pageRuntime?.state??'unknown',geoState:r.geolocationRuntime?.state??'unknown',fontState:r.fontRuntime?.state??'unknown',
    pageCount:r.pageRuntime?.registeredRuleCount??null,geoCount:r.geolocationRuntime?.registeredRuleCount??null,fontCount:r.fontRuntime?.registeredRuleCount??null,
    pageReload:r.pageRuntime?.reloadRequired??false,status:r.status,headers:r.components.headers?.status??'unknown',content:r.components.contentScripts.status,webrtc:r.components.webrtc.status}};
}
  if (!['off','restore'].includes(phase)) throw new Error('未知测试阶段，未保存');
  const {config: current, summary: before} = await snapshot();
  if (phase === 'restore' ? !Object.values(hashes).includes(before.configHash) : before.configHash !== hashes.baseline) throw new Error('当前配置不属于本阶段已核验状态，未保存；请反馈错误');
  const draft = structuredClone(current);
  if (phase === 'off') {
    for (const signal of ['language','timezone','geolocation']) draft.globalProfile[signal].enabled = false;
    draft.fontExposure.enabled = false;
  } else {
    draft.rules = draft.rules.filter(rule => rule.domain !== 'localhost');
    for (const signal of ['language','timezone','geolocation']) draft.globalProfile[signal].enabled = true;
    draft.fontExposure.enabled = true;
  }
  if (await hash(draft) !== hashes[phase]) throw new Error('完整候选摘要不符，未保存');
  const response = await chrome.runtime.sendMessage({action:'setSiteConfig',config:draft});
  if (response?.saved !== true) throw new Error('普通保存接口未确认，停止后续步骤并反馈错误');
  const {summary: after} = await snapshot();
  if (after.configHash !== hashes[phase]) throw new Error('保存后完整配置摘要不符，停止后续步骤并反馈错误');
  return {phase,before,after};
})(), null, 2));
