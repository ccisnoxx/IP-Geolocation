import { register } from 'node:module';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, DEFAULT_PROFILES } from '../src/shared/config-model';
import { installUiDom, waitFor } from './helpers/ui-dom';

register(new URL('./helpers/css-loader.mjs', import.meta.url));

interface RuntimeCall { action?: string; config?: any; domain?: string; profileId?: string; force?: boolean }

function createChrome(calls: RuntimeCall[]) {
  // chrome.storage.local 的最小实现：options.ts 用它读 lastGeoError（烘焙构建里
  // 运行时通道是关的，这条信息只能从 storage 拿），并在写完之后触发 onChanged。
  const storage: Record<string, any> = {};
  const storageListeners: Array<(changes: Record<string, any>, area: string) => void> = [];
  const storageArea = {
    async get(defaults: Record<string, any>) {
      const out: Record<string, any> = {};
      for (const key of Object.keys(defaults ?? {})) {
        out[key] = key in storage ? storage[key] : defaults[key];
      }
      return out;
    },
    async set(patch: Record<string, any>) {
      const changes: Record<string, any> = {};
      for (const [key, value] of Object.entries(patch)) {
        changes[key] = { oldValue: storage[key], newValue: value };
        storage[key] = value;
      }
      for (const listener of storageListeners) listener(changes, 'local');
    }
  };
  let bakeResponse: any = { status: 'ok', config: structuredClone(DEFAULT_CONFIG), lastLocation: null };
  let siteConfig = structuredClone(DEFAULT_CONFIG);
  // 「先发的读慢、后发的读快」这种顺序不排队就是造不出来的：默认每次读都立刻回，
  // 那么无论有没有轮次守卫，最后写下的都是最新一次读到的内容。
  let ipSyncReadQueue: Array<{ delay: number; storedIp: string }> = [];
  let responseDelay = 0;
  let ipSyncEnabled = false;
  let ipSyncLanguage = false;
  let ipSyncInterval = DEFAULT_CONFIG.ipSync.intervalMinutes;
  let exitIpSyncOutcome: any = null;
  let storedIpOverride: string | null = null;
  let checkIpSyncError: string | null = null;
  let applyOutcome: any = null;
  return {
    runtime: {
      lastError: undefined,
      sendMessage(message: any, callback?: (response: any) => void) {
        calls.push(message);
        const response = (() => {
          switch (message.action) {
            case 'getSiteConfig':
              // 桩要真的记住写进去的东西：恒返回 DEFAULT_CONFIG 时，任何"保存后
              // 再读"的断言都只是在测渲染函数对一份固定输入的输出（见 docs/reviews/REVIEW-P2.md 第 22 条）
              return { status: 'ok', config: structuredClone(siteConfig) };
            case 'setSiteConfig':
              siteConfig = structuredClone(message.config);
              return { status: 'ok', config: structuredClone(siteConfig) };
            case 'applyProfile':
              return { status: 'ok', config: structuredClone(siteConfig) };
            case 'getBakeSnapshot':
              return bakeResponse;
            case 'getExitIpSyncState': {
              const queued = ipSyncReadQueue.shift();
              responseDelay = queued?.delay ?? 0;
              return {
                status: 'ok',
                ipSync: { enabled: ipSyncEnabled, syncLanguage: ipSyncLanguage, intervalMinutes: ipSyncInterval },
                storedIp: queued
                  ? queued.storedIp
                  : (ipSyncEnabled ? (storedIpOverride ?? '203.0.113.9') : ''),
                lastLocation: ipSyncEnabled
                  ? { latitude: 34.0522, longitude: -118.2437, accuracy: 50, timezone: 'America/Los_Angeles', country: 'United States', updateTime: 1 }
                  : null
              };
            }
            case 'applyFromExitIp': {
              const outcome = applyOutcome || {
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
              if (!outcome.ok) return { status: 'ok', outcome };
              siteConfig = {
                ...structuredClone(siteConfig),
                globalProfile: {
                  ...siteConfig.globalProfile,
                  timezone: { ...siteConfig.globalProfile.timezone, mode: 'manual', timezone: outcome.timezone },
                  geolocation: {
                    ...siteConfig.globalProfile.geolocation,
                    mode: 'manual',
                    latitude: outcome.latitude,
                    longitude: outcome.longitude,
                    country: outcome.country
                  }
                }
              };
              return {
                status: 'ok',
                outcome,
                config: structuredClone(siteConfig),
                lastLocation: {
                  latitude: outcome.latitude,
                  longitude: outcome.longitude,
                  country: outcome.country,
                  timezone: outcome.timezone
                }
              };
            }
            case 'checkExitIpSync': {
              // 真实链路上后台抛错会被 service-worker 转成 { status: 'error' }，
              // 前端 sendRuntimeMessage 再 reject —— 这里照这个形状造错误
              if (checkIpSyncError) return { status: 'error', message: checkIpSyncError };
              const synced = structuredClone(siteConfig);
              synced.ipSync = { enabled: ipSyncEnabled, syncLanguage: ipSyncLanguage, intervalMinutes: ipSyncInterval };
              return {
                status: 'ok',
                outcome: exitIpSyncOutcome || { ok: true, changed: true, layers: ['timezone', 'profile'], ip: '203.0.113.9' },
                config: synced
              };
            }
            default:
              return { status: 'ok' };
          }
        })();
        if (typeof callback === 'function') {
          setTimeout(() => callback(response), responseDelay);
          responseDelay = 0;
          return undefined;
        }
        return Promise.resolve(response);
      }
    },
    storage: {
      local: storageArea,
      onChanged: { addListener: (fn: (changes: Record<string, any>, area: string) => void) => { storageListeners.push(fn); } }
    },
    setBakeResponse(value: any) { bakeResponse = value; },
    setIpSyncState(state: { enabled?: boolean; syncLanguage?: boolean; intervalMinutes?: number }) {
      if (typeof state.enabled === 'boolean') ipSyncEnabled = state.enabled;
      if (typeof state.syncLanguage === 'boolean') ipSyncLanguage = state.syncLanguage;
      if (typeof state.intervalMinutes === 'number') ipSyncInterval = state.intervalMinutes;
    },
    setSiteConfig(value: any) { siteConfig = structuredClone(value); },
    setExitIpSyncOutcome(value: any) { exitIpSyncOutcome = value; },
    setStoredExitIp(value: string | null) { storedIpOverride = value; },
    setIpSyncReadQueue(queue: Array<{ delay: number; storedIp: string }>) { ipSyncReadQueue = [...queue]; },
    setCheckIpSyncError(value: string | null) { checkIpSyncError = value; },
    setApplyOutcome(value: any) { applyOutcome = value; }
  };
}

let ui: ReturnType<typeof installUiDom>;
let calls: RuntimeCall[];
let chromeStub: ReturnType<typeof createChrome>;

before(async () => {
  ui = installUiDom('src/options/options.html', 'chrome-extension://test/options/options.html');
  calls = [];
  chromeStub = createChrome(calls);
  (globalThis as any).chrome = chromeStub;
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
  // 内置卡片由 DEFAULT_PROFILES 驱动，数量跟着预设走，不写死
  assert.equal(ui.document.querySelectorAll('.profile-card').length, DEFAULT_PROFILES.length);
  assert.ok(ui.document.querySelector('.profile-card[data-profile="us-west"]'));
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

test('options 跟随出口 IP：总开关关着时语言/周期/立即同步都禁用，打开才解锁', () => {
  const enabled = el<HTMLInputElement>('ipSyncEnabled');
  enabled.checked = false;
  enabled.dispatchEvent(new Event('change'));
  assert.equal(el<HTMLInputElement>('ipSyncLanguage').disabled, true);
  assert.equal(el<HTMLInputElement>('ipSyncInterval').disabled, true);
  assert.equal(el<HTMLButtonElement>('ipSyncNow').disabled, true);

  enabled.checked = true;
  enabled.dispatchEvent(new Event('change'));
  assert.equal(el<HTMLInputElement>('ipSyncLanguage').disabled, false);
  assert.equal(el<HTMLInputElement>('ipSyncInterval').disabled, false);
  assert.equal(el<HTMLButtonElement>('ipSyncNow').disabled, false);
});

test('options 开启跟随后保存：ipSync 落库，时区与坐标强制 auto 档', async () => {
  el<HTMLInputElement>('ipSyncEnabled').checked = true;
  el<HTMLInputElement>('ipSyncLanguage').checked = true;
  el<HTMLInputElement>('ipSyncInterval').value = '10';
  // 手填值：跟随开着时不该把 auto 改回 manual
  el<HTMLInputElement>('timezone').value = 'Asia/Tokyo';
  el<HTMLInputElement>('latitude').value = '35.6895';
  el<HTMLInputElement>('longitude').value = '139.6917';

  const before = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);

  const saved = calls.filter((call) => call.action === 'setSiteConfig').at(-1)!;
  assert.deepEqual(saved.config.ipSync, { enabled: true, syncLanguage: true, intervalMinutes: 10 });
  assert.equal(saved.config.globalProfile.timezone.mode, 'auto');
  assert.equal(saved.config.globalProfile.geolocation.mode, 'auto');
});

test('options 跟随出口 IP：周期越界被夹到 5–1440', async () => {
  el<HTMLInputElement>('ipSyncEnabled').checked = true;

  el<HTMLInputElement>('ipSyncInterval').value = '0';
  let before = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);
  assert.equal(calls.filter((call) => call.action === 'setSiteConfig').at(-1)!.config.ipSync.intervalMinutes, 5);

  el<HTMLInputElement>('ipSyncInterval').value = '9999';
  before = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);
  assert.equal(calls.filter((call) => call.action === 'setSiteConfig').at(-1)!.config.ipSync.intervalMinutes, 1440);
});

function enableIpSync(): void {
  chromeStub.setIpSyncState({ enabled: true });
  const enabled = el<HTMLInputElement>('ipSyncEnabled');
  enabled.checked = true;
  enabled.dispatchEvent(new Event('change'));
}

test('options 关掉跟随开关保存时，syncLanguage 一起落 false（勾选框 disabled，用户自己取消不了）', async () => {
  el<HTMLInputElement>('ipSyncLanguage').checked = true;
  el<HTMLInputElement>('ipSyncEnabled').checked = false;
  const before = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);
  const payload = calls.filter((call) => call.action === 'setSiteConfig').at(-1)!.config;
  assert.equal(payload.ipSync.enabled, false);
  assert.equal(payload.ipSync.syncLanguage, false);
});

test('options 立即同步：force 透传，alert 说明改了哪些层，按钮恢复可点', async () => {
  chromeStub.setExitIpSyncOutcome({ ok: true, changed: true, layers: ['timezone', 'geolocation', 'language'], ip: '198.51.100.7' });
  enableIpSync();

  const callsBefore = calls.length;
  const alertsBefore = ui.alerts.length;
  el<HTMLButtonElement>('ipSyncNow').click();
  await waitFor(() => ui.alerts.length > alertsBefore);

  const request = calls.slice(callsBefore).find((call) => call.action === 'checkExitIpSync');
  assert.equal(request?.force, true);
  assert.match(ui.alerts.at(-1)!, /198\.51\.100\.7/);
  assert.match(ui.alerts.at(-1)!, /时区、坐标、语言/);
  assert.equal(el<HTMLButtonElement>('ipSyncNow').disabled, false);
  assert.equal(el<HTMLButtonElement>('ipSyncNow').textContent, '立即同步一次');
});

test('options 立即同步：IP 没变和查不到出口都给清楚的跳过/失败文案', async () => {
  enableIpSync();
  chromeStub.setExitIpSyncOutcome({ ok: true, changed: false, skipped: 'same-ip', layers: [], ip: '198.51.100.7' });
  let alertsBefore = ui.alerts.length;
  el<HTMLButtonElement>('ipSyncNow').click();
  await waitFor(() => ui.alerts.length > alertsBefore);
  assert.match(ui.alerts.at(-1)!, /出口 IP 没变/);

  chromeStub.setExitIpSyncOutcome({ ok: false, error: '所有地理接口都失败' });
  alertsBefore = ui.alerts.length;
  el<HTMLButtonElement>('ipSyncNow').click();
  await waitFor(() => ui.alerts.length > alertsBefore);
  assert.match(ui.alerts.at(-1)!, /同步失败：所有地理接口都失败/);
});

test('options 立即同步：后台抛错时给出提示，不是静默恢复按钮', async () => {
  enableIpSync();
  chromeStub.setCheckIpSyncError('后台炸了');
  const alertsBefore = ui.alerts.length;
  el<HTMLButtonElement>('ipSyncNow').click();
  await waitFor(() => ui.alerts.length > alertsBefore);

  assert.match(ui.alerts.at(-1)!, /同步失败：后台炸了/);
  assert.match(el('ipSyncStatus').textContent || '', /同步失败：后台炸了/);
  assert.equal(el<HTMLButtonElement>('ipSyncNow').disabled, false);
  assert.equal(el<HTMLButtonElement>('ipSyncNow').textContent, '立即同步一次');
  chromeStub.setCheckIpSyncError(null);
});

test('options 跟随出口 IP：状态行显示上次出口 IP、定位与周期，关掉后说明仍按手填值', async () => {
  chromeStub.setIpSyncState({ enabled: true, intervalMinutes: 15 });
  let before = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLInputElement>('ipSyncEnabled').checked = true;
  el<HTMLInputElement>('ipSyncInterval').value = '15';
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);
  // 状态行是异步刷新的：等周期这一轮真的渲染出来，避免读到上一轮的旧文案
  await waitFor(() => (el('ipSyncStatus').textContent || '').includes('每 15 分钟检查一次'));
  assert.match(el('ipSyncStatus').textContent || '', /203\.0\.113\.9/);
  assert.match(el('ipSyncStatus').textContent || '', /America\/Los_Angeles/);
  assert.match(el('ipSyncStatus').textContent || '', /34\.052, -118\.244/);

  chromeStub.setIpSyncState({ enabled: false });
  before = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLInputElement>('ipSyncEnabled').checked = false;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);
  await waitFor(() => (el('ipSyncStatus').textContent || '').includes('未开启'));
});

test('options 刚打开开关时状态行会等后台落地，拿到出口 IP 后自己更新', async () => {
  chromeStub.setStoredExitIp('');
  enableIpSync();
  const before = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > before);
  await waitFor(() => (el('ipSyncStatus').textContent || '').includes('还没成功同步过'));

  // 后台同步跑完：状态行应该在下一次轮询里自己补上，不需要用户再点一次保存
  chromeStub.setStoredExitIp('198.51.100.7');
  await waitFor(() => (el('ipSyncStatus').textContent || '').includes('198.51.100.7'));
  chromeStub.setStoredExitIp(null);
});

test('开着跟随保存：用后台对齐的时区/坐标/国家，不把表单里的手填值顶回去', async () => {
  const aligned = structuredClone(DEFAULT_CONFIG);
  aligned.ipSync = { enabled: true, syncLanguage: false, intervalMinutes: 5 };
  aligned.globalProfile.timezone = { ...aligned.globalProfile.timezone, mode: 'auto', timezone: 'America/Los_Angeles' };
  aligned.globalProfile.geolocation = {
    ...aligned.globalProfile.geolocation,
    mode: 'auto',
    latitude: 34.0522,
    longitude: -118.2437,
    country: 'United States'
  };
  chromeStub.setSiteConfig(aligned);
  chromeStub.setIpSyncState({ enabled: true, syncLanguage: false, intervalMinutes: 5 });

  // 真实路径：点「立即同步一次」会带回新配置并 populateForm，currentConfig 随之更新
  const alertsBefore = ui.alerts.length;
  el<HTMLButtonElement>('ipSyncNow').click();
  // 等 alert：它出现在 populateForm 之后，此时 currentConfig 才是后台对齐的那份
  await waitFor(() => ui.alerts.length > alertsBefore);

  // 用户在表单里改成柏林：开着跟随时这个手填值不该被提交
  el<HTMLInputElement>('latitude').value = '52.52';
  el<HTMLInputElement>('longitude').value = '13.405';
  const savesBefore = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > savesBefore);

  const payload = calls.filter((call) => call.action === 'setSiteConfig').at(-1)!.config;
  assert.equal(payload.globalProfile.timezone.mode, 'auto');
  assert.equal(payload.globalProfile.timezone.timezone, 'America/Los_Angeles');
  assert.equal(payload.globalProfile.geolocation.mode, 'auto');
  assert.equal(payload.globalProfile.geolocation.latitude, 34.0522);
  assert.equal(payload.globalProfile.geolocation.longitude, -118.2437);
  assert.equal(payload.globalProfile.geolocation.country, 'United States', '保存不该把 country 丢掉');
});

test('状态行：先发的慢读回来时，不许盖掉后发的新文案', async () => {
  chromeStub.setIpSyncState({ enabled: true, syncLanguage: false, intervalMinutes: 5 });
  chromeStub.setStoredExitIp('');
  // 第一轮读到空（200ms 才回），第二轮读到 203.0.113.9（立刻回）：
  // 没有轮次守卫时，慢读会在第二轮写完之后把"还没成功同步过"盖上去
  chromeStub.setIpSyncReadQueue([{ delay: 200, storedIp: '' }]);
  el<HTMLInputElement>('ipSyncEnabled').checked = true;
  el<HTMLButtonElement>('save').click();
  await new Promise((resolve) => { setTimeout(resolve, 50); });

  chromeStub.setStoredExitIp('198.51.100.7');
  el<HTMLButtonElement>('save').click();
  await waitFor(() => el<HTMLElement>('ipSyncStatus').textContent!.includes('198.51.100.7'));

  // 慢读在 ~250ms 落地：让位的话界面保持新文案
  await new Promise((resolve) => { setTimeout(resolve, 400); });
  const text = el<HTMLElement>('ipSyncStatus').textContent!;
  assert.match(text, /198\.51\.100\.7/);
  assert.doesNotMatch(text, /还没成功同步过/);
});

test('周期输入框被清空时保持原值，不被悄悄夹成 5', async () => {
  chromeStub.setIpSyncState({ enabled: true, syncLanguage: false, intervalMinutes: 5 });
  el<HTMLInputElement>('ipSyncEnabled').checked = true;
  // 先正常存成 17（这一步也让页面里的 currentConfig 跟上）
  el<HTMLInputElement>('ipSyncInterval').value = '17';
  let savesBefore = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > savesBefore);

  // 再把输入框清空：空串不等于 0，更不该被下限夹成 5
  el<HTMLInputElement>('ipSyncInterval').value = '';
  savesBefore = calls.filter((call) => call.action === 'setSiteConfig').length;
  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.filter((call) => call.action === 'setSiteConfig').length > savesBefore);

  const payload = calls.filter((call) => call.action === 'setSiteConfig').at(-1)!.config;
  assert.equal(payload.ipSync.intervalMinutes, 17, '清空保持原值，不是改成 5');
});

test('「从 IP 自动配置」走 applyFromExitIp：新坐标/时区写进表单，失败必须弹出来', async () => {
  chromeStub.setIpSyncState({ enabled: false });
  chromeStub.setApplyOutcome({
    ok: true,
    changed: true,
    layers: ['timezone', 'geolocation', 'language', 'profile'],
    ip: '203.0.113.9',
    country: 'United States',
    timezone: 'America/Los_Angeles',
    latitude: 34.0522,
    longitude: -118.2437,
    language: 'en-US'
  });
  ui.alerts.length = 0;

  el<HTMLButtonElement>('getFromIP').click();
  await waitFor(() => ui.alerts.some((message) => /已按出口 IP 203\.0\.113\.9/.test(message)));

  assert.equal(el<HTMLInputElement>('latitude').value, '34.0522');
  assert.equal(el<HTMLInputElement>('longitude').value, '-118.2437');
  assert.equal(el<HTMLInputElement>('timezone').value, 'America/Los_Angeles');
  assert.match(ui.alerts.at(-1)!, /America\/Los_Angeles/);
  assert.equal(calls.some((call) => call.action === 'applyFromExitIp'), true);

  // 失败不是"按钮转一圈就恢复"：错误必须说出来
  chromeStub.setApplyOutcome({ ok: false, error: 'network down' });
  ui.alerts.length = 0;
  await waitFor(() => el<HTMLButtonElement>('getFromIP').disabled === false);
  el<HTMLButtonElement>('getFromIP').click();
  await waitFor(() => ui.alerts.some((message) => /自动配置失败/.test(message)));
  assert.match(ui.alerts.at(-1)!, /network down/);
});

test('「完全不调用系统定位」联动「伪装位置权限」，保存后写进配置', async () => {
  const noNative = el<HTMLInputElement>('noNativeCall');
  assert.match(el('noNativeCallHint').textContent || '', /站点永远不会弹授权框/);
  const spoof = el<HTMLInputElement>('spoofPermission');

  spoof.checked = false;
  spoof.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(noNative.checked, false, '关掉伪装权限要顺手放开这道刹车');

  noNative.checked = true;
  noNative.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(spoof.checked, true, '不碰原生必须同时伪装权限');

  el<HTMLButtonElement>('save').click();
  await waitFor(() => calls.some((call) => call.action === 'setSiteConfig'
    && call.config?.globalProfile?.geolocation?.noNativeCall === true
    && call.config?.globalProfile?.geolocation?.spoofPermission === true));
});

test('上次定位失败：storage 里有记录才出现，写进去立刻反映（不用刷新页面）', async () => {
  const box = el<HTMLElement>('geoError');
  // 起步时干净：卡片必须是 hidden，不能让正常用户看到一张空卡
  assert.equal(box.hidden, true, '没有失败记录时卡片不出现');

  await (globalThis as any).chrome.storage.local.set({
    lastGeoError: 'IP geolocation APIs returned no valid coordinates: https://a no valid location | https://b no valid location',
    lastGeoErrorAt: new Date().toISOString()
  });
  await waitFor(() => box.hidden === false);

  const hint = el('geoErrorHint').textContent || '';
  assert.match(hint, /可用坐标/, '人话解释在卡片外层');
  assert.doesNotMatch(hint, /https:\/\//, '拼接的接口原文不该糊在人话里');
  assert.match(el('geoErrorReason').textContent || '', /https:\/\/a/, '原文折在「技术原因」里，排障要看得到');
  assert.equal(el('geoErrorAge').textContent, '刚刚');

  // 老版本写过的记录没有 lastGeoErrorAt：卡片照样出现，只是不显示"多久之前"
  await (globalThis as any).chrome.storage.local.set({ lastGeoErrorAt: '' });
  await waitFor(() => (el('geoErrorAge').textContent || '') === '');
  assert.equal(box.hidden, false, '缺时间戳不影响卡片本身');

  // 「清除提示」只清提示，不动配置
  el<HTMLButtonElement>('geoErrorDismiss').click();
  await waitFor(() => box.hidden === true);
  const stored = await (globalThis as any).chrome.storage.local.get({ lastGeoError: 'x', lastGeoErrorAt: 'x' });
  assert.equal(stored.lastGeoError, '');
  assert.equal(stored.lastGeoErrorAt, '');
});
