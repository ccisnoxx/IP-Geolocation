import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDomModule, waitFor } from './helpers/dom-module';
import { createRule, normalizeConfig, normalizeLanguage, normalizeTimezone, normalizeGeolocation } from '../src/shared/config-model';
import { validateConfig } from '../src/shared/config-resolver';
import { applyConfigAuditFix } from '../src/shared/config-audit';
import { ENVIRONMENT_PRESETS } from '../src/shared/environment-presets';
import type { SiteSpoofConfig } from '../src/shared/types';

function backend() {
  let config = normalizeConfig({ masterEnabled: true, debugMode: true, rules: [createRule('example.test')],
    globalProfile: { language: normalizeLanguage({ enabled: true, language: 'en-US', languages: ['en-US'] }),
      timezone: normalizeTimezone({ enabled: false, mode: 'manual', timezone: 'UTC' }),
      geolocation: normalizeGeolocation({ enabled: false, mode: 'manual', latitude: 0, longitude: 0, accuracy: 50, country: 'Synthetic' }) } });
  const writes: SiteSpoofConfig[] = [];
  const syncReport = { status: 'ok', metadataError: null, configSignature: 'synthetic',
    components: { contentScripts: { status: 'ok', errors: [] }, webrtc: { status: 'ok', errors: [] },
      tabReload: { status: 'ok', errors: [] }, headers: { status: 'ok', errors: [] } },
    pageRuntime: { state: 'ready', registeredRuleCount: 1, reloadRequired: false },
    fontRuntime: { state: 'disabled', registeredRuleCount: 0, reloadRequired: false },
    geolocationRuntime: { state: 'disabled', registeredRuleCount: 0, reloadRequired: false } };
  let rejectSave = false;
  const respond = (request: { action: string; config?: SiteSpoofConfig; findingId?: string }) => {
    if (request.action === 'getWebRtcConfig') return { status: 'ok', state: { effectivePolicy: 'disable_non_proxied_udp', policyState: {} } };
    if (request.action === 'getCurrentTabState') return { status: 'ok', state: { config, syncReport, domain: 'example.test', url: 'https://example.test/', scriptable: true } };
    if (request.action === 'setSiteConfig' || request.action === 'applyConfigAuditFix') {
      if (rejectSave) return { status: 'error', message: 'Synthetic save rejection' };
      const result = validateConfig(request.action === 'applyConfigAuditFix' ? applyConfigAuditFix(config, request.findingId!) : request.config);
      assert.equal(result.ok, true, result.errors.join('；'));
      config = result.config;
      writes.push(structuredClone(config));
      return { status: 'ok', saved: true, config, syncReport };
    }
    if (request.action === 'getSiteConfig') return { status: 'ok', config, syncReport };
    throw new Error(`未实现的测试消息：${request.action}`);
  };
  return { writes, current: () => config, rejectSave() { rejectSave = true; },
    chrome: { runtime: { sendMessage(request: Parameters<typeof respond>[0], callback?: (response: unknown) => void) {
      const response = respond(request);
      if (callback) { queueMicrotask(() => callback(response)); return; }
      return Promise.resolve(response);
    } } } };
}

for (const page of ['popup', 'options'] as const) {
  test(`${page} 三层字体的none/false及追加名单在其他设置保存后保留`, async () => {
    const server = backend();
    server.current().fontExposure = { enabled: true, mode: 'layered', layers: { platform: 'none', hideCjkFonts: false },
      blockedFamilies: ['Synthetic Font'], canvasSpoof: { enabled: false, platform: 'windows' } };
    const expected = structuredClone(server.current().fontExposure);
    const ui = await loadDomModule(new URL(`../src/${page}/${page}.ts`, import.meta.url), new URL(`../src/${page}/${page}.html`, import.meta.url), server.chrome);
    try {
      await waitFor(() => (ui.document.getElementById('fontExposureMode') as HTMLSelectElement).value === 'layered');
      if (page === 'options') (ui.document.getElementById('save') as HTMLButtonElement).click();
      else {
        const input = ui.document.getElementById('debugMode') as HTMLInputElement;
        input.checked = false;
        input.dispatchEvent(new ui.window.Event('change', { bubbles: true }));
      }
      await waitFor(() => server.writes.length === 1);
      assert.deepEqual(server.writes[0].fontExposure, expected);
    } finally { ui.close(); }
  });
  test(`${page} 整份维护源和真实DOM：六个预设点击后沿原保存链路写入三信号`, async () => {
    const server = backend();
    const ui = await loadDomModule(new URL(`../src/${page}/${page}.ts`, import.meta.url), new URL(`../src/${page}/${page}.html`, import.meta.url), server.chrome);
    try {
      await waitFor(() => (ui.document.getElementById('language') as HTMLInputElement).value === 'en-US');
      const cards = ui.document.querySelectorAll<HTMLButtonElement>('[data-preset]');
      assert.equal(cards.length, 6);
      for (const preset of ENVIRONMENT_PRESETS) {
        const count = server.writes.length;
        ui.document.querySelector<HTMLButtonElement>(`[data-preset="${preset.id}"]`)!.click();
        await waitFor(() => server.writes.length === count + 1);
        const saved = server.writes.at(-1)!;
        assert.equal(saved.globalProfile.timezone.timezone, preset.timezone);
        assert.equal(saved.globalProfile.language.language, preset.language);
        assert.equal(saved.globalProfile.geolocation.country, preset.country);
        assert.equal(saved.globalProfile.geolocation.latitude, preset.latitude);
        assert.equal(saved.rules[0].id, server.current().rules[0].id);
      }
      server.rejectSave();
      cards[0].click();
      await waitFor(() => ui.document.getElementById('runtimeSyncStatus')!.dataset.status === 'failed');
      assert.match(ui.document.getElementById('runtimeSyncStatus')!.textContent!, /Synthetic save rejection/);
    } finally { ui.close(); }
  });
}

test('配置体检真实DOM：显式修复由后台保存，保留其他选项并刷新提示', async () => {
  const server = backend();
  const ui = await loadDomModule(new URL('../src/diagnostic/config-audit.ts', import.meta.url), new URL('../src/diagnostic/report.html', import.meta.url), server.chrome);
  try {
    await waitFor(() => Boolean(ui.document.querySelector('[data-finding="debug-mode"]')));
    ui.document.querySelector<HTMLButtonElement>('[data-finding="debug-mode"] button')!.click();
    await waitFor(() => !ui.document.querySelector('[data-finding="debug-mode"]'));
    assert.equal(server.current().debugMode, false);
    assert.equal(server.current().globalProfile.timezone.enabled, false);
    assert.equal(server.writes.length, 1);
    assert.match(ui.document.getElementById('auditStatus')!.textContent!, /不代表网页实际生效/);
  } finally { ui.close(); }
});
