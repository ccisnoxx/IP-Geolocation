import './popup.css';
import {
  DEFAULT_CANVAS,
  DEFAULT_CONFIG,
  normalizeConfig,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeTimezone,
  normalizeWebRtc
} from '../shared/config-model';
import { ruleLines, rulesFromText } from '../shared/rule-text';
import { sendRuntimeMessage } from '../shared/runtime-message';
import { coordinateInputValue, geolocationModeFromInput, parseCoordinateInput, utcOffsetInputValue, webRtcSelectValue } from '../shared/ui-values';
import { describeSiteStatus } from '../shared/site-status';
import type { GeolocationHistory, SiteSpoofConfig } from '../shared/types';

const globalEnabledEl = document.getElementById('globalEnabled') as HTMLInputElement;
const debugModeEl = document.getElementById('debugMode') as HTMLInputElement;
const globalStatusEl = document.getElementById('globalStatus') as HTMLElement;
const currentSiteEl = document.getElementById('currentSite') as HTMLElement;
const siteWarningEl = document.getElementById('siteWarning') as HTMLElement;
const siteWarningTextEl = document.getElementById('siteWarningText') as HTMLElement;
const siteWarningHintEl = document.getElementById('siteWarningHint') as HTMLElement;
const siteOkEl = document.getElementById('siteOk') as HTMLElement;
const retryLocationBtn = document.getElementById('retryLocation') as HTMLButtonElement;
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
const canvasPlatformEl = document.getElementById('canvasPlatform') as HTMLSelectElement;
const canvasHideCjkEl = document.getElementById('canvasHideCjk') as HTMLInputElement;
const resetFontsBtn = document.getElementById('resetFonts') as HTMLButtonElement;
const openOptionsBtn = document.getElementById('openOptions') as HTMLButtonElement;
const openLeakTestBtn = document.getElementById('openLeakTest') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const autoSaveToast = document.getElementById('autoSaveToast') as HTMLElement;

let currentConfig: SiteSpoofConfig = normalizeConfig(DEFAULT_CONFIG);
let currentHostname = '';
let autoSaveTimer: number | null = null;


function showAutoSaveToast(): void {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveToast.classList.add('show');
  autoSaveTimer = window.setTimeout(() => {
    autoSaveToast.classList.remove('show');
    autoSaveTimer = null;
  }, 2000);
}


function updateGlobalStatus(): void {
  globalStatusEl.textContent = globalEnabledEl.checked ? '全局保护已启用' : '全局保护已禁用';
}

function populateForm(config: SiteSpoofConfig): void {
  globalEnabledEl.checked = config.masterEnabled;
  debugModeEl.checked = config.debugMode;
  updateGlobalStatus();
  ruleListEl.value = ruleLines(config.rules);

  const geo = config.globalProfile.geolocation;
  geolocationEnabledEl.checked = geo.enabled;
  latitudeEl.value = coordinateInputValue(geo.latitude);
  longitudeEl.value = coordinateInputValue(geo.longitude);
  accuracyEl.value = String(geo.accuracy);
  randomizeEl.checked = geo.randomize;
  randomRadiusMetersEl.value = String(geo.randomRadiusMeters);
  spoofPermissionEl.checked = geo.spoofPermission;

  const timezone = config.globalProfile.timezone;
  timezoneEnabledEl.checked = timezone.enabled;
  timezoneEl.value = timezone.timezone;
  // 必须按**配置里的时区**算，不能用宿主的 getTimezoneOffset()：
  // 选了 America/Los_Angeles 却显示 +08 是纯粹的误导。
  utcOffsetEl.value = utcOffsetInputValue(timezone.timezone);

  const language = config.globalProfile.language;
  languageEnabledEl.checked = language.enabled;
  languageEl.value = language.language;
  languagesEl.value = language.languages.join(', ');
  acceptLanguageEl.value = language.acceptLanguage;

  webrtcEnabledEl.checked = config.webRtc.globalMode !== 'default';
  webrtcPolicyEl.value = webRtcSelectValue(config);
  canvasEnabledEl.checked = config.canvas.enabled;
  canvasPlatformEl.value = config.canvas.platform;
  canvasHideCjkEl.checked = config.canvas.hideCjkFonts;
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
        mode: geolocationModeFromInput(latitudeEl.value, longitudeEl.value),
        latitude: parseCoordinateInput(latitudeEl.value),
        longitude: parseCoordinateInput(longitudeEl.value),
        accuracy: Number(accuracyEl.value),
        randomize: randomizeEl.checked,
        randomRadiusMeters: Number(randomRadiusMetersEl.value),
        spoofPermission: spoofPermissionEl.checked,
        history: currentConfig.globalProfile.geolocation.history
      })
    },
    webRtc: webrtcEnabledEl.checked ? normalizeWebRtc({ policy: webrtcPolicyEl.value }) : normalizeWebRtc({ globalMode: 'default' }),
    canvas: {
      ...currentConfig.canvas,
      enabled: canvasEnabledEl.checked,
      platform: canvasPlatformEl.value as SiteSpoofConfig['canvas']['platform'],
      hideCjkFonts: canvasHideCjkEl.checked
    }
  });
}

async function saveChanges(): Promise<void> {
  currentConfig = readForm();
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'setSiteConfig', config: currentConfig });
  currentConfig = normalizeConfig(response.config);
  showAutoSaveToast();
}

function renderSiteStatus(state: any): void {
  const status = describeSiteStatus(state || { matched: false, payload: null, errors: [] });
  siteWarningEl.hidden = !status.broken;
  siteOkEl.hidden = !status.active;
  if (status.broken) {
    siteWarningTextEl.textContent = status.text;
    siteWarningHintEl.textContent = status.hint;
  }
  retryLocationBtn.hidden = !status.broken;
}

async function loadConfig(): Promise<void> {
  const response = await sendRuntimeMessage<{ state: any }>({ action: 'getCurrentTabState' });
  currentConfig = normalizeConfig(response.state.config);
  currentHostname = response.state.domain || '';
  currentSiteEl.textContent = currentHostname || 'N/A';
  renderSiteStatus(response.state);
  populateForm(currentConfig);
}

async function handleApplyProfile(profileId: string): Promise<void> {
  if (!profileId) return;
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig }>({ action: 'applyProfile', profileId });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
  showAutoSaveToast();
}

async function handleEnableSite(): Promise<void> {
  if (!currentHostname) return;
  // upsert：站点没有任何规则时直接建一条启用的，已有的则翻成启用
  await sendRuntimeMessage({ action: 'setDomainRuleEnabled', domain: currentHostname, enabled: true });
  await loadConfig();
}

async function handleDisableSite(): Promise<void> {
  if (!currentHostname) return;
  // 「排除」而不是删除：保留规则才能在父域白名单里单独挖掉一个子域
  await sendRuntimeMessage({ action: 'setDomainRuleEnabled', domain: currentHostname, enabled: false });
  await loadConfig();
}

async function handleSaveCoordinate(): Promise<void> {
  // Number('') === 0：空输入会在历史里留下一条 (0,0)，先显式挡住。
  const latText = latitudeEl.value.trim();
  const lonText = longitudeEl.value.trim();
  const accText = accuracyEl.value.trim();
  if (!latText || !lonText || !accText) {
    alert('请填写完整的纬度和经度');
    return;
  }
  const lat = Number(latText);
  const lon = Number(lonText);
  const acc = Number(accText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(acc)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180 || acc < 0) {
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

async function handleRetryLocation(): Promise<void> {
  retryLocationBtn.disabled = true;
  retryLocationBtn.textContent = '获取中...';
  try {
    await sendRuntimeMessage({ action: 'manualUpdate' });
    await loadConfig();
  } finally {
    retryLocationBtn.disabled = false;
    retryLocationBtn.textContent = '重试定位';
  }
}

async function handleGetFromIP(): Promise<void> {
  getFromIPBtn.disabled = true;
  getFromIPBtn.textContent = '获取中...';
  try {
    await sendRuntimeMessage({ action: 'manualUpdate' });
    await loadConfig();
    showAutoSaveToast();
  } finally {
    getFromIPBtn.disabled = false;
    getFromIPBtn.textContent = '从 IP 自动配置';
  }
}

async function handleResetFonts(): Promise<void> {
  // 恢复的是三层默认值：平台 auto、中文层开、手动层清空
  currentConfig.canvas.platform = DEFAULT_CANVAS.platform;
  currentConfig.canvas.hideCjkFonts = DEFAULT_CANVAS.hideCjkFonts;
  currentConfig.canvas.targetFonts = [...DEFAULT_CANVAS.targetFonts];
  populateForm(currentConfig);
  await saveChanges();
}

globalEnabledEl.addEventListener('change', () => { updateGlobalStatus(); void saveChanges(); });
debugModeEl.addEventListener('change', () => { void saveChanges(); });
ruleListEl.addEventListener('blur', () => { void saveChanges(); });
enableSiteBtn.addEventListener('click', () => { void handleEnableSite(); });
retryLocationBtn.addEventListener('click', () => { void handleRetryLocation(); });
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
canvasPlatformEl.addEventListener('change', () => { void saveChanges(); });
canvasHideCjkEl.addEventListener('change', () => { void saveChanges(); });
saveCoordinateBtn.addEventListener('click', () => { void handleSaveCoordinate(); });
getFromIPBtn.addEventListener('click', () => { void handleGetFromIP(); });
resetFontsBtn.addEventListener('click', () => { void handleResetFonts(); });
openOptionsBtn.addEventListener('click', () => { void sendRuntimeMessage({ action: 'openOptions' }); });
openOptionsHeaderBtn.addEventListener('click', () => { void sendRuntimeMessage({ action: 'openOptions' }); });
openLeakTestBtn.addEventListener('click', () => { void sendRuntimeMessage({ action: 'openLeakTest' }); });
resetBtn.addEventListener('click', () => {
  currentConfig = normalizeConfig(DEFAULT_CONFIG);
  populateForm(currentConfig);
  void saveChanges();
});

document.querySelectorAll('.profile-card').forEach((card) => {
  card.addEventListener('click', () => {
    void handleApplyProfile((card as HTMLElement).dataset.profile || '');
  });
});

void loadConfig();
