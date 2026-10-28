import './popup.css';
import { exitProfileSignals, findEnvironmentPreset, presetSignals, type QuickSetSignals } from '../shared/environment-presets';
import { isRuntimeInjectionPaused, renderRuntimeSyncReport, renderRuntimeSyncPending, renderFontRuntimeStatus } from '../shared/runtime-sync';
import { getPageRuntimeProfile } from '../shared/config-resolver';
import type { RuntimeSyncReport } from '../shared/types';
import {
  DEFAULT_FONT_EXPOSURE,
  VENDOR_SOFTWARE_FONT_FAMILIES,
  createInitialConfig,
  createRule,
  getDefaultLanguages,
  getTimezoneOffsetMinutes,
  normalizeConfig,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeTimezone,
  normalizeWebRtc,
  parseWebRtcMode
} from '../shared/config-model';
import { deriveCurrentSiteStatus } from '../shared/ui-state';
import { ruleListToText, rulesFromText } from '../shared/rule-list';
import type { GeolocationHistory, SiteSpoofConfig } from '../shared/types';

const runtimeSyncStatusEl = document.getElementById('runtimeSyncStatus') as HTMLElement;
const fontExposureStatusEl = document.getElementById('fontExposureStatus') as HTMLElement;
const retryRuntimeSyncBtn = document.getElementById('retryRuntimeSync') as HTMLButtonElement;

const globalEnabledEl = document.getElementById('globalEnabled') as HTMLInputElement;
const debugModeEl = document.getElementById('debugMode') as HTMLInputElement;
const globalStatusEl = document.getElementById('globalStatus') as HTMLElement;
const currentSiteEl = document.getElementById('currentSite') as HTMLElement;
const currentSitePresetEl = document.getElementById('currentSitePreset') as HTMLSelectElement;
const siteStatusBadgeEl = document.getElementById('siteStatusBadge') as HTMLElement;
const siteStatusDetailEl = document.getElementById('siteStatusDetail') as HTMLElement;
const enableSiteBtn = document.getElementById('enableSite') as HTMLButtonElement;
const disableSiteBtn = document.getElementById('disableSite') as HTMLButtonElement;
const ruleListEl = document.getElementById('ruleList') as HTMLTextAreaElement;
const openOptionsHeaderBtn = document.getElementById('openOptionsHeader') as HTMLButtonElement;
const quickSetExitProfileEl = document.getElementById('quickSetExitProfile') as HTMLSelectElement;
const applyQuickSetExitEl = document.getElementById('applyQuickSetExit') as HTMLButtonElement;
const quickSetExitHintEl = document.getElementById('quickSetExitHint') as HTMLElement;
const quickSetCards = Array.from(document.querySelectorAll<HTMLButtonElement>('.profile-card[data-preset]'));
const geolocationEnabledEl = document.getElementById('geolocationEnabled') as HTMLInputElement;
const latitudeEl = document.getElementById('latitude') as HTMLInputElement;
const longitudeEl = document.getElementById('longitude') as HTMLInputElement;
const accuracyEl = document.getElementById('accuracy') as HTMLInputElement;
const randomizeEl = document.getElementById('randomize') as HTMLInputElement;
const randomRadiusMetersEl = document.getElementById('randomRadiusMeters') as HTMLInputElement;
const spoofPermissionEl = document.getElementById('spoofPermission') as HTMLInputElement;
const saveCoordinateBtn = document.getElementById('saveCoordinate') as HTMLButtonElement;
const currentExitProfileEl = document.getElementById('currentExitProfile') as HTMLElement;
const currentExitProfileSelectEl = document.getElementById('currentExitProfileSelect') as HTMLSelectElement;
const manageExitProfilesBtn = document.getElementById('manageExitProfiles') as HTMLButtonElement;
const intlModeEl = document.getElementById('intlMode') as HTMLSelectElement;
const timezoneEnabledEl = document.getElementById('timezoneEnabled') as HTMLInputElement;
const timezoneEl = document.getElementById('timezone') as HTMLInputElement;
const utcOffsetEl = document.getElementById('utcOffset') as HTMLInputElement;
const languageEnabledEl = document.getElementById('languageEnabled') as HTMLInputElement;
const languageEl = document.getElementById('language') as HTMLInputElement;
const languagesEl = document.getElementById('languages') as HTMLInputElement;
const webrtcEnabledEl = document.getElementById('webrtcEnabled') as HTMLInputElement;
const webrtcPolicyEl = document.getElementById('webrtcPolicy') as HTMLSelectElement;
const fontExposureEnabledEl = document.getElementById('fontExposureEnabled') as HTMLInputElement;
const fontExposureModeEl = document.getElementById('fontExposureMode') as HTMLSelectElement;
const fontExposureVendorFamiliesEl = document.getElementById('fontExposureVendorFamilies') as HTMLTextAreaElement;
const fontExposureBlockedFamiliesEl = document.getElementById('fontExposureBlockedFamilies') as HTMLTextAreaElement;
const fontExposureVendorGroupEl = document.getElementById('fontExposureVendorGroup') as HTMLElement;
const fontExposureCustomGroupEl = document.getElementById('fontExposureCustomGroup') as HTMLElement;
const resetFontsBtn = document.getElementById('resetFonts') as HTMLButtonElement;
const openOptionsBtn = document.getElementById('openOptions') as HTMLButtonElement;
const openLeakTestBtn = document.getElementById('openLeakTest') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const autoSaveToast = document.getElementById('autoSaveToast') as HTMLElement;

let currentConfig: SiteSpoofConfig = createInitialConfig();
let currentHostname = '';
let currentDisableDomain: string | null = null;
let currentRuleId: string | null = null;
let currentTabState: { domain: string; scriptable: boolean } | null = null;
let autoSaveTimer: number | null = null;

let pendingConfigSaves = 0;
let configSaveFailed = false;
function sendRuntimeMessage<T = any>(message: Record<string, unknown>): Promise<T> {
  const saving = message.action === 'setSiteConfig';
  if (saving) {
    pendingConfigSaves++;
    renderRuntimeSyncPending(runtimeSyncStatusEl);
    autoSaveToast.textContent = '正在保存并同步…';
    autoSaveToast.dataset.status = 'pending';
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (saving) pendingConfigSaves--;
      if (chrome.runtime.lastError) {
        if (saving) configSaveFailed = true;
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.status === 'error') {
        if (saving) configSaveFailed = true;
        reject(new Error(response?.message || '扩展后台返回未知错误'));
        return;
      }
      if (saving) configSaveFailed = false;
      const report = response.syncReport || response.state?.syncReport;
      if (report && !configSaveFailed) {
        if (pendingConfigSaves) renderRuntimeSyncPending(runtimeSyncStatusEl);
        else renderRuntimeSyncReport(runtimeSyncStatusEl, report, 'compact');
        renderFontRuntimeStatus(fontExposureStatusEl, report, 'compact');
      }
      const config = response.config || (message.action === 'getExtensionState' || message.action === 'getCurrentTabState' ? response.state?.config : undefined);
      if (currentTabState && (config || report)) renderCurrentSiteStatus({ ...currentTabState, config: config || currentConfig, syncReport: report });
      resolve(response);
    });
  });
}

function showOperationError(error: unknown): void {
  runtimeSyncStatusEl.textContent = `操作结果未确认：${error instanceof Error ? error.message : String(error)}${configSaveFailed ? ' 请重新保存配置；重试同步只对账已保存的配置，不能确认本次关闭。' : ''}`;
  runtimeSyncStatusEl.dataset.status = 'failed';
  if (configSaveFailed) {
    autoSaveToast.textContent = '保存结果未确认，请重新保存';
    autoSaveToast.dataset.status = 'failed';
  }
  renderFontRuntimeStatus(fontExposureStatusEl, undefined, 'compact');
}

function runUiTask(task: Promise<unknown>): void { void task.catch(showOperationError); }

async function retryRuntimeSync(): Promise<void> {
  retryRuntimeSyncBtn.disabled = true;
  try { await sendRuntimeMessage({ action: 'reconcileRuntime' }); }
  finally { retryRuntimeSyncBtn.disabled = false; }
}

function showAutoSaveToast(report?: RuntimeSyncReport): void {
  if (pendingConfigSaves || configSaveFailed) return;
  autoSaveToast.textContent = isRuntimeInjectionPaused(report) ? '已保存，语言/时区已暂停'
    : report?.status !== 'ok' ? '已保存，部分同步未完成'
      : (report.pageRuntime?.reloadRequired || report.fontRuntime?.reloadRequired || report.geolocationRuntime?.reloadRequired) ? '已保存，请重新加载网页'
        : report.pageRuntime ? '已保存并同步' : '已保存，同步状态待确认';
  autoSaveToast.dataset.status = report?.status || 'partial';
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveToast.classList.add('show');
  autoSaveTimer = window.setTimeout(() => {
    autoSaveToast.classList.remove('show');
    autoSaveTimer = null;
  }, 2000);
}

function updateGlobalStatus(): void {
  globalStatusEl.textContent = globalEnabledEl.checked ? '总开关已开启' : '总开关已关闭';
}

function setStatusBadgeClass(kind: string): void {
  siteStatusBadgeEl.className = `status-badge ${kind}`;
}

function renderCurrentSiteStatus(state: any): void {
  const config = normalizeConfig(state.config || currentConfig);
  const status = deriveCurrentSiteStatus({
    domain: state.domain || '',
    scriptable: Boolean(state.scriptable),
    config,
    ...getPageRuntimeProfile(config, state.domain || ''),
    syncReport: state.syncReport
  });
  currentDisableDomain = status.disableDomain;
  siteStatusBadgeEl.textContent = status.label;
  siteStatusDetailEl.textContent = status.detail;
  setStatusBadgeClass(status.kind);
  enableSiteBtn.disabled = !status.canEnable;
  disableSiteBtn.disabled = !status.canDisable;
  enableSiteBtn.textContent = status.kind === 'enabled' ? '已启用' : '启用当前网站';
  disableSiteBtn.textContent = status.disableDomain ? `关闭 ${status.disableDomain}` : '关闭当前网站';
}

function updateExitLocationProfile(config: SiteSpoofConfig): void {
  const rule = currentRuleId ? config.rules.find((item) => item.id === currentRuleId) || null : null;
  currentSitePresetEl.value = rule?.compatibilityPreset || 'full';
  currentSitePresetEl.disabled = !rule;
  currentExitProfileSelectEl.innerHTML = '';
  currentExitProfileSelectEl.append(new Option('未选择出口', ''));
  config.exitLocationProfiles
    .filter((profile) => profile.verification === 'verified')
    .forEach((profile) => currentExitProfileSelectEl.append(new Option(profile.name, profile.id)));
  currentExitProfileSelectEl.value = rule?.exitLocationProfileId || '';
  currentExitProfileSelectEl.disabled = !rule;
  const profile = rule?.exitLocationProfileId
    ? config.exitLocationProfiles.find((item) => item.id === rule.exitLocationProfileId) || null
    : null;
  currentExitProfileEl.textContent = !rule
    ? '当前站点没有启用规则'
    : !rule.exitLocationProfileId
      ? '未选择出口；自动位置/时区需要绑定出口档案'
      : !profile
        ? `引用的出口位置档案不存在：${rule.exitLocationProfileId}`
        : `${profile.name} · ${profile.publicIp || 'IP 未验证'} · ${profile.country || '国家未知'} · ${profile.timezone || '时区未知'}`;
}

function updateTimezoneOffset(): void {
  const offset = getTimezoneOffsetMinutes(timezoneEl.value);
  utcOffsetEl.value = offset === null ? '' : String(-offset / 60);
}

function updateLanguageList(): void {
  languagesEl.value = getDefaultLanguages(languageEl.value).join(', ');
}

function updateFontExposureMode(): void {
  const custom = fontExposureModeEl.value === 'custom';
  fontExposureVendorGroupEl.hidden = custom;
  fontExposureCustomGroupEl.hidden = !custom;
}

function populateForm(config: SiteSpoofConfig): void {
  globalEnabledEl.checked = config.masterEnabled;
  debugModeEl.checked = config.debugMode;
  intlModeEl.value = config.intlMode;
  updateGlobalStatus();
  ruleListEl.value = ruleListToText(config.rules);

  const geo = config.globalProfile.geolocation;
  geolocationEnabledEl.checked = geo.enabled;
  latitudeEl.value = geo.latitude === null ? '' : String(geo.latitude);
  longitudeEl.value = geo.longitude === null ? '' : String(geo.longitude);
  accuracyEl.value = String(geo.accuracy);
  randomizeEl.checked = geo.randomize;
  randomRadiusMetersEl.value = String(geo.randomRadiusMeters);
  spoofPermissionEl.checked = geo.spoofPermission;

  const timezone = config.globalProfile.timezone;
  timezoneEnabledEl.checked = timezone.enabled;
  timezoneEl.value = timezone.timezone;
  updateTimezoneOffset();

  const language = config.globalProfile.language;
  languageEnabledEl.checked = language.enabled;
  languageEl.value = language.language;
  languagesEl.value = language.languages.join(', ');

  webrtcEnabledEl.checked = config.webRtc.globalMode !== 'default';
  webrtcPolicyEl.value = config.webRtc.globalMode;
  fontExposureEnabledEl.checked = config.fontExposure.enabled;
  fontExposureModeEl.value = config.fontExposure.mode;
  fontExposureVendorFamiliesEl.value = VENDOR_SOFTWARE_FONT_FAMILIES.join('\n');
  fontExposureBlockedFamiliesEl.value = config.fontExposure.blockedFamilies.join('\n');
  updateFontExposureMode();
  latitudeEl.placeholder = geo.mode === 'auto' ? '由当前规则的出口档案提供' : '';
  longitudeEl.placeholder = geo.mode === 'auto' ? '由当前规则的出口档案提供' : '';
  timezoneEl.placeholder = timezone.mode === 'auto' ? '由当前规则的出口档案提供' : 'UTC';
  updateExitLocationProfile(config);
}

function readForm(): SiteSpoofConfig {
  const rules = rulesFromText(ruleListEl.value, currentConfig.rules);
  return normalizeConfig({
    ...currentConfig,
    masterEnabled: globalEnabledEl.checked,
    debugMode: debugModeEl.checked,
    intlMode: intlModeEl.value as SiteSpoofConfig['intlMode'],
    rules,
    globalProfile: {
      language: normalizeLanguage({
        enabled: languageEnabledEl.checked,
        mode: 'custom',
        language: languageEl.value,
        languages: languagesEl.value.split(',').map((item) => item.trim()).filter(Boolean)
      }),
      timezone: normalizeTimezone({
        enabled: timezoneEnabledEl.checked,
        mode: timezoneEl.value ? 'manual' : 'auto',
        timezone: timezoneEl.value
      }),
      geolocation: normalizeGeolocation({
        enabled: geolocationEnabledEl.checked,
        mode: latitudeEl.value && longitudeEl.value ? 'manual' : 'auto',
        latitude: latitudeEl.value === '' ? null : Number(latitudeEl.value),
        longitude: longitudeEl.value === '' ? null : Number(longitudeEl.value),
        accuracy: Number(accuracyEl.value),
        country: currentConfig.globalProfile.geolocation.country,
        randomize: randomizeEl.checked,
        randomRadiusMeters: Number(randomRadiusMetersEl.value),
        spoofPermission: spoofPermissionEl.checked,
        history: currentConfig.globalProfile.geolocation.history
      })
    },
    webRtc: webrtcEnabledEl.checked ? normalizeWebRtc({ globalMode: parseWebRtcMode(webrtcPolicyEl.value) }) : normalizeWebRtc({ globalMode: 'default' }),
    fontExposure: {
      enabled: fontExposureEnabledEl.checked,
      canvasSpoof: currentConfig.fontExposure.canvasSpoof,
      mode: fontExposureModeEl.value as SiteSpoofConfig['fontExposure']['mode'],
      blockedFamilies: fontExposureModeEl.value === 'vendor-software'
        ? [...VENDOR_SOFTWARE_FONT_FAMILIES]
        : fontExposureBlockedFamiliesEl.value.split('\n').map((item) => item.trim()).filter(Boolean)
    }
  });
}

// 快速设置：独立区块，一次写入经纬度/语言/时区；WebRTC 与字体配置不动。
function applyQuickSetSignals(signals: QuickSetSignals, note: string): void {
  geolocationEnabledEl.checked = true;
  latitudeEl.value = String(signals.latitude);
  longitudeEl.value = String(signals.longitude);
  // 国家没有独立输入框，与新坐标一起更新 readForm 沿用的字段。
  currentConfig.globalProfile.geolocation.country = signals.country ?? '';
  timezoneEnabledEl.checked = true;
  timezoneEl.value = signals.timezone;
  languageEnabledEl.checked = true;
  if (signals.language) languageEl.value = signals.language;
  if (signals.languages.length) languagesEl.value = signals.languages.join(', ');
  updateTimezoneOffset();
  quickSetExitHintEl.textContent = note;
  runUiTask(saveChanges());
}

function renderQuickSetExitProfiles(): void {
  // 轻量 UI 夹具的元素只有 value/checked，没有真实 DOM 方法，此时跳过渲染。
  if (!quickSetExitProfileEl || typeof quickSetExitProfileEl.replaceChildren !== 'function') return;
  const verified = currentConfig.exitLocationProfiles.filter(profile => profile.verification === 'verified');
  const previous = quickSetExitProfileEl.value;
  quickSetExitProfileEl.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = verified.length
    ? '从 IP 自动配置（选择已确认出口档案）'
    : '没有已确认的出口档案，请先在完整配置里检测出口';
  quickSetExitProfileEl.appendChild(placeholder);
  for (const profile of verified) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.country || '未知地区'} · ${profile.timezone || '无时区'} · ${profile.publicIp || '无 IP'}`;
    quickSetExitProfileEl.appendChild(option);
  }
  if (verified.some(profile => profile.id === previous)) quickSetExitProfileEl.value = previous;
  quickSetExitProfileEl.disabled = verified.length === 0;
  applyQuickSetExitEl.disabled = verified.length === 0;
  quickSetExitHintEl.textContent = verified.length
    ? '出口档案的坐标与时区来自同一次已确认检测；语言只用地区常用候选，取不到就保留当前语言。'
    : '出口档案要来自一次完整检测并确认；现在没有可用档案。';
}

function applyQuickSetFromExitProfile(): void {
  const profile = currentConfig.exitLocationProfiles.find(item => item.id === quickSetExitProfileEl.value);
  if (!profile) { quickSetExitHintEl.textContent = '请先选择一个已确认的出口档案。'; return; }
  const signals = exitProfileSignals(profile, {
    language: languageEl.value, languages: languagesEl.value.split(',').map(item => item.trim()).filter(Boolean)
  });
  if (!signals) { quickSetExitHintEl.textContent = '该档案尚未确认，不能用于自动配置。'; return; }
  if (!signals.timezone) { quickSetExitHintEl.textContent = '该档案缺少有效时区，无法完整配置。'; return; }
  applyQuickSetSignals(signals, `已按出口档案「${profile.name}」配置`);
}

async function saveChanges(): Promise<void> {
  updateTimezoneOffset();
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({ action: 'setSiteConfig', config: readForm() });
  currentConfig = normalizeConfig(response.config);
  // 单测的 UI 夹具只注入白名单函数，这里按需刷新，缺函数时保持原样。
  if (typeof renderQuickSetExitProfiles === 'function') renderQuickSetExitProfiles();
  showAutoSaveToast(response.syncReport);
}

async function loadConfig(): Promise<void> {
  const response = await sendRuntimeMessage<{ state: any }>({ action: 'getCurrentTabState' });
  const state = response.state;
  currentTabState = { domain: state.domain || '', scriptable: Boolean(state.scriptable) };
  currentConfig = normalizeConfig(state.config);
  currentHostname = state.domain || '';
  currentRuleId = state.rule?.id || null;
  currentSiteEl.textContent = currentHostname || 'N/A';
  populateForm(currentConfig);
  // 单测的 UI 夹具只注入白名单函数，这里按需刷新，缺函数时保持原样。
  if (typeof renderQuickSetExitProfiles === 'function') renderQuickSetExitProfiles();
  renderCurrentSiteStatus(state);
}

async function handleEnableSite(): Promise<void> {
  if (!currentHostname) return;
  await sendRuntimeMessage({ action: 'addDomainRule', domain: currentHostname });
  await loadConfig();
}

async function handleDisableSite(): Promise<void> {
  const domain = currentDisableDomain || currentHostname;
  if (!domain) return;
  await sendRuntimeMessage({ action: 'setDomainRuleEnabled', domain, enabled: false });
  await loadConfig();
}

async function handleSaveCoordinate(): Promise<void> {
  const lat = Number(latitudeEl.value);
  const lon = Number(longitudeEl.value);
  const acc = Number(accuracyEl.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(acc)) {
    alert('无效的坐标');
    return;
  }
  const history: GeolocationHistory = { latitude: lat, longitude: lon, accuracy: acc, createdAt: Date.now() };
  currentConfig.globalProfile.geolocation.history = [
    history,
    ...currentConfig.globalProfile.geolocation.history.filter((item) => item.latitude !== lat || item.longitude !== lon)
  ].slice(0, 10);
  await saveChanges();
}

async function saveExitLocationBinding(): Promise<void> {
  if (!currentRuleId) return;
  const rule = currentConfig.rules.find((item) => item.id === currentRuleId);
  if (!rule) return;
  rule.exitLocationProfileId = currentExitProfileSelectEl.value || null;
  await saveChanges();
}

async function handleResetFonts(): Promise<void> {
  fontExposureModeEl.value = DEFAULT_FONT_EXPOSURE.mode;
  updateFontExposureMode();
  await saveChanges();
}

globalEnabledEl.addEventListener('change', () => { updateGlobalStatus(); runUiTask(saveChanges()); });
debugModeEl.addEventListener('change', () => { runUiTask(saveChanges()); });
ruleListEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
enableSiteBtn.addEventListener('click', () => { runUiTask(handleEnableSite()); });
disableSiteBtn.addEventListener('click', () => { runUiTask(handleDisableSite()); });
geolocationEnabledEl.addEventListener('change', () => { runUiTask(saveChanges()); });
latitudeEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
longitudeEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
accuracyEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
randomizeEl.addEventListener('change', () => { runUiTask(saveChanges()); });
randomRadiusMetersEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
spoofPermissionEl.addEventListener('change', () => { runUiTask(saveChanges()); });
intlModeEl.addEventListener('change', () => { runUiTask(saveChanges()); });
timezoneEnabledEl.addEventListener('change', () => { runUiTask(saveChanges()); });
timezoneEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
languageEnabledEl.addEventListener('change', () => { runUiTask(saveChanges()); });
languageEl.addEventListener('change', updateLanguageList);
applyQuickSetExitEl.addEventListener('click', () => applyQuickSetFromExitProfile());
for (const card of quickSetCards) {
  card.addEventListener('click', () => {
    const preset = findEnvironmentPreset(card.dataset.preset || '');
    if (!preset) return;
    for (const other of quickSetCards) other.setAttribute('aria-pressed', String(other === card));
    applyQuickSetSignals(presetSignals(preset), `已应用预设「${preset.name}」`);
  });
}
languageEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
languagesEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
webrtcEnabledEl.addEventListener('change', () => {
  webrtcPolicyEl.value = webrtcEnabledEl.checked ? (webrtcPolicyEl.value === 'default' ? 'strict' : webrtcPolicyEl.value) : 'default';
  runUiTask(saveChanges());
});
webrtcPolicyEl.addEventListener('change', () => {
  webrtcEnabledEl.checked = webrtcPolicyEl.value !== 'default';
  runUiTask(saveChanges());
});
fontExposureEnabledEl.addEventListener('change', () => { runUiTask(saveChanges()); });
fontExposureModeEl.addEventListener('change', () => { updateFontExposureMode(); runUiTask(saveChanges()); });
fontExposureBlockedFamiliesEl.addEventListener('blur', () => { runUiTask(saveChanges()); });
saveCoordinateBtn.addEventListener('click', () => { runUiTask(handleSaveCoordinate()); });
currentExitProfileSelectEl.addEventListener('change', () => { runUiTask(saveExitLocationBinding()); });
currentSitePresetEl.addEventListener('change', () => { runUiTask((async () => {
  const inherited = currentConfig.rules.find(rule => rule.id === currentRuleId);
  if (!inherited || !currentHostname) return;
  // 从父域继承时创建当前域名子规则，避免改变兄弟站点。
  let rule = currentConfig.rules.find(item => item.domain === currentHostname);
  if (!rule) {
    rule = { ...inherited, ...createRule(currentHostname), overrides: structuredClone(inherited.overrides),
      exitLocationProfileId: inherited.exitLocationProfileId };
    currentConfig.rules.push(rule);
  }
  rule.compatibilityPreset = currentSitePresetEl.value as NonNullable<typeof rule.compatibilityPreset>;
  ruleListEl.value = ruleListToText(currentConfig.rules);
  await saveChanges();
  await loadConfig();
})()); });
manageExitProfilesBtn.addEventListener('click', () => { runUiTask(sendRuntimeMessage({ action: 'openOptions' })); });
resetFontsBtn.addEventListener('click', () => { runUiTask(handleResetFonts()); });
openOptionsBtn.addEventListener('click', () => { runUiTask(sendRuntimeMessage({ action: 'openOptions' })); });
openOptionsHeaderBtn.addEventListener('click', () => { runUiTask(sendRuntimeMessage({ action: 'openOptions' })); });
openLeakTestBtn.addEventListener('click', () => { runUiTask(sendRuntimeMessage({ action: 'openLeakTest' })); });
resetBtn.addEventListener('click', () => {
  if (!confirm('清空全部配置、规则、出口档案和历史，关闭保护并恢复浏览器默认 WebRTC？此操作无法撤销。')) return;
  runUiTask(sendRuntimeMessage({ action: 'resetSiteConfig' }).then(loadConfig));
});

runUiTask(loadConfig());

retryRuntimeSyncBtn.addEventListener('click', () => { runUiTask(retryRuntimeSync()); });
