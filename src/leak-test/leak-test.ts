// 诊断页只展示实际观测；扩展预期配置不进入普通网页。
import './leak-test.css';
import { buildWebRtcLeakSnapshot } from '../shared/diagnostic';
import { formatLocaleDateTimeForPage } from '../shared/locale-datetime';

type CheckRow = {
  id: string;
  label: string;
  actual: unknown;
  detail?: string;
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

const I18N_EN = {
  documentTitle: 'VanishGeo Leak Test',
  languageSwitchLabel: 'Language switch',
  eyebrow: 'Web-origin observation target',
  pageTitle: 'VanishGeo Leak Test',
  subtitle: 'Observation mode: displays actual page-visible values without extension profile validation.',
  testTargetTitle: 'Test Target',
  currentOriginLabel: 'Current origin',
  validationModeLabel: 'Target guidance',
  observationModeLabel: 'Observation mode',
  observationModeNoteHtml: 'This page receives no extension expected profile. It shows observations only and does not judge profile PASS / FAIL. Full validation requires an extension-side report.',
  observationModeSummary: 'Observation mode · UNKNOWN (profile validation unavailable)',
  observationStatus: 'Observation mode · UNKNOWN',
  actionsTitle: 'Actions',
  runAllChecksButton: 'Run all checks',
  runGeolocationButton: 'Run geolocation',
  runWebRtcButton: 'Run WebRTC ICE',
  runRealmChecksButton: 'Run iframe / worker',
  captureBaselineButton: 'Capture pass-through baseline',
  clearBaselineButton: 'Clear pass-through baseline',
  languageSectionTitle: 'Page Language And Native Header',
  timezoneSectionTitle: 'Timezone',
  geolocationSectionTitle: 'Geolocation',
  webrtcSectionTitle: 'WebRTC Policy And ICE',
  webrtcNoteHtml: 'Normal web pages cannot read Chrome privacy policy. ICE candidates are observations only and do not prove policy enforcement or leak protection.',
  realmSectionTitle: 'Iframe And Worker Realms',
  passThroughSectionTitle: 'Pass-Through Real-Device Surfaces',
  passThroughNoteHtml: 'Capture actual device observations before allowlisting localhost. The stored baseline is a local reference for manual comparison; this page does not issue a verdict.',
  rawValuesTitle: 'Raw Values',
  footerDisclaimerHtml: 'This page must be served from a normal HTTP(S) origin for allowlist validation. Use the hosted target <code>https://leak.962850.xyz/leak-test/leak-test.html</code> or the local development target <code>http://localhost:8787/leak-test/leak-test.html</code>. It does not add or spoof any real-device fingerprint surface.',
  actualLabel: 'Actual',
  statusUnknown: 'UNKNOWN',
  observationDetail: 'Actual observation only; extension profile validation is unavailable.',
  runtimeExtensionNotice: 'Launcher/baseline only. Chrome does not inject this extension into its own extension page; open the hosted HTTPS target or serve it on localhost for allowlist validation.',
  runtimeLocalhostNotice: 'HTTP target. Add/enable localhost in VanishGeo, reload this page, then run checks.',
  runtimeHttpNoticePrefix: 'HTTP target. Add/enable ',
  runtimeHttpNoticeSuffix: ' in VanishGeo, reload this page, then run checks.',
  geoResultLabel: 'getCurrentPosition / watchPosition',
  clickRunGeolocation: 'click Run geolocation',
  webRtcPolicyLabel: 'Chrome WebRTC policy',
  iceExposureLabel: 'ICE candidate exposure',
  clickRunWebRtc: 'click Run WebRTC ICE',
  realmFixturesLabel: 'Iframe / worker realms',
  clickRunRealm: 'click Run iframe / worker',
  intlLocaleLabel: 'Intl.DateTimeFormat locale',
  acceptLanguageHeaderLabel: 'Native Accept-Language (observation only; not a synchronization target)',
  intlTimezoneLabel: 'Intl.DateTimeFormat timezone',
  timezoneOffsetLabel: 'Date.getTimezoneOffset()',
  dateStringOffsetLabel: 'Date.toString() offset',
  localeStringLabel: 'Date.toLocaleString() sample',
  geoExistsLabel: 'navigator.geolocation exists',
  permissionStatusLabel: 'Permission status',
  permissionQueryFailedDetail: 'permission query failed',
  permissionsUnavailableDetail: 'navigator.permissions is unavailable',
  geoPositionLabel: 'getCurrentPosition coordinate',
  geoAccuracyLabel: 'getCurrentPosition accuracy',
  geoPositionFailedDetail: 'getCurrentPosition did not return a position',
  geoWatchLabel: 'watchPosition first callback',
  watchFailedDetail: 'watchPosition did not return a position',
  rtcUnavailableDetail: 'RTCPeerConnection is unavailable',
  candidateTypeFallback: 'candidate',
  noCandidates: 'no candidates',
  iceCompletedNoCandidates: 'No candidates observed within the gathering window; protection is unverified.',
  iceFailedDetail: 'ICE gathering failed; no validation result is available.',
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
  baselineLoadedPrefix: 'Local observation baseline: ',
  baselineReferenceLabel: 'Previous observation',
  policyUnavailableDetail: 'Not observable from a normal web page. Read policy status in extension Options.',
  noBaseline: 'No pass-through baseline stored yet.',
  webglAvailableNoDebug: 'WebGL available (debug renderer unavailable)',
} as const;

type I18nKey = keyof typeof I18N_EN;

const I18N_ZH: Record<I18nKey, string> = {
  documentTitle: 'VanishGeo 隐私检测',
  languageSwitchLabel: '语言切换',
  eyebrow: '网页环境观测目标',
  pageTitle: 'VanishGeo 隐私检测',
  subtitle: '观察模式（observation mode）：仅展示页面实际可见值，不执行扩展配置验收。',
  testTargetTitle: '检测目标',
  currentOriginLabel: '当前来源',
  validationModeLabel: '目标说明',
  observationModeLabel: '观察模式（observation mode）',
  observationModeNoteHtml: '本页不接收扩展预期配置，仅展示实际观测，不判定配置 PASS / FAIL。完整验证需由后续扩展侧报告完成。',
  observationModeSummary: '观察模式（observation mode）· UNKNOWN（未验证配置）',
  observationStatus: '观察模式 · UNKNOWN',
  actionsTitle: '操作',
  runAllChecksButton: '运行全部检测',
  runGeolocationButton: '运行地理位置检测',
  runWebRtcButton: '运行 WebRTC ICE 检测',
  runRealmChecksButton: '运行 iframe / worker 检测',
  captureBaselineButton: '记录真实设备基线',
  clearBaselineButton: '清除真实设备基线',
  languageSectionTitle: '网页语言与原生请求头',
  timezoneSectionTitle: '时区',
  geolocationSectionTitle: '地理位置',
  webrtcSectionTitle: 'WebRTC 策略与 ICE',
  webrtcNoteHtml: '普通网页无法读取 Chrome privacy policy。ICE 候选仅为实际观测，不能证明策略生效或泄露防护通过。',
  realmSectionTitle: 'Iframe 与 Worker 环境',
  passThroughSectionTitle: '真实设备透传项',
  passThroughNoteHtml: '可在加入 localhost 白名单前记录实际设备观测。已保存基线仅作本地人工参考，本页不做通过或失败判定。',
  rawValuesTitle: '原始值',
  footerDisclaimerHtml: '此页面必须运行在可加入白名单的普通 HTTP(S) 来源下。可使用托管地址 <code>https://leak.962850.xyz/leak-test/leak-test.html</code>，也可使用本地开发地址 <code>http://localhost:8787/leak-test/leak-test.html</code>。页面本身不会新增或伪造任何真实设备指纹项。',
  actualLabel: '实际',
  statusUnknown: 'UNKNOWN 未知',
  observationDetail: '仅为实际观测，未进行扩展配置验证。',
  runtimeExtensionNotice: '当前是扩展页启动器/基线页。Chrome 不会把本扩展注入自己的扩展页；请打开托管 HTTPS 目标或本地 localhost 页面进行白名单验证。',
  runtimeLocalhostNotice: 'HTTP 检测目标。请在 VanishGeo 中添加并启用 localhost，刷新本页后再运行检测。',
  runtimeHttpNoticePrefix: 'HTTP 检测目标。请在 VanishGeo 中添加并启用 ',
  runtimeHttpNoticeSuffix: '，刷新本页后再运行检测。',
  geoResultLabel: 'getCurrentPosition / watchPosition',
  clickRunGeolocation: '点击“运行地理位置检测”',
  webRtcPolicyLabel: 'Chrome WebRTC 策略',
  iceExposureLabel: 'ICE 候选地址暴露',
  clickRunWebRtc: '点击“运行 WebRTC ICE 检测”',
  realmFixturesLabel: 'Iframe / worker 环境',
  clickRunRealm: '点击“运行 iframe / worker 检测”',
  intlLocaleLabel: 'Intl.DateTimeFormat locale',
  acceptLanguageHeaderLabel: '原生 Accept-Language（仅观测，不是同步目标）',
  intlTimezoneLabel: 'Intl.DateTimeFormat 时区',
  timezoneOffsetLabel: 'Date.getTimezoneOffset()',
  dateStringOffsetLabel: 'Date.toString() 时区偏移',
  localeStringLabel: 'Date.toLocaleString() 示例',
  geoExistsLabel: 'navigator.geolocation 存在',
  permissionStatusLabel: '权限状态',
  permissionQueryFailedDetail: '权限查询失败',
  permissionsUnavailableDetail: 'navigator.permissions 不可用',
  geoPositionLabel: 'getCurrentPosition 坐标',
  geoAccuracyLabel: 'getCurrentPosition 精度',
  geoPositionFailedDetail: 'getCurrentPosition 未返回位置',
  geoWatchLabel: 'watchPosition 首次回调',
  watchFailedDetail: 'watchPosition 未返回位置',
  rtcUnavailableDetail: 'RTCPeerConnection 不可用',
  candidateTypeFallback: '候选地址',
  noCandidates: '无候选地址',
  iceCompletedNoCandidates: '收集窗口内未观测到候选，防护效果未验证。',
  iceFailedDetail: 'ICE 收集失败，没有可用验证结论。',
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
  baselineLoadedPrefix: '本地观测基线：',
  baselineReferenceLabel: '之前的实际观测',
  policyUnavailableDetail: '普通网页无法观测；请在扩展 Options 查看策略状态。',
  noBaseline: '尚未保存真实设备基线。',
  webglAvailableNoDebug: 'WebGL 可用（无法读取调试渲染器）',
};

const I18N: Record<UiLanguage, Record<I18nKey, string>> = {
  en: I18N_EN,
  zh: I18N_ZH
};

const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302'];
const DEFAULT_ICE_TIMEOUT_MS = 5000;

const sections = new Map<string, CheckRow[]>();
const rawSnapshots: Record<string, unknown> = {};
const baselineKey = `vanishgeoLeakTestPassThroughBaseline:v1:${window.location.origin}`;
const uiLanguageKey = 'vanishgeoLeakTestUiLanguage:v1';
let uiLanguage = readInitialUiLanguage();

const runtimeOriginEl = requireElement('runtimeOrigin');
const runtimeOriginNoticeEl = requireElement('runtimeOriginNotice');
const observationModeEl = requireElement('observationMode');
const overallStatusEl = requireElement('overallStatus');
const baselineStatusEl = requireElement('baselineStatus');
const rawValuesEl = requireElement('rawValues');
const languageSwitchEl = requireElement('languageSwitch');
const observationModeNoteEl = requireElement('observationModeNote');
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
  observationModeNoteEl.innerHTML = t('observationModeNoteHtml');
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

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function createRowElement(row: CheckRow): HTMLElement {
  const element = document.createElement('div');
  element.className = 'verdict-row';
  const detail = row.detail ? `<div class="verdict-detail">${escapeHtml(row.detail)}</div>` : '';
  element.innerHTML = `
    <div class="verdict-label">${escapeHtml(row.label)}</div>
    <div class="verdict-actual"><strong>${escapeHtml(t('actualLabel'))}:</strong> ${escapeHtml(formatValue(row.actual))}</div>
    <div class="status-badge status-unknown">${escapeHtml(t('statusUnknown'))}</div>
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
  overallStatusEl.textContent = t('observationStatus');
  rawValuesEl.textContent = JSON.stringify({ mode: 'observe', status: 'UNKNOWN', snapshots: rawSnapshots }, null, 2);
}

function observationRow(id: string, label: string, actual: unknown, detail = t('observationDetail')): CheckRow {
  return { id, label, actual, detail };
}

function unknownRow(id: string, label: string, message: string): CheckRow {
  return observationRow(id, label, null, message);
}

function renderInitialState(): void {
  runtimeOriginEl.textContent = window.location.origin;
  observationModeEl.textContent = t('observationModeSummary');

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
    unknownRow('geo-result', t('geoResultLabel'), t('clickRunGeolocation'))
  ]);
  renderSection('webrtcChecks', [
    unknownRow('webrtc-policy', t('webRtcPolicyLabel'), t('policyUnavailableDetail')),
    unknownRow('webrtc-ice', t('iceExposureLabel'), t('clickRunWebRtc'))
  ]);
  renderSection('realmChecks', [
    unknownRow('realm-fixtures', t('realmFixturesLabel'), t('clickRunRealm'))
  ]);
}

async function runPassiveChecks(): Promise<void> {
  renderLanguageChecks(await loadAcceptLanguageHeader());
  renderTimezoneChecks();
  renderWebRtcPolicy();
  renderPassThroughChecks();
}

async function loadAcceptLanguageHeader(): Promise<string | null> {
  if (window.location.protocol === 'chrome-extension:') return null;
  try {
    const response = await fetch('/headers.json', { cache: 'no-store', referrerPolicy: 'no-referrer' });
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
    observationRow('navigator-language', 'navigator.language', navigator.language || null),
    observationRow('navigator-languages', 'navigator.languages', Array.from(navigator.languages || [])),
    observationRow('intl-locale', t('intlLocaleLabel'), locale),
    observationRow('accept-language-header', t('acceptLanguageHeaderLabel'), acceptLanguageHeader)
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
  const rows = [
    observationRow('intl-timezone', t('intlTimezoneLabel'), timezone),
    observationRow('timezone-offset', t('timezoneOffsetLabel'), offset),
    observationRow('date-string-offset', t('dateStringOffsetLabel'), dateString),
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
  return observationRow('date-locale-string', t('localeStringLabel'), formatLocaleDateTimeForPage(new Date()));
}

function renderWebRtcPolicy(): void {
  const iceRows = (sections.get('webrtcChecks') || []).filter((row) => row.id !== 'webrtc-policy');
  rawSnapshots.webRtcPolicy = { status: 'not_observable' };
  renderSection('webrtcChecks', [
    unknownRow('webrtc-policy', t('webRtcPolicyLabel'), t('policyUnavailableDetail')),
    ...iceRows
  ]);
}

async function runGeolocationCheck(): Promise<void> {
  const rows: CheckRow[] = [
    observationRow('geo-exists', t('geoExistsLabel'), Boolean(navigator.geolocation))
  ];
  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      rows.push(observationRow('geo-permission', t('permissionStatusLabel'), permission.state));
    } catch (error) {
      rows.push(observationRow('geo-permission', t('permissionStatusLabel'), error instanceof Error ? error.message : String(error), t('permissionQueryFailedDetail')));
    }
  } else {
    rows.push(unknownRow('geo-permission', t('permissionStatusLabel'), t('permissionsUnavailableDetail')));
  }
  if (navigator.geolocation) {
    try {
      const position = await getCurrentPosition();
      rows.push(observationRow('geo-position', t('geoPositionLabel'), `${position.coords.latitude}, ${position.coords.longitude}`));
      rows.push(observationRow('geo-accuracy', t('geoAccuracyLabel'), `${position.coords.accuracy}m`));
    } catch (error) {
      rows.push(observationRow('geo-position', t('geoPositionLabel'), error instanceof Error ? error.message : String(error), t('geoPositionFailedDetail')));
    }
    try {
      const watch = await runSingleWatchPosition();
      rows.push(observationRow('geo-watch', t('geoWatchLabel'), `${watch.coords.latitude}, ${watch.coords.longitude}`));
    } catch (error) {
      rows.push(observationRow('geo-watch', t('geoWatchLabel'), error instanceof Error ? error.message : String(error), t('watchFailedDetail')));
    }
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
  const rows = policyRows.length ? policyRows : [unknownRow('webrtc-policy', t('webRtcPolicyLabel'), t('policyUnavailableDetail'))];

  if (!window.RTCPeerConnection) {
    renderSection('webrtcChecks', [
      ...rows,
      unknownRow('webrtc-ice', t('iceExposureLabel'), t('rtcUnavailableDetail'))
    ]);
    return;
  }

  try {
    const candidates = await gatherIceCandidates();
    const snapshot = buildWebRtcLeakSnapshot({ candidates });
    const candidateSummary = snapshot.candidates.length
      ? snapshot.candidates.map((candidate) => `${candidate.type || t('candidateTypeFallback')}:${candidate.risk}`).join(', ')
      : t('noCandidates');
    rawSnapshots.webRtcIce = snapshot;
    renderSection('webrtcChecks', [
      ...rows,
      observationRow(
        'webrtc-ice',
        t('iceExposureLabel'),
        candidateSummary,
        candidates.length ? candidates.join(' | ') : t('iceCompletedNoCandidates')
      )
    ]);
  } catch (error) {
    renderSection('webrtcChecks', [
      ...rows,
      observationRow('webrtc-ice', t('iceExposureLabel'), error instanceof Error ? error.message : String(error), t('iceFailedDetail'))
    ]);
  }
}

function gatherIceCandidates(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const candidates = new Set<string>();
    let settled = false;
    const pc = new RTCPeerConnection({
      iceServers: DEFAULT_STUN_URLS.map((url) => ({ urls: url }))
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      pc.close();
      resolve([...candidates]);
    };
    const timer = window.setTimeout(finish, DEFAULT_ICE_TIMEOUT_MS);
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
  if (!snapshot) return unknownRow(id, label, detail || t('realmSnapshotUnavailable'));
  return observationRow(
    id,
    label,
    `${snapshot.language} / ${snapshot.languages.join(', ')} / ${snapshot.timezone} / ${snapshot.offsetMinutes}`,
    detail || `locale=${snapshot.locale}; date=${snapshot.dateString}`
  );
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
  const rows = Object.entries(current).map(([key, actual]) => observationRow(
    `pass-through-${key}`,
    key,
    actual,
    baseline ? `${t('baselineReferenceLabel')}: ${formatValue(baseline[key])}` : t('observationDetail')
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
