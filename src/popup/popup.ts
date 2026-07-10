import './popup.css';
import {
  DEFAULT_CANVAS,
  DEFAULT_CONFIG,
  createRule,
  normalizeConfig,
  normalizeDomain,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeTimezone,
  normalizeWebRtc
} from '../shared/config-model';
import { formatCoordinate, formatLastLocationStatus } from '../shared/last-location-display';
import { deriveIpLocationStatus } from '../shared/ip-location';
import { deriveCurrentSiteStatus, deriveEffectiveEnvironment, freezeIpLocationToManualConfig } from '../shared/ui-state';
import type { GeolocationHistory, LastLocation, SiteRule, SiteSpoofConfig } from '../shared/types';
import type { IpLocationStatusSnapshot } from '../shared/ip-location';

const globalEnabledEl = document.getElementById('globalEnabled') as HTMLInputElement;
const debugModeEl = document.getElementById('debugMode') as HTMLInputElement;
const globalStatusEl = document.getElementById('globalStatus') as HTMLElement;
const currentSiteEl = document.getElementById('currentSite') as HTMLElement;
const siteStatusBadgeEl = document.getElementById('siteStatusBadge') as HTMLElement;
const siteStatusDetailEl = document.getElementById('siteStatusDetail') as HTMLElement;
const enableSiteBtn = document.getElementById('enableSite') as HTMLButtonElement;
const disableSiteBtn = document.getElementById('disableSite') as HTMLButtonElement;
const ruleListEl = document.getElementById('ruleList') as HTMLTextAreaElement;
const openOptionsHeaderBtn = document.getElementById('openOptionsHeader') as HTMLButtonElement;
const geolocationEnabledEl = document.getElementById('geolocationEnabled') as HTMLInputElement;
const latitudeEl = document.getElementById('latitude') as HTMLInputElement;
const longitudeEl = document.getElementById('longitude') as HTMLInputElement;
const accuracyEl = document.getElementById('accuracy') as HTMLInputElement;
const randomizeEl = document.getElementById('randomize') as HTMLInputElement;
const randomRadiusMetersEl = document.getElementById('randomRadiusMeters') as HTMLInputElement;
const spoofPermissionEl = document.getElementById('spoofPermission') as HTMLInputElement;
const saveCoordinateBtn = document.getElementById('saveCoordinate') as HTMLButtonElement;
const getFromIPBtn = document.getElementById('getFromIP') as HTMLButtonElement;
const ipLocationStatusEl = document.getElementById('ipLocationStatus') as HTMLElement;
const effectiveGeolocationSourceEl = document.getElementById('effectiveGeolocationSource') as HTMLElement;
const effectiveGeolocationValueEl = document.getElementById('effectiveGeolocationValue') as HTMLElement;
const effectiveGeolocationDetailEl = document.getElementById('effectiveGeolocationDetail') as HTMLElement;
const effectiveTimezoneSourceEl = document.getElementById('effectiveTimezoneSource') as HTMLElement;
const effectiveTimezoneValueEl = document.getElementById('effectiveTimezoneValue') as HTMLElement;
const effectiveTimezoneDetailEl = document.getElementById('effectiveTimezoneDetail') as HTMLElement;
const freezeIpProfileBtn = document.getElementById('freezeIpProfile') as HTMLButtonElement;
const timezoneEnabledEl = document.getElementById('timezoneEnabled') as HTMLInputElement;
const timezoneEl = document.getElementById('timezone') as HTMLInputElement;
const utcOffsetEl = document.getElementById('utcOffset') as HTMLInputElement;
const languageEnabledEl = document.getElementById('languageEnabled') as HTMLInputElement;
const languageEl = document.getElementById('language') as HTMLInputElement;
const languagesEl = document.getElementById('languages') as HTMLInputElement;
const acceptLanguageEl = document.getElementById('acceptLanguage') as HTMLInputElement;
const webrtcEnabledEl = document.getElementById('webrtcEnabled') as HTMLInputElement;
const webrtcPolicyEl = document.getElementById('webrtcPolicy') as HTMLSelectElement;
const canvasEnabledEl = document.getElementById('canvasEnabled') as HTMLInputElement;
const resetFontsBtn = document.getElementById('resetFonts') as HTMLButtonElement;
const openOptionsBtn = document.getElementById('openOptions') as HTMLButtonElement;
const openLeakTestBtn = document.getElementById('openLeakTest') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const autoSaveToast = document.getElementById('autoSaveToast') as HTMLElement;

let currentConfig: SiteSpoofConfig = normalizeConfig(DEFAULT_CONFIG);
let currentHostname = '';
let currentDisableDomain: string | null = null;
let lastLocation: LastLocation | null = null;
let ipLocationStatus: IpLocationStatusSnapshot | null = null;
let autoSaveTimer: number | null = null;

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

function showAutoSaveToast(): void {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveToast.classList.add('show');
  autoSaveTimer = window.setTimeout(() => {
    autoSaveToast.classList.remove('show');
    autoSaveTimer = null;
  }, 2000);
}

function webRtcSelectValue(config: SiteSpoofConfig): string {
  if (config.webRtc.globalMode === 'strict') return 'disable_non_proxied_udp';
  if (config.webRtc.globalMode === 'compatible') return 'default_public_interface_only';
  return 'default';
}

function ruleLines(config: SiteSpoofConfig): string {
  return config.rules.filter((rule) => rule.enabled).map((rule) => rule.domain).join('\n');
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

function updateGlobalStatus(): void {
  globalStatusEl.textContent = globalEnabledEl.checked ? '全局保护已启用' : '全局保护已禁用';
}

function setStatusBadgeClass(kind: string): void {
  siteStatusBadgeEl.className = `status-badge ${kind}`;
}

function setSourceChip(element: HTMLElement, source: string, label: string): void {
  element.className = `source-chip ${source}`;
  element.textContent = label;
}

function renderCurrentSiteStatus(state: any): void {
  const status = deriveCurrentSiteStatus({
    domain: state.domain || '',
    scriptable: Boolean(state.scriptable),
    config: currentConfig,
    matched: Boolean(state.matched),
    rule: state.rule || null,
    payload: state.payload || null,
    errors: Array.isArray(state.errors) ? state.errors : []
  });
  currentDisableDomain = status.disableDomain;
  siteStatusBadgeEl.textContent = status.label;
  siteStatusDetailEl.textContent = status.detail;
  setStatusBadgeClass(status.kind);
  enableSiteBtn.disabled = !status.canEnable;
  disableSiteBtn.disabled = !status.canDisable;
  enableSiteBtn.textContent = status.kind === 'enabled' ? '已启用' : '启用当前网站';
  disableSiteBtn.textContent = status.disableDomain ? `移除 ${status.disableDomain}` : '不启用';
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

function updateIpLocationDisplay(config: SiteSpoofConfig): void {
  ipLocationStatusEl.textContent = formatLastLocationStatus(lastLocation, ipLocationStatus);
  const followsIpGeolocation = config.globalProfile.geolocation.mode === 'auto';
  const followsIpTimezone = config.globalProfile.timezone.mode === 'auto';
  latitudeEl.placeholder = followsIpGeolocation && lastLocation ? formatCoordinate(lastLocation.latitude) : '';
  longitudeEl.placeholder = followsIpGeolocation && lastLocation ? formatCoordinate(lastLocation.longitude) : '';
  timezoneEl.placeholder = followsIpTimezone && lastLocation?.timezone ? lastLocation.timezone : 'UTC';
  updateEffectiveDisplay(config);
}

function populateForm(config: SiteSpoofConfig): void {
  globalEnabledEl.checked = config.masterEnabled;
  debugModeEl.checked = config.debugMode;
  updateGlobalStatus();
  ruleListEl.value = ruleLines(config);

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
  const offset = timezone.timezone ? new Date().getTimezoneOffset() : 0;
  utcOffsetEl.value = timezone.timezone ? String(-offset / 60) : '';

  const language = config.globalProfile.language;
  languageEnabledEl.checked = language.enabled;
  languageEl.value = language.language;
  languagesEl.value = language.languages.join(', ');
  acceptLanguageEl.value = language.acceptLanguage;

  webrtcEnabledEl.checked = config.webRtc.globalMode !== 'default';
  webrtcPolicyEl.value = webRtcSelectValue(config);
  canvasEnabledEl.checked = config.canvas.enabled;
  updateIpLocationDisplay(config);
}

function readForm(): SiteSpoofConfig {
  const rules = rulesFromText(ruleListEl.value, currentConfig.rules);
  return normalizeConfig({
    ...currentConfig,
    masterEnabled: globalEnabledEl.checked,
    debugMode: debugModeEl.checked,
    rules,
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
      ...currentConfig.canvas,
      enabled: canvasEnabledEl.checked
    }
  });
}

async function saveChanges(): Promise<void> {
  currentConfig = readForm();
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'setSiteConfig', config: currentConfig });
  currentConfig = normalizeConfig(response.config);
  showAutoSaveToast();
}

async function loadConfig(): Promise<void> {
  const response = await sendRuntimeMessage<{ state: any }>({ action: 'getCurrentTabState' });
  const state = response.state;
  currentConfig = normalizeConfig(state.config);
  lastLocation = state.lastLocation || null;
  ipLocationStatus = state.ipLocationStatus || null;
  currentHostname = state.domain || '';
  currentSiteEl.textContent = currentHostname || 'N/A';
  populateForm(currentConfig);
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
  await sendRuntimeMessage({ action: 'deleteDomainRule', domain });
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
    showAutoSaveToast();
  } catch (error) {
    updateIpLocationDisplay(currentConfig);
    alert(`刷新出口 IP 定位失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    getFromIPBtn.disabled = false;
    getFromIPBtn.textContent = '刷新出口 IP 定位';
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
  await saveChanges();
}

async function handleResetFonts(): Promise<void> {
  currentConfig.canvas.targetFonts = DEFAULT_CANVAS.targetFonts;
  await saveChanges();
}

globalEnabledEl.addEventListener('change', () => { updateGlobalStatus(); void saveChanges(); });
debugModeEl.addEventListener('change', () => { void saveChanges(); });
ruleListEl.addEventListener('blur', () => { void saveChanges(); });
enableSiteBtn.addEventListener('click', () => { void handleEnableSite(); });
disableSiteBtn.addEventListener('click', () => { void handleDisableSite(); });
geolocationEnabledEl.addEventListener('change', () => { void saveChanges(); });
latitudeEl.addEventListener('blur', () => { void saveChanges(); });
longitudeEl.addEventListener('blur', () => { void saveChanges(); });
accuracyEl.addEventListener('blur', () => { void saveChanges(); });
randomizeEl.addEventListener('change', () => { void saveChanges(); });
randomRadiusMetersEl.addEventListener('blur', () => { void saveChanges(); });
spoofPermissionEl.addEventListener('change', () => { void saveChanges(); });
timezoneEnabledEl.addEventListener('change', () => { void saveChanges(); });
timezoneEl.addEventListener('blur', () => { void saveChanges(); });
languageEnabledEl.addEventListener('change', () => { void saveChanges(); });
languageEl.addEventListener('blur', () => { void saveChanges(); });
languagesEl.addEventListener('blur', () => { void saveChanges(); });
acceptLanguageEl.addEventListener('blur', () => { void saveChanges(); });
webrtcEnabledEl.addEventListener('change', () => { void saveChanges(); });
webrtcPolicyEl.addEventListener('change', () => { void saveChanges(); });
canvasEnabledEl.addEventListener('change', () => { void saveChanges(); });
saveCoordinateBtn.addEventListener('click', () => { void handleSaveCoordinate(); });
getFromIPBtn.addEventListener('click', () => { void handleGetFromIP(); });
freezeIpProfileBtn.addEventListener('click', () => { void handleFreezeIpProfile(); });
resetFontsBtn.addEventListener('click', () => { void handleResetFonts(); });
openOptionsBtn.addEventListener('click', () => { void sendRuntimeMessage({ action: 'openOptions' }); });
openOptionsHeaderBtn.addEventListener('click', () => { void sendRuntimeMessage({ action: 'openOptions' }); });
openLeakTestBtn.addEventListener('click', () => { void sendRuntimeMessage({ action: 'openLeakTest' }); });
resetBtn.addEventListener('click', () => {
  currentConfig = normalizeConfig(DEFAULT_CONFIG);
  populateForm(currentConfig);
  void saveChanges();
});

void loadConfig();
