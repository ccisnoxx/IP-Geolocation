import './leak-test.css';
import { SITE_CONFIG_KEY, normalizeConfig } from '../shared/config-model';

// Geolocation elements
const geolocationExistsEl = document.getElementById('geolocationExists') as HTMLElement;
const geolocationResultEl = document.getElementById('geolocationResult') as HTMLElement;
const latitudeEl = document.getElementById('latitude') as HTMLElement;
const longitudeEl = document.getElementById('longitude') as HTMLElement;
const accuracyEl = document.getElementById('accuracy') as HTMLElement;
const geolocationPermissionEl = document.getElementById('geolocationPermission') as HTMLElement;
const testGeolocationBtn = document.getElementById('testGeolocation') as HTMLButtonElement;
const testWatchPositionBtn = document.getElementById('testWatchPosition') as HTMLButtonElement;

// Language elements
const navigatorLanguageEl = document.getElementById('navigatorLanguage') as HTMLElement;
const navigatorLanguagesEl = document.getElementById('navigatorLanguages') as HTMLElement;
const intlLocaleEl = document.getElementById('intlLocale') as HTMLElement;

// Timezone elements
const intlTimezoneEl = document.getElementById('intlTimezone') as HTMLElement;
const timezoneOffsetEl = document.getElementById('timezoneOffset') as HTMLElement;
const dateToStringEl = document.getElementById('dateToString') as HTMLElement;
const dateToLocaleStringEl = document.getElementById('dateToLocaleString') as HTMLElement;

// WebRTC elements
const rtcExistsEl = document.getElementById('rtcExists') as HTMLElement;
const iceCandidatesEl = document.getElementById('iceCandidates') as HTMLElement;
const testWebRTCBtn = document.getElementById('testWebRTC') as HTMLButtonElement;

// Navigator elements
const platformEl = document.getElementById('platform') as HTMLElement;
const hardwareConcurrencyEl = document.getElementById('hardwareConcurrency') as HTMLElement;
const deviceMemoryEl = document.getElementById('deviceMemory') as HTMLElement;
const userAgentEl = document.getElementById('userAgent') as HTMLElement;
const screenSizeEl = document.getElementById('screenSize') as HTMLElement;
const colorDepthEl = document.getElementById('colorDepth') as HTMLElement;
const devicePixelRatioEl = document.getElementById('devicePixelRatio') as HTMLElement;

function initialize() {
  renderConfig();
  checkGeolocation();
  checkLanguage();
  checkTimezone();
  checkWebRTC();
  checkNavigator();
}

function checkGeolocation() {
  geolocationExistsEl.textContent = navigator.geolocation ? 'Yes' : 'No';

  if (navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' as PermissionName }).then(result => {
      geolocationPermissionEl.textContent = result.state;
    }).catch(() => {
      geolocationPermissionEl.textContent = 'N/A';
    });
  } else {
    geolocationPermissionEl.textContent = 'N/A';
  }
}

function testGeolocation() {
  if (!navigator.geolocation) {
    geolocationResultEl.textContent = 'Not available';
    return;
  }

  geolocationResultEl.textContent = 'Testing...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      geolocationResultEl.textContent = 'Success';
      latitudeEl.textContent = position.coords.latitude.toString();
      longitudeEl.textContent = position.coords.longitude.toString();
      accuracyEl.textContent = `${position.coords.accuracy}m`;
    },
    (error) => {
      geolocationResultEl.textContent = `Error: ${error.message}`;
      latitudeEl.textContent = 'N/A';
      longitudeEl.textContent = 'N/A';
      accuracyEl.textContent = 'N/A';
    }
  );
}

let watchId: number | null = null;

function testWatchPosition() {
  if (!navigator.geolocation) {
    alert('Geolocation not available');
    return;
  }

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    testWatchPositionBtn.textContent = 'Test watchPosition';
    return;
  }

  let count = 0;
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      count++;
      geolocationResultEl.textContent = `watchPosition callback #${count}`;
      latitudeEl.textContent = position.coords.latitude.toString();
      longitudeEl.textContent = position.coords.longitude.toString();
      accuracyEl.textContent = `${position.coords.accuracy}m`;
    },
    (error) => {
      geolocationResultEl.textContent = `Error: ${error.message}`;
    }
  );

  testWatchPositionBtn.textContent = 'Stop watching';
}

function checkLanguage() {
  navigatorLanguageEl.textContent = navigator.language || 'N/A';
  navigatorLanguagesEl.textContent = navigator.languages ? navigator.languages.join(', ') : 'N/A';

  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    intlLocaleEl.textContent = locale;
  } catch {
    intlLocaleEl.textContent = 'N/A';
  }
}

function checkTimezone() {
  try {
    const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    intlTimezoneEl.textContent = timezone;
  } catch {
    intlTimezoneEl.textContent = 'N/A';
  }

  const offset = new Date().getTimezoneOffset();
  timezoneOffsetEl.textContent = `${offset} minutes (UTC${offset > 0 ? '-' : '+'}${Math.abs(offset / 60)})`;

  dateToStringEl.textContent = new Date().toString();
  dateToLocaleStringEl.textContent = new Date().toLocaleString();
}

function checkWebRTC() {
  rtcExistsEl.textContent = window.RTCPeerConnection ? 'Yes' : 'No';
}

async function testWebRTC() {
  if (!window.RTCPeerConnection) {
    iceCandidatesEl.textContent = 'Not available';
    return;
  }

  iceCandidatesEl.textContent = 'Testing...';

  try {
    const pc = new RTCPeerConnection({
      iceServers: []
    });

    const candidates: string[] = [];

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        candidates.push(event.candidate.candidate);
        iceCandidatesEl.textContent = candidates.length > 0
          ? candidates.join(' | ')
          : 'No candidates (protected)';
      } else {
        // Gathering complete
        if (candidates.length === 0) {
          iceCandidatesEl.textContent = 'No candidates detected (protected)';
        }
      }
    };

    // Create offer to trigger ICE gathering
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Close after 3 seconds
    setTimeout(() => {
      pc.close();
    }, 3000);

  } catch (error) {
    iceCandidatesEl.textContent = `Error: ${error}`;
  }
}

function checkNavigator() {
  platformEl.textContent = navigator.platform || 'N/A';
  hardwareConcurrencyEl.textContent = navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency.toString()
    : 'N/A';

  const nav = navigator as any;
  deviceMemoryEl.textContent = nav.deviceMemory
    ? `${nav.deviceMemory} GB`
    : 'N/A';

  userAgentEl.textContent = navigator.userAgent || 'N/A';
  screenSizeEl.textContent = `${screen.width} × ${screen.height}`;
  colorDepthEl.textContent = `${screen.colorDepth} bits`;
  devicePixelRatioEl.textContent = window.devicePixelRatio.toString();
}

// Event listeners
testGeolocationBtn.addEventListener('click', testGeolocation);
testWatchPositionBtn.addEventListener('click', testWatchPosition);
testWebRTCBtn.addEventListener('click', testWebRTC);

// Initialize - delay to ensure spoofs are installed
console.log('Leak test: Waiting for spoofs...');
setTimeout(() => {
  console.log('Leak test: Running checks now');
  initialize();
}, 100);

// ---------- 当前配置（期望值） ----------

async function renderConfig(): Promise<void> {
  const setText = (id: string, value: string) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  try {
    const stored = await chrome.storage.local.get(SITE_CONFIG_KEY);
    const config = normalizeConfig(stored[SITE_CONFIG_KEY] || null);
    const language = config.globalProfile.language;
    const timezone = config.globalProfile.timezone;
    const geolocation = config.globalProfile.geolocation;

    setText('configMaster', config.masterEnabled ? 'enabled' : 'disabled');
    setText('configLanguage', `${language.language} [${language.languages.join(', ')}]`);
    setText('configAcceptLanguage', language.acceptLanguage);
    setText('configTimezone', timezone.mode === 'auto'
      ? 'auto（跟随出口 IP 推导；推导不出来就留原生值）'
      : timezone.timezone || '-');
    setText('configGeolocation', geolocation.mode === 'auto'
      ? `auto（跟随出口 IP；accuracy ${geolocation.accuracy}m）`
      : `${geolocation.latitude}, ${geolocation.longitude}（accuracy ${geolocation.accuracy}m）`);

    // 字体层：这里只显示"配置说了什么"。三张字表只存在于注入层（它必须自包含，
    // 不能与其它入口共享 chunk），所以"实际生效多少条"要问页面里的 runtime ——
    // 它在 document_start 装完补丁后会把真实条数报回来，见下方 renderFontUsage。
    const canvas = config.canvas;
    const claimed = canvas.platform === 'auto' || !canvas.platform ? '自动（跟随浏览器）' : canvas.platform;
    setText('configFonts', canvas.enabled
      ? `${claimed} · 中文层 ${canvas.hideCjkFonts ? '隐藏' : '保留'} · 手动追加 ${canvas.targetFonts.length} 条`
      : 'off（页面按原生字表判定）');
    setText('configFontTargets', canvas.enabled ? '正在查询页面实际上报…' : '（未启用字体伪装）');

    const enabled = config.rules.filter((rule) => rule.enabled).map((rule) => rule.domain);
    const excluded = config.rules.filter((rule) => !rule.enabled).map((rule) => `!${rule.domain}`);
    setText('configRules', [...enabled, ...excluded].join('、') || '（空）');

    if (config.canvas.enabled) void renderFontUsage();
  } catch (error) {
    setText('configMaster', `读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * "实际生效"这一行：问后台要注入层的回报。
 *
 * 为什么不在这里算：三张字表只编在 injected/runtime.js 里（注入层必须自包含，
 * 一旦与其它入口共享 chunk，产物就不是经典脚本、MAIN world 里根本跑不起来）。
 * 所以数字只能由 document_start 装完补丁的 runtime 自己报回来。
 */
async function renderFontUsage(): Promise<void> {
  const element = document.getElementById('configFontTargets');
  const setText = (value: string) => { if (element) element.textContent = value; };
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const target = tabs.find((tab) => tab.url && /^https?:/i.test(tab.url));
    if (!target || !target.url) {
      setText('没有可比对的站点（先打开一个 http/https 页面，且该域名已启用）');
      return;
    }
    const response = await chrome.runtime.sendMessage({ action: 'getFontLayers', url: target.url });
    const layers = response && response.layers;
    if (!layers) {
      setText(`${new URL(target.url).hostname}：还没有页面加载过（打开或刷新该页后再看）`);
      return;
    }
    // 与配置对不上时明确说出来：说明页面拿到的 payload 和当前配置不是同一份
    const platformNote = layers.platform === 'auto' ? '自动' : layers.platform;
    setText(`${new URL(target.url).hostname}：${layers.count} 条 · 平台 ${platformNote} · 中文层 ${layers.hideCjkFonts ? '隐藏' : '保留'}`);
  } catch (error) {
    setText(`查询失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------- 探测当前标签页 ----------

/**
 * 这个函数会被 `chrome.scripting.executeScript` 序列化后注入目标页面，
 * 所以它必须**自包含** —— 任何外部引用在页面里都是 ReferenceError。
 */
async function pageProbe() {
  const rows: Array<{ label: string; value: string; ok?: boolean }> = [];
  const push = (label: string, value: unknown, ok?: boolean) => {
    rows.push({ label, value: String(value), ok });
  };
  const same = (label: string, expected: string, actual: string) => {
    rows.push({ label, value: actual, ok: actual === expected });
  };

  // 时区
  try {
    push('Intl 时区', new Intl.DateTimeFormat().resolvedOptions().timeZone);
    push('Intl locale', new Intl.DateTimeFormat().resolvedOptions().locale);
    push('getTimezoneOffset()', new Date().getTimezoneOffset());
    push('Date.toString()', new Date().toString());
  } catch (error) {
    push('时区', `读取失败：${error}`);
  }

  // 语言
  push('navigator.language', navigator.language);
  push('navigator.languages', navigator.languages.join(', '));
  rows.push({
    label: 'languages 冻结（FrozenArray）',
    value: String(Object.isFrozen(navigator.languages)),
    ok: Object.isFrozen(navigator.languages)
  });

  // Date 语义
  try {
    const stringDate = new Date('2026-01-01T00:00:00');
    push('new Date("2026-01-01T00:00:00").getHours()', stringDate.getHours());
    push('同上 toISOString()', stringDate.toISOString());
    same('非法日期 toString()', 'Invalid Date', new Date('nope').toString());

    const roundTrip = new Date('2026-01-01T00:00:00');
    roundTrip.setHours(15, 0, 0, 0);
    rows.push({
      label: 'setHours(15) 往返',
      value: String(roundTrip.getHours()),
      ok: roundTrip.getHours() === 15
    });
  } catch (error) {
    push('Date 语义', `读取失败：${error}`);
  }

  // 反检测不变量
  rows.push({
    label: 'Date.prototype.setHours.toString()',
    value: Date.prototype.setHours.toString(),
    ok: Date.prototype.setHours.toString() === 'function setHours() { [native code] }'
  });
  rows.push({
    label: 'new Date() 自有属性个数',
    value: String(Object.keys(new Date()).length),
    ok: Object.keys(new Date()).length === 0
  });
  rows.push({
    label: "document.fonts.check('12px Helvetica')",
    value: document.fonts ? String(document.fonts.check('12px Helvetica')) : 'n/a',
    ok: document.fonts ? document.fonts.check('12px Helvetica') === true : undefined
  });

  // 字体度量：检测脚本的标准写法（canvas 宽度探测 + 本地化名字 + OffscreenCanvas）
  //
  // 这一组直接复刻公开检测站的实现：单选一个字体名，和三个通用族各比一次宽度。
  // 只要有一条命中，就说明那个字体名没有被伪装。中文名（苹方-简 / 微软雅黑）必须
  // 单独列出来 —— 它们和拉丁名指向同一个字体，但字符串完全不同。
  try {
    const measureFonts = (ctx: any) => {
      const probe = (family: string) => ['monospace', 'sans-serif', 'serif'].some((generic) => {
        ctx.font = `72px ${generic}`;
        const base = ctx.measureText('中文字体检测ABCabc012').width;
        ctx.font = `72px "${family}", ${generic}`;
        const width = ctx.measureText('中文字体检测ABCabc012').width;
        return Math.abs(width - base) > 0.5;
      });
      return {
        latin: ['SimSun', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB'].filter(probe),
        alias: ['宋体', '苹方-简', '微软雅黑'].filter(probe),
        vendor: ['MiSans', 'HarmonyOS Sans SC', 'OPPO Sans'].filter(probe)
      };
    };

    const canvasCtx = document.createElement('canvas').getContext('2d');
    const viaCanvas = canvasCtx ? measureFonts(canvasCtx) : null;
    if (viaCanvas) {
      for (const [key, label] of [['latin', 'canvas 拉丁名'], ['alias', 'canvas 中文别名'], ['vendor', 'canvas 厂商字体']] as const) {
        rows.push({
          label: `${label}探测命中`,
          value: (viaCanvas as any)[key].join(', ') || 'none',
          ok: (viaCanvas as any)[key].length === 0
        });
      }
    }

    // OffscreenCanvas 是另一条路径：只补 <canvas> 的实现会在这里全露
    const offscreenCtx = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(8, 8).getContext('2d')
      : null;
    if (offscreenCtx) {
      const viaOffscreen = measureFonts(offscreenCtx);
      rows.push({
        label: 'OffscreenCanvas 探测命中',
        value: [...viaOffscreen.latin, ...viaOffscreen.alias, ...viaOffscreen.vendor].join(', ') || 'none',
        ok: viaOffscreen.latin.length + viaOffscreen.alias.length + viaOffscreen.vendor.length === 0
      });
    }
  } catch (error) {
    push('字体度量', `读取失败：${error}`);
  }

  // 定位
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    push('permissions.geolocation', permission.state);
  } catch {
    push('permissions.geolocation', 'n/a');
  }

  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (value) => resolve(value),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
  if (position) {
    const coords: any = position.coords;
    push('坐标', `${coords.latitude}, ${coords.longitude} ±${coords.accuracy}m`);
    rows.push({
      label: 'Coordinates 自有属性个数',
      value: String(Object.keys(coords).length),
      ok: Object.keys(coords).length === 0
    });
    rows.push({
      label: 'Coordinates toStringTag',
      value: Object.prototype.toString.call(coords),
      ok: Object.prototype.toString.call(coords) === '[object GeolocationCoordinates]'
    });
  } else {
    push('坐标', '未取得（权限被拒或超时）');
  }

  // canvas 字体度量：被伪装的字体应该和兜底字体量出一样的宽度
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      const measure = (family: string) => {
        context.font = `16px ${family}`;
        return context.measureText('mmmmmmmmmmlli').width;
      };
      push('measureText(monospace)', measure('monospace'));
      push('measureText(serif)', measure('serif'));
    }
  } catch (error) {
    push('canvas', `读取失败：${error}`);
  }

  return rows;
}

/**
 * 填目标下拉框。
 *
 * 不能用 `active: true, currentWindow: true` —— 本页自己就是活动标签页，
 * 那样永远探测到自己。这里把同窗口的 http(s) 标签页列出来让用户挑。
 */
async function renderProbeTargets(): Promise<void> {
  const select = document.getElementById('probeTarget') as HTMLSelectElement | null;
  if (!select) return;

  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const self = tabs.find((tab) => tab.active && tab.url?.startsWith('chrome-extension://'));
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !/^https?:/i.test(tab.url)) continue;
      const option = document.createElement('option');
      option.value = String(tab.id);
      option.textContent = `${tab.title || tab.url} — ${tab.url}`;
      if (self && tab.index < self.index) option.selected = true;
      select.appendChild(option);
    }
    if (!select.options.length) {
      const option = document.createElement('option');
      option.textContent = '（同窗口没有 http/https 标签页）';
      option.value = '';
      select.appendChild(option);
    }
  } catch (error) {
    select.textContent = '';
    const option = document.createElement('option');
    option.textContent = `读取标签页失败：${error instanceof Error ? error.message : String(error)}`;
    option.value = '';
    select.appendChild(option);
  }
}

async function probeActiveTab(): Promise<void> {
  const container = document.getElementById('probeResult');
  const select = document.getElementById('probeTarget') as HTMLSelectElement | null;
  if (!container) return;
  const tabId = Number(select?.value || 0);
  if (!tabId) {
    container.textContent = '先选一个 http/https 标签页。';
    return;
  }
  container.textContent = '探测中…';

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url || !/^https?:/i.test(tab.url)) {
      container.textContent = '目标不是 http/https 页面，无法探测。';
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: pageProbe
    });
    const rows = (results?.[0]?.result || []) as Array<{ label: string; value: string; ok?: boolean }>;
    if (!rows.length) {
      container.textContent = '没有取到结果（页面可能拒绝了注入）。';
      return;
    }

    container.textContent = '';
    const target = document.createElement('p');
    target.className = 'note';
    target.textContent = `目标：${tab.url}`;
    container.appendChild(target);

    const table = document.createElement('table');
    table.className = 'probe-table';
    for (const row of rows) {
      const tr = document.createElement('tr');
      const label = document.createElement('td');
      label.textContent = row.label;
      const value = document.createElement('td');
      value.textContent = row.value;
      if (row.ok === true) value.className = 'probe-ok';
      if (row.ok === false) value.className = 'probe-bad';
      tr.append(label, value);
      table.appendChild(tr);
    }
    container.appendChild(table);
  } catch (error) {
    container.textContent = `探测失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

document.getElementById('probeTab')?.addEventListener('click', probeActiveTab);
void renderProbeTargets();
