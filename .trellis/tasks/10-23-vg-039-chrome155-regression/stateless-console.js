// 本轮验收临时命令：初始化与read只读；仅显式restore调用既有普通保存接口。
// 不在页面内存保存原始配置；从已核验状态逆变换，并在写入前确认完整原始摘要。
window.vg039 = (() => {
  if (location.href !== chrome.runtime.getURL('options/options.html')) {
    throw new Error('请在 VanishGeo 选项页顶层 Console 执行');
  }
  function canonical(v) { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; }
  async function hash(v) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(v)))); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''); }
  const originalHash = "a489d3c7cc1600d5ca6e4386e1859287178aa823fca233ea78e14787241e0aca";
  const allowed = ["a489d3c7cc1600d5ca6e4386e1859287178aa823fca233ea78e14787241e0aca", "6ebf2314f62728deeec4be29f5eb70b37de371f604ae39d99ac9edeb88b980e9", "444e684acaa5605fc17dd2a32893d41f8359b53de58eeb925a3fdb2bca89034f", "f52f6f1b64068e9a4b57d383bf91705abb120f432647a1b3b4a7413791924804", "e8667c910d130b009acf5f6a30f824f387ba826c3f4b45417b79883e75461cca", "9b91892532a67c2fc2e356c733bc712eb4bd84757d11055475f726f91e558c17", "2c0eb1b545c206aaa317d54a8a230b55a99b39f5895484b6b59080f606b9db9e", "cd7db2c0cbbdaeafd6d878f231a68a615206d4010453f7520fa762c998da42c8", "a8548113da3661da6e8c0f607d80a83feaea5b5bdcb18894a3e9d60e0a83cf3a"];
  const probeUrl = "http://127.0.0.1:57113/parent";
  async function readback(probeUrl) {
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
    if (!allowed.includes(await hash(current))) throw new Error('当前配置不属于已核验状态，未执行恢复；请反馈只读摘要');
    const original = structuredClone(current);
    original.rules = original.rules.filter(rule => rule.domain !== 'localhost');
    Object.assign(original.globalProfile.timezone, { enabled: true, mode: 'auto', timezone: '' });
    Object.assign(original.globalProfile.geolocation, { enabled: true, mode: 'auto', latitude: null, longitude: null, randomize: true });
    original.globalProfile.language.enabled = true;
    original.fontExposure.enabled = true;
    if (await hash(original) !== originalHash) throw new Error('逆变换未得到完整原始配置，未执行恢复');
    const response = await chrome.runtime.sendMessage({ action: 'setSiteConfig', config: original });
    if (response?.saved !== true) throw new Error('普通保存接口未确认恢复，请反馈错误');
    const result = await readback(probeUrl);
    if (result.configHash !== originalHash) throw new Error('恢复后完整配置摘要不一致，请保留现场并反馈');
    return result;
  }
  return Object.freeze({ read: () => readback(probeUrl), restore });
})();
console.log(JSON.stringify(await window.vg039.read(), null, 2));
