// 执行真实管理页维护源，观察保存/加载/重试的可见文本；这是 VM 证据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as configModel from '../src/shared/config-model';
import * as configResolver from '../src/shared/config-resolver';
import * as runtimeSync from '../src/shared/runtime-sync';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';
import * as uiState from '../src/shared/ui-state';
import type { RuntimeSyncComponent, RuntimeSyncReport } from '../src/shared/types';

function report(failed?: RuntimeSyncComponent): RuntimeSyncReport {
  const ok = () => ({ status: 'ok' as const, errors: [] });
  const result: RuntimeSyncReport = { configSignature: 'synthetic-signature', status: 'ok', metadataError: null,
    pageRuntime: { state: 'ready', registeredRuleCount: 1, reloadRequired: false },
    components: { contentScripts: ok(), webrtc: ok(), tabReload: ok() } };
  if (failed) {
    result.status = 'partial';
    result.components[failed] = { status: 'failed', errors: [{ code: 'synthetic-failure', message: '合成失败，请重试。' }] };
    if (failed === 'contentScripts') result.pageRuntime!.state = 'sync-failed';
  }
  return result;
}

for (const page of ['popup', 'options'] as const) {
  test(`${page} 独立同步状态、userScripts 阻断和新旧文档快照提示贯通保存、加载与重试`, async () => {
    class Element {
      textContent = ''; innerHTML = ''; className = ''; value = ''; checked = false; disabled = false; placeholder = '';
      dataset: Record<string, string> = {};
      children: Element[] = [];
      classList = { add() {}, remove() {} };
      addEventListener() {}
      setAttribute() {}
      append(...children: Element[]) { this.children.push(...children); }
      appendChild(child: Element) { this.children.push(child); }
    }
    class Option extends Element { constructor(text: string, value: string) { super(); this.textContent = text; this.value = value; } }
    const elements = new Map<string, Element>();
    const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
    const config = configModel.normalizeConfig({ masterEnabled: true, rules: [{ domain: 'example.com' }] as any, globalProfile: {
      geolocation: configModel.normalizeGeolocation({ enabled: true, mode: 'auto' }),
      timezone: configModel.normalizeTimezone({ enabled: true, mode: 'manual', timezone: 'UTC' }),
      language: configModel.normalizeLanguage({ enabled: true })
    } });
    let currentReport = report();
    let nextReport = report();
    let failure = false;
    const alerts: string[] = [];
    const actions: string[] = [];
    const context = vm.createContext({
      ...configModel, ...configResolver, ...runtimeSync, ...uiState, ruleListToText, rulesFromText,
      formatCoordinate: String, validateProfile: () => true, Option,
      document: { getElementById: element, createElement: () => new Element(), querySelectorAll: () => [] },
      window: { setTimeout: () => 1, clearTimeout() {} },
      alert: (value: string) => alerts.push(value),
      chrome: { runtime: { sendMessage: (request: any, callback: (response: any) => void) => {
        actions.push(request.action);
        if (request.action === 'getWebRtcConfig') return callback({ status: 'ok', state: { config: config.webRtc, effectivePolicy: null, policyState: {} } });
        if (request.action === 'getCurrentTabState') return callback({ status: 'ok', state: { config, syncReport: currentReport, scriptable: true, domain: 'example.com' } });
        if (request.action === 'getSiteConfig') return callback({ status: 'ok', config, syncReport: currentReport });
        if (failure) return callback({ status: 'error', message: '合成存储失败' });
        currentReport = nextReport;
        callback({ status: currentReport.status === 'ok' ? 'ok' : 'partial', config: request.config || config, syncReport: currentReport, saved: true });
      } } }
    });
    const source = readFileSync(new URL(`../src/${page}/${page}.ts`, import.meta.url), 'utf8');
    const parsed = ts.createSourceFile('ui.ts', source, ts.ScriptTarget.Latest, true);
    const body = parsed.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(parsed)).join('\n');
    vm.runInContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText, context);
    await vm.runInContext('loadConfig()', context);
    assert.equal(element('runtimeSyncStatus').dataset.status, 'ok');
    assert.match(element('runtimeSyncStatus').textContent, /WebRTC 策略：已同步/);
    assert.doesNotMatch(element('setupStatus').textContent, /页面伪装已暂停/);
    if (page === 'popup') assert.equal(element('siteStatusBadge').textContent, '新文档语言/时区可用');
    for (const component of ['contentScripts', 'webrtc', 'tabReload'] as const) {
      nextReport = report(component);
      await vm.runInContext(page === 'popup' ? 'saveChanges()' : 'saveSettings()', context);
      assert.match(element('runtimeSyncStatus').textContent, /已保存但未完全生效/);
      assert.match(element('runtimeSyncStatus').textContent, new RegExp(runtimeSync.RUNTIME_SYNC_COMPONENT_LABELS[component]));
      assert.equal(element('runtimeSyncStatus').dataset.status, 'partial');
      if (page === 'options') assert.match(alerts.at(-1)!, /已保存但未完全生效/);
      else assert.doesNotMatch(element('autoSaveToast').textContent, /已自动保存并同步/);
      await vm.runInContext('loadConfig()', context);
      assert.equal(element('runtimeSyncStatus').dataset.status, 'partial');
      nextReport = report();
      await vm.runInContext('retryRuntimeSync()', context);
      assert.equal(element('runtimeSyncStatus').dataset.status, 'ok');
      assert.equal(element('retryRuntimeSync').disabled, false);
    }
    const unavailable = {
      'api-unsupported': /不支持所需 userScripts API.*Chrome 138\+/,
      'permission-required': /缺少 userScripts 权限/,
      'switch-required': /chrome:\/\/extensions.*详情页.*Allow User Scripts.*重试同步/,
      'sync-failed': /页面语言\/时区注册同步失败/
    } as const;
    for (const [state, expected] of Object.entries(unavailable)) {
      nextReport = report('contentScripts');
      nextReport.pageRuntime!.state = state as NonNullable<RuntimeSyncReport['pageRuntime']>['state'];
      for (const operation of [page === 'popup' ? 'saveChanges()' : 'saveSettings()', 'loadConfig()', 'retryRuntimeSync()']) {
        await vm.runInContext(operation, context);
        assert.match(element('runtimeSyncStatus').textContent, expected);
        assert.equal(element('runtimeSyncStatus').dataset.pageRuntime, state);
        assert.match(element('runtimeSyncStatus').textContent, /当前页面实际值为 UNKNOWN/);
        assert.doesNotMatch(element('runtimeSyncStatus').textContent, /已有受影响页面需完整重载/);
        if (page === 'popup') assert.doesNotMatch(element('siteStatusBadge').textContent, /新文档语言\/时区可用/);
      }
    }
    nextReport = report();
    nextReport.pageRuntime!.reloadRequired = true;
    const savesBeforeRetry = actions.filter((action) => action === 'setSiteConfig').length;
    element('language').value = 'de-DE';
    await vm.runInContext('retryRuntimeSync()', context);
    assert.equal(actions.filter((action) => action === 'setSiteConfig').length, savesBeforeRetry);
    assert.equal(element('language').value, 'de-DE');
    for (const text of [element('runtimeSyncStatus').textContent, ...(page === 'popup' ? [element('siteStatusDetail').textContent] : [])]) {
      assert.match(text, /新建且匹配规则的 HTTP\(S\) 顶层文档和普通 iframe/);
      assert.match(text, /已有受影响页面需完整重载（reload）或关闭后重新打开/);
      assert.match(text, /BFCache 恢复文档保留原快照，不会热更新或自动刷新/);
      assert.match(text, /当前页面实际值尚未验证/);
      assert.match(text, /Geolocation \/ Permissions geolocation、Worker \/ SharedWorker 仍暂停/);
      assert.match(text, /about:blank、srcdoc、data:、blob:.*sandbox.*unsupported \/ UNKNOWN/);
      assert.doesNotMatch(text, /全部保护.*生效|当前页面已.*生效/);
    }
    if (page === 'popup') assert.equal(element('siteStatusBadge').textContent, '语言/时区待完整重载');
    nextReport = report();
    nextReport.pageRuntime = { state: 'disabled', registeredRuleCount: 0, reloadRequired: true };
    await vm.runInContext(page === 'popup' ? 'saveChanges()' : 'saveSettings()', context);
    assert.match(element('runtimeSyncStatus').textContent, /当前未注册启用规则.*使用当前关闭配置/);
    if (page === 'popup') assert.equal(element('siteStatusBadge').textContent, '页面语言/时区未注册');
    const fontStates = {
      ready: /固定内置名单字体过滤已注册 1 条规则.*仅覆盖 measureText\(\) 和 FontFaceSet.check\(\).*不隐藏 DOM 尺寸/,
      disabled: /字体过滤当前未注册启用规则/,
      paused: /已配置但当前未应用.*人工恢复门禁/,
      'custom-paused': /自定义名单仅保存，当前不生产派发/,
      'sync-failed': /字体注册撤销或同步失败，残留注册数量尚未确认/
    } as const;
    for (const [state, expected] of Object.entries(fontStates)) {
      nextReport = report();
      nextReport.fontRuntime = { state: state as keyof typeof fontStates,
        registeredRuleCount: state === 'sync-failed' ? null : state === 'ready' ? 1 : 0,
        reloadRequired: state === 'ready' || state === 'disabled' || state === 'custom-paused' };
      if (state === 'sync-failed') {
        nextReport.status = 'partial';
        nextReport.components.contentScripts = { status: 'failed', errors: [{ code: 'font-scripts-sync-failed', message: '合成字体故障' }] };
      }
      for (const operation of [page === 'popup' ? 'saveChanges()' : 'saveSettings()', 'loadConfig()', 'retryRuntimeSync()']) {
        await vm.runInContext(operation, context);
        assert.match(element('fontExposureStatus').textContent, expected);
        assert.equal(element('fontExposureStatus').dataset.fontRuntime, state);
        assert.equal(element('runtimeSyncStatus').dataset.pageRuntime, 'ready');
        assert.match(element('runtimeSyncStatus').textContent, /页面语言\/时区已注册 1 条规则/);
        if (nextReport.fontRuntime.reloadRequired) assert.match(element('fontExposureStatus').textContent, /已有受影响页面需完整重载/);
      }
    }
    nextReport = report('contentScripts');
    delete nextReport.pageRuntime;
    nextReport.components.contentScripts = { status: 'partial', errors: [runtimeSync.RUNTIME_INJECTION_PAUSED] };
    for (const operation of [page === 'popup' ? 'saveChanges()' : 'saveSettings()', 'loadConfig()', 'retryRuntimeSync()']) {
      await vm.runInContext(operation, context);
      const text = element('runtimeSyncStatus').textContent;
      assert.match(text, /页面伪装已暂停/);
      assert.match(text, /语言、时区、位置、字体暴露过滤和 worker/);
      assert.match(text, /当前语言\/时区注册与 WebRTC 按各自状态报告；请求头保持原生/);
      assert.match(text, /已有 hook 与旧 BFCache 文档需关闭并重建/);
      assert.match(text, /重试同步不会恢复/);
      assert.match(element('setupStatus').textContent, /历史报告：页面伪装已暂停／部分生效/);
      assert.doesNotMatch(element('setupStatus').textContent, /所选站点按已保存配置运行/);
    }
    if (page === 'popup') assert.match(element('autoSaveToast').textContent, /页面伪装已暂停/);
    failure = true;
    await vm.runInContext(`runUiTask(${page === 'popup' ? 'saveChanges()' : 'saveSettings()'})`, context);
    await new Promise<void>((done) => setImmediate(done));
    assert.match(element('runtimeSyncStatus').textContent, /操作结果未确认.*合成存储失败/);
    assert.equal(element('runtimeSyncStatus').dataset.status, 'failed');
  });
}

test('Popup 与 Options 静态说明区分已授权固定字体与暂停表面', () => {
  for (const page of ['popup', 'options']) {
    const html = readFileSync(new URL(`../src/${page}/${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /Chrome 138\+、userScripts 权限及 Allow User Scripts 开关/);
    assert.match(html, /Geolocation \/ Permissions geolocation、Worker \/ SharedWorker 仍暂停/);
    assert.match(html, /固定内置名单字体过滤已获恢复授权，仅在总开关、字体开关及HTTP\(S\)站点规则均启用时独立注册，自定义名单仅保存/);
    assert.match(html, /about:blank、srcdoc、data:、blob:.*unsupported \/ UNKNOWN/);
    assert.match(html, /BFCache 恢复文档保留原快照/);
    assert.doesNotMatch(html, /时区（页面伪装已暂停）|语言（DNR 可用，页面伪装暂停）|当前不在页面执行|保存配置不会恢复页面注入/);
  }
});
