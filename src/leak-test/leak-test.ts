// Local leak-test UI that compares page-visible values against the acceptance profile.
import './leak-test.css';
import {
  buildWebRtcLeakSnapshot,
  compareDiagnosticValue,
  compareGeolocationCoordinates,
  summarizeDiagnosticVerdicts,
  type DiagnosticVerdict
} from '../shared/diagnostic';
import {
  formatLocaleDateTimeForPage,
  normalizeLocaleDateTimeText
} from '../shared/locale-datetime';

type CheckRow = {
  id: string;
  label: string;
  expected: unknown;
  actual: unknown;
  status: DiagnosticVerdict;
  detail?: string;
};

type ExpectedProfile = {
  validationMode: ValidationMode;
  language: string | null;
  languages: string[] | null;
  acceptLanguage: string | null;
  timezone: string | null;
  timezoneOffset: number | null;
  latitude: number | null;
  longitude: number | null;
  localeString: string | null;
  localeStringTimestamp: number | null;
  geolocationToleranceMeters: number;
  webRtcMode: 'strict' | 'compatible' | 'default';
  webRtcPolicy: string | null;
  webRtcPolicyStateProvided: boolean;
  actualWebRtcPolicy: string | null;
  actualWebRtcPolicySupported: boolean | null;
  actualWebRtcPolicyLevelOfControl: string | null;
  actualWebRtcPolicyControlledByThisExtension: boolean | null;
  actualWebRtcLeakProtectionActive: boolean | null;
  actualWebRtcPolicyError: string | null;
  stunUrls: string[];
  iceTimeoutMs: number;
};

type RealmSnapshot = {
  language: string;
  languages: string[];
  locale: string;
  timezone: string;
  offsetMinutes: number;
  dateString: string;
};

type PassThroughSnapshot = Record<string, string>;

type UiLanguage = 'zh' | 'en';
type ValidationMode = 'observe' | 'acceptance';

const I18N_EN = {
  documentTitle: 'VanishGeo Leak Test',
  languageSwitchLabel: 'Language switch',
  eyebrow: 'Allowlisted web-origin acceptance target',
  pageTitle: 'VanishGeo Leak Test',
  subtitle: 'Displays page-visible values. When opened from VanishGeo with an effective profile, it reports PASS / FAIL / UNKNOWN.',
  testTargetTitle: 'Test Target',
  currentOriginLabel: 'Current origin',
  validationModeLabel: 'Validation mode',
  expectedProfileLabel: 'Expected profile',
  expectedProfileNoteHtml: 'Direct visits use observation mode and do not assume any country. Open this page from VanishGeo, or pass explicit query params such as <code>?validation=acceptance&amp;expectedLanguage=en-US&amp;expectedTimezone=America/Los_Angeles</code>, to run acceptance comparisons.',
  observationModeSummary: 'Observation mode: no expected profile was provided; values are shown without profile PASS / FAIL judgment.',
  acceptanceModeSummary: 'Acceptance mode: comparing against the expected profile supplied in the URL.',
  actionsTitle: 'Actions',
  runAllChecksButton: 'Run all checks',
  runGeolocationButton: 'Run geolocation',
  runWebRtcButton: 'Run WebRTC ICE',
  runRealmChecksButton: 'Run iframe / worker',
  captureBaselineButton: 'Capture pass-through baseline',
  clearBaselineButton: 'Clear pass-through baseline',
  languageSectionTitle: 'Language And Request Header',
  timezoneSectionTitle: 'Timezone',
  geolocationSectionTitle: 'Geolocation',
  webrtcSectionTitle: 'WebRTC Policy And ICE',
  webrtcNoteHtml: 'When opened from VanishGeo, the extension reads Chrome privacy policy in the background and passes that snapshot to this page. Direct visits may show UNKNOWN.',
  realmSectionTitle: 'Iframe And Worker Realms',
  passThroughSectionTitle: 'Pass-Through Real-Device Surfaces',
  passThroughNoteHtml: 'Capture the baseline before allowlisting localhost, then reload after allowlisting and compare these rows.',
  rawValuesTitle: 'Raw Values',
  footerDisclaimerHtml: 'This page must be served from a normal HTTP(S) origin for allowlist validation. Use the hosted target <code>https://leak.962850.xyz/leak-test/leak-test.html</code> or the local development target <code>http://localhost:8787/leak-test/leak-test.html</code>. It does not add or spoof any real-device fingerprint surface.',
  expectedLabel: 'Expected',
  actualLabel: 'Actual',
  statusPass: 'PASS',
  statusFail: 'FAIL',
  statusUnknown: 'UNKNOWN',
  yes: 'yes',
  no: 'no',
  observeOnlyExpected: 'observe only',
  notConfiguredExpected: 'not configured',
  observationDetail: 'No expected value was provided, so this row is not judged.',
  notConfiguredDetail: 'This surface is not enabled in the expected profile.',
  runtimeExtensionNotice: 'Launcher/baseline only. Chrome does not inject this extension into its own extension page; open the hosted HTTPS target or serve it on localhost for allowlist validation.',
  runtimeLocalhostNotice: 'HTTP target. Add/enable localhost in VanishGeo, reload this page, then run checks.',
  runtimeHttpNoticePrefix: 'HTTP target. Add/enable ',
  runtimeHttpNoticeSuffix: ' in VanishGeo, reload this page, then run checks.',
  geoResultLabel: 'getCurrentPosition / watchPosition',
  clickRunGeolocation: 'click Run geolocation',
  webRtcPolicyLabel: 'Chrome WebRTC policy',
  policyNotCompleted: 'policy probe has not completed',
  iceExposureLabel: 'ICE candidate exposure',
  noIpCandidates: 'no local/private/public IP candidates',
  clickRunWebRtc: 'click Run WebRTC ICE',
  realmFixturesLabel: 'Iframe / worker realms',
  clickRunRealm: 'click Run iframe / worker',
  intlLocaleLabel: 'Intl.DateTimeFormat locale',
  acceptLanguageHeaderLabel: 'Accept-Language request header',
  intlTimezoneLabel: 'Intl.DateTimeFormat timezone',
  timezoneOffsetLabel: 'Date.getTimezoneOffset()',
  dateStringOffsetLabel: 'Date.toString() offset',
  dateStringOffsetDetail: 'Date string should include expected GMT offset',
  localeStringLabel: 'Date.toLocaleString() sample',
  localeStringDetail: 'Compares Date.toLocaleString() for the extension-provided current timestamp at minute precision.',
  localeStringExpectedUnavailableDetail: 'Open this page from VanishGeo so the extension can provide the expected localized time string.',
  webRtcPolicyDetail: 'compares requested and actual Chrome privacy policy',
  webRtcPolicyHostedDetail: 'Open this page from VanishGeo so the background can provide the Chrome privacy policy snapshot.',
  webRtcPolicyReadFailedDetail: 'the extension could not read Chrome privacy policy before opening this page',
  webRtcPolicySnapshotMissingDetail: 'the extension did not provide an actual Chrome policy value',
  geoExistsLabel: 'navigator.geolocation exists',
  geoApiVisibleDetail: 'geolocation API must be visible',
  permissionStatusLabel: 'Permission status',
  granted: 'granted',
  permissionQueryFailedDetail: 'permission query failed',
  permissionsUnavailableDetail: 'navigator.permissions is unavailable',
  geoPositionLabel: 'getCurrentPosition coordinate',
  geoAccuracyLabel: 'getCurrentPosition accuracy',
  positiveAccuracy: 'positive accuracy',
  positiveAccuracyDetail: 'accuracy must be a positive numeric value',
  geoPositionFailedDetail: 'getCurrentPosition did not return a position',
  geoWatchLabel: 'watchPosition first callback',
  watchFailedDetail: 'watchPosition did not return a position',
  rtcUnavailableDetail: 'RTCPeerConnection is unavailable',
  candidateTypeFallback: 'candidate',
  noCandidates: 'no candidates',
  iceCompletedNoCandidates: 'ICE completed without IP candidates',
  iceFailedDetail: 'ICE gathering failed before a conclusive leak result',
  topWindowRealmLabel: 'Top window realm',
  realmSnapshotUnavailable: 'realm snapshot is unavailable',
  iframeLabelPrefix: 'iframe: ',
  iframeAboutBlankLabel: 'about:blank',
  iframeSrcdocLabel: 'srcdoc',
  iframeSameOriginLabel: 'same-origin fixture',
  workerClassicLabel: 'classic Worker',
  workerModuleLabel: 'module Worker',
  sharedWorkerLabel: 'SharedWorker',
  workerTimeout: 'worker timeout',
  workerFailed: 'worker failed',
  sharedWorkerUnsupported: 'SharedWorker is unsupported',
  sharedWorkerTimeout: 'shared worker timeout',
  sharedWorkerMessageFailed: 'shared worker message failed',
  storedBaseline: 'stored pre-allowlist baseline',
  captureBaselineBeforeAllowlist: 'capture baseline before allowlisting localhost',
  baselineLoadedPrefix: 'Baseline loaded from ',
  noBaseline: 'No pass-through baseline stored yet.',
  webglAvailableNoDebug: 'WebGL available (debug renderer unavailable)',
  chromeRuntimeUnavailable: 'chrome.runtime is unavailable'
} as const;

type I18nKey = keyof typeof I18N_EN;

const I18N_ZH: Record<I18nKey, string> = {
  documentTitle: 'VanishGeo 隐私检测',
  languageSwitchLabel: '语言切换',
  eyebrow: '白名单网页环境验收目标',
  pageTitle: 'VanishGeo 隐私检测',
  subtitle: '展示页面可见值；从 VanishGeo 携带有效配置打开时，再报告 PASS 通过 / FAIL 失败 / UNKNOWN 未知。',
  testTargetTitle: '检测目标',
  currentOriginLabel: '当前来源',
  validationModeLabel: '验证模式',
  expectedProfileLabel: '期望配置',
  expectedProfileNoteHtml: '直接访问时使用观察模式，不默认假设任何国家。请从 VanishGeo 打开本页，或显式传入查询参数，例如 <code>?validation=acceptance&amp;expectedLanguage=en-US&amp;expectedTimezone=America/Los_Angeles</code>，再进行验收对比。',
  observationModeSummary: '观察模式：未提供期望配置，仅展示当前页面可见值，不按 profile 判定 PASS / FAIL。',
  acceptanceModeSummary: '验收模式：正在与 URL 中提供的期望配置对比。',
  actionsTitle: '操作',
  runAllChecksButton: '运行全部检测',
  runGeolocationButton: '运行地理位置检测',
  runWebRtcButton: '运行 WebRTC ICE 检测',
  runRealmChecksButton: '运行 iframe / worker 检测',
  captureBaselineButton: '记录真实设备基线',
  clearBaselineButton: '清除真实设备基线',
  languageSectionTitle: '语言与请求头',
  timezoneSectionTitle: '时区',
  geolocationSectionTitle: '地理位置',
  webrtcSectionTitle: 'WebRTC 策略与 ICE',
  webrtcNoteHtml: '从 VanishGeo 打开时，扩展会在后台读取 Chrome 隐私策略并把快照传给本页；直接访问时可能显示 UNKNOWN 未知。',
  realmSectionTitle: 'Iframe 与 Worker 环境',
  passThroughSectionTitle: '真实设备透传项',
  passThroughNoteHtml: '先在未加入白名单前记录基线；加入白名单并刷新后，再对比这些真实设备项是否保持不变。',
  rawValuesTitle: '原始值',
  footerDisclaimerHtml: '此页面必须运行在可加入白名单的普通 HTTP(S) 来源下。可使用托管地址 <code>https://leak.962850.xyz/leak-test/leak-test.html</code>，也可使用本地开发地址 <code>http://localhost:8787/leak-test/leak-test.html</code>。页面本身不会新增或伪造任何真实设备指纹项。',
  expectedLabel: '期望',
  actualLabel: '实际',
  statusPass: 'PASS 通过',
  statusFail: 'FAIL 失败',
  statusUnknown: 'UNKNOWN 未知',
  yes: '是',
  no: '否',
  observeOnlyExpected: '仅观察',
  notConfiguredExpected: '未配置',
  observationDetail: '未提供期望值，因此此项不参与判定。',
  notConfiguredDetail: '期望配置中未启用此项。',
  runtimeExtensionNotice: '当前是扩展页启动器/基线页。Chrome 不会把本扩展注入自己的扩展页；请打开托管 HTTPS 目标或本地 localhost 页面进行白名单验证。',
  runtimeLocalhostNotice: 'HTTP 检测目标。请在 VanishGeo 中添加并启用 localhost，刷新本页后再运行检测。',
  runtimeHttpNoticePrefix: 'HTTP 检测目标。请在 VanishGeo 中添加并启用 ',
  runtimeHttpNoticeSuffix: '，刷新本页后再运行检测。',
  geoResultLabel: 'getCurrentPosition / watchPosition',
  clickRunGeolocation: '点击“运行地理位置检测”',
  webRtcPolicyLabel: 'Chrome WebRTC 策略',
  policyNotCompleted: '策略探测尚未完成',
  iceExposureLabel: 'ICE 候选地址暴露',
  noIpCandidates: '无本地/私网/公网 IP 候选地址',
  clickRunWebRtc: '点击“运行 WebRTC ICE 检测”',
  realmFixturesLabel: 'Iframe / worker 环境',
  clickRunRealm: '点击“运行 iframe / worker 检测”',
  intlLocaleLabel: 'Intl.DateTimeFormat locale',
  acceptLanguageHeaderLabel: 'Accept-Language 请求头',
  intlTimezoneLabel: 'Intl.DateTimeFormat 时区',
  timezoneOffsetLabel: 'Date.getTimezoneOffset()',
  dateStringOffsetLabel: 'Date.toString() 时区偏移',
  dateStringOffsetDetail: 'Date 字符串应包含期望的 GMT 偏移',
  localeStringLabel: 'Date.toLocaleString() 示例',
  localeStringDetail: '使用扩展传入的当前时间戳，按分钟精度对比 Date.toLocaleString() 输出。',
  localeStringExpectedUnavailableDetail: '请从 VanishGeo 打开本页，以便扩展提供期望的本地化时间字符串。',
  webRtcPolicyDetail: '对比请求策略与 Chrome 实际隐私策略',
  webRtcPolicyHostedDetail: '请从 VanishGeo 打开本页，以便后台提供 Chrome 隐私策略快照。',
  webRtcPolicyReadFailedDetail: '扩展打开本页前读取 Chrome 隐私策略失败',
  webRtcPolicySnapshotMissingDetail: '扩展未提供 Chrome 实际策略值',
  geoExistsLabel: 'navigator.geolocation 存在',
  geoApiVisibleDetail: '页面应能看到 geolocation API',
  permissionStatusLabel: '权限状态',
  granted: 'granted',
  permissionQueryFailedDetail: '权限查询失败',
  permissionsUnavailableDetail: 'navigator.permissions 不可用',
  geoPositionLabel: 'getCurrentPosition 坐标',
  geoAccuracyLabel: 'getCurrentPosition 精度',
  positiveAccuracy: '正数精度',
  positiveAccuracyDetail: '精度必须是正数',
  geoPositionFailedDetail: 'getCurrentPosition 未返回位置',
  geoWatchLabel: 'watchPosition 首次回调',
  watchFailedDetail: 'watchPosition 未返回位置',
  rtcUnavailableDetail: 'RTCPeerConnection 不可用',
  candidateTypeFallback: '候选地址',
  noCandidates: '无候选地址',
  iceCompletedNoCandidates: 'ICE 完成，未暴露 IP 候选地址',
  iceFailedDetail: 'ICE 收集失败，无法得到确定泄露结论',
  topWindowRealmLabel: '顶层窗口环境',
  realmSnapshotUnavailable: '无法获取环境快照',
  iframeLabelPrefix: 'iframe：',
  iframeAboutBlankLabel: 'about:blank',
  iframeSrcdocLabel: 'srcdoc',
  iframeSameOriginLabel: '同源 fixture',
  workerClassicLabel: '经典 Worker',
  workerModuleLabel: '模块 Worker',
  sharedWorkerLabel: 'SharedWorker',
  workerTimeout: 'worker 超时',
  workerFailed: 'worker 失败',
  sharedWorkerUnsupported: '不支持 SharedWorker',
  sharedWorkerTimeout: 'shared worker 超时',
  sharedWorkerMessageFailed: 'shared worker 消息失败',
  storedBaseline: '已保存的白名单前基线',
  captureBaselineBeforeAllowlist: '请先在未加入 localhost 白名单前记录基线',
  baselineLoadedPrefix: '已加载基线：',
  noBaseline: '尚未保存真实设备基线。',
  webglAvailableNoDebug: 'WebGL 可用（无法读取调试渲染器）',
  chromeRuntimeUnavailable: 'chrome.runtime 不可用'
};

const I18N: Record<UiLanguage, Record<I18nKey, string>> = {
  en: I18N_EN,
  zh: I18N_ZH
};

const DEFAULT_GEOLOCATION_TOLERANCE_METERS = 1000;
const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302'];
const DEFAULT_ICE_TIMEOUT_MS = 5000;

const sections = new Map<string, CheckRow[]>();
const rawSnapshots: Record<string, unknown> = {};
const baselineKey = `vanishgeoLeakTestPassThroughBaseline:v1:${window.location.origin}`;
const uiLanguageKey = 'vanishgeoLeakTestUiLanguage:v1';
const statusClassNames = ['status-pass', 'status-fail', 'status-unknown'];
let uiLanguage = readInitialUiLanguage();

const runtimeOriginEl = requireElement('runtimeOrigin');
const runtimeOriginNoticeEl = requireElement('runtimeOriginNotice');
const expectedProfileEl = requireElement('expectedProfile');
const overallStatusEl = requireElement('overallStatus');
const baselineStatusEl = requireElement('baselineStatus');
const rawValuesEl = requireElement('rawValues');
const languageSwitchEl = requireElement('languageSwitch');
const expectedProfileNoteEl = requireElement('expectedProfileNote');
const webRtcNoteEl = requireElement('webrtcNote');
const passThroughNoteEl = requireElement('passThroughNote');
const footerDisclaimerEl = requireElement('footerDisclaimer');
const runAllChecksBtn = requireButton('runAllChecks');
const testGeolocationBtn = requireButton('testGeolocation');
const testWebRTCBtn = requireButton('testWebRTC');
const runRealmChecksBtn = requireButton('runRealmChecks');
const captureBaselineBtn = requireButton('captureBaseline');
const clearBaselineBtn = requireButton('clearBaseline');
const uiLangZhBtn = requireButton('uiLangZh');
const uiLangEnBtn = requireButton('uiLangEn');
const expected = readExpectedProfile();

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  return requireElement(id) as HTMLButtonElement;
}

function readInitialUiLanguage(): UiLanguage {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('ui');
  if (fromUrl === 'zh' || fromUrl === 'en') return fromUrl;
  const fromStorage = window.localStorage.getItem(uiLanguageKey);
  return fromStorage === 'en' ? 'en' : 'zh';
}

function t(key: I18nKey): string {
  return I18N[uiLanguage][key];
}

function statusText(status: DiagnosticVerdict): string {
  if (status === 'PASS') return t('statusPass');
  if (status === 'FAIL') return t('statusFail');
  return t('statusUnknown');
}

function setUiLanguage(nextLanguage: UiLanguage, options: { persist: boolean; rerender: boolean }): void {
  uiLanguage = nextLanguage;
  if (options.persist) {
    window.localStorage.setItem(uiLanguageKey, nextLanguage);
  }
  applyStaticTranslations();
  if (options.rerender) {
    resetDiagnosticDisplay();
  }
}

function applyStaticTranslations(): void {
  document.documentElement.lang = uiLanguage === 'zh' ? 'zh-CN' : 'en';
  document.title = t('documentTitle');
  languageSwitchEl.setAttribute('aria-label', t('languageSwitchLabel'));
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n as I18nKey | undefined;
    if (key && key in I18N_EN) {
      element.textContent = t(key);
    }
  });
  expectedProfileNoteEl.innerHTML = t('expectedProfileNoteHtml');
  webRtcNoteEl.innerHTML = t('webrtcNoteHtml');
  passThroughNoteEl.innerHTML = t('passThroughNoteHtml');
  footerDisclaimerEl.innerHTML = t('footerDisclaimerHtml');
  uiLangZhBtn.classList.toggle('active', uiLanguage === 'zh');
  uiLangEnBtn.classList.toggle('active', uiLanguage === 'en');
}

function resetDiagnosticDisplay(): void {
  sections.clear();
  Object.keys(rawSnapshots).forEach((key) => {
    delete rawSnapshots[key];
  });
  renderInitialState();
  void runPassiveChecks();
}

function readParam(name: string, fallback: string): string {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  return value && value.trim() ? value.trim() : fallback;
}

function readOptionalParam(name: string): string | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  return value && value.trim() ? value.trim() : null;
}

function readNumberParam(name: string, fallback: number): number {
  const parsed = Number(readParam(name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalNumberParam(name: string): number | null {
  const value = readOptionalParam(name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalBooleanParam(name: string): boolean | null {
  const value = readOptionalParam(name);
  if (value === null) return null;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}

function readOptionalListParam(name: string): string[] | null {
  const value = readOptionalParam(name);
  if (value === null) return null;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

function readExpectedProfile(): ExpectedProfile {
  const params = new URLSearchParams(window.location.search);
  const validationMode: ValidationMode = params.get('validation') === 'acceptance'
    || [...params.keys()].some((key) => key.startsWith('expected'))
    ? 'acceptance'
    : 'observe';
  const hasExpectedWebRtc = params.has('expectedWebRtcMode') || params.has('expectedWebRtcPolicy');
  const webRtcMode = readParam('expectedWebRtcMode', 'strict');
  const normalizedMode = webRtcMode === 'compatible' || webRtcMode === 'default' ? webRtcMode : 'strict';
  const policyFallback = normalizedMode === 'strict'
    ? 'disable_non_proxied_udp'
    : normalizedMode === 'compatible'
      ? 'default_public_interface_only'
      : 'default';
  const webRtcPolicyStateProvided = [
    'actualWebRtcPolicy',
    'actualWebRtcPolicySupported',
    'actualWebRtcPolicyLevelOfControl',
    'actualWebRtcPolicyControlledByThisExtension',
    'actualWebRtcLeakProtectionActive',
    'actualWebRtcPolicyError'
  ].some((name) => params.has(name));

  return {
    validationMode,
    language: readOptionalParam('expectedLanguage'),
    languages: readOptionalListParam('expectedLanguages'),
    acceptLanguage: readOptionalParam('expectedAcceptLanguage'),
    timezone: readOptionalParam('expectedTimezone'),
    timezoneOffset: readOptionalNumberParam('expectedTimezoneOffset'),
    latitude: readOptionalNumberParam('expectedLatitude'),
    longitude: readOptionalNumberParam('expectedLongitude'),
    localeString: readOptionalParam('expectedLocaleString'),
    localeStringTimestamp: readOptionalNumberParam('expectedLocaleStringTimestamp'),
    geolocationToleranceMeters: readNumberParam('expectedGeoToleranceMeters', DEFAULT_GEOLOCATION_TOLERANCE_METERS),
    webRtcMode: normalizedMode,
    webRtcPolicy: hasExpectedWebRtc ? readParam('expectedWebRtcPolicy', policyFallback) : null,
    webRtcPolicyStateProvided,
    actualWebRtcPolicy: readOptionalParam('actualWebRtcPolicy'),
    actualWebRtcPolicySupported: readOptionalBooleanParam('actualWebRtcPolicySupported'),
    actualWebRtcPolicyLevelOfControl: readOptionalParam('actualWebRtcPolicyLevelOfControl'),
    actualWebRtcPolicyControlledByThisExtension: readOptionalBooleanParam('actualWebRtcPolicyControlledByThisExtension'),
    actualWebRtcLeakProtectionActive: readOptionalBooleanParam('actualWebRtcLeakProtectionActive'),
    actualWebRtcPolicyError: readOptionalParam('actualWebRtcPolicyError'),
    stunUrls: readOptionalListParam('stunUrls') || DEFAULT_STUN_URLS,
    iceTimeoutMs: readNumberParam('iceTimeoutMs', DEFAULT_ICE_TIMEOUT_MS)
  };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function statusClass(status: DiagnosticVerdict): string {
  return status === 'PASS' ? 'status-pass' : status === 'FAIL' ? 'status-fail' : 'status-unknown';
}

function createRowElement(row: CheckRow): HTMLElement {
  const element = document.createElement('div');
  element.className = 'verdict-row';
  const detail = row.detail ? `<div class="verdict-detail">${escapeHtml(row.detail)}</div>` : '';
  element.innerHTML = `
    <div class="verdict-label">${escapeHtml(row.label)}</div>
    <div class="verdict-expected"><strong>${escapeHtml(t('expectedLabel'))}:</strong> ${escapeHtml(formatValue(row.expected))}</div>
    <div class="verdict-actual"><strong>${escapeHtml(t('actualLabel'))}:</strong> ${escapeHtml(formatValue(row.actual))}</div>
    <div class="status-badge ${statusClass(row.status)}">${escapeHtml(statusText(row.status))}</div>
    ${detail}
  `;
  return element;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSection(sectionId: string, rows: CheckRow[]): void {
  sections.set(sectionId, rows);
  const container = requireElement(sectionId);
  container.replaceChildren(...rows.map(createRowElement));
  renderSummary();
}

function renderSummary(): void {
  const rows = [...sections.values()].flat();
  const summary = summarizeDiagnosticVerdicts(rows.map((row) => row.status));
  overallStatusEl.textContent = `${statusText(summary.status)} ${summary.passed}/${summary.total}`;
  overallStatusEl.classList.remove(...statusClassNames);
  overallStatusEl.classList.add(statusClass(summary.status));
  rawValuesEl.textContent = JSON.stringify({ expected, summary, snapshots: rawSnapshots }, null, 2);
}

function rowFromComparison(
  id: string,
  label: string,
  expectedValue: unknown,
  actualValue: unknown,
  kind?: 'string' | 'list' | 'number',
  tolerance?: number
): CheckRow {
  const result = compareDiagnosticValue({ expected: expectedValue, actual: actualValue, kind, tolerance });
  return {
    id,
    label,
    expected: expectedValue,
    actual: actualValue,
    status: result.status,
    detail: result.message
  };
}

function unknownRow(id: string, label: string, expectedValue: unknown, message: string): CheckRow {
  return {
    id,
    label,
    expected: expectedValue,
    actual: '-',
    status: 'UNKNOWN',
    detail: message
  };
}

function passFailRow(id: string, label: string, expectedValue: unknown, actualValue: unknown, passed: boolean, detail: string): CheckRow {
  return {
    id,
    label,
    expected: expectedValue,
    actual: actualValue,
    status: passed ? 'PASS' : 'FAIL',
    detail
  };
}

function isExpectedValueConfigured(value: unknown): boolean {
  return value !== null
    && value !== undefined
    && !(typeof value === 'string' && value.trim() === '')
    && !(Array.isArray(value) && value.length === 0);
}

function missingExpectedValue(): string {
  return expected.validationMode === 'observe' ? t('observeOnlyExpected') : t('notConfiguredExpected');
}

function missingExpectedDetail(): string {
  return expected.validationMode === 'observe' ? t('observationDetail') : t('notConfiguredDetail');
}

function observationRow(id: string, label: string, actualValue: unknown, detail = missingExpectedDetail()): CheckRow {
  return {
    id,
    label,
    expected: missingExpectedValue(),
    actual: actualValue,
    status: 'UNKNOWN',
    detail
  };
}

function rowFromOptionalComparison(
  id: string,
  label: string,
  expectedValue: unknown,
  actualValue: unknown,
  kind?: 'string' | 'list' | 'number',
  tolerance?: number
): CheckRow {
  return isExpectedValueConfigured(expectedValue)
    ? rowFromComparison(id, label, expectedValue, actualValue, kind, tolerance)
    : observationRow(id, label, actualValue);
}

function expectedCoordinateText(): string {
  return expected.latitude !== null && expected.longitude !== null
    ? `${expected.latitude}, ${expected.longitude}`
    : missingExpectedValue();
}

function expectedRealmText(): string {
  const values = [expected.language, expected.timezone].filter(isExpectedValueConfigured);
  return values.length ? values.join(' / ') : missingExpectedValue();
}

function expectedProfileSummary(): string {
  if (expected.validationMode === 'observe') {
    return t('observationModeSummary');
  }

  const items = [
    expected.language ? `language=${expected.language}` : '',
    expected.languages ? `languages=${expected.languages.join(',')}` : '',
    expected.acceptLanguage ? `acceptLanguage=${expected.acceptLanguage}` : '',
    expected.timezone ? `timezone=${expected.timezone}` : '',
    expected.timezoneOffset !== null ? `offset=${expected.timezoneOffset}` : '',
    expected.latitude !== null && expected.longitude !== null ? `geo=${expected.latitude},${expected.longitude}` : '',
    expected.webRtcPolicy ? `webrtc=${expected.webRtcMode}` : '',
    `stun=${expected.stunUrls.join(',') || 'none'}`
  ].filter(Boolean);
  return items.length ? items.join(' | ') : t('acceptanceModeSummary');
}

function renderInitialState(): void {
  runtimeOriginEl.textContent = window.location.origin || window.location.href;
  expectedProfileEl.textContent = expectedProfileSummary();

  if (window.location.protocol === 'chrome-extension:') {
    runtimeOriginNoticeEl.textContent = t('runtimeExtensionNotice');
    runtimeOriginNoticeEl.classList.add('warning');
  } else {
    const host = window.location.hostname;
    runtimeOriginNoticeEl.textContent = host === 'localhost'
      ? t('runtimeLocalhostNotice')
      : `${t('runtimeHttpNoticePrefix')}${host}${t('runtimeHttpNoticeSuffix')}`;
    runtimeOriginNoticeEl.classList.remove('warning');
  }

  renderSection('geolocationChecks', [
    unknownRow('geo-result', t('geoResultLabel'), expectedCoordinateText(), t('clickRunGeolocation'))
  ]);
  renderSection('webrtcChecks', [
    unknownRow('webrtc-policy', t('webRtcPolicyLabel'), expected.webRtcPolicy || missingExpectedValue(), t('policyNotCompleted')),
    unknownRow('webrtc-ice', t('iceExposureLabel'), t('noIpCandidates'), t('clickRunWebRtc'))
  ]);
  renderSection('realmChecks', [
    unknownRow('realm-fixtures', t('realmFixturesLabel'), expectedRealmText(), t('clickRunRealm'))
  ]);
}

async function runPassiveChecks(): Promise<void> {
  renderLanguageChecks(await loadAcceptLanguageHeader());
  renderTimezoneChecks();
  await renderWebRtcPolicy();
  renderPassThroughChecks();
}

async function loadAcceptLanguageHeader(): Promise<string | null> {
  if (window.location.protocol === 'chrome-extension:') return null;
  try {
    const response = await fetch('/headers.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data?.acceptLanguage || null;
  } catch {
    return null;
  }
}

function renderLanguageChecks(acceptLanguageHeader: string | null): void {
  const locale = safeRead(() => new Intl.DateTimeFormat().resolvedOptions().locale);
  const rows = [
    rowFromOptionalComparison('navigator-language', 'navigator.language', expected.language, navigator.language || null),
    rowFromOptionalComparison('navigator-languages', 'navigator.languages', expected.languages, Array.from(navigator.languages || []), 'list'),
    rowFromOptionalComparison('intl-locale', t('intlLocaleLabel'), expected.language, locale),
    rowFromOptionalComparison('accept-language-header', t('acceptLanguageHeaderLabel'), expected.acceptLanguage, acceptLanguageHeader)
  ];
  rawSnapshots.language = {
    navigatorLanguage: navigator.language,
    navigatorLanguages: Array.from(navigator.languages || []),
    intlLocale: locale,
    acceptLanguageHeader
  };
  renderSection('languageChecks', rows);
}

function renderTimezoneChecks(): void {
  const localeStringRow = buildLocaleStringRow();
  const timezone = safeRead(() => new Intl.DateTimeFormat().resolvedOptions().timeZone);
  const offset = new Date().getTimezoneOffset();
  const dateString = new Date().toString();
  const expectedOffsetText = expected.timezoneOffset === null
    ? null
    : expected.timezoneOffset <= 0
      ? `GMT+${String(Math.floor(Math.abs(expected.timezoneOffset) / 60)).padStart(2, '0')}${String(Math.abs(expected.timezoneOffset) % 60).padStart(2, '0')}`
      : `GMT-${String(Math.floor(Math.abs(expected.timezoneOffset) / 60)).padStart(2, '0')}${String(Math.abs(expected.timezoneOffset) % 60).padStart(2, '0')}`;
  const rows = [
    rowFromOptionalComparison('intl-timezone', t('intlTimezoneLabel'), expected.timezone, timezone),
    rowFromOptionalComparison('timezone-offset', t('timezoneOffsetLabel'), expected.timezoneOffset, offset, 'number'),
    expectedOffsetText
      ? passFailRow('date-string-offset', t('dateStringOffsetLabel'), expectedOffsetText, dateString, dateString.includes(expectedOffsetText), t('dateStringOffsetDetail'))
      : observationRow('date-string-offset', t('dateStringOffsetLabel'), dateString),
    localeStringRow
  ];
  rawSnapshots.timezone = {
    timezone,
    offset,
    dateString,
    localeString: localeStringRow
  };
  renderSection('timezoneChecks', rows);
}

function buildLocaleStringRow(): CheckRow {
  const timestamp = expected.localeStringTimestamp;
  const probeDate = timestamp !== null ? new Date(timestamp) : new Date();
  const actualValue = formatLocaleDateTimeForPage(probeDate);
  if (!expected.localeString || timestamp === null) {
    return observationRow(
      'date-locale-string',
      t('localeStringLabel'),
      actualValue,
      t('localeStringExpectedUnavailableDetail')
    );
  }

  const normalizedExpected = normalizeLocaleDateTimeText(expected.localeString);
  const normalizedActual = normalizeLocaleDateTimeText(actualValue);
  return passFailRow(
    'date-locale-string',
    t('localeStringLabel'),
    expected.localeString,
    actualValue,
    normalizedExpected === normalizedActual,
    `${t('localeStringDetail')} ${new Date(timestamp).toISOString()}`
  );
}

function formatWebRtcPolicyActual(input: {
  requestedPolicy: string | null;
  actualPolicy: string | null;
  levelOfControl: string | null;
  leakProtectionActive: boolean | null;
  supported?: boolean | null;
}): string {
  return [
    input.supported === false ? 'supported=no' : '',
    `requested=${input.requestedPolicy || 'default'}`,
    `actual=${input.actualPolicy || 'unknown'}`,
    `control=${input.levelOfControl || 'unknown'}`,
    `strict=${input.leakProtectionActive ? 'yes' : 'no'}`
  ].filter(Boolean).join(' | ');
}

function buildWebRtcPolicyRowFromUrlSnapshot(): CheckRow {
  const actual = expected.actualWebRtcPolicyError
    ? expected.actualWebRtcPolicyError
    : formatWebRtcPolicyActual({
      requestedPolicy: expected.webRtcPolicy,
      actualPolicy: expected.actualWebRtcPolicy,
      levelOfControl: expected.actualWebRtcPolicyLevelOfControl,
      leakProtectionActive: expected.actualWebRtcLeakProtectionActive,
      supported: expected.actualWebRtcPolicySupported
    });

  if (!expected.webRtcPolicy) {
    return observationRow('webrtc-policy', t('webRtcPolicyLabel'), actual);
  }

  if (expected.actualWebRtcPolicyError) {
    return {
      id: 'webrtc-policy',
      label: t('webRtcPolicyLabel'),
      expected: expected.webRtcPolicy,
      actual,
      status: 'UNKNOWN',
      detail: t('webRtcPolicyReadFailedDetail')
    };
  }

  if (expected.actualWebRtcPolicySupported === false) {
    return passFailRow(
      'webrtc-policy',
      t('webRtcPolicyLabel'),
      expected.webRtcPolicy,
      actual,
      false,
      t('webRtcPolicyDetail')
    );
  }

  if (!expected.actualWebRtcPolicy) {
    return {
      id: 'webrtc-policy',
      label: t('webRtcPolicyLabel'),
      expected: expected.webRtcPolicy,
      actual,
      status: 'UNKNOWN',
      detail: t('webRtcPolicySnapshotMissingDetail')
    };
  }

  const matches = expected.webRtcMode === 'strict'
    ? expected.actualWebRtcPolicy === expected.webRtcPolicy && expected.actualWebRtcLeakProtectionActive === true
    : expected.actualWebRtcPolicy === expected.webRtcPolicy;
  return passFailRow(
    'webrtc-policy',
    t('webRtcPolicyLabel'),
    expected.webRtcPolicy,
    actual,
    matches,
    t('webRtcPolicyDetail')
  );
}

async function renderWebRtcPolicy(): Promise<void> {
  const existingRows = sections.get('webrtcChecks') || [];
  const iceRows = existingRows.filter((row) => row.id !== 'webrtc-policy');
  if (expected.webRtcPolicyStateProvided) {
    rawSnapshots.webRtcPolicy = {
      source: 'url',
      actualPolicy: expected.actualWebRtcPolicy,
      supported: expected.actualWebRtcPolicySupported,
      levelOfControl: expected.actualWebRtcPolicyLevelOfControl,
      controlledByThisExtension: expected.actualWebRtcPolicyControlledByThisExtension,
      leakProtectionActive: expected.actualWebRtcLeakProtectionActive,
      error: expected.actualWebRtcPolicyError
    };
    renderSection('webrtcChecks', [
      buildWebRtcPolicyRowFromUrlSnapshot(),
      ...iceRows
    ]);
    return;
  }

  try {
    const response = await sendRuntimeMessage<{ state: { effectivePolicy: string | null; policyState?: unknown } }>({ action: 'getWebRtcConfig' });
    const policyState = response.state.policyState as {
      supported?: boolean | null;
      actualPolicy?: string | null;
      levelOfControl?: string | null;
      leakProtectionActive?: boolean;
    } | undefined;
    const actual = formatWebRtcPolicyActual({
      requestedPolicy: response.state.effectivePolicy || 'default',
      actualPolicy: policyState?.actualPolicy || null,
      levelOfControl: policyState?.levelOfControl || null,
      leakProtectionActive: policyState?.leakProtectionActive ?? null,
      supported: policyState?.supported ?? null
    });
    if (!expected.webRtcPolicy) {
      rawSnapshots.webRtcPolicy = { response };
      renderSection('webrtcChecks', [
        observationRow('webrtc-policy', t('webRtcPolicyLabel'), actual),
        ...iceRows
      ]);
      return;
    }
    const expectedPolicy = expected.webRtcPolicy === 'default' ? null : expected.webRtcPolicy;
    const matches = expected.webRtcMode === 'default'
      ? !response.state.effectivePolicy
      : response.state.effectivePolicy === expectedPolicy
        && policyState?.actualPolicy === expectedPolicy
        && (expected.webRtcMode !== 'strict' || policyState?.leakProtectionActive === true);
    rawSnapshots.webRtcPolicy = { response };
    renderSection('webrtcChecks', [
      passFailRow('webrtc-policy', t('webRtcPolicyLabel'), expected.webRtcPolicy, actual, matches, t('webRtcPolicyDetail')),
      ...iceRows
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rawSnapshots.webRtcPolicy = { error: message };
    renderSection('webrtcChecks', [
      {
        id: 'webrtc-policy',
        label: t('webRtcPolicyLabel'),
        expected: expected.webRtcPolicy || missingExpectedValue(),
        actual: message,
        status: 'UNKNOWN',
        detail: t('webRtcPolicyHostedDetail')
      },
      ...iceRows
    ]);
  }
}

async function runGeolocationCheck(): Promise<void> {
  const hasExpectedGeolocation = expected.latitude !== null && expected.longitude !== null;
  const rows: CheckRow[] = [
    hasExpectedGeolocation
      ? passFailRow('geo-exists', t('geoExistsLabel'), t('yes'), navigator.geolocation ? t('yes') : t('no'), Boolean(navigator.geolocation), t('geoApiVisibleDetail'))
      : observationRow('geo-exists', t('geoExistsLabel'), navigator.geolocation ? t('yes') : t('no'))
  ];

  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      rows.push(hasExpectedGeolocation
        ? rowFromComparison('geo-permission', t('permissionStatusLabel'), t('granted'), permission.state)
        : observationRow('geo-permission', t('permissionStatusLabel'), permission.state));
    } catch (error) {
      rows.push({
        id: 'geo-permission',
        label: t('permissionStatusLabel'),
        expected: hasExpectedGeolocation ? t('granted') : missingExpectedValue(),
        actual: error instanceof Error ? error.message : String(error),
        status: 'UNKNOWN',
        detail: t('permissionQueryFailedDetail')
      });
    }
  } else {
    rows.push(unknownRow('geo-permission', t('permissionStatusLabel'), hasExpectedGeolocation ? t('granted') : missingExpectedValue(), t('permissionsUnavailableDetail')));
  }

  if (!navigator.geolocation) {
    renderSection('geolocationChecks', rows);
    return;
  }

  try {
    const position = await getCurrentPosition();
    const actualPosition = `${position.coords.latitude}, ${position.coords.longitude}`;
    if (hasExpectedGeolocation) {
      const coordinate = compareGeolocationCoordinates({
        expectedLatitude: expected.latitude,
        expectedLongitude: expected.longitude,
        actualLatitude: position.coords.latitude,
        actualLongitude: position.coords.longitude,
        toleranceMeters: expected.geolocationToleranceMeters
      });
      rows.push({
        id: 'geo-position',
        label: t('geoPositionLabel'),
        expected: expectedCoordinateText(),
        actual: actualPosition,
        status: coordinate.status,
        detail: coordinate.message
      });
      rows.push({
        id: 'geo-accuracy',
        label: t('geoAccuracyLabel'),
        expected: t('positiveAccuracy'),
        actual: `${position.coords.accuracy}m`,
        status: Number.isFinite(position.coords.accuracy) && position.coords.accuracy > 0 ? 'PASS' : 'FAIL',
        detail: t('positiveAccuracyDetail')
      });
    } else {
      rows.push(observationRow('geo-position', t('geoPositionLabel'), actualPosition));
      rows.push(observationRow('geo-accuracy', t('geoAccuracyLabel'), `${position.coords.accuracy}m`));
    }
  } catch (error) {
    rows.push({
      id: 'geo-position',
      label: t('geoPositionLabel'),
      expected: expectedCoordinateText(),
      actual: error instanceof Error ? error.message : String(error),
      status: hasExpectedGeolocation ? 'FAIL' : 'UNKNOWN',
      detail: t('geoPositionFailedDetail')
    });
  }

  try {
    const watch = await runSingleWatchPosition();
    const actualWatch = `${watch.coords.latitude}, ${watch.coords.longitude}`;
    if (hasExpectedGeolocation) {
      const coordinate = compareGeolocationCoordinates({
        expectedLatitude: expected.latitude,
        expectedLongitude: expected.longitude,
        actualLatitude: watch.coords.latitude,
        actualLongitude: watch.coords.longitude,
        toleranceMeters: expected.geolocationToleranceMeters
      });
      rows.push({
        id: 'geo-watch',
        label: t('geoWatchLabel'),
        expected: expectedCoordinateText(),
        actual: actualWatch,
        status: coordinate.status,
        detail: coordinate.message
      });
    } else {
      rows.push(observationRow('geo-watch', t('geoWatchLabel'), actualWatch));
    }
  } catch (error) {
    rows.push({
      id: 'geo-watch',
      label: t('geoWatchLabel'),
      expected: expectedCoordinateText(),
      actual: error instanceof Error ? error.message : String(error),
      status: hasExpectedGeolocation ? 'FAIL' : 'UNKNOWN',
      detail: t('watchFailedDetail')
    });
  }

  rawSnapshots.geolocation = rows;
  renderSection('geolocationChecks', rows);
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 0 });
  });
}

function runSingleWatchPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let watchId: number | null = null;
    const timer = window.setTimeout(() => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      reject(new Error('watchPosition timeout'));
    }, 5000);
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        window.clearTimeout(timer);
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        resolve(position);
      },
      (error) => {
        window.clearTimeout(timer);
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        reject(error);
      },
      { timeout: 5000, maximumAge: 0 }
    );
  });
}

async function runWebRtcIceCheck(): Promise<void> {
  const existingRows = sections.get('webrtcChecks') || [];
  const policyRows = existingRows.filter((row) => row.id === 'webrtc-policy');
  const rows = policyRows.length ? policyRows : [unknownRow('webrtc-policy', t('webRtcPolicyLabel'), expected.webRtcPolicy || missingExpectedValue(), t('policyNotCompleted'))];

  if (!window.RTCPeerConnection) {
    renderSection('webrtcChecks', [
      ...rows,
      unknownRow('webrtc-ice', t('iceExposureLabel'), t('noIpCandidates'), t('rtcUnavailableDetail'))
    ]);
    return;
  }

  try {
    const candidates = await gatherIceCandidates();
    const snapshot = buildWebRtcLeakSnapshot({ candidates });
    const candidateSummary = snapshot.candidates.length
      ? snapshot.candidates.map((candidate) => `${candidate.type || t('candidateTypeFallback')}:${candidate.risk}`).join(', ')
      : t('noCandidates');
    const protectedByIce = !snapshot.exposesLocalIp && !snapshot.exposesPublicIp;
    rawSnapshots.webRtcIce = snapshot;
    renderSection('webrtcChecks', [
      ...rows,
      passFailRow(
        'webrtc-ice',
        t('iceExposureLabel'),
        t('noIpCandidates'),
        candidateSummary,
        protectedByIce,
        candidates.length ? candidates.join(' | ') : t('iceCompletedNoCandidates')
      )
    ]);
  } catch (error) {
    renderSection('webrtcChecks', [
      ...rows,
      {
        id: 'webrtc-ice',
        label: t('iceExposureLabel'),
        expected: t('noIpCandidates'),
        actual: error instanceof Error ? error.message : String(error),
        status: 'UNKNOWN',
        detail: t('iceFailedDetail')
      }
    ]);
  }
}

function gatherIceCandidates(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const candidates = new Set<string>();
    let settled = false;
    const pc = new RTCPeerConnection({
      iceServers: expected.stunUrls.map((url) => ({ urls: url }))
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      pc.close();
      resolve([...candidates]);
    };
    const timer = window.setTimeout(finish, expected.iceTimeoutMs);
    pc.onicecandidate = (event) => {
      if (event.candidate?.candidate) {
        candidates.add(event.candidate.candidate);
        return;
      }
      finish();
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    try {
      pc.createDataChannel('vanishgeo-ice-check');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch((error) => {
          if (!settled) reject(error);
        });
    } catch (error) {
      if (!settled) reject(error);
    }
  });
}

async function runRealmChecks(): Promise<void> {
  const rows: CheckRow[] = [];
  const top = snapshotRealm(window);
  rawSnapshots.topRealm = top;
  rows.push(realmRow('realm-top', t('topWindowRealmLabel'), top));

  const frames = await runIframeChecks();
  frames.forEach((frame) => rows.push(realmRow(frame.id, frame.label, frame.snapshot)));
  const workers = await runWorkerChecks();
  workers.forEach((worker) => rows.push(realmRow(worker.id, worker.label, worker.snapshot, worker.detail)));
  renderSection('realmChecks', rows);
}

function realmRow(id: string, label: string, snapshot: RealmSnapshot | null, detail?: string): CheckRow {
  if (!snapshot) {
    return {
      id,
      label,
      expected: expectedRealmText(),
      actual: '-',
      status: 'UNKNOWN',
      detail: detail || t('realmSnapshotUnavailable')
    };
  }
  if (!expected.language && !expected.languages && !expected.timezone && expected.timezoneOffset === null) {
    return observationRow(
      id,
      label,
      `${snapshot.language} / ${snapshot.languages.join(', ')} / ${snapshot.timezone} / ${snapshot.offsetMinutes}`,
      detail || `locale=${snapshot.locale}; date=${snapshot.dateString}`
    );
  }
  const language = compareDiagnosticValue({ expected: expected.language, actual: snapshot.language });
  const languages = compareDiagnosticValue({ expected: expected.languages, actual: snapshot.languages, kind: 'list' });
  const timezone = compareDiagnosticValue({ expected: expected.timezone, actual: snapshot.timezone });
  const offset = compareDiagnosticValue({ expected: expected.timezoneOffset, actual: snapshot.offsetMinutes, kind: 'number' });
  const summary = summarizeDiagnosticVerdicts([language.status, languages.status, timezone.status, offset.status]);
  return {
    id,
    label,
    expected: [
      expected.language,
      expected.languages?.join(', '),
      expected.timezone,
      expected.timezoneOffset
    ].filter(isExpectedValueConfigured).join(' / ') || missingExpectedValue(),
    actual: `${snapshot.language} / ${snapshot.languages.join(', ')} / ${snapshot.timezone} / ${snapshot.offsetMinutes}`,
    status: summary.status,
    detail: detail || `locale=${snapshot.locale}; date=${snapshot.dateString}`
  };
}

async function runIframeChecks(): Promise<Array<{ id: string; label: string; snapshot: RealmSnapshot | null }>> {
  const result: Array<{ id: string; label: string; snapshot: RealmSnapshot | null }> = [];
  const frames = [
    await createInspectableFrame('about:blank', (frame) => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write('<!DOCTYPE html><html><head><title>about:blank leak-test child</title></head><body>about:blank</body></html>');
      doc.close();
    }),
    await createInspectableFrame('srcdoc', (frame) => {
      frame.srcdoc = '<!DOCTYPE html><html><head><title>srcdoc leak-test child</title></head><body>srcdoc</body></html>';
    }),
    await createInspectableFrame('same-origin fixture', (frame) => {
      frame.src = '/fixtures/iframe/child-same-origin.html';
    })
  ];

  frames.forEach((entry, index) => {
    result.push({
      id: `iframe-${index}`,
      label: `${t('iframeLabelPrefix')}${translateFrameLabel(entry.label)}`,
      snapshot: entry.frame.contentWindow ? snapshotRealm(entry.frame.contentWindow) : null
    });
    entry.frame.remove();
  });
  rawSnapshots.iframes = result;
  return result;
}

function translateFrameLabel(label: string): string {
  if (label === 'about:blank') return t('iframeAboutBlankLabel');
  if (label === 'srcdoc') return t('iframeSrcdocLabel');
  if (label === 'same-origin fixture') return t('iframeSameOriginLabel');
  return label;
}

function createInspectableFrame(label: string, configure: (frame: HTMLIFrameElement) => void): Promise<{ label: string; frame: HTMLIFrameElement }> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.setTimeout(() => resolve({ label, frame }), 150);
    };
    frame.style.position = 'absolute';
    frame.style.left = '-9999px';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.addEventListener('load', settle, { once: true });
    configure(frame);
    document.body.appendChild(frame);
    window.setTimeout(settle, 1200);
  });
}

async function runWorkerChecks(): Promise<Array<{ id: string; label: string; snapshot: RealmSnapshot | null; detail?: string }>> {
  const workers = [
    await runWorkerSnapshot('worker-classic', t('workerClassicLabel'), '/fixtures/workers/worker-classic.js'),
    await runWorkerSnapshot('worker-module', t('workerModuleLabel'), '/fixtures/workers/worker-module.js', { type: 'module' }),
    await runSharedWorkerSnapshot('shared-worker', t('sharedWorkerLabel'), `/fixtures/workers/shared-worker.js?leakTest=${Date.now()}`)
  ];
  rawSnapshots.workers = workers;
  return workers;
}

function runWorkerSnapshot(id: string, label: string, scriptUrl: string, options?: WorkerOptions): Promise<{ id: string; label: string; snapshot: RealmSnapshot | null; detail?: string }> {
  return new Promise((resolve) => {
    try {
      const worker = new Worker(scriptUrl, options);
      const timer = window.setTimeout(() => {
        worker.terminate();
        resolve({ id, label, snapshot: null, detail: t('workerTimeout') });
      }, 5000);
      worker.onmessage = (event) => {
        window.clearTimeout(timer);
        worker.terminate();
        resolve({ id, label, snapshot: normalizeWorkerSnapshot(event.data), detail: '' });
      };
      worker.onerror = (event) => {
        window.clearTimeout(timer);
        worker.terminate();
        resolve({ id, label, snapshot: null, detail: event.message || t('workerFailed') });
      };
    } catch (error) {
      resolve({ id, label, snapshot: null, detail: error instanceof Error ? error.message : String(error) });
    }
  });
}

function runSharedWorkerSnapshot(id: string, label: string, scriptUrl: string): Promise<{ id: string; label: string; snapshot: RealmSnapshot | null; detail?: string }> {
  if (typeof SharedWorker !== 'function') {
    return Promise.resolve({ id, label, snapshot: null, detail: t('sharedWorkerUnsupported') });
  }
  return new Promise((resolve) => {
    try {
      const worker = new SharedWorker(scriptUrl);
      const port = worker.port;
      if (typeof port.start === 'function') port.start();
      const timer = window.setTimeout(() => {
        try { port.close(); } catch {}
        resolve({ id, label, snapshot: null, detail: t('sharedWorkerTimeout') });
      }, 5000);
      port.onmessage = (event) => {
        window.clearTimeout(timer);
        try { port.close(); } catch {}
        resolve({ id, label, snapshot: normalizeWorkerSnapshot(event.data), detail: '' });
      };
      port.addEventListener('messageerror', (event) => {
        window.clearTimeout(timer);
        try { port.close(); } catch {}
        resolve({ id, label, snapshot: null, detail: event instanceof MessageEvent ? String(event.data || '') : t('sharedWorkerMessageFailed') });
      }, { once: true });
    } catch (error) {
      resolve({ id, label, snapshot: null, detail: error instanceof Error ? error.message : String(error) });
    }
  });
}

function normalizeWorkerSnapshot(value: any): RealmSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  return {
    language: String(value.language || ''),
    languages: Array.isArray(value.languages) ? value.languages.map(String) : [],
    locale: String(value.dateTimeFormatLocale || ''),
    timezone: String(value.timezone || ''),
    offsetMinutes: Number(value.offsetMinutes),
    dateString: String(value.dateString || '')
  };
}

function snapshotRealm(realm: Window): RealmSnapshot {
  const globals = realm as Window & typeof globalThis;
  return {
    language: globals.navigator.language || '',
    languages: Array.from(globals.navigator.languages || []),
    locale: globals.Intl.DateTimeFormat().resolvedOptions().locale || '',
    timezone: globals.Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    offsetMinutes: new globals.Date().getTimezoneOffset(),
    dateString: new globals.Date().toString()
  };
}

function renderPassThroughChecks(): void {
  const current = snapshotPassThroughSurfaces();
  const baseline = readPassThroughBaseline();
  const rows = Object.entries(current).map(([key, actual]) => (
    baseline
      ? rowFromComparison(`pass-through-${key}`, key, baseline[key] ?? null, actual)
      : unknownRow(`pass-through-${key}`, key, t('storedBaseline'), t('captureBaselineBeforeAllowlist'))
  ));
  rawSnapshots.passThrough = { baseline, current };
  baselineStatusEl.textContent = baseline
    ? `${t('baselineLoadedPrefix')}${baselineKey}.`
    : t('noBaseline');
  renderSection('passThroughChecks', rows);
}

function snapshotPassThroughSurfaces(): PassThroughSnapshot {
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  return {
    platform: navigator.platform || 'N/A',
    hardwareConcurrency: navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'N/A',
    deviceMemory: nav.deviceMemory ? `${nav.deviceMemory} GB` : 'N/A',
    userAgent: navigator.userAgent || 'N/A',
    screenSize: `${screen.width} x ${screen.height}`,
    colorDepth: `${screen.colorDepth}`,
    devicePixelRatio: String(window.devicePixelRatio),
    webglRenderer: readWebGlRenderer(),
    audioSampleRate: readAudioSampleRate(),
    codecProbe: readCodecProbe(),
    webgpuExists: nav.gpu ? 'yes' : 'no'
  };
}

function readWebGlRenderer(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'N/A';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    return debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : t('webglAvailableNoDebug');
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function readAudioSampleRate(): string {
  try {
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return 'N/A';
    const context = new AudioCtor();
    const sampleRate = String(context.sampleRate);
    void context.close?.();
    return sampleRate;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function readCodecProbe(): string {
  try {
    const video = document.createElement('video');
    const mp4 = video.canPlayType('video/mp4; codecs="avc1.42E01E"') || 'no';
    const webm = video.canPlayType('video/webm; codecs="vp8"') || 'no';
    return `mp4=${mp4}, webm=${webm}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function readPassThroughBaseline(): PassThroughSnapshot | null {
  const value = window.localStorage.getItem(baselineKey);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writePassThroughBaseline(): void {
  const baseline = snapshotPassThroughSurfaces();
  window.localStorage.setItem(baselineKey, JSON.stringify(baseline));
  renderPassThroughChecks();
}

function clearPassThroughBaseline(): void {
  window.localStorage.removeItem(baselineKey);
  renderPassThroughChecks();
}

function sendRuntimeMessage<T = any>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error(t('chromeRuntimeUnavailable')));
      return;
    }
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

function safeRead<T>(reader: () => T): T | null {
  try {
    return reader();
  } catch {
    return null;
  }
}

async function runAllChecks(): Promise<void> {
  await runPassiveChecks();
  await runGeolocationCheck();
  await runWebRtcIceCheck();
  await runRealmChecks();
}

runAllChecksBtn.addEventListener('click', () => { void runAllChecks(); });
testGeolocationBtn.addEventListener('click', () => { void runGeolocationCheck(); });
testWebRTCBtn.addEventListener('click', () => { void runWebRtcIceCheck(); });
runRealmChecksBtn.addEventListener('click', () => { void runRealmChecks(); });
captureBaselineBtn.addEventListener('click', writePassThroughBaseline);
clearBaselineBtn.addEventListener('click', clearPassThroughBaseline);
uiLangZhBtn.addEventListener('click', () => { setUiLanguage('zh', { persist: true, rerender: true }); });
uiLangEnBtn.addEventListener('click', () => { setUiLanguage('en', { persist: true, rerender: true }); });

setUiLanguage(uiLanguage, { persist: false, rerender: false });
renderInitialState();
window.setTimeout(() => {
  void runPassiveChecks();
}, 150);
