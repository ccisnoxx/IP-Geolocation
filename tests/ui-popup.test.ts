import { register } from 'node:module';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/shared/config-model';
import { installUiDom, waitFor } from './helpers/ui-dom';

register(new URL('./helpers/css-loader.mjs', import.meta.url));

interface RuntimeCall { action?: string; config?: any; domain?: string; profileId?: string }

function createChrome(calls: RuntimeCall[]) {
  const state = {
    domain: 'claude.ai',
    matched: true,
    payload: { hostname: 'claude.ai' },
    errors: [] as string[],
    config: structuredClone(DEFAULT_CONFIG),
    workerFallback: null as any,
    lastLocation: null as any,
    applyOutcome: {
      ok: true,
      changed: true,
      layers: ['timezone', 'geolocation', 'language', 'profile'],
      ip: '203.0.113.9',
      country: 'United States',
      timezone: 'America/Los_Angeles',
      latitude: 34.0522,
      longitude: -118.2437,
      language: 'en-US'
    } as any
  };
  const createdTabs: string[] = [];
  return {
    state,
    createdTabs,
    tabs: { create: async (details: { url: string }) => { createdTabs.push(details.url); return { id: 1 }; } },
    runtime: {
      lastError: undefined,
      sendMessage(message: any, callback?: (response: any) => void) {
        calls.push(message);
        const response = (() => {
          switch (message.action) {
            case 'getCurrentTabState':
              return {
                status: 'ok',
                state: { ...state, config: structuredClone(state.config), lastLocation: state.lastLocation }
              };
            case 'applyFromExitIp': {
              const outcome = state.applyOutcome;
              if (!outcome.ok) return { status: 'ok', outcome };
              // 模拟后台：手动配置落 manual，坐标/时区直接写进配置
              state.config = {
                ...state.config,
                globalProfile: {
                  ...state.config.globalProfile,
                  timezone: { ...state.config.globalProfile.timezone, mode: 'manual', timezone: outcome.timezone },
                  geolocation: {
                    ...state.config.globalProfile.geolocation,
                    mode: 'manual',
                    latitude: outcome.latitude,
                    longitude: outcome.longitude,
                    country: outcome.country
                  }
                },
                profile: { ...state.config.profile, activeProfileId: null }
              };
              state.lastLocation = {
                latitude: outcome.latitude,
                longitude: outcome.longitude,
                country: outcome.country,
                timezone: outcome.timezone
              };
              return { status: 'ok', outcome, config: structuredClone(state.config), lastLocation: state.lastLocation };
            }
            case 'getFirstScreenStatus':
              // 「允许用户脚本」没开、Chrome 156：首屏保护未开启
              return { status: 'ok', state: { mode: 'contentScripts', chromeMajor: 156, extensionId: 'ext-id' } };
            case 'getExitIpSyncState':
              return { status: 'ok', ipSync: state.config.ipSync, storedIp: '', lastLocation: state.lastLocation };
            case 'manualUpdate':
              return { status: 'ok', geo: { ok: true, location: state.lastLocation } };
            case 'setSiteConfig':
              state.config = structuredClone(message.config);
              return { status: 'ok', config: structuredClone(message.config) };
            case 'setDomainRuleEnabled':
              return { status: 'ok', config: structuredClone(state.config) };
            case 'applyProfile':
              return { status: 'ok', config: structuredClone(state.config) };
            default:
              return { status: 'ok' };
          }
        })();
        if (typeof callback === 'function') {
          setTimeout(() => callback(response), 0);
          return undefined;
        }
        return Promise.resolve(response);
      }
    }
  };
}

let ui: ReturnType<typeof installUiDom>;
let calls: RuntimeCall[];
let chrome: ReturnType<typeof createChrome>;

before(async () => {
  ui = installUiDom('src/popup/popup.html', 'chrome-extension://test/popup/popup.html');
  calls = [];
  chrome = createChrome(calls);
  (globalThis as any).chrome = chrome;
  await import('../src/popup/popup');
  await waitFor(() => (ui.document.getElementById('currentSite') as HTMLElement).textContent === 'claude.ai');
});

const el = <T extends HTMLElement>(id: string): T => ui.document.getElementById(id) as T;

after(() => { ui.dom.window.close(); });

test('popup 加载真实 DOM：站点、全局状态和隐藏告警正确', () => {
  assert.equal(el('currentSite').textContent, 'claude.ai');
  assert.equal(el('currentSiteSites').textContent, 'claude.ai');
  assert.equal(el<HTMLInputElement>('globalEnabled').checked, true);
  assert.equal(el('globalStatus').textContent, '全局保护已启用');
  assert.equal(el('siteWarning').hidden, true);
  assert.equal(el('siteOk').hidden, false);
});

test('概览摘要包含字体伪装，并指向 Canvas 分组', () => {
  assert.equal(el('summaryFont').textContent, '未启用');
  const row = ui.document.querySelector('.summary-row[data-target="canvasSection"]');
  assert.ok(row);
  assert.equal(el('canvasSection').tagName, 'DETAILS');
});

test('Worker 包装失败报告可见，并说明按域聚合且未独立验证', async () => {
  chrome.state.workerFallback = {
    hostname: 'claude.ai',
    count: 2,
    reasons: ['csp-blocked'],
    lastScript: 'https://claude.ai/worker.js',
    lastMessage: "Failed to construct 'Worker': CSP",
    at: Date.now()
  } as any;
  // 任意一次 loadConfig 都会重画：用"排除本站"触发（它内部只改规则再重读状态）
  el<HTMLButtonElement>('disableSite').dispatchEvent(new Event('click', { bubbles: true }));
  await waitFor(() => el('workerFallback').hidden === false);

  assert.match(el('workerFallbackText').textContent || '', /同域页面报告 2 次 Worker 包装失败/);
  assert.match(el('workerFallbackText').textContent || '', /CSP/);
  assert.match(el('workerFallbackHint').textContent || '', /回退原生/);
  assert.match(el('workerFallbackHint').textContent || '', /尚未独立验证/);

  chrome.state.workerFallback = null;
  el<HTMLButtonElement>('disableSite').dispatchEvent(new Event('click', { bubbles: true }));
  await waitFor(() => el('workerFallback').hidden === true);
});

test('popup 切总开关立即保存并更新状态文案', async () => {
  el<HTMLInputElement>('globalEnabled').checked = false;
  el<HTMLInputElement>('globalEnabled').dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig' && call.config?.masterEnabled === false));
  assert.equal(el('globalStatus').textContent, '全局保护已禁用');
});

test('popup 排除 / 启用本站带回当前 hostname', async () => {
  el<HTMLButtonElement>('disableSite').click();
  await waitFor(() => calls.some((call) => call.action === 'setDomainRuleEnabled' && call.domain === 'claude.ai'));
  assert.equal(calls.filter((call) => call.action === 'setDomainRuleEnabled').at(-1)?.domain, 'claude.ai');

  el<HTMLButtonElement>('enableSite').click();
  await waitFor(() => calls.filter((call) => call.action === 'setDomainRuleEnabled').length >= 2);
});

test('popup 坐标校验：空值 / 越界提示，有效坐标写入 history', async () => {
  const lat = el<HTMLInputElement>('latitude');
  const lon = el<HTMLInputElement>('longitude');
  const acc = el<HTMLInputElement>('accuracy');

  lat.value = '';
  lon.value = '';
  acc.value = '';
  el<HTMLButtonElement>('saveCoordinate').click();
  await waitFor(() => ui.alerts.includes('请填写完整的纬度和经度'));

  lat.value = '91';
  lon.value = '0';
  acc.value = '10';
  el<HTMLButtonElement>('saveCoordinate').click();
  await waitFor(() => ui.alerts.includes('无效的坐标'));

  lat.value = '35.6762';
  lon.value = '139.6503';
  acc.value = '25';
  el<HTMLButtonElement>('saveCoordinate').click();
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig'
    && call.config?.globalProfile?.geolocation?.history?.[0]?.latitude === 35.6762));
});

test('popup 快捷配置、重试定位、打开选项页都发对应 action', async () => {
  const card = ui.document.querySelector('.profile-card[data-profile="japan"]') as HTMLButtonElement;
  card.click();
  await waitFor(() => calls.some((call) => call.action === 'applyProfile' && call.profileId === 'japan'));

  // 新增的 preset 卡片走同一条通路：HTML 里加卡片即可，不需要额外接线
  const west = ui.document.querySelector('.profile-card[data-profile="us-west"]') as HTMLButtonElement;
  west.click();
  await waitFor(() => calls.some((call) => call.action === 'applyProfile' && call.profileId === 'us-west'));

  el<HTMLButtonElement>('retryLocation').click();
  await waitFor(() => calls.some((call) => call.action === 'manualUpdate'));

  el<HTMLButtonElement>('openOptionsHeader').click();
  await waitFor(() => calls.some((call) => call.action === 'openOptions'));
});

test('字体层默认关闭时弹窗明说「未启用」，勾上就消失', async () => {
  // 默认 DEFAULT_CONFIG.canvas.enabled === false
  assert.equal(el('canvasOffBadge').hidden, false);
  assert.equal(el('canvasOffHint').hidden, false);
  assert.match(el('canvasOffHint').textContent || '', /中文字体/);

  el<HTMLInputElement>('canvasEnabled').checked = true;
  el<HTMLInputElement>('canvasEnabled').dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => el('canvasOffBadge').hidden === true);
  assert.equal(el('canvasOffHint').hidden, true);
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig' && call.config?.canvas?.enabled === true));
  await waitFor(() => el('summaryFont').textContent === '已启用');

  // 关回去也要恢复提示
  el<HTMLInputElement>('canvasEnabled').checked = false;
  el<HTMLInputElement>('canvasEnabled').dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => el('canvasOffBadge').hidden === false);
  assert.equal(el('canvasOffHint').hidden, false);
  await waitFor(() => el('summaryFont').textContent === '未启用');
});

test('popup 重置字体和重置全部配置都会保存', async () => {
  const before = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('resetFonts').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);
  const afterFonts = calls.filter((call) => call.action === 'setSiteConfig').length;

  el<HTMLButtonElement>('reset').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > afterFonts);
  assert.equal(el<HTMLInputElement>('globalEnabled').checked, true);
});

test('「从 IP 自动配置」真的改写坐标/时区，并把结果写在按钮下面', async () => {
  chrome.state.applyOutcome = {
    ok: true,
    changed: true,
    layers: ['timezone', 'geolocation', 'language', 'profile'],
    ip: '203.0.113.9',
    country: 'United States',
    timezone: 'America/Los_Angeles',
    latitude: 34.0522,
    longitude: -118.2437,
    language: 'en-US'
  };

  el<HTMLButtonElement>('getFromIP').click();
  await waitFor(() => calls.some((call) => call.action === 'applyFromExitIp'));
  // 先有"正在查询"、成功后才变 ok —— 只等 hidden 会在 pending 阶段就通过
  await waitFor(() => el('ipConfigStatus').dataset.tone === 'ok');

  // 以前发的是 manualUpdate：配置是 manual 时解析层不看 lastLocation，界面一个数字都不动
  assert.equal(calls.some((call) => call.action === 'applyFromExitIp'), true);
  assert.equal(el<HTMLInputElement>('latitude').value, '34.0522');
  assert.equal(el<HTMLInputElement>('longitude').value, '-118.2437');
  assert.equal(el<HTMLInputElement>('timezone').value, 'America/Los_Angeles');

  const status = el('ipConfigStatus');
  assert.match(status.textContent || '', /已按出口 IP 203\.0\.113\.9 配置/);
  assert.match(status.textContent || '', /America\/Los_Angeles/);
  assert.equal(status.dataset.tone, 'ok');
});

test('「从 IP 自动配置」失败时按钮下面必须有错误，而不是静默无反应', async () => {
  chrome.state.applyOutcome = { ok: false, error: 'exit IP lookup failed: timeout' };
  el('ipConfigStatus').hidden = true;
  await waitFor(() => el<HTMLButtonElement>('getFromIP').disabled === false);

  el<HTMLButtonElement>('getFromIP').click();
  await waitFor(() => el('ipConfigStatus').hidden === false && el('ipConfigStatus').dataset.tone === 'error');

  assert.match(el('ipConfigStatus').textContent || '', /自动配置失败/);
  assert.match(el('ipConfigStatus').textContent || '', /查不到出口 IP/);
  // 技术细节留给 lastGeoError，弹窗里别糊三行 URL 上去
  assert.doesNotMatch(el('ipConfigStatus').textContent || '', /https?:\/\//);
  assert.equal(el<HTMLButtonElement>('getFromIP').disabled, false);
});

test('auto 档在表单里显示实际生效的定位，保存时不会被钉成 manual', async () => {
  chrome.state.config = {
    ...chrome.state.config,
    globalProfile: {
      ...chrome.state.config.globalProfile,
      timezone: { ...chrome.state.config.globalProfile.timezone, mode: 'auto', timezone: '' },
      geolocation: {
        ...chrome.state.config.globalProfile.geolocation,
        mode: 'auto',
        latitude: null,
        longitude: null
      }
    }
  };
  chrome.state.lastLocation = {
    latitude: 1.3521,
    longitude: 103.8198,
    country: 'Singapore',
    timezone: 'Asia/Singapore'
  };

  // 重试定位会重读状态并按 lastLocation 重画
  el<HTMLButtonElement>('retryLocation').click();
  await waitFor(() => el<HTMLInputElement>('latitude').value === '1.3521');

  assert.equal(el<HTMLInputElement>('longitude').value, '103.8198');
  assert.equal(el<HTMLInputElement>('timezone').value, 'Asia/Singapore');
  assert.equal(el<HTMLInputElement>('utcOffset').value, '8');

  // 用户没动过这几个数字：保存时仍按 auto 提交，跟随出口 IP 不会被静默关掉
  el<HTMLInputElement>('globalEnabled').checked = false;
  el<HTMLInputElement>('globalEnabled').dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig'
    && call.config?.globalProfile?.geolocation?.mode === 'auto'
    && call.config?.globalProfile?.timezone?.mode === 'auto'));
});

test('「完全不调用系统定位」与「伪装权限」互相牵制，并一起写进配置', async () => {
  const noNative = el<HTMLInputElement>('noNativeCall');
  const spoof = el<HTMLInputElement>('spoofPermission');

  // 文案必须把用户真正在意的结果说出来：站点再也看不到授权框
  assert.match(el('noNativeCallHint').textContent || '', /站点永远不会弹授权框/);
  assert.match(el('noNativeCallHint').textContent || '', /留痕/);

  // 关掉伪装权限 → 这道刹车自动松开（否则归一化会把它拉回来，界面像在抽风）
  spoof.checked = false;
  spoof.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => noNative.checked === false);
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig'
    && call.config?.globalProfile?.geolocation?.spoofPermission === false
    && call.config?.globalProfile?.geolocation?.noNativeCall === false));

  // 再打开刹车 → 必须把伪装权限一起勾上
  noNative.checked = true;
  noNative.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(spoof.checked, true, '不碰原生必须同时伪装权限');
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig'
    && call.config?.globalProfile?.geolocation?.noNativeCall === true
    && call.config?.globalProfile?.geolocation?.spoofPermission === true));
});

test('首屏保护未开启：提示去扩展详情页打开「允许用户脚本」，按钮直达本扩展详情页', async () => {
  await waitFor(() => el('firstScreen').hidden === false);
  assert.equal(el('firstScreenText').textContent, '首屏保护未开启');
  assert.match(el('firstScreenHint').textContent || '', /允许用户脚本/);
  assert.equal(el('firstScreenOpen').hidden, false);
  el<HTMLButtonElement>('firstScreenOpen').click();
  await waitFor(() => chrome.createdTabs.length > 0);
  assert.deepEqual(chrome.createdTabs, ['chrome://extensions/?id=ext-id']);
});
