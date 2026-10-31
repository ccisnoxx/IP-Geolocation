import './leak-test.css';
import { LAST_LOCATION_KEY, SITE_CONFIG_KEY, normalizeConfig } from '../shared/config-model';
import { auditConfig, sortFindings, type AuditEnvironment, type AuditFinding, type AuditSeverity } from '../shared/config-audit';
import { buildWorkerDiagnosticsSnapshot } from '../shared/diagnostic';
import { buildProbeReport, type NativeBaseline, type ProbeReport, type ProbeSnapshot, type ReportRow } from '../shared/probe-report';
import type { LastLocation, SiteSpoofConfig } from '../shared/types';

/**
 * 诊断页。
 *
 * 本页跑在扩展源下，注入层不作用于这里，所以本页自己读到的是浏览器原生值。
 * 主区块是「站点实测」：在选中标签页的 MAIN world 里采集真实取值，与按该站点
 * 解析出的期望值逐项对比；本页的原生值只作为“不在规则里的站点应当是什么”的基线，
 * 放在折叠的高级区里。
 */

const setText = (id: string, value: string): void => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

/** 本页读到的就是浏览器原生值（注入层不作用于扩展源） */
function nativeBaseline(): NativeBaseline {
  return {
    timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    languages: Array.from(navigator.languages || [])
  };
}

async function readStoredState(): Promise<{ config: SiteSpoofConfig; exit: LastLocation | null }> {
  const stored = await chrome.storage.local.get([SITE_CONFIG_KEY, LAST_LOCATION_KEY]);
  return {
    config: normalizeConfig(stored[SITE_CONFIG_KEY] || null),
    exit: (stored[LAST_LOCATION_KEY] as LastLocation | undefined) || null
  };
}

// ---------- 站点实测 ----------

/**
 * 被 `chrome.scripting.executeScript` 序列化后注入目标页面的 MAIN world，
 * 必须**自包含** —— 任何外部引用在页面里都是 ReferenceError。
 */
async function pageProbe(): Promise<ProbeSnapshot> {
  const checks: ProbeSnapshot['checks'] = [];
  const check = (group: string, label: string, value: unknown, ok: boolean | null) => {
    checks.push({ group, label, value: String(value), ok });
  };

  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  const temporal = (globalThis as any).Temporal;
  let temporalTimeZone: string | null = null;
  try {
    if (temporal && temporal.Now) temporalTimeZone = String(temporal.Now.timeZoneId());
  } catch { /* 不支持 Temporal 的浏览器 */ }

  // Date 语义：字符串日期按本地时间解释、set* 往返
  try {
    const stringDate = new Date('2026-01-01T00:00:00');
    check('Date 语义', 'new Date("2026-01-01T00:00:00").getHours() 为 0', stringDate.getHours(), stringDate.getHours() === 0);
    const roundTrip = new Date('2026-01-01T00:00:00');
    roundTrip.setHours(15, 0, 0, 0);
    check('Date 语义', 'setHours(15) 后 getHours() 为 15', roundTrip.getHours(), roundTrip.getHours() === 15);
    check('Date 语义', '非法日期 toString()', new Date('nope').toString(), new Date('nope').toString() === 'Invalid Date');
  } catch (error) {
    check('Date 语义', '读取', `失败：${error}`, false);
  }

  // 反检测：补丁不能留下可被一行代码看出来的痕迹
  check('反检测', 'navigator.languages 是冻结数组', Object.isFrozen(navigator.languages), Object.isFrozen(navigator.languages));
  check('反检测', 'Date.prototype.setHours 显示为原生函数', Date.prototype.setHours.toString(),
    Date.prototype.setHours.toString() === 'function setHours() { [native code] }');
  check('反检测', 'new Date() 没有自有属性', Object.keys(new Date()).length, Object.keys(new Date()).length === 0);
  check('反检测', 'Date.prototype.constructor === Date', Date.prototype.constructor === Date, Date.prototype.constructor === Date);
  if (document.fonts) {
    const fontsCheck = document.fonts.check('12px Helvetica');
    check('反检测', "document.fonts.check('12px Helvetica') 保持原生 true", fontsCheck, fontsCheck === true);
  }

  // 字体：复刻公开检测站的 canvas 宽度探测（只在字体伪装开启时参与判定）
  try {
    const measureFonts = (ctx: any) => {
      const probe = (family: string) => ['monospace', 'sans-serif', 'serif'].some((generic) => {
        ctx.font = `72px ${generic}`;
        const base = ctx.measureText('中文字体检测ABCabc012').width;
        ctx.font = `72px "${family}", ${generic}`;
        return Math.abs(ctx.measureText('中文字体检测ABCabc012').width - base) > 0.5;
      });
      return ['SimSun', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', '宋体', '苹方-简', '微软雅黑', 'MiSans', 'HarmonyOS Sans SC'].filter(probe);
    };
    const canvasCtx = document.createElement('canvas').getContext('2d');
    if (canvasCtx) {
      const hits = measureFonts(canvasCtx);
      check('字体', 'canvas 探测不到被隐藏的中文字体', hits.join(', ') || '无', hits.length === 0);
    }
    const offscreenCtx = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(8, 8).getContext('2d') : null;
    if (offscreenCtx) {
      const hits = measureFonts(offscreenCtx);
      check('字体', 'OffscreenCanvas 探测不到被隐藏的中文字体', hits.join(', ') || '无', hits.length === 0);
    }
  } catch (error) {
    check('字体', '字体度量', `失败：${error}`, null);
  }

  // 定位：只在已授权时读取，绝不触发授权框
  let permission = 'unknown';
  let coords: ProbeSnapshot['geolocation']['coords'] = null;
  let geoError: string | null = null;
  try {
    permission = (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch { /* permissions API 不可用 */ }
  if (permission === 'granted' && navigator.geolocation) {
    const position = await new Promise<GeolocationPosition | string>((resolve) => {
      navigator.geolocation.getCurrentPosition(resolve, (error) => resolve(`错误：${error.message || error.code}`), { timeout: 5000 });
    });
    if (typeof position === 'string') {
      geoError = position;
    } else {
      coords = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
      const own = Object.keys(position.coords).length;
      check('反检测', 'GeolocationCoordinates 没有自有属性', own, own === 0);
    }
  }

  // WebRTC：在网页里收集本机候选（扩展页不受策略约束、不做 mDNS 匿名化，测不准）。
  // 必须建数据通道：没有任何 m-line 的 offer 不会触发 ICE 收集。
  let webrtc: ProbeSnapshot['webrtc'] = null;
  if (typeof RTCPeerConnection === 'function') {
    webrtc = await new Promise<NonNullable<ProbeSnapshot['webrtc']>>((resolve) => {
      const candidates: string[] = [];
      let pc: RTCPeerConnection | null = null;
      let done = false;
      const finish = (error: string | null) => {
        if (done) return;
        done = true;
        try { pc?.close(); } catch { /* ignore */ }
        resolve({ candidates, error });
      };
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('vanishgeo-probe');
        pc.onicecandidate = (event) => {
          if (!event.candidate) { finish(null); return; }
          const address = event.candidate.candidate.split(' ')[4];
          if (address) candidates.push(address);
        };
        pc.createOffer().then((offer) => pc!.setLocalDescription(offer)).catch((error) => finish(`失败：${error}`));
        setTimeout(() => finish(null), 3000);
      } catch (error) {
        finish(`失败：${error}`);
      }
    });
  }

  return {
    webrtc,
    timezone: resolved.timeZone,
    offsetMinutes: new Date().getTimezoneOffset(),
    temporalTimeZone,
    locale: resolved.locale,
    language: navigator.language,
    languages: Array.from(navigator.languages || []),
    geolocation: { permission, coords, error: geoError },
    checks
  };
}

/**
 * 填目标下拉框：本窗口的 http(s) 标签页，默认选最近用过的那个。
 * 本页自己就是活动标签页，所以不能用 `active: true` 去找目标。
 */
async function renderProbeTargets(): Promise<void> {
  const select = document.getElementById('probeTarget') as HTMLSelectElement | null;
  if (!select) return;
  select.textContent = '';
  try {
    const tabs = (await chrome.tabs.query({ currentWindow: true }))
      .filter((tab) => tab.id && tab.url && /^https?:/i.test(tab.url));
    const recent = tabs.slice().sort((a, b) => ((b as any).lastAccessed || b.index) - ((a as any).lastAccessed || a.index))[0];
    for (const tab of tabs) {
      const option = document.createElement('option');
      option.value = String(tab.id);
      option.textContent = `${tab.title || tab.url} — ${new URL(tab.url!).hostname}`;
      option.selected = tab === recent;
      select.appendChild(option);
    }
    if (!tabs.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '（本窗口没有 http/https 网页，先打开一个要检测的站点）';
      select.appendChild(option);
    }
  } catch (error) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = `读取标签页失败：${error instanceof Error ? error.message : String(error)}`;
    select.appendChild(option);
  }
}

const STATUS_MARK: Record<ReportRow['status'], string> = { ok: '✓', bad: '✗', skip: '—' };
/** 结论先看这几组；反检测、Date 语义、字体折叠成一行汇总 */
const MAIN_GROUPS = ['时区', '语言', '定位', 'WebRTC'];

function renderRows(rows: ReportRow[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'probe-table';
  const head = document.createElement('tr');
  for (const title of ['项目', '期望', '网页实际', '']) {
    const th = document.createElement('th');
    th.textContent = title;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = `row-${row.status}`;
    for (const text of [row.label, row.expected, row.actual, STATUS_MARK[row.status]]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}

function renderReport(report: ProbeReport): void {
  setText('probeScope', report.scope);
  const summary = document.getElementById('probeSummary');
  if (summary) {
    summary.className = `summary ${report.failed ? 'summary-bad' : 'summary-ok'}`;
    summary.textContent = report.failed
      ? `✗ ${report.failed} 项与期望不一致，${report.passed} 项一致`
      : `✓ ${report.passed} 项全部与期望一致${report.spoofed ? '' : '（该站点按原生值判定）'}`;
  }

  const container = document.getElementById('probeResult');
  if (!container) return;
  container.textContent = '';
  for (const group of MAIN_GROUPS) {
    const rows = report.rows.filter((row) => row.group === group);
    if (!rows.length) continue;
    const title = document.createElement('h3');
    title.textContent = group;
    container.append(title, renderRows(rows));
  }

  const others = report.rows.filter((row) => !MAIN_GROUPS.includes(row.group));
  if (others.length) {
    const failed = others.filter((row) => row.status === 'bad').length;
    const passed = others.filter((row) => row.status === 'ok').length;
    const details = document.createElement('details');
    details.className = 'probe-more';
    details.open = failed > 0;
    const label = document.createElement('summary');
    label.textContent = `反检测与 Date 语义检查：${passed}/${passed + failed} 通过${failed ? `，${failed} 项未通过` : ''}`;
    details.append(label, renderRows(others));
    container.appendChild(details);
  }
}

let probing = false;

async function probeSelectedTab(): Promise<void> {
  const select = document.getElementById('probeTarget') as HTMLSelectElement | null;
  const container = document.getElementById('probeResult');
  const tabId = Number(select?.value || 0);
  if (!container) return;
  if (!tabId) {
    setText('probeScope', '');
    setText('probeSummary', '');
    container.textContent = '先在本窗口打开一个要检测的网页（扩展加载后打开或刷新过），再回到这里。';
    return;
  }
  if (probing) return;
  probing = true;
  setText('probeSummary', '检测中…');
  container.textContent = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url || !/^https?:/i.test(tab.url)) {
      container.textContent = '目标不是 http/https 网页，无法检测。';
      return;
    }
    const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageProbe });
    const probe = results?.[0]?.result as ProbeSnapshot | undefined;
    if (!probe) {
      setText('probeSummary', '');
      container.textContent = '没有取到结果（网页可能拒绝了注入）。';
      return;
    }
    const { config, exit } = await readStoredState();
    renderReport(buildProbeReport(config, tab.url, exit, nativeBaseline(), probe));
  } catch (error) {
    setText('probeSummary', '');
    container.textContent = `检测失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    probing = false;
  }
}

// ---------- 配置概览 ----------

async function renderConfig(): Promise<void> {
  try {
    const { config, exit } = await readStoredState();
    const webRtc = await readWebRtcState();
    const language = config.globalProfile.language;
    const timezone = config.globalProfile.timezone;
    const geolocation = config.globalProfile.geolocation;

    setText('configMaster', config.masterEnabled ? '开启' : '关闭（所有站点保持原生）');
    setText('configLanguage', language.enabled ? `${language.language}（${language.languages.join(', ')}）` : '不接管');
    setText('configAcceptLanguage', language.enabled ? language.acceptLanguage : '不接管');
    setText('configTimezone', !timezone.enabled
      ? '不接管'
      : timezone.mode === 'auto'
        ? `跟随出口 IP${exit && exit.timezone ? `（当前 ${exit.timezone}）` : '（尚未取得，暂留原生值）'}`
        : timezone.timezone || '-');
    setText('configGeolocation', !geolocation.enabled
      ? '不接管'
      : geolocation.mode === 'auto'
        ? `跟随出口 IP${exit ? `（当前 ${exit.latitude}, ${exit.longitude}）` : '（尚未取得）'} · 精度 ${geolocation.accuracy}m`
        : `${geolocation.latitude}, ${geolocation.longitude} · 精度 ${geolocation.accuracy}m`);

    // 字体层：这里只显示"配置说了什么"。三张字表只存在于注入层（它必须自包含，
    // 不能与其它入口共享 chunk），所以"实际生效多少条"要问页面里的 runtime ——
    // 它在 document_start 装完补丁后会把真实条数报回来，见下方 renderFontUsage。
    const canvas = config.canvas;
    const claimed = canvas.platform === 'auto' || !canvas.platform ? '自动（跟随浏览器）' : canvas.platform;
    setText('configFonts', canvas.enabled
      ? `${claimed} · 中文层 ${canvas.hideCjkFonts ? '隐藏' : '保留'} · 手动追加 ${canvas.targetFonts.length} 条`
      : '不接管');
    setText('configFontTargets', canvas.enabled ? '正在查询页面实际上报…' : '（未启用字体伪装）');

    const enabled = config.rules.filter((rule) => rule.enabled).map((rule) => rule.domain);
    const excluded = config.rules.filter((rule) => !rule.enabled).map((rule) => `!${rule.domain}`);
    setText('configRules', `${enabled.length} 个启用${excluded.length ? `、${excluded.length} 个排除` : ''}：${[...enabled, ...excluded].join('、') || '（空）'}`);

    setText('configWebRtc', describeWebRtc(webRtc));

    if (config.canvas.enabled) void renderFontUsage();
    void renderWorkerCoverage();
    renderAudit(config, { exit, webRtc });
  } catch (error) {
    setText('configMaster', `读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 后台读回的 WebRTC 策略：期望值来自配置，实际值与控制权来自浏览器 */
async function readWebRtcState(): Promise<AuditEnvironment['webRtc']> {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getWebRtcConfig' });
    if (!response || response.status !== 'ok') return null;
    const actual = response.state && response.state.actual;
    return {
      expected: response.state.effectivePolicy || null,
      value: actual ? actual.value : null,
      levelOfControl: actual ? actual.levelOfControl : null
    };
  } catch {
    return null;
  }
}

function describeWebRtc(state: AuditEnvironment['webRtc']): string {
  if (!state) return '读取失败';
  const expected = state.expected || '不接管（default）';
  if (!state.levelOfControl) return `${expected} / 浏览器未返回实际值`;
  const owner = state.levelOfControl === 'controlled_by_this_extension'
    ? '本扩展控制'
    : state.levelOfControl === 'controlled_by_other_extensions'
      ? '被其它扩展控制'
      : state.levelOfControl === 'not_controllable'
        ? '被浏览器策略锁定'
        : '可由扩展控制';
  return `${expected} / ${state.value || '-'}（${owner}）`;
}

// ---------- 配置体检 ----------

const SEVERITY_LABEL: Record<AuditSeverity, string> = { error: '必错', warn: '可疑', info: '取舍' };

/** 配置体检：把纯逻辑模块的结论渲染成清单，可点的给出修法 */
function renderAudit(config: SiteSpoofConfig, environment: AuditEnvironment = {}): void {
  const container = document.getElementById('auditList');
  if (!container) return;
  container.textContent = '';

  const findings = sortFindings(auditConfig(config, environment));
  if (!findings.length) {
    const ok = document.createElement('div');
    ok.className = 'audit-ok';
    ok.textContent = '✓ 没有发现自相矛盾的配置。';
    container.appendChild(ok);
    return;
  }

  for (const finding of findings) {
    container.appendChild(renderFinding(finding));
  }
}

function renderFinding(finding: AuditFinding): HTMLElement {
  const item = document.createElement('div');
  item.className = `audit-item ${finding.severity}`;

  const head = document.createElement('div');
  head.className = 'audit-head';
  const badge = document.createElement('span');
  badge.className = 'audit-badge';
  badge.textContent = SEVERITY_LABEL[finding.severity];
  const title = document.createElement('span');
  title.className = 'audit-title';
  title.textContent = finding.title;
  head.append(badge, title);

  const detail = document.createElement('div');
  detail.className = 'audit-detail';
  detail.textContent = finding.detail;

  item.append(head, detail);

  if (finding.fix) {
    const fix = finding.fix;
    const button = document.createElement('button');
    button.className = 'audit-fix';
    button.textContent = fix.label;
    button.addEventListener('click', () => {
      void (async () => {
        const stored = await chrome.storage.local.get(SITE_CONFIG_KEY);
        const current = normalizeConfig(stored[SITE_CONFIG_KEY] || null);
        const next = normalizeConfig(fix.apply(current));
        await chrome.storage.local.set({ [SITE_CONFIG_KEY]: next });
        button.disabled = true;
        button.textContent = '已应用，重新读取…';
        await renderConfig();
        // 配置会热推给已打开的网页，稍等一下再复测
        setTimeout(() => { void probeSelectedTab(); }, 600);
      })();
    });
    item.appendChild(button);
  }

  return item;
}

/**
 * 页面侧报告：问后台要按 hostname 聚合的注入层回报，不能当作独立验证。
 *
 * 为什么不在这里算：三张字表只编在 injected/runtime.js 里（注入层必须自包含，
 * 一旦与其它入口共享 chunk，产物就不是经典脚本、MAIN world 里根本跑不起来）。
 * 所以数字只能由 document_start 装完补丁的 runtime 自己报回来。
 */
async function renderFontUsage(): Promise<void> {
  const report = (value: string) => setText('configFontTargets', value);
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const target = tabs.find((tab) => tab.url && /^https?:/i.test(tab.url));
    if (!target || !target.url) {
      report('没有可比对的站点（先打开一个 http/https 页面，且该域名已启用）');
      return;
    }
    const response = await chrome.runtime.sendMessage({ action: 'getFontLayers', url: target.url });
    const layers = response && response.layers;
    if (!layers) {
      report(`${new URL(target.url).hostname}：尚未收到页面侧报告（打开或刷新该页后再看）`);
      return;
    }
    const platformNote = layers.platform === 'auto' ? '自动' : layers.platform;
    report(`${new URL(target.url).hostname}：${layers.count} 条 · 平台 ${platformNote} · 中文层 ${layers.hideCjkFonts ? '隐藏' : '保留'} · 页面侧报告，未独立验证`);
  } catch (error) {
    report(`查询失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Worker 覆盖面的"实际观察"。
 *
 * 声明部分来自 `WORKER_COVERAGE`（与注入层同源）；观察部分只认后台记录到的回退：
 * 页面 CSP 拒绝 blob 时，那个 Worker 里读到的是原生值 —— 这时 classic/module 要显示
 * degraded，不能和"已生效"混成一句话。
 */
async function renderWorkerCoverage(): Promise<void> {
  const report = (value: string) => setText('workerCoverage', value);
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const target = tabs.find((tab) => tab.url && /^https?:/i.test(tab.url));
    const response = target && target.url
      ? await chrome.runtime.sendMessage({ action: 'getWorkerFallbacks', url: target.url })
      : null;
    const fallback = (response && response.fallback) || null;
    const snapshot = buildWorkerDiagnosticsSnapshot({ workerFallback: fallback });
    const host = target && target.url ? new URL(target.url).hostname : '当前站点';
    const head = snapshot.classicWorker.status === 'degraded'
      ? '⚠️ classic/module/nested 部分覆盖 · shared/service 不支持'
      : 'classic/module/nested 已覆盖 · shared/service 不支持';
    const note = fallback && fallback.count > 0
      ? ` · ${host} 页面侧报告 ${fallback.count} 次回退（${fallback.reasons.join('、')}），未独立验证；最近一次 ${fallback.lastScript || '未记录'}`
      : '';
    report(`${head}${note}`);
  } catch (error) {
    report(`查询失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------- 高级：本页原生基线与手动测试 ----------

function renderBaseline(): void {
  const native = nativeBaseline();
  setText('navigatorLanguage', native.language || 'N/A');
  setText('navigatorLanguages', native.languages.join(', ') || 'N/A');
  setText('intlLocale', new Intl.DateTimeFormat().resolvedOptions().locale);
  setText('intlTimezone', native.timezone);
  const offset = new Date().getTimezoneOffset();
  setText('timezoneOffset', `${offset}（UTC${offset > 0 ? '-' : '+'}${Math.abs(offset / 60)}）`);
  setText('dateToString', new Date().toString());
  setText('platform', navigator.platform || 'N/A');
  setText('userAgent', navigator.userAgent || 'N/A');
  const memory = (navigator as any).deviceMemory;
  setText('hardware', `${navigator.hardwareConcurrency || 'N/A'} 核 / ${memory ? `${memory} GB` : 'N/A'}`);
  setText('screenSize', `${screen.width} × ${screen.height} · ${window.devicePixelRatio}`);

  // 只读权限状态：扩展页没有 geolocation 权限，调用 getCurrentPosition 只会报错并在扩展错误页留下
  // "Is the 'geolocation' permission appropriate?"；网页上的定位由「站点实测」检测
  if (navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' as PermissionName })
      .then((result) => setText('geolocationPermission', result.state))
      .catch(() => setText('geolocationPermission', 'N/A'));
  }
}

// ---------- 启动 ----------

document.getElementById('probeTab')?.addEventListener('click', () => { void probeSelectedTab(); });
document.getElementById('probeTarget')?.addEventListener('change', () => { void probeSelectedTab(); });

renderBaseline();
void renderConfig();
// 打开即检测：没有可检测的网页时 probeSelectedTab 会给出提示
void renderProbeTargets().then(() => probeSelectedTab());
