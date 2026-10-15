import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { compareDiagnosticEvidence } from '../src/shared/diagnostic-report';

test('后台已消费或重启后，完成报告的 TTL 仍清除并显示本地过期状态', async () => {
  class Element {
    textContent = '';
    className = '';
    disabled = false;
    value = '';
    children: Element[] = [];
    constructor(readonly id = '') {}
    get options() { return this.children; }
    addEventListener() {}
    replaceChildren(...children: Element[]) {
      this.children = children;
      if (this.id === 'target') this.value = children[0]?.value || '';
    }
    append(...children: Element[]) { this.children.push(...children); }
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id)!;
  };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let restarted = false;
  let executions = 0;
  const run = { runId: 'synthetic-run', expiresAt: Date.now() + 120000, targetOrigin: 'https://example.test', state: 'ready' };
  const unavailable = { value: null, error: 'not_observable' };
  const evidence = { ...run, expectation: { language: null, timezone: null, geolocation: null }, requestedPolicy: null, policy: unavailable, actual: { realm: unavailable, header: unavailable, position: unavailable, watch: unavailable, permission: unavailable, ice: unavailable, workers: {} }, frames: [], passThrough: { value: { hardwareConcurrency: 4 }, error: null }, reference: { value: { hardwareConcurrency: 4 }, error: null } };
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => new Element() },
    window: { addEventListener() {} },
    chrome: { runtime: { sendMessage: async (request: any) => {
      if (request.action === 'getDiagnosticTargets') return { status: 'ok', targets: [{ tabId: 1, origin: run.targetOrigin }] };
      if (request.action === 'prepareDiagnosticRun') return { status: 'ok', run };
      if (request.action === 'executeDiagnosticRun') { executions++; return { status: 'ok', evidence }; }
      if (request.action === 'cancelDiagnosticRun') return restarted ? { status: 'error', message: '诊断 run 不存在或后台已重启，请重新运行' } : { status: 'ok' };
      throw new Error('未知测试动作');
    } } },
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id), compareDiagnosticEvidence
  });
  const source = fs.readFileSync(new URL('../src/diagnostic/report.ts', import.meta.url), 'utf8');
  vm.runInContext(ts.transpileModule(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  await vm.runInContext('refreshTargets()', context);
  const result = await vm.runInContext('run()', context);
  assert.equal(executions, 1);
  assert.equal(result.evidence, evidence);
  assert.deepEqual(result.rows, compareDiagnosticEvidence(evidence));
  assert.ok(element('results').children.length > 0);
  assert.match(element('status').textContent, /诊断完成/);
  restarted = true;
  for (const timer of [...timers.values()]) timer();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(element('results').children.length, 0);
  assert.match(element('status').textContent, /诊断已过期/);
});
