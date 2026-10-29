import './options.css';
import {
  DEFAULT_CONFIG,
  DEFAULT_PROFILES,
  normalizeConfig,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeTimezone,
  normalizeWebRtc
} from '../shared/config-model';
import { ruleLines, rulesFromText } from '../shared/rule-text';
import { sendRuntimeMessage } from '../shared/runtime-message';
import { describeGeoError, describeIpApplyError, formatErrorAge, geolocationModeFromInput, locationDisplay, parseCoordinateInput, utcOffsetInputValue, webRtcSelectValue } from '../shared/ui-values';
import { validateProfile } from '../shared/profile';
import type { ExitIpApplyOutcome, ExitIpSyncOutcome } from '../background/ip-sync';
import type { IpSyncConfig, LastLocation, Profile, SiteSpoofConfig } from '../shared/types';

let currentConfig: SiteSpoofConfig = normalizeConfig(DEFAULT_CONFIG);
/** 后台最近一次定位：auto 档要在表单里显示它，否则坐标/时区永远是两个空框 */
let currentLastLocation: LastLocation | null = null;
/** 上一轮 populateForm 里由 auto 档算出的显示值，readForm 用来判断"用户有没有动过" */
let autoDisplay: { latitude: string; longitude: string; timezone: string; autoGeo: boolean; autoTimezone: boolean } | null = null;

/** `getExitIpSyncState` / `checkExitIpSync` 的返回形状（后台 message-router 给） */
interface IpSyncStateResponse {
  status?: string;
  ipSync?: IpSyncConfig;
  storedIp?: string;
  lastLocation?: LastLocation | null;
  outcome?: ExitIpSyncOutcome;
  config?: SiteSpoofConfig;
}

const globalEnabledEl = document.getElementById('globalEnabled') as HTMLInputElement;
const debugModeEl = document.getElementById('debugMode') as HTMLInputElement;
const ruleListEl = document.getElementById('ruleList') as HTMLTextAreaElement;
const geolocationEnabledEl = document.getElementById('geolocationEnabled') as HTMLInputElement;
const latitudeEl = document.getElementById('latitude') as HTMLInputElement;
const longitudeEl = document.getElementById('longitude') as HTMLInputElement;
const accuracyEl = document.getElementById('accuracy') as HTMLInputElement;
const randomizeEl = document.getElementById('randomize') as HTMLInputElement;
const randomRadiusMetersEl = document.getElementById('randomRadiusMeters') as HTMLInputElement;
const spoofPermissionEl = document.getElementById('spoofPermission') as HTMLInputElement;
const noNativeCallEl = document.getElementById('noNativeCall') as HTMLInputElement;
const getFromIPBtn = document.getElementById('getFromIP') as HTMLButtonElement;
const timezoneEnabledEl = document.getElementById('timezoneEnabled') as HTMLInputElement;
const timezoneEl = document.getElementById('timezone') as HTMLInputElement;
const utcOffsetEl = document.getElementById('utcOffset') as HTMLInputElement;
const languageEnabledEl = document.getElementById('languageEnabled') as HTMLInputElement;
const languageEl = document.getElementById('language') as HTMLInputElement;
const languagesEl = document.getElementById('languages') as HTMLInputElement;
const acceptLanguageEl = document.getElementById('acceptLanguage') as HTMLInputElement;
const webrtcEnabledEl = document.getElementById('webrtcEnabled') as HTMLInputElement;
const webrtcPolicyEl = document.getElementById('webrtcPolicy') as HTMLSelectElement;
const defaultProfilesEl = document.getElementById('defaultProfiles') as HTMLElement;
const customProfilesEl = document.getElementById('customProfiles') as HTMLElement;
const siteRulesEl = document.getElementById('siteRules') as HTMLElement;
const exportConfigBtn = document.getElementById('exportConfig') as HTMLButtonElement;
const importConfigBtn = document.getElementById('importConfig') as HTMLButtonElement;
const importFileEl = document.getElementById('importFile') as HTMLInputElement;
const exportBakeBtn = document.getElementById('exportBake') as HTMLButtonElement;
const resetAllBtn = document.getElementById('resetAll') as HTMLButtonElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const saveAsCustomBtn = document.getElementById('saveAsCustom') as HTMLButtonElement;
const saveProfileModal = document.getElementById('saveProfileModal') as HTMLElement;
const settingsToastEl = document.getElementById('settingsToast') as HTMLElement;
let settingsToastTimer: number | undefined;
const newProfileNameEl = document.getElementById('newProfileName') as HTMLInputElement;
const newProfileDescriptionEl = document.getElementById('newProfileDescription') as HTMLInputElement;
const confirmSaveProfileBtn = document.getElementById('confirmSaveProfile') as HTMLButtonElement;
const cancelSaveProfileBtn = document.getElementById('cancelSaveProfile') as HTMLButtonElement;
const ipSyncEnabledEl = document.getElementById('ipSyncEnabled') as HTMLInputElement;
const ipSyncLanguageEl = document.getElementById('ipSyncLanguage') as HTMLInputElement;
const ipSyncIntervalEl = document.getElementById('ipSyncInterval') as HTMLInputElement;
const ipSyncNowBtn = document.getElementById('ipSyncNow') as HTMLButtonElement;
const ipSyncStatusEl = document.getElementById('ipSyncStatus') as HTMLElement;
const geoErrorEl = document.getElementById('geoError') as HTMLElement;
const geoErrorHintEl = document.getElementById('geoErrorHint') as HTMLElement;
const geoErrorReasonEl = document.getElementById('geoErrorReason') as HTMLElement;
const geoErrorAgeEl = document.getElementById('geoErrorAge') as HTMLElement;
const geoErrorDismissEl = document.getElementById('geoErrorDismiss') as HTMLButtonElement;


/** 「完全不调用系统定位」必须与「伪装位置权限」同开：权限回答与坐标不能各说各的 */
function syncNoNativeCallControls(): void {
  noNativeCallEl.disabled = !spoofPermissionEl.checked && !noNativeCallEl.checked;
}

function populateForm(config: SiteSpoofConfig): void {
  globalEnabledEl.checked = config.masterEnabled;
  debugModeEl.checked = config.debugMode;
  ruleListEl.value = ruleLines(config.rules);

  const geo = config.globalProfile.geolocation;
  const timezone = config.globalProfile.timezone;
  // auto 档显示实际生效的定位（lastLocation），manual 档显示配置里写死的值
  const display = locationDisplay(geo, timezone, currentLastLocation);
  autoDisplay = { ...display };
  geolocationEnabledEl.checked = geo.enabled;
  latitudeEl.value = display.latitude;
  longitudeEl.value = display.longitude;
  accuracyEl.value = String(geo.accuracy);
  randomizeEl.checked = geo.randomize;
  randomRadiusMetersEl.value = String(geo.randomRadiusMeters);
  spoofPermissionEl.checked = geo.spoofPermission;
  noNativeCallEl.checked = geo.noNativeCall !== false;
  syncNoNativeCallControls();

  timezoneEnabledEl.checked = timezone.enabled;
  timezoneEl.value = display.timezone;
  utcOffsetEl.value = utcOffsetInputValue(display.timezone);

  const language = config.globalProfile.language;
  languageEnabledEl.checked = language.enabled;
  languageEl.value = language.language;
  languagesEl.value = language.languages.join(', ');
  acceptLanguageEl.value = language.acceptLanguage;

  webrtcEnabledEl.checked = config.webRtc.globalMode !== 'default';
  webrtcPolicyEl.value = webRtcSelectValue(config);

  ipSyncEnabledEl.checked = config.ipSync.enabled;
  ipSyncLanguageEl.checked = config.ipSync.syncLanguage;
  ipSyncIntervalEl.value = String(config.ipSync.intervalMinutes);
  syncIpSyncControls();
  void refreshIpSyncStatusUntilSettled();

  renderProfiles();
  renderSiteRules();
}

/** 周期输入框：空或非数字时保持原值，交给 normalizeIpSync 只做范围夹取。 */
function parseIntervalMinutes(raw: string, fallback: number): number {
  const text = raw.trim();
  if (!text) return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}

function readForm(): SiteSpoofConfig {
  // 跟随出口 IP 打开时，时区与坐标由后台按出口 IP 改写。这里必须存成 auto 档，
  // 否则在配置页点一次保存就把 auto 手滑改回 manual，开关看起来像没生效。
  const ipSyncOn = ipSyncEnabledEl.checked;
  // 开着跟随时，表单里的时区/坐标是静态旧值（后台对齐的结果在 currentConfig 里）。
  // 把它们原样提交回去，等于用旧值覆盖后台刚写好的值：auto 档虽然不看字段值，但下一轮
  // `planExitIpSync` 会因此多报一层「变了」，还把配置写成自相矛盾的样子。
  const staticProfile = currentConfig.globalProfile;
  // 显示的是 lastLocation 且用户没改 → 仍然是 auto（否则一次保存就把跟随钉成手填）
  const geoTouched = !(autoDisplay?.autoGeo
    && autoDisplay.latitude === latitudeEl.value
    && autoDisplay.longitude === longitudeEl.value);
  const timezoneUntouched = Boolean(autoDisplay?.autoTimezone && autoDisplay.timezone === timezoneEl.value);
  return normalizeConfig({
    ...currentConfig,
    masterEnabled: globalEnabledEl.checked,
    debugMode: debugModeEl.checked,
    rules: rulesFromText(ruleListEl.value, currentConfig.rules),
    globalProfile: {
      language: normalizeLanguage({
        enabled: languageEnabledEl.checked,
        mode: 'custom',
        language: languageEl.value,
        languages: languagesEl.value.split(',').map((item) => item.trim()).filter(Boolean),
        acceptLanguage: acceptLanguageEl.value
      }),
      timezone: normalizeTimezone({
        enabled: timezoneEnabledEl.checked,
        mode: ipSyncOn || timezoneUntouched || !timezoneEl.value ? 'auto' : 'manual',
        timezone: ipSyncOn ? staticProfile.timezone.timezone : timezoneEl.value
      }),
      geolocation: normalizeGeolocation({
        enabled: geolocationEnabledEl.checked,
        mode: ipSyncOn || !geoTouched ? 'auto' : geolocationModeFromInput(latitudeEl.value, longitudeEl.value),
        latitude: ipSyncOn ? staticProfile.geolocation.latitude : parseCoordinateInput(latitudeEl.value),
        longitude: ipSyncOn ? staticProfile.geolocation.longitude : parseCoordinateInput(longitudeEl.value),
        // 国家只在跟随过程中写入，配置页以前根本没提交它 —— 每点一次保存就丢一次，
        // 下一轮同步再当作「变了」重写。跟着一起带上。
        country: staticProfile.geolocation.country,
        accuracy: Number(accuracyEl.value),
        randomize: randomizeEl.checked,
        randomRadiusMeters: Number(randomRadiusMetersEl.value),
        spoofPermission: noNativeCallEl.checked ? true : spoofPermissionEl.checked,
        noNativeCall: noNativeCallEl.checked,
        history: currentConfig.globalProfile.geolocation.history
      })
    },
    webRtc: webrtcEnabledEl.checked ? normalizeWebRtc({ policy: webrtcPolicyEl.value }) : normalizeWebRtc({ globalMode: 'default' }),
    ipSync: {
      enabled: ipSyncOn,
      // 关掉开关时一起落 false：勾选框是 disabled 的，用户没法自己取消勾选，
      // 留着 true 会让「以后重新打开总开关」无声地把语言也接管过去。
      syncLanguage: ipSyncOn && ipSyncLanguageEl.checked,
      // 空串不能当 0 处理：`Number('')` 是 0，会被下限夹成 5，用户把"15"清空再保存
      // 就悄悄变成了 5。空/非数字一律保持上次存的值，真要改就打一个新数字进去。
      intervalMinutes: parseIntervalMinutes(ipSyncIntervalEl.value, currentConfig.ipSync.intervalMinutes)
    }
  });
}

/**
 * 「上次自动定位没成功」卡片。
 *
 * 读的是 `chrome.storage.local` 而不是走消息通道：烘焙（只读）构建里运行时通道是
 * 关掉的，而这条信息在烘焙构建里一样有用（release 包里的 auto 时区同样会失败）。
 * storage 在任何扩展页都读得到，所以直接用。
 *
 * 后台在 `recordGeoError` 里成对写 `lastGeoError` / `lastGeoErrorAt`；这里成对读，
 * 缺时间就不显示"多久之前"（老版本写过的记录没有时间戳）。
 */
function renderGeoError(message: string, at: string): void {
  const text = String(message || '').trim();
  if (!text) {
    geoErrorEl.hidden = true;
    geoErrorHintEl.textContent = '';
    geoErrorReasonEl.textContent = '';
    geoErrorAgeEl.textContent = '';
    return;
  }
  geoErrorEl.hidden = false;
  geoErrorHintEl.textContent = describeGeoError(text);
  geoErrorReasonEl.textContent = text;
  geoErrorAgeEl.textContent = formatErrorAge(at);
}

async function loadGeoError(): Promise<void> {
  const stored = await chrome.storage.local.get({ lastGeoError: '', lastGeoErrorAt: '' });
  renderGeoError(String(stored.lastGeoError ?? ''), String(stored.lastGeoErrorAt ?? ''));
}

async function loadConfig(): Promise<void> {
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'getSiteConfig' });
  currentConfig = normalizeConfig(response.config);
  // auto 档的坐标/时区来自 lastLocation，不一起读就会显示成空框
  const state = await sendRuntimeMessage<IpSyncStateResponse>({ action: 'getExitIpSyncState' })
    .catch(() => null);
  if (state) currentLastLocation = state.lastLocation ?? null;
  populateForm(currentConfig);
  // 定位失败与配置无关，别让 getSiteConfig 失败把这张卡也带走
  await loadGeoError().catch(() => undefined);
}

function showSettingsToast(message: string): void {
  settingsToastEl.textContent = message;
  settingsToastEl.classList.add('show');
  window.clearTimeout(settingsToastTimer);
  settingsToastTimer = window.setTimeout(() => {
    settingsToastEl.classList.remove('show');
  }, 2400);
}

async function saveSettings(options: { announce?: boolean } = {}): Promise<void> {
  currentConfig = readForm();
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'setSiteConfig', config: currentConfig });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
  if (options.announce) showSettingsToast('设置已保存');
}

async function applyProfile(profileId: string): Promise<void> {
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'applyProfile', profileId });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
}

function createPresetProfileCard(profile: Profile): HTMLElement {
  const card = document.createElement('div');
  card.className = 'profile-card';
  card.dataset.profile = profile.id;
  card.innerHTML = `
    <div class="profile-header">
      <div class="profile-info">
        <div class="profile-name"></div>
        <div class="profile-desc"></div>
      </div>
      <div class="profile-actions"></div>
    </div>
  `;
  card.querySelector('.profile-name')!.textContent = profile.name;
  card.querySelector('.profile-desc')!.textContent = `${profile.geolocation.latitude}, ${profile.geolocation.longitude} | ${profile.timezone.timezone}`;
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn-primary btn-sm';
  applyBtn.textContent = '应用';
  applyBtn.onclick = () => { void applyProfile(profile.id); };
  card.querySelector('.profile-actions')!.appendChild(applyBtn);
  return card;
}

function createCustomProfileCard(profile: Profile): HTMLElement {
  const card = createPresetProfileCard(profile);
  const actions = card.querySelector('.profile-actions')!;
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn-secondary btn-sm';
  exportBtn.textContent = '导出';
  exportBtn.onclick = () => exportProfile(profile);
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger btn-sm';
  deleteBtn.textContent = '删除';
  deleteBtn.onclick = () => deleteProfile(profile.id);
  actions.append(exportBtn, deleteBtn);
  return card;
}

function renderProfiles(): void {
  defaultProfilesEl.innerHTML = '';
  DEFAULT_PROFILES.forEach((profile) => defaultProfilesEl.appendChild(createPresetProfileCard(profile)));

  customProfilesEl.innerHTML = '';
  const defaultIds = new Set(DEFAULT_PROFILES.map((profile) => profile.id));
  const customProfiles = currentConfig.profile.profiles.filter((profile) => !defaultIds.has(profile.id));
  if (!customProfiles.length) {
    customProfilesEl.innerHTML = '<p class="empty-state">暂无自定义配置文件</p>';
    return;
  }
  customProfiles.forEach((profile) => customProfilesEl.appendChild(createCustomProfileCard(profile)));
}

/**
 * 规则列表只是文本框的视图：所有改动先写回文本框，再走正常保存路径。
 * 这样"在列表里点禁用"和"在文本框里写 !"是同一条数据通路，不会互相覆盖。
 */
function updateRuleLine(domain: string, change: { enabled?: boolean; remove?: boolean }): void {
  const rules = rulesFromText(ruleListEl.value, currentConfig.rules);
  const index = rules.findIndex((rule) => rule.domain === domain);
  if (index === -1) return;

  if (change.remove) {
    rules.splice(index, 1);
  } else {
    rules[index] = { ...rules[index], enabled: change.enabled !== false };
  }
  ruleListEl.value = ruleLines(rules);
}

async function reloadRulesFromBackground(): Promise<void> {
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'getSiteConfig' });
  currentConfig = normalizeConfig(response.config);
  renderSiteRules();
}

async function handleToggleRule(domain: string, enabled: boolean): Promise<void> {
  updateRuleLine(domain, { enabled });
  await saveSettings();
  // 背景侧的重载在保存之后执行，页面重新加载时拿到的就是新配置
  await sendRuntimeMessage({ action: 'reloadAffectedTabs', domain });
  await reloadRulesFromBackground();
}

async function handleDeleteRule(domain: string): Promise<void> {
  updateRuleLine(domain, { remove: true });
  await saveSettings();
  await sendRuntimeMessage({ action: 'reloadAffectedTabs', domain });
  await reloadRulesFromBackground();
}

function renderSiteRules(): void {
  siteRulesEl.innerHTML = '';
  if (!currentConfig.rules.length) {
    siteRulesEl.innerHTML = '<p class="empty-state">暂无站点规则</p>';
    return;
  }

  currentConfig.rules.forEach((rule) => {
    const ruleEl = document.createElement('div');
    ruleEl.className = 'site-rule';

    const info = document.createElement('div');
    const hostnameEl = document.createElement('span');
    hostnameEl.className = 'site-hostname';
    hostnameEl.textContent = rule.domain;
    const statusEl = document.createElement('span');
    statusEl.className = `site-status ${rule.enabled ? 'enabled' : 'disabled'}`;
    statusEl.textContent = rule.enabled ? '已启用' : '已排除';
    info.append(hostnameEl, statusEl);

    const actions = document.createElement('div');
    actions.className = 'site-rule-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-secondary btn-sm';
    toggleBtn.textContent = rule.enabled ? '禁用' : '启用';
    toggleBtn.title = rule.enabled
      ? '禁用后保留这条规则，并覆盖父域白名单'
      : '启用这条规则（覆盖父域的排除）';
    toggleBtn.onclick = () => { void handleToggleRule(rule.domain, !rule.enabled); };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-sm';
    deleteBtn.textContent = '删除';
    deleteBtn.title = '删掉这条规则：子域回到「继承父域」的状态';
    deleteBtn.onclick = () => { void handleDeleteRule(rule.domain); };

    actions.append(toggleBtn, deleteBtn);
    ruleEl.append(info, actions);
    siteRulesEl.appendChild(ruleEl);
  });
}

function openSaveAsCustomModal(): void {
  newProfileNameEl.value = '';
  newProfileDescriptionEl.value = '';
  saveProfileModal.classList.add('active');
}

function closeSaveAsCustomModal(): void {
  saveProfileModal.classList.remove('active');
}

async function handleSaveAsCustom(): Promise<void> {
  const name = newProfileNameEl.value.trim();
  if (!name) {
    alert('请输入配置名称');
    return;
  }
  currentConfig = readForm();
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const latitude = currentConfig.globalProfile.geolocation.latitude;
  const longitude = currentConfig.globalProfile.geolocation.longitude;
  // Number(null) === 0：坐标没填时不能悄悄生成一个 (0,0) 的 profile。
  if (latitude === null || longitude === null) {
    alert('当前配置缺少有效坐标，不能保存为 profile');
    return;
  }
  const profile: Profile = {
    id,
    name,
    description: newProfileDescriptionEl.value.trim() || undefined,
    geolocation: {
      latitude,
      longitude,
      accuracy: currentConfig.globalProfile.geolocation.accuracy,
      country: currentConfig.globalProfile.geolocation.country
    },
    language: {
      language: currentConfig.globalProfile.language.language,
      languages: currentConfig.globalProfile.language.languages.slice(),
      acceptLanguage: currentConfig.globalProfile.language.acceptLanguage
    },
    timezone: {
      timezone: currentConfig.globalProfile.timezone.timezone
    }
  };
  if (!validateProfile(profile)) {
    alert('当前配置缺少有效坐标或时区，不能保存为 profile');
    return;
  }
  currentConfig.profile.profiles = [
    ...currentConfig.profile.profiles.filter((item) => item.id !== id),
    profile
  ];
  await saveSettings();
  closeSaveAsCustomModal();
}

function exportProfile(profile: Profile): void {
  downloadJson(`vanishgeo-profile-${profile.id}-${Date.now()}.json`, profile);
}

async function deleteProfile(profileId: string): Promise<void> {
  if (!confirm('确定要删除这个配置文件吗？')) return;
  currentConfig.profile.profiles = currentConfig.profile.profiles.filter((profile) => profile.id !== profileId);
  if (currentConfig.profile.activeProfileId === profileId) {
    currentConfig.profile.activeProfileId = null;
  }
  renderProfiles();
  // 只改内存不落库，刷新页面就"复活"了 —— 必须走一次保存。
  await saveSettings();
}

function downloadJson(filename: string, value: unknown): void {
  const dataBlob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportConfiguration(): void {
  currentConfig = readForm();
  downloadJson(`vanishgeo-config-${Date.now()}.json`, currentConfig);
}

/**
 * 导出烘焙构建的输入文件。
 *
 * 非烘焙构建：content script 在 document_start 发起握手 → 后台解析配置 → 端口回投，
 * 这条链路是异步的，页面首个内联脚本可能先跑（实测本地页能稳定复现）。
 * 烘焙构建把 payload 编译成 runtime.js 里的常量，document_start 同步生效。
 */
async function exportBakeSnapshot(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ action: 'getBakeSnapshot' }).catch((error: unknown) => ({ status: 'error', error: String(error) }));
  if (!response || response.status === 'error') {
    alert(`导出失败: ${response && response.error ? response.error : '后台没有响应'}`);
    return;
  }
  downloadJson('vanishgeo-bake.json', { config: response.config, lastLocation: response.lastLocation ?? null });
}

function importConfiguration(): void {
  importFileEl.click();
}

async function handleImportFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    currentConfig = normalizeConfig(JSON.parse(await file.text()));
    populateForm(currentConfig);
    await saveSettings();
  } catch (error) {
    alert(`导入配置失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    importFileEl.value = '';
  }
}

async function resetAllData(): Promise<void> {
  if (!confirm('重置所有数据为默认值？此操作无法撤销。')) return;
  currentConfig = normalizeConfig(DEFAULT_CONFIG);
  populateForm(currentConfig);
  await saveSettings();
}

/**
 * 从 IP 自动配置：查出口，把坐标/时区/语言**写进当前配置**并应用。
 *
 * 以前这里发 `manualUpdate`（只刷新 lastLocation）。配置是 manual 档时解析层
 * 不看 lastLocation，点完表单一个数字都不动 —— 就是"点了没反应"。
 */
async function handleGetFromIP(): Promise<void> {
  const label = getFromIPBtn.textContent;
  getFromIPBtn.disabled = true;
  getFromIPBtn.textContent = '获取中...';
  try {
    const response = await sendRuntimeMessage<{
      outcome?: ExitIpApplyOutcome;
      config?: SiteSpoofConfig;
      lastLocation?: LastLocation | null;
    }>({ action: 'applyFromExitIp' });
    const outcome = response?.outcome;
    if (!outcome || outcome.ok !== true) {
      alert(`从 IP 自动配置失败：${outcome?.error ? describeIpApplyError(outcome.error) : '后台没有返回结果'}`);
      return;
    }
    if (response.config) {
      currentConfig = normalizeConfig(response.config);
    }
    currentLastLocation = response.lastLocation ?? null;
    populateForm(currentConfig);
    const summary = [outcome.country, outcome.timezone, outcome.language].filter(Boolean).join(' · ');
    alert(`已按出口 IP ${outcome.ip} 配置：${summary}\n记得点「保存设置」把它存下来。`);
  } catch (error) {
    alert(`从 IP 自动配置失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    getFromIPBtn.disabled = false;
    getFromIPBtn.textContent = label;
  }
}

const IP_SYNC_SKIP_TEXT: Record<string, string> = {
  'extension-disabled': '全局保护已关闭，这次跳过',
  'sync-disabled': '「跟随出口 IP」还没打开，这次跳过',
  'same-ip': '出口 IP 没变，这次跳过'
};

const IP_SYNC_LAYER_TEXT: Record<string, string> = {
  timezone: '时区',
  geolocation: '坐标',
  language: '语言',
  profile: '预设选择'
};

/** 周期与语言开关只有总开关打开时才有意义，一起禁用免得配了个不生效的值 */
function syncIpSyncControls(): void {
  const enabled = ipSyncEnabledEl.checked;
  ipSyncLanguageEl.disabled = !enabled;
  ipSyncIntervalEl.disabled = !enabled;
  ipSyncNowBtn.disabled = !enabled;
}

function describeIpSyncState(state: IpSyncStateResponse | null | undefined): string {
  const sync = state?.ipSync;
  if (!sync?.enabled) return '未开启。时区与坐标仍按「当前配置」里手填的值来。';

  const ip = (state?.storedIp || '').trim();
  const parts: string[] = [ip ? `上次同步出口 IP ${ip}` : '还没成功同步过'];
  const location = state?.lastLocation;
  if (location) {
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      parts.push(`当前定位 ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);
    }
    if (location.timezone) parts.push(`时区 ${location.timezone}`);
  }
  parts.push(`每 ${sync.intervalMinutes} 分钟检查一次`);
  parts.push(sync.syncLanguage ? '语言跟随出口国家' : '语言保持当前配置');
  return `${parts.join(' · ')}。`;
}

function describeIpSyncOutcome(outcome: ExitIpSyncOutcome | undefined): string {
  if (!outcome) return '后台没有返回同步结果。';
  if (!outcome.ok) return `同步失败：${outcome.error}`;
  if (outcome.skipped) return IP_SYNC_SKIP_TEXT[outcome.skipped] || '这次跳过。';
  if (!outcome.changed) return `出口 IP ${outcome.ip}，配置已是最新。`;
  const layers = outcome.layers.map((layer) => IP_SYNC_LAYER_TEXT[layer] || layer).join('、');
  return `出口 IP ${outcome.ip}，已更新：${layers}。`;
}

/**
 * 渲染状态行。返回「这份状态算不算定了」：开关开着但还没拿到出口 IP 时算没定 ——
 * 刚打开开关的那次同步是后台异步跑的，页面这会儿读到的必然还是旧值。
 */
// 每发起一轮刷新就换一个序号。`populateForm` 每次保存都会叫一轮，连点两次保存
// 就会有两轮在跑；没有序号时先发的那轮后到，用旧状态覆盖掉新文案（表现为闪一下旧值）。
let ipSyncStatusRound = 0;

/** 读一次状态；返回"算不算定下来了"。 */
async function refreshIpSyncStatus(): Promise<boolean> {
  const round = ipSyncStatusRound;
  try {
    const state = await sendRuntimeMessage<IpSyncStateResponse>({ action: 'getExitIpSyncState' });
    // await 期间有更新的一轮开始了：这次的结果已经过期，别再写 DOM
    if (round !== ipSyncStatusRound) return true;
    ipSyncStatusEl.textContent = describeIpSyncState(state);
    if (!state?.ipSync?.enabled) return true;
    return Boolean((state.storedIp || '').trim());
  } catch (error) {
    if (round !== ipSyncStatusRound) return true;
    ipSyncStatusEl.textContent = `读取同步状态失败：${error instanceof Error ? error.message : String(error)}`;
    return true;
  }
}

/** 后台同步是一次异步的查出口，等它落地再收工；最多等 ~4 秒，离线时不至于一直转 */
async function refreshIpSyncStatusUntilSettled(attempts = 5, delayMs = 800): Promise<void> {
  ipSyncStatusRound += 1;
  const round = ipSyncStatusRound;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (round !== ipSyncStatusRound) return; // 后面又开了一轮，这轮让位
    if (await refreshIpSyncStatus()) return;
    await new Promise((resolve) => { setTimeout(resolve, delayMs); });
  }
}

/** 立即同步一次：force 跳过「IP 没变」，用来验证配置是否真的落到了 payload 上 */
async function handleIpSyncNow(): Promise<void> {
  const label = ipSyncNowBtn.textContent;
  ipSyncNowBtn.disabled = true;
  ipSyncNowBtn.textContent = '同步中...';
  try {
    const response = await sendRuntimeMessage<IpSyncStateResponse>({ action: 'checkExitIpSync', force: true });
    alert(describeIpSyncOutcome(response?.outcome));
    if (response?.lastLocation) currentLastLocation = response.lastLocation;
    if (response?.config) {
      currentConfig = normalizeConfig(response.config);
      populateForm(currentConfig);
    } else {
      await loadConfig();
    }
  } catch (error) {
    // 后台抛错（查接口期间扩展被重载、存储被策略锁住）时 `sendRuntimeMessage` 直接 reject。
    // 不接住的话用户只看到按钮转一圈又恢复，连"失败了"都不知道。
    const message = error instanceof Error ? error.message : String(error);
    ipSyncStatusEl.textContent = `同步失败：${message}`;
    alert(`同步失败：${message}`);
  } finally {
    ipSyncNowBtn.textContent = label;
    syncIpSyncControls();
  }
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetTab = (btn as HTMLElement).dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((content) => content.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.tab-content[data-tab="${targetTab}"]`)?.classList.add('active');
  });
});

spoofPermissionEl.addEventListener('change', () => {
  if (!spoofPermissionEl.checked) noNativeCallEl.checked = false;
  syncNoNativeCallControls();
});
noNativeCallEl.addEventListener('change', () => {
  if (noNativeCallEl.checked) spoofPermissionEl.checked = true;
  syncNoNativeCallControls();
});
saveBtn.addEventListener('click', () => { void saveSettings({ announce: true }); });
saveAsCustomBtn.addEventListener('click', openSaveAsCustomModal);
confirmSaveProfileBtn.addEventListener('click', () => { void handleSaveAsCustom(); });
cancelSaveProfileBtn.addEventListener('click', closeSaveAsCustomModal);
document
  .getElementById('cancelSaveProfileIcon')
  ?.addEventListener('click', closeSaveAsCustomModal);
getFromIPBtn.addEventListener('click', () => { void handleGetFromIP(); });
ipSyncEnabledEl.addEventListener('change', syncIpSyncControls);
ipSyncNowBtn.addEventListener('click', () => { void handleIpSyncNow(); });
exportConfigBtn.addEventListener('click', exportConfiguration);
exportBakeBtn.addEventListener('click', () => { void exportBakeSnapshot(); });
importConfigBtn.addEventListener('click', importConfiguration);
importFileEl.addEventListener('change', (event) => { void handleImportFile(event); });
resetAllBtn.addEventListener('click', () => { void resetAllData(); });
saveProfileModal.addEventListener('click', (event) => {
  if (event.target === saveProfileModal) closeSaveAsCustomModal();
});

// 后台写完 lastGeoError 立刻反映到这张卡上：用户点「从 IP 自动配置」失败时
// 不用手动刷新配置页就能看到原因。storage.onChanged 在扩展页里是实时事件。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // 两个 key 是成对写的，任一变就整对重读：只拼一半会出现"有了时间没有原文"
  if (!('lastGeoError' in changes) && !('lastGeoErrorAt' in changes)) return;
  void loadGeoError().catch(() => undefined);
});

geoErrorDismissEl.addEventListener('click', () => {
  // 只清提示，不动配置：这条错误是"最后一次失败"的快照，不是需要修的状态
  void chrome.storage.local.set({ lastGeoError: '', lastGeoErrorAt: '' });
});

void loadConfig();
