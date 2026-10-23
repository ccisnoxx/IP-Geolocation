window.vg039 = await (async () => {
  if (location.href !== chrome.runtime.getURL('options/options.html')) {
    throw new Error('请在 VanishGeo 选项页的 Console 执行，不在 service worker Console 执行');
  }
  function canonical(v) { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; }
  async function hash(v) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(v)))); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''); }
  const original = structuredClone((await chrome.storage.local.get('siteSpoofConfig')).siteSpoofConfig);
  const originalHash = "a489d3c7cc1600d5ca6e4386e1859287178aa823fca233ea78e14787241e0aca";
  if (await hash(original) !== originalHash) throw new Error('当前配置已变化，未建立临时副本；先停止测试');
  const allowed = ["a489d3c7cc1600d5ca6e4386e1859287178aa823fca233ea78e14787241e0aca","af7310eabc1cab6c629308bda4ae429871a341e8727fdab549772570454ff202","0edc211ac05d81809d49546cd053076ed50a83b2d820a05e50ad400ab42850c9","83df3c59e9853286a9846ae95f9b15baa6000d4dd5f05c2ac28eb51d5e77af21"];
  const probeUrl = "http://127.0.0.1:53832/parent";
  async function readback(probeUrl) {
  function canonical(v) { return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v; }
  async function hash(v) { const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v))));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join(''); }
  const [u,c,d,s,local,session,rtc,loopbackTabs]=await Promise.all([chrome.userScripts.getScripts(),chrome.scripting.getRegisteredContentScripts(),chrome.declarativeNetRequest.getDynamicRules(),chrome.declarativeNetRequest.getSessionRules(),chrome.storage.local.get('siteSpoofConfig'),chrome.storage.session.get('runtimeSyncMetadata'),chrome.privacy.network.webRTCIPHandlingPolicy.get({}),chrome.tabs.query({url:'http://127.0.0.1/*'})]);
  const config=local.siteSpoofConfig, r=session.runtimeSyncMetadata?.report;
  if(!config||config.schemaVersion!==3||!r||!Array.isArray(session.runtimeSyncMetadata.pendingReloads)) throw new Error('配置或同步报告尚未确认');
  const probe=loopbackTabs.filter(x=>x.url===probeUrl);
  const owned=d.filter(x=>x.id>=40000&&x.id<=49999).sort((a,b)=>a.id-b.id);
  return {configHash:await hash(config),profileHash:await hash(config.exitLocationProfiles),masterEnabled:config.masterEnabled,webRtcMode:config.webRtc.globalMode,rtcPolicy:rtc.value,rtcControl:rtc.levelOfControl,
    verified:config.exitLocationProfiles.filter(x=>x.verification==='verified').length,bound:config.rules.filter(x=>x.exitLocationProfileId!==null).length,
    probeTabs:probe.length,probePageDebt:session.runtimeSyncMetadata.pendingReloads.filter(x=>probe.some(t=>t.id===x.tabId)&&(!x.surfaces||x.surfaces.includes('page'))).length,
    page:u.filter(x=>x.id.startsWith('vanishgeo-language-timezone-')).length,geo:u.filter(x=>x.id.startsWith('vanishgeo-geolocation-')).length,font:c.filter(x=>x.id.startsWith('vanishgeo-font-exposure-')).length,
    legacy:c.filter(x=>x.id==='vanishgeo-runtime-init').length,dynamic:owned.length,session:s.filter(x=>x.id>=30000&&x.id<=39999).length,headerHash:await hash(owned),
    pageState:r.pageRuntime?.state??'unknown',geoState:r.geolocationRuntime?.state??'unknown',fontState:r.fontRuntime?.state??'unknown',
    pageCount:r.pageRuntime?.registeredRuleCount??null,geoCount:r.geolocationRuntime?.registeredRuleCount??null,fontCount:r.fontRuntime?.registeredRuleCount??null,
    pageReload:r.pageRuntime?.reloadRequired??false,status:r.status,headers:r.components.headers?.status??'unknown',content:r.components.contentScripts.status,webrtc:r.components.webrtc.status};
}
  async function restore() {
    const current = (await chrome.storage.local.get('siteSpoofConfig')).siteSpoofConfig;
    if (!allowed.includes(await hash(current))) throw new Error('当前配置不属于已核验的测试状态，未执行恢复；先反馈只读摘要');
    const response = await chrome.runtime.sendMessage({ action: 'setSiteConfig', config: structuredClone(original) });
    if (response?.saved !== true) throw new Error('普通保存接口尚未确认恢复，请保留本页并反馈');
    const result = await readback(probeUrl);
    if (result.configHash !== originalHash) throw new Error('恢复后完整配置摘要不一致，请保留本页并反馈');
    return result;
  }
  return Object.freeze({ read: () => readback(probeUrl), restore });
})();
console.log(JSON.stringify(await window.vg039.read(), null, 2));
