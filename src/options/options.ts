import './options.css';
import {
  DEFAULT_CANVAS,
  DEFAULT_CONFIG,
  createRule,
  getTimezoneOffsetMinutes,
  normalizeConfig,
  normalizeDomain,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeTimezone,
  normalizeWebRtc
} from '../shared/config-model';
import { formatCoordinate, formatLastLocationStatus } from '../shared/last-location-display';
import { deriveIpLocationStatus } from '../shared/ip-location';
import { validateProfile } from '../shared/profile';
import { deriveEffectiveEnvironment, freezeIpLocationToManualConfig } from '../shared/ui-state';
import type { LastLocation, Profile, SiteRule, SiteSpoofConfig } from '../shared/types';
import type { IpLocationStatusSnapshot } from '../shared/ip-location';

let currentConfig: SiteSpoofConfig = normalizeConfig(DEFAULT_CONFIG);
let lastLocation: LastLocation | null = null;
let ipLocationStatus: IpLocationStatusSnapshot | null = null;

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
const getFromIPBtn = document.getElementById('getFromIP') as HTMLButtonElement;
const freezeIpProfileBtn = document.getElementById('freezeIpProfile') as HTMLButtonElement;
const ipLocationStatusEl = document.getElementById('ipLocationStatus') as HTMLElement;
const effectiveGeolocationSourceEl = document.getElementById('effectiveGeolocationSource') as HTMLElement;
const effectiveGeolocationValueEl = document.getElementById('effectiveGeolocationValue') as HTMLElement;
const effectiveGeolocationDetailEl = document.getElementById('effectiveGeolocationDetail') as HTMLElement;
const effectiveTimezoneSourceEl = document.getElementById('effectiveTimezoneSource') as HTMLElement;
const effectiveTimezoneValueEl = document.getElementById('effectiveTimezoneValue') as HTMLElement;
const effectiveTimezoneDetailEl = document.getElementById('effectiveTimezoneDetail') as HTMLElement;
const timezoneEnabledEl = document.getElementById('timezoneEnabled') as HTMLInputElement;
const timezoneEl = document.getElementById('timezone') as HTMLInputElement;
const utcOffsetEl = document.getElementById('utcOffset') as HTMLInputElement;
const languageEnabledEl = document.getElementById('languageEnabled') as HTMLInputElement;
const languageEl = document.getElementById('language') as HTMLInputElement;
const languagesEl = document.getElementById('languages') as HTMLInputElement;
const acceptLanguageEl = document.getElementById('acceptLanguage') as HTMLInputElement;
const webrtcEnabledEl = document.getElementById('webrtcEnabled') as HTMLInputElement;
const webrtcPolicyEl = document.getElementById('webrtcPolicy') as HTMLSelectElement;
const webrtcPolicyStatusEl = document.getElementById('webrtcPolicyStatus') as HTMLElement;
const canvasEnabledEl = document.getElementById('canvasEnabled') as HTMLInputElement;
const canvasSpoofFontsEl = document.getElementById('canvasSpoofFonts') as HTMLInputElement;
const canvasTargetFontsEl = document.getElementById('canvasTargetFonts') as HTMLTextAreaElement;
const resetFontsBtn = document.getElementById('resetFonts') as HTMLButtonElement;
const customProfilesEl = document.getElementById('customProfiles') as HTMLElement;
const siteRulesEl = document.getElementById('siteRules') as HTMLElement;
const exportConfigBtn = document.getElementById('exportConfig') as HTMLButtonElement;
const importConfigBtn = document.getElementById('importConfig') as HTMLButtonElement;
const importFileEl = document.getElementById('importFile') as HTMLInputElement;
const resetAllBtn = document.getElementById('resetAll') as HTMLButtonElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const saveFooterBtn = document.getElementById('saveFooter') as HTMLButtonElement;
const saveAsCustomBtn = document.getElementById('saveAsCustom') as HTMLButtonElement;
const saveProfileModal = document.getElementById('saveProfileModal') as HTMLElement;
const newProfileNameEl = document.getElementById('newProfileName') as HTMLInputElement;
const newProfileDescriptionEl = document.getElementById('newProfileDescription') as HTMLInputElement;
const confirmSaveProfileBtn = document.getElementById('confirmSaveProfile') as HTMLButtonElement;
const cancelSaveProfileBtn = document.getElementById('cancelSaveProfile') as HTMLButtonElement;

function sendRuntimeMessage<T = any>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.status === 'error') {
        reject(new Error(response?.message || 'Unknown runtime error'));
        return;
      }
      resolve(response);
    });
  });
}

function webRtcSelectValue(config: SiteSpoofConfig): string {
  if (config.webRtc.globalMode === 'strict') return 'disable_non_proxied_udp';
  if (config.webRtc.globalMode === 'compatible') return 'default_public_interface_only';
  return 'default';
}

function setSourceChip(element: HTMLElement, source: string, label: string): void {
  element.className = `source-chip ${source}`;
  element.textContent = label;
}

function updateEffectiveDisplay(config: SiteSpoofConfig): void {
  const display = deriveEffectiveEnvironment(config, lastLocation, ipLocationStatus);
  setSourceChip(effectiveGeolocationSourceEl, display.geolocation.source, display.geolocation.sourceLabel);
  effectiveGeolocationValueEl.textContent = display.geolocation.value;
  effectiveGeolocationDetailEl.textContent = display.geolocation.detail || '-';
  setSourceChip(effectiveTimezoneSourceEl, display.timezone.source, display.timezone.sourceLabel);
  effectiveTimezoneValueEl.textContent = display.timezone.value;
  effectiveTimezoneDetailEl.textContent = display.timezone.detail || '-';
  freezeIpProfileBtn.disabled = !display.canFreezeIpLocation;
}

function rulesFromText(value: string, existingRules: SiteRule[]): SiteRule[] {
  const existingByDomain = new Map(existingRules.map((rule) => [rule.domain, rule]));
  const seen = new Set<string>();
  return value
    .split('\n')
    .map(normalizeDomain)
    .filter(Boolean)
    .filter((domain) => {
      if (seen.has(domain)) return false;
      seen.add(domain);
      return true;
    })
    .map((domain) => ({ ...(existingByDomain.get(domain) || createRule(domain)), domain, enabled: true }));
}

function populateForm(config: SiteSpoofConfig): void {
  globalEnabledEl.checked = config.masterEnabled;
  debugModeEl.checked = config.debugMode;
  ruleListEl.value = config.rules.filter((rule) => rule.enabled).map((rule) => rule.domain).join('\n');

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
  const offset = timezone.timezone ? getTimezoneOffsetMinutes(timezone.timezone) : null;
  utcOffsetEl.value = offset === null ? '' : String(-offset / 60);

  const language = config.globalProfile.language;
  languageEnabledEl.checked = language.enabled;
  languageEl.value = language.language;
  languagesEl.value = language.languages.join(', ');
  acceptLanguageEl.value = language.acceptLanguage;

  webrtcEnabledEl.checked = config.webRtc.globalMode !== 'default';
  webrtcPolicyEl.value = webRtcSelectValue(config);
  canvasEnabledEl.checked = config.canvas.enabled;
  canvasSpoofFontsEl.checked = config.canvas.spoofFonts;
  canvasTargetFontsEl.value = config.canvas.targetFonts.join('\n');
  updateIpLocationDisplay(config);

  renderProfiles();
  renderSiteRules();
}

function updateIpLocationDisplay(config: SiteSpoofConfig): void {
  ipLocationStatusEl.textContent = formatLastLocationStatus(lastLocation, ipLocationStatus);
  const followsIpGeolocation = config.globalProfile.geolocation.mode === 'auto';
  const followsIpTimezone = config.globalProfile.timezone.mode === 'auto';
  latitudeEl.placeholder = followsIpGeolocation && lastLocation ? formatCoordinate(lastLocation.latitude) : '';
  longitudeEl.placeholder = followsIpGeolocation && lastLocation ? formatCoordinate(lastLocation.longitude) : '';
  timezoneEl.placeholder = followsIpTimezone && lastLocation?.timezone ? lastLocation.timezone : 'UTC';
  updateEffectiveDisplay(config);
}

function readForm(): SiteSpoofConfig {
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
    webRtc: webrtcEnabledEl.checked ? normalizeWebRtc({ policy: webrtcPolicyEl.value }) : normalizeWebRtc({ globalMode: 'default' }),
    canvas: {
      enabled: canvasEnabledEl.checked,
      spoofFonts: canvasSpoofFontsEl.checked,
      targetFonts: canvasTargetFontsEl.value.split('\n').map((item) => item.trim()).filter(Boolean)
    }
  });
}

async function loadConfig(): Promise<void> {
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; lastLocation?: LastLocation | null; ipLocationStatus?: IpLocationStatusSnapshot }>({ action: 'getSiteConfig' });
  currentConfig = normalizeConfig(response.config);
  lastLocation = response.lastLocation || null;
  ipLocationStatus = response.ipLocationStatus || null;
  populateForm(currentConfig);
  await loadWebRtcPolicyState();
}

async function loadWebRtcPolicyState(): Promise<void> {
  try {
    const response = await sendRuntimeMessage<{ state: { effectivePolicy: string | null; policyState?: { actualPolicy?: string | null; levelOfControl?: string | null; leakProtectionActive?: boolean } } }>({ action: 'getWebRtcConfig' });
    const state = response.state;
    webrtcPolicyStatusEl.textContent = [
      `请求策略：${state.effectivePolicy || 'default'}`,
      `浏览器实际：${state.policyState?.actualPolicy || 'unknown'}`,
      `控制级别：${state.policyState?.levelOfControl || 'unknown'}`
    ].join(' · ');
  } catch (error) {
    webrtcPolicyStatusEl.textContent = `当前策略状态：读取失败（${error instanceof Error ? error.message : String(error)}）`;
  }
}

async function saveSettings(): Promise<void> {
  currentConfig = readForm();
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'setSiteConfig', config: currentConfig });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
  alert('设置已保存');
}

async function applyProfile(profileId: string): Promise<void> {
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'applyProfile', profileId });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
}

function createProfileCard(profile: Profile): HTMLElement {
  const card = document.createElement('div');
  card.className = 'profile-card';
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
  const card = createProfileCard(profile);
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
  customProfilesEl.innerHTML = '';
  const customProfiles = currentConfig.profile.profiles;
  if (!customProfiles.length) {
    customProfilesEl.innerHTML = '<p style="color: #888; font-size: 14px;">暂无自定义配置文件</p>';
    return;
  }
  customProfiles.forEach((profile) => customProfilesEl.appendChild(createCustomProfileCard(profile)));
}

function renderSiteRules(): void {
  siteRulesEl.innerHTML = '';
  if (!currentConfig.rules.length) {
    siteRulesEl.innerHTML = '<p style="color: #888; font-size: 14px;">暂无站点规则</p>';
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
    statusEl.textContent = rule.enabled ? '已启用' : '已禁用';
    info.append(hostnameEl, statusEl);
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-sm';
    deleteBtn.textContent = '删除';
    deleteBtn.onclick = () => {
      currentConfig.rules = currentConfig.rules.filter((item) => item.domain !== rule.domain);
      ruleListEl.value = currentConfig.rules.filter((item) => item.enabled).map((item) => item.domain).join('\n');
      renderSiteRules();
    };
    ruleEl.append(info, deleteBtn);
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
  const profile: Profile = {
    id,
    name,
    description: newProfileDescriptionEl.value.trim() || undefined,
    geolocation: {
      latitude: Number(currentConfig.globalProfile.geolocation.latitude),
      longitude: Number(currentConfig.globalProfile.geolocation.longitude),
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

function deleteProfile(profileId: string): void {
  if (!confirm('确定要删除这个配置文件吗？')) return;
  currentConfig.profile.profiles = currentConfig.profile.profiles.filter((profile) => profile.id !== profileId);
  renderProfiles();
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

async function handleGetFromIP(): Promise<void> {
  getFromIPBtn.disabled = true;
  getFromIPBtn.textContent = '获取中...';
  ipLocationStatus = deriveIpLocationStatus(lastLocation, { status: 'refreshing', startedAt: Date.now() });
  updateIpLocationDisplay(currentConfig);
  try {
    const response = await sendRuntimeMessage<{ geo: { ok: boolean; location?: LastLocation; error?: string }; ipLocationStatus?: IpLocationStatusSnapshot }>({ action: 'manualUpdate' });
    lastLocation = response.geo.location || lastLocation;
    ipLocationStatus = response.ipLocationStatus || ipLocationStatus;
    if (!response.geo.ok) throw new Error(response.geo.error || '出口 IP 定位失败');
    await loadConfig();
    alert('出口 IP 定位已刷新；地理位置和时区为 auto 时会使用最新定位。语言仍由自定义配置控制。');
  } catch (error) {
    updateIpLocationDisplay(currentConfig);
    alert(`刷新出口 IP 定位失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    getFromIPBtn.disabled = false;
    getFromIPBtn.textContent = '刷新出口 IP 定位（地理位置 + 时区）';
  }
}

async function handleFreezeIpProfile(): Promise<void> {
  const frozen = freezeIpLocationToManualConfig(currentConfig, lastLocation);
  if (!frozen) {
    alert('当前出口 IP 定位缺少有效坐标或时区，无法应用为手动配置');
    return;
  }
  currentConfig = frozen;
  populateForm(currentConfig);
  await saveSettings();
}

async function handleResetFonts(): Promise<void> {
  currentConfig.canvas.targetFonts = DEFAULT_CANVAS.targetFonts;
  canvasTargetFontsEl.value = DEFAULT_CANVAS.targetFonts.join('\n');
  await saveSettings();
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

saveBtn.addEventListener('click', () => { void saveSettings(); });
saveFooterBtn.addEventListener('click', () => { void saveSettings(); });
saveAsCustomBtn.addEventListener('click', openSaveAsCustomModal);
confirmSaveProfileBtn.addEventListener('click', () => { void handleSaveAsCustom(); });
cancelSaveProfileBtn.addEventListener('click', closeSaveAsCustomModal);
getFromIPBtn.addEventListener('click', () => { void handleGetFromIP(); });
freezeIpProfileBtn.addEventListener('click', () => { void handleFreezeIpProfile(); });
canvasEnabledEl.addEventListener('change', () => { currentConfig = readForm(); populateForm(currentConfig); });
canvasSpoofFontsEl.addEventListener('change', () => { currentConfig = readForm(); populateForm(currentConfig); });
resetFontsBtn.addEventListener('click', () => { void handleResetFonts(); });
exportConfigBtn.addEventListener('click', exportConfiguration);
importConfigBtn.addEventListener('click', importConfiguration);
importFileEl.addEventListener('change', (event) => { void handleImportFile(event); });
resetAllBtn.addEventListener('click', () => { void resetAllData(); });
saveProfileModal.addEventListener('click', (event) => {
  if (event.target === saveProfileModal) closeSaveAsCustomModal();
});

void loadConfig();
