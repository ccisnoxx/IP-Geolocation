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
    config: structuredClone(DEFAULT_CONFIG)
  };
  return {
    state,
    runtime: {
      lastError: undefined,
      sendMessage(message: any, callback?: (response: any) => void) {
        calls.push(message);
        const response = (() => {
          switch (message.action) {
            case 'getCurrentTabState':
              return { status: 'ok', state: { ...state, config: structuredClone(state.config) } };
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
  assert.equal(el<HTMLInputElement>('globalEnabled').checked, true);
  assert.equal(el('globalStatus').textContent, '全局保护已启用');
  assert.equal(el('siteWarning').hidden, true);
  assert.equal(el('siteOk').hidden, false);
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

  el<HTMLButtonElement>('retryLocation').click();
  await waitFor(() => calls.some((call) => call.action === 'manualUpdate'));

  el<HTMLButtonElement>('openOptionsHeader').click();
  await waitFor(() => calls.some((call) => call.action === 'openOptions'));
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
