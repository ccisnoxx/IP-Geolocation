// 执行真实管理页维护源，观察保存/加载/重试的可见文本；这是 VM 证据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as configModel from '../src/shared/config-model';
import * as runtimeSync from '../src/shared/runtime-sync';
import { ruleListToText, rulesFromText } from '../src/shared/rule-list';
import * as uiState from '../src/shared/ui-state';
import type { RuntimeSyncComponent, RuntimeSyncReport } from '../src/shared/types';

function report(failed?: RuntimeSyncComponent): RuntimeSyncReport {
  const ok = () => ({ status: 'ok' as const, errors: [] });
  const result: RuntimeSyncReport = { configSignature: 'synthetic-signature', status: 'ok', metadataError: null,
    components: { contentScripts: ok(), dnr: ok(), webrtc: ok(), tabReload: ok() } };
  if (failed) {
    result.status = 'partial';
    result.components[failed] = { status: 'failed', errors: [{ code: 'synthetic-failure', message: '合成失败，请重试。' }] };
  }
  return result;
}

for (const page of ['popup', 'options'] as const) {
  test(`${page} 四组件失败可见，保存不显示纯成功，加载和重试状态可恢复`, async () => {
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
    const config = configModel.normalizeConfig({ rules: [], globalProfile: {
      geolocation: configModel.normalizeGeolocation({ enabled: false }),
      timezone: configModel.normalizeTimezone({ enabled: false }),
      language: configModel.normalizeLanguage({ enabled: true })
    } });
    let currentReport = report();
    let nextReport = report();
    let failure = false;
    const alerts: string[] = [];
    const actions: string[] = [];
    const context = vm.createContext({
      ...configModel, ...runtimeSync, ...uiState, ruleListToText, rulesFromText,
      formatCoordinate: String, validateProfile: () => true, Option,
      document: { getElementById: element, createElement: () => new Element(), querySelectorAll: () => [] },
      window: { setTimeout: () => 1, clearTimeout() {} },
      alert: (value: string) => alerts.push(value),
      chrome: { runtime: { sendMessage: (request: any, callback: (response: any) => void) => {
        actions.push(request.action);
        if (request.action === 'getWebRtcConfig') return callback({ status: 'ok', state: { config: config.webRtc, effectivePolicy: null, policyState: {} } });
        if (request.action === 'getCurrentTabState') return callback({ status: 'ok', state: { config, syncReport: currentReport, scriptable: false } });
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
    for (const component of ['contentScripts', 'dnr', 'webrtc', 'tabReload'] as const) {
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
    nextReport = report('contentScripts');
    nextReport.components.contentScripts = { status: 'partial', errors: [runtimeSync.RUNTIME_INJECTION_PAUSED] };
    for (const operation of [page === 'popup' ? 'saveChanges()' : 'saveSettings()', 'loadConfig()', 'retryRuntimeSync()']) {
      await vm.runInContext(operation, context);
      const text = element('runtimeSyncStatus').textContent;
      assert.match(text, /页面伪装已暂停/);
      assert.match(text, /语言、时区、位置、Canvas 和 worker/);
      assert.match(text, /请求头规则与 WebRTC 按各自状态/);
      assert.match(text, /已有 hook 与旧 BFCache 文档需关闭并重建/);
      assert.match(text, /重试同步不会恢复/);
      assert.match(element('setupStatus').textContent, /页面伪装已暂停／部分生效/);
      assert.doesNotMatch(element('setupStatus').textContent, /所选站点按已保存配置运行/);
    }
    if (page === 'popup') assert.match(element('autoSaveToast').textContent, /页面伪装已暂停/);
    failure = true;
    await vm.runInContext(`runUiTask(${page === 'popup' ? 'saveChanges()' : 'saveSettings()'})`, context);
    await new Promise<void>((done) => setImmediate(done));
    assert.match(element('runtimeSyncStatus').textContent, /操作结果未确认.*合成存储失败/);
    assert.equal(element('runtimeSyncStatus').dataset.status, 'failed');
    assert.equal(actions.filter((action) => action === 'reconcileRuntime').length, 5);
  });
}
