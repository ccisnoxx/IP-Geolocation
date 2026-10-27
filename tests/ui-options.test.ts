import { register } from 'node:module';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/shared/config-model';
import { installUiDom, waitFor } from './helpers/ui-dom';

register(new URL('./helpers/css-loader.mjs', import.meta.url));

interface RuntimeCall { action?: string; config?: any; domain?: string; profileId?: string }

function createChrome(calls: RuntimeCall[]) {
  let bakeResponse: any = { status: 'ok', config: structuredClone(DEFAULT_CONFIG), lastLocation: null };
  return {
    runtime: {
      lastError: undefined,
      sendMessage(message: any, callback?: (response: any) => void) {
        calls.push(message);
        const response = (() => {
          switch (message.action) {
            case 'getSiteConfig':
              return { status: 'ok', config: structuredClone(DEFAULT_CONFIG) };
            case 'setSiteConfig':
              return { status: 'ok', config: structuredClone(message.config) };
            case 'applyProfile':
              return { status: 'ok', config: structuredClone(DEFAULT_CONFIG) };
            case 'getBakeSnapshot':
              return bakeResponse;
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
    },
    setBakeResponse(value: any) { bakeResponse = value; }
  };
}

let ui: ReturnType<typeof installUiDom>;
let calls: RuntimeCall[];

before(async () => {
  ui = installUiDom('src/options/options.html', 'chrome-extension://test/options/options.html');
  calls = [];
  (globalThis as any).chrome = createChrome(calls);
  await import('../src/options/options');
  await waitFor(() => (ui.document.getElementById('ruleList') as HTMLTextAreaElement).value.length > 0);
});

const el = <T extends HTMLElement>(id: string): T => ui.document.getElementById(id) as T;

after(() => { ui.dom.window.close(); });

test('options 加载后用真实 DOM 渲染字段、规则和空的自定义 profile 区', () => {
  assert.equal(el<HTMLInputElement>('globalEnabled').checked, true);
  assert.match(el<HTMLTextAreaElement>('ruleList').value, /chatgpt\.com/);
  assert.ok(ui.document.querySelectorAll('.site-rule').length > 0);
  assert.match(el('customProfiles').textContent || '', /暂无自定义配置文件/);
  assert.equal(ui.document.querySelectorAll('.profile-card').length, 5);
});

test('options 保存读取当前表单并把改名后的配置发给后台', async () => {
  el<HTMLInputElement>('globalEnabled').checked = false;
  el<HTMLInputElement>('debugMode').checked = true;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig' && call.config?.masterEnabled === false));

  const save = calls.filter((call) => call.action === 'setSiteConfig').at(-1);
  assert.equal(save?.config.masterEnabled, false);
  assert.equal(save?.config.debugMode, true);
});

test('options 站点规则按钮走 save → reload → reloadRules 链路', async () => {
  el<HTMLInputElement>('globalEnabled').checked = true;
  const toggle = ui.document.querySelector('.site-rule button') as HTMLButtonElement;
  toggle.click();
  await waitFor(() => calls.some((call) => call.action === 'reloadAffectedTabs'));
  assert.ok(calls.some((call) => call.action === 'setSiteConfig'));
  assert.ok(calls.some((call) => call.action === 'reloadAffectedTabs' && call.domain));
});

test('options tab 点击切换 active 状态', () => {
  const tabs = [...ui.document.querySelectorAll<HTMLButtonElement>('.tab-btn')];
  tabs[1].click();
  assert.equal(tabs[1].classList.contains('active'), true);
  assert.equal(tabs[0].classList.contains('active'), false);
  assert.equal(ui.document.querySelector('.tab-content[data-tab="timezone"]')?.classList.contains('active'), true);
});

test('options 另存为自定义 profile：空名称提示，有效名称落库并渲染', async () => {
  el<HTMLButtonElement>('saveAsCustom').click();
  el<HTMLButtonElement>('confirmSaveProfile').click();
  await waitFor(() => ui.alerts.includes('请输入配置名称'));

  el<HTMLInputElement>('newProfileName').value = 'Tokyo Test';
  el<HTMLInputElement>('newProfileDescription').value = 'dom test';
  el<HTMLInputElement>('latitude').value = '35.6762';
  el<HTMLInputElement>('longitude').value = '139.6503';
  el<HTMLInputElement>('timezone').value = 'Asia/Tokyo';
  el<HTMLButtonElement>('confirmSaveProfile').click();
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig' && call.config?.profile?.profiles?.some((profile: any) => profile.id === 'tokyo-test')));
  await waitFor(() => /Tokyo Test/.test(el('customProfiles').textContent || ''));
  assert.match(el('customProfiles').textContent || '', /Tokyo Test/);
});

test('options 重置受 confirm 保护，确认后才保存默认配置', async () => {
  const before = calls.filter((call) => call.action === 'setSiteConfig').length;
  ui.setConfirm(false);
  el<HTMLButtonElement>('resetAll').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.filter((call) => call.action === 'setSiteConfig').length, before);

  ui.setConfirm(true);
  el<HTMLButtonElement>('resetAll').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);
});

test('options 导出配置和烘焙失败路径都能走通', async () => {
  el<HTMLButtonElement>('exportConfig').click();
  assert.equal(ui.downloads.length, 1);
  assert.match(ui.downloads[0].download, /^vanishgeo-config-\d+\.json$/);

  const chrome = (globalThis as any).chrome;
  chrome.setBakeResponse({ status: 'ok', config: structuredClone(DEFAULT_CONFIG), lastLocation: null });
  el<HTMLButtonElement>('exportBake').click();
  await waitFor(() => ui.downloads.length === 2);
  assert.match(ui.downloads[1].download, /vanishgeo-bake\.json/);

  chrome.setBakeResponse({ status: 'error', error: 'offline' });
  el<HTMLButtonElement>('exportBake').click();
  await waitFor(() => ui.alerts.some((message) => message.includes('导出失败: offline')));
});
