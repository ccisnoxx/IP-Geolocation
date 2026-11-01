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
import { describeIpApplyError, geolocationModeFromInput, locationDisplay, parseCoordinateInput, utcOffsetInputValue, webRtcSelectValue } from '../shared/ui-values';
import { describeSiteStatus } from '../shared/site-status';
import { WORKER_FALLBACK_REASON_LABELS } from '../shared/worker-coverage';
import type { ExitIpApplyOutcome } from '../background/ip-sync';
import type { GeolocationHistory, LastLocation, SiteSpoofConfig } from '../shared/types';

const globalEnabledEl = document.getElementById('globalEnabled') as HTMLInputElement;
const debugModeEl = document.getElementById('debugMode') as HTMLInputElement;
const globalStatusEl = document.getElementById('globalStatus') as HTMLElement;
const globalStatePillEl = document.getElementById('globalStatePill') as HTMLElement;
const currentSiteEl = document.getElementById('currentSite') as HTMLElement;
const siteWarningEl = document.getElementById('siteWarning') as HTMLElement;
const siteWarningTextEl = document.getElementById('siteWarningText') as HTMLElement;
const siteWarningHintEl = document.getElementById('siteWarningHint') as HTMLElement;
const siteOkEl = document.getElementById('siteOk') as HTMLElement;
const workerFallbackEl = document.getElementById('workerFallback') as HTMLElement;
const workerFallbackTextEl = document.getElementById('workerFallbackText') as HTMLElement;
const workerFallbackHintEl = document.getElementById('workerFallbackHint') as HTMLElement;
const firstScreenEl = document.getElementById('firstScreen') as HTMLElement;
const firstScreenTextEl = document.getElementById('firstScreenText') as HTMLElement;
const firstScreenHintEl = document.getElementById('firstScreenHint') as HTMLElement;
const firstScreenOpenEl = document.getElementById('firstScreenOpen') as HTMLButtonElement;
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
const noNativeCallEl = document.getElementById('noNativeCall') as HTMLInputElement;
const saveCoordinateBtn = document.getElementById('saveCoordinate') as HTMLButtonElement;
const getFromIPBtn = document.getElementById('getFromIP') as HTMLButtonElement;
const ipConfigStatusEl = document.getElementById('ipConfigStatus') as HTMLElement;
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
const canvasOffBadgeEl = document.getElementById('canvasOffBadge') as HTMLElement;
const canvasOffHintEl = document.getElementById('canvasOffHint') as HTMLElement;
const resetFontsBtn = document.getElementById('resetFonts') as HTMLButtonElement;
const openOptionsBtn = document.getElementById('openOptions') as HTMLButtonElement;
const openLeakTestBtn = document.getElementById('openLeakTest') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const autoSaveToast = document.getElementById('autoSaveToast') as HTMLElement;
const locationFlagEl = document.getElementById('locationFlag') as HTMLElement;
const locationTitleEl = document.getElementById('locationTitle') as HTMLElement;
const locationSubEl = document.getElementById('locationSub') as HTMLElement;
const summaryGeoEl = document.getElementById('summaryGeo') as HTMLElement;
const summaryTzEl = document.getElementById('summaryTz') as HTMLElement;
const summaryPrivacyEl = document.getElementById('summaryPrivacy') as HTMLElement;
const summaryFontEl = document.getElementById('summaryFont') as HTMLElement;
const currentSiteSitesEl = document.getElementById('currentSiteSites') as HTMLElement;

/** 内置预设的展示文案：概览里的定位摘要不复用英文配置名 */
const PROFILE_SUMMARY: Record<string, { title: string; city: string; flag: string }> = {
  'us-west': { title: '美国 · 洛杉矶', city: '洛杉矶', flag: '🇺🇸' },
  singapore: { title: '新加坡', city: '新加坡', flag: '🇸🇬' },
  japan: { title: '日本 · 东京', city: '东京', flag: '🇯🇵' }
};

const COUNTRY_SUMMARY: Record<string, { label: string; flag: string }> = {
  'United States': { label: '美国', flag: '🇺🇸' },
  'United States of America': { label: '美国', flag: '🇺🇸' },
  USA: { label: '美国', flag: '🇺🇸' },
  Singapore: { label: '新加坡', flag: '🇸🇬' },
  Japan: { label: '日本', flag: '🇯🇵' },
  'United Kingdom': { label: '英国', flag: '🇬🇧' },
  Germany: { label: '德国', flag: '🇩🇪' },
  Canada: { label: '加拿大', flag: '🇨🇦' },
  Australia: { label: '澳大利亚', flag: '🇦🇺' }
};

let currentConfig: SiteSpoofConfig = normalizeConfig(DEFAULT_CONFIG);
let currentHostname = '';
let autoSaveTimer: number | null = null;
/** 后台最近一次定位结果：auto 档的坐标/时区要在表单里显示它，否则永远是空框 */
let currentLastLocation: LastLocation | null = null;
/**
 * 上一轮 `populateForm` 里由 auto 档算出来的显示值。
 * `readForm` 靠它区分"这几个数字是算出来的、用户没动"和"用户手填的"——
 * 否则每次保存都会把 auto 悄悄钉成 manual，跟随出口 IP 从此失效。
 */
let autoDisplay: { latitude: string; longitude: string; timezone: string; autoGeo: boolean; autoTimezone: boolean } | null = null;


function showAutoSaveToast(): void {
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveToast.classList.add('show');
  autoSaveTimer = window.setTimeout(() => {
    autoSaveToast.classList.remove('show');
    autoSaveTimer = null;
  }, 2000);
}


function updateGlobalStatus(): void {
  const enabled = globalEnabledEl.checked;
  globalStatusEl.textContent = enabled ? '全局保护已启用' : '全局保护已禁用';
  globalStatePillEl.textContent = enabled ? '已开启' : '已关闭';
  globalStatePillEl.classList.toggle('is-off', !enabled);
}

/** 概览页的定位摘要：优先当前预设，其次当前出口，最后才是空态 */
function resolveLocationSummary(
  config: SiteSpoofConfig,
  lastLocation: LastLocation | null
): { title: string; city: string; flag: string } {
  const activeId = config.profile.activeProfileId;
  const preset = activeId ? PROFILE_SUMMARY[activeId] : undefined;
  if (preset) return preset;

  const profile = activeId ? config.profile.profiles.find((item) => item.id === activeId) : undefined;
  const country = (profile?.geolocation.country || lastLocation?.country || '').trim();
  const countryInfo = COUNTRY_SUMMARY[country];

  if (profile) {
    return {
      title: profile.name || countryInfo?.label || '自定义配置',
      city: countryInfo?.label || country || profile.name || '自定义',
      flag: countryInfo?.flag || '🌐'
    };
  }
  if (lastLocation) {
    return {
      title: countryInfo?.label || country || '自动跟随出口',
      city: countryInfo?.label || country || '自动跟随',
      flag: countryInfo?.flag || '🌐'
    };
  }
  return { title: '自动跟随出口', city: '跟随出口 IP', flag: '🌐' };
}

/** 内置预设、自定义方案与 null（跟随出口）都要在概览里标出当前项 */
function syncProfileSelection(config: SiteSpoofConfig): void {
  const activeId = config.profile.activeProfileId;
  document.querySelectorAll<HTMLElement>('.profile-card').forEach((card) => {
    const active = card.dataset.profile === activeId;
    card.classList.toggle('is-active', active);
    card.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function syncLocationSummary(config: SiteSpoofConfig, lastLocation: LastLocation | null): void {
  const info = resolveLocationSummary(config, lastLocation);
  const display = locationDisplay(config.globalProfile.geolocation, config.globalProfile.timezone, lastLocation);
  const activeProfile = config.profile.activeProfileId
    ? config.profile.profiles.find((item) => item.id === config.profile.activeProfileId)
    : undefined;
  // auto 档在拿到出口 IP 前没有可显示的时区；预设本身有时区，先用它撑住摘要
  const timezone = display.timezone || activeProfile?.timezone.timezone || config.globalProfile.timezone.timezone || '未设置';
  const language = config.globalProfile.language.language || '未设置';
  locationFlagEl.textContent = info.flag;
  locationTitleEl.textContent = info.title;
  locationSubEl.textContent = `${timezone} · ${language}`;
  summaryGeoEl.textContent = info.city;
  summaryTzEl.textContent = `${info.city} · ${language}`;
  summaryPrivacyEl.textContent = config.webRtc.globalMode !== 'default' ? 'WebRTC 已启用' : 'WebRTC 未启用';
  summaryFontEl.textContent = config.canvas.enabled ? '已启用' : '未启用';
}

/** 自动配置结果行：失败必须看得见，否则用户只会觉得"点了一下没反应"。 */
function showIpConfigStatus(message: string, tone: 'ok' | 'error' | 'pending'): void {
  ipConfigStatusEl.hidden = !message;
  ipConfigStatusEl.textContent = message;
  ipConfigStatusEl.dataset.tone = tone;
}

/** 「完全不调用系统定位」必须与「伪装权限」同开：权限回答与坐标不能各说各的 */
function syncNoNativeCallControls(): void {
  noNativeCallEl.disabled = !spoofPermissionEl.checked && !noNativeCallEl.checked;
}

function populateForm(config: SiteSpoofConfig, lastLocation: LastLocation | null = currentLastLocation): void {
  globalEnabledEl.checked = config.masterEnabled;
  debugModeEl.checked = config.debugMode;
  updateGlobalStatus();
  ruleListEl.value = ruleLines(config.rules);

  const geo = config.globalProfile.geolocation;
  const timezone = config.globalProfile.timezone;
  // auto 档显示实际生效的定位（lastLocation），manual 档才显示配置里的值
  const display = locationDisplay(geo, timezone, lastLocation);
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
  // 必须按**显示出来的时区**算，不能用宿主的 getTimezoneOffset()：
  // 选了 America/Los_Angeles 却显示 +08 是纯粹的误导。
  utcOffsetEl.value = utcOffsetInputValue(display.timezone);

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
  syncCanvasHints(config.canvas.enabled);
  syncProfileSelection(config);
  syncLocationSummary(config, lastLocation);
}

/**
 * 字体层默认关着（见 `DEFAULT_CANVAS` 的注释：它会改写 canvas 度量）。
 * 但"关着"这件事必须在弹窗上看得见 —— 否则用户以为默认已经藏好，
 * 而检测站那边「已安装中文字体」照样给他加分。
 */
function syncCanvasHints(enabled: boolean): void {
  canvasOffBadgeEl.hidden = enabled;
  canvasOffHintEl.hidden = enabled;
}

function readForm(): SiteSpoofConfig {
  const rules = rulesFromText(ruleListEl.value, currentConfig.rules);
  // 显示的是 lastLocation 且用户没改过 → 仍然是 auto，别把它钉成 manual
  const geoTouched = !(autoDisplay?.autoGeo
    && autoDisplay.latitude === latitudeEl.value
    && autoDisplay.longitude === longitudeEl.value);
  const timezoneUntouched = Boolean(autoDisplay?.autoTimezone && autoDisplay.timezone === timezoneEl.value);
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
        mode: timezoneUntouched ? 'auto' : (timezoneEl.value ? 'manual' : 'auto'),
        timezone: timezoneEl.value
      }),
      geolocation: normalizeGeolocation({
        enabled: geolocationEnabledEl.checked,
        mode: geoTouched ? geolocationModeFromInput(latitudeEl.value, longitudeEl.value) : 'auto',
        latitude: parseCoordinateInput(latitudeEl.value),
        longitude: parseCoordinateInput(longitudeEl.value),
        accuracy: Number(accuracyEl.value),
        randomize: randomizeEl.checked,
        randomRadiusMeters: Number(randomRadiusMetersEl.value),
        spoofPermission: noNativeCallEl.checked ? true : spoofPermissionEl.checked,
        noNativeCall: noNativeCallEl.checked,
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
  // 摘要卡是概览的实时快照：改完字体/坐标/时区后不重开会话也要同步
  syncLocationSummary(currentConfig, currentLastLocation);
  syncProfileSelection(currentConfig);
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

/**
 * Worker 包装失败提示。
 *
 * 只对**被包装过却回退**的上下文有意义：SharedWorker 本来就不包装（UNSUPPORTED），
 * 它出现在这里没有信息量，也不该让人以为"出了故障"。
 */
function renderWorkerFallback(state: any): void {
  const summary = state && state.workerFallback;
  const count = summary && Number(summary.count) > 0 ? Number(summary.count) : 0;
  if (!count) {
    workerFallbackEl.hidden = true;
    return;
  }
  const reasons: string[] = Array.isArray(summary.reasons)
    ? summary.reasons.map((reason: string) => (WORKER_FALLBACK_REASON_LABELS as Record<string, string>)[reason] || String(reason))
    : [];
  workerFallbackEl.hidden = false;
  workerFallbackTextEl.textContent = `同域页面报告 ${count} 次 Worker 包装失败${reasons.length ? `（${reasons.join('、')}）` : ''}`;
  workerFallbackHintEl.textContent = summary.lastScript
    ? `报告称已回退原生入口，尚未独立验证；Date / Intl 可能暴露本机值。最近一次：${summary.lastScript}`
    : '报告称已回退原生入口，尚未独立验证；Date / Intl 可能暴露本机值。';
}

/**
 * 首屏保护提示：「允许用户脚本」没开时，网页最前面的脚本会先读到真实值（配置异步送到）。
 * 后台收不到开关变化的通知，这里每次打开弹窗都问一次（后台会顺手对齐注册状态）。
 * Chrome 138 起开关在扩展详情页，之前是扩展管理页的开发者模式。
 */
async function renderFirstScreen(): Promise<void> {
  let status: { mode: string; chromeMajor: number | null; extensionId: string } | undefined;
  try {
    status = (await sendRuntimeMessage<{ state: typeof status }>({ action: 'getFirstScreenStatus' })).state;
  } catch {
    status = undefined;
  }
  // 读不到状态（后台出错、旧版后台）就不提示：宁可少一条提示，也不报出不确定的结论
  if (!status || status.mode === 'userScripts' || status.mode === 'baked') {
    firstScreenEl.hidden = true;
    return;
  }
  firstScreenEl.hidden = false;
  if (status.mode === 'unsupported') {
    firstScreenTextEl.textContent = '浏览器版本过低，首屏保护不可用';
    firstScreenHintEl.textContent = '需要 Chrome 120 及以上。网页最前面的脚本会先读到真实值；需要首屏即生效请改用烘焙构建。';
    firstScreenOpenEl.hidden = true;
    return;
  }
  const perExtension = status.chromeMajor === null || status.chromeMajor >= 138;
  firstScreenTextEl.textContent = '首屏保护未开启';
  firstScreenHintEl.textContent = perExtension
    ? '网页最前面的脚本会先读到真实值。在扩展详情页打开「允许用户脚本」，再刷新网页即可首屏生效。'
    : '网页最前面的脚本会先读到真实值。在扩展管理页右上角打开「开发者模式」，再刷新网页即可首屏生效。';
  firstScreenOpenEl.hidden = false;
  firstScreenOpenEl.onclick = () => {
    void chrome.tabs.create({ url: perExtension ? `chrome://extensions/?id=${status.extensionId}` : 'chrome://extensions/' });
  };
}

async function loadConfig(): Promise<void> {
  const response = await sendRuntimeMessage<{ state: any }>({ action: 'getCurrentTabState' });
  currentConfig = normalizeConfig(response.state.config);
  currentLastLocation = (response.state.lastLocation as LastLocation | null) || null;
  currentHostname = response.state.domain || '';
  currentSiteEl.textContent = currentHostname || 'N/A';
  currentSiteSitesEl.textContent = currentHostname || 'N/A';
  renderSiteStatus(response.state);
  renderWorkerFallback(response.state);
  void renderFirstScreen();
  populateForm(currentConfig);
  // 首屏渲染完成标记：冒烟脚本和截图工具靠它判断"面板已经画完"。
  // 之前靠 sleep 或"storage 读到了"来判断，慢引擎（Helium）上会读到半成品 ——
  // 复选框还是默认值、状态文案却已经写好了，看着像状态不同步。
  document.documentElement.dataset.popupReady = '1';
}

/** 只刷新站点状态/Worker 提示，不碰表单（别把用户正在编辑的值冲掉） */
async function refreshSiteState(): Promise<void> {
  const response = await sendRuntimeMessage<{ state: any }>({ action: 'getCurrentTabState' });
  currentHostname = response.state.domain || '';
  currentSiteEl.textContent = currentHostname || 'N/A';
  currentSiteSitesEl.textContent = currentHostname || 'N/A';
  renderSiteStatus(response.state);
  renderWorkerFallback(response.state);
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
    const response = await sendRuntimeMessage<{ geo?: { ok?: boolean; error?: string } }>({ action: 'manualUpdate' });
    await loadConfig();
    if (response?.geo && response.geo.ok === false) {
      showIpConfigStatus(`定位失败：${response.geo.error || '查询出口 IP 失败'}`, 'error');
    }
  } finally {
    retryLocationBtn.disabled = false;
    retryLocationBtn.textContent = '重试定位';
  }
}

/**
 * 从 IP 自动配置：查出口，把坐标/时区/语言**写进当前配置**再应用。
 *
 * 以前这里发的是 `manualUpdate`（只刷新 lastLocation）：配置是 manual 时解析层
 * 根本不看 lastLocation，点完界面一个数字都不动 —— 正是"点了没反应"。
 */
async function handleGetFromIP(): Promise<void> {
  getFromIPBtn.disabled = true;
  getFromIPBtn.textContent = '获取中...';
  showIpConfigStatus('正在查询出口 IP...', 'pending');
  try {
    const response = await sendRuntimeMessage<{ outcome?: ExitIpApplyOutcome; config?: SiteSpoofConfig; lastLocation?: LastLocation | null }>({ action: 'applyFromExitIp' });
    const outcome = response?.outcome;
    if (!outcome || outcome.ok !== true) {
      showIpConfigStatus(`自动配置失败：${outcome?.error ? describeIpApplyError(outcome.error) : '后台没有返回结果'}`, 'error');
      return;
    }
    if (response.config) {
      currentConfig = normalizeConfig(response.config);
    }
    currentLastLocation = (response.lastLocation as LastLocation | null) || null;
    populateForm(currentConfig);
    const summary = [outcome.country, outcome.timezone, outcome.language].filter(Boolean).join(' · ');
    showIpConfigStatus(`已按出口 IP ${outcome.ip} 配置：${summary}`, 'ok');
    showAutoSaveToast();
    await refreshSiteState();
  } catch (error) {
    showIpConfigStatus(`自动配置失败：${error instanceof Error ? error.message : String(error)}`, 'error');
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
spoofPermissionEl.addEventListener('change', () => {
  // 关掉伪装权限就自动放掉"完全不碰原生"：否则归一化会把它又拉回来，界面像在抽风
  if (!spoofPermissionEl.checked) noNativeCallEl.checked = false;
  syncNoNativeCallControls();
  void saveChanges();
});
noNativeCallEl.addEventListener('change', () => {
  if (noNativeCallEl.checked) spoofPermissionEl.checked = true;
  syncNoNativeCallControls();
  void saveChanges();
});
timezoneEnabledEl.addEventListener('change', () => { void saveChanges(); });
timezoneEl.addEventListener('blur', () => { void saveChanges(); });
languageEnabledEl.addEventListener('change', () => { void saveChanges(); });
languageEl.addEventListener('blur', () => { void saveChanges(); });
languagesEl.addEventListener('blur', () => { void saveChanges(); });
acceptLanguageEl.addEventListener('blur', () => { void saveChanges(); });
webrtcEnabledEl.addEventListener('change', () => { void saveChanges(); });
webrtcPolicyEl.addEventListener('change', () => { void saveChanges(); });
canvasEnabledEl.addEventListener('change', () => {
  syncCanvasHints(canvasEnabledEl.checked);
  void saveChanges();
});
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

function setView(view: string): void {
  document.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll<HTMLElement>('.view').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.view === view);
  });
  // 三个视图共用同一个滚动容器，切换时回到顶部，避免继承上一页的滚动位置
  const scroller = document.querySelector<HTMLElement>('.views');
  if (scroller) scroller.scrollTop = 0;
}

document.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view || 'overview'));
});

/** 摘要行是进入详细配置的快捷入口：先切 tab，再展开对应层 */
document.querySelectorAll<HTMLElement>('.summary-row').forEach((row) => {
  row.addEventListener('click', () => {
    setView('config');
    const target = document.getElementById(row.dataset.target || '');
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView({ block: 'start' });
    }
  });
});

void loadConfig();
