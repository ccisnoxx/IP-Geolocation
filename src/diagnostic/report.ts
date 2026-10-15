import './report.css';
import { compareDiagnosticEvidence } from '../shared/diagnostic-report';
import type { DiagnosticRow, DiagnosticRunInfo } from '../shared/diagnostic-report';

const element = (id: string) => document.getElementById(id)!;
const target = element('target') as HTMLSelectElement;
const status = element('status');
const summary = element('summary');
const results = element('results');
const cancel = element('cancel') as HTMLButtonElement;
const start = element('run') as HTMLButtonElement;
const timingStart = element('runTiming') as HTMLButtonElement;
let active: DiagnosticRunInfo | null = null;
let generation = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

async function message(request: Record<string, unknown>) {
  const response = await chrome.runtime.sendMessage(request);
  if (response?.status !== 'ok') throw new Error(response?.message || '后台不可用，请重新加载报告页');
  return response;
}
function clearDisplay(text: string) {
  results.replaceChildren();
  summary.textContent = 'UNKNOWN · 无有效报告';
  status.textContent = text;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = undefined;
}
function setBusy(busy: boolean) {
  start.disabled = busy;
  timingStart.disabled = busy;
  for (const id of ['refresh', 'openHosted', 'openLocal']) (element(id) as HTMLButtonElement).disabled = busy;
  target.disabled = busy;
}
async function clearRun(text: string) {
  generation++;
  const previous = active;
  active = null;
  clearDisplay(text);
  cancel.disabled = true;
  // 执行中取消后，允许重新开始；旧响应由 generation 隔离。
  setBusy(false);
  if (previous) await message({ action: 'cancelDiagnosticRun', runId: previous.runId });
}
async function refreshTargets(selected = Number(target.value)) {
  const response = await message({ action: 'getDiagnosticTargets' });
  target.replaceChildren(...response.targets.map((tab: { tabId: number; origin: string }) => {
    const option = document.createElement('option');
    option.value = String(tab.tabId);
    option.textContent = `#${tab.tabId} · ${tab.origin}`;
    return option;
  }));
  if (Array.from(target.options).some((option) => Number(option.value) === selected)) target.value = String(selected);
  if (!target.options.length) status.textContent = '暂无普通 HTTP(S) 目标；请打开 hosted 或 localhost 页面。';
}
function render(rows: DiagnosticRow[]) {
  const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
  const nodes = rows.map((row) => {
    counts[row.verdict]++;
    const container = document.createElement('div');
    container.className = 'row';
    const label = document.createElement('strong');
    label.textContent = row.label;
    const badge = document.createElement('span');
    badge.className = `badge ${row.verdict}`;
    badge.textContent = row.verdict;
    const detail = document.createElement('p');
    detail.textContent = row.detail;
    const values = document.createElement('pre');
    values.textContent = `实际：${JSON.stringify(row.actual ?? null)}\n预期：${JSON.stringify(row.expected ?? null)}`;
    container.append(label, badge, detail, values);
    return container;
  });
  results.replaceChildren(...nodes);
  summary.textContent = `${counts.FAIL ? 'FAIL' : counts.UNKNOWN ? 'UNKNOWN' : 'PASS'} · PASS ${counts.PASS} / FAIL ${counts.FAIL} / UNKNOWN ${counts.UNKNOWN}`;
}
export async function run(timingOnly = false) {
  await clearRun('正在绑定目标文档…');
  if (!target.value) throw new Error('请先选择目标标签页');
  const currentGeneration = generation;
  setBusy(true);
  try {
    const response = await message({ action: 'prepareDiagnosticRun', tabId: Number(target.value) });
    if (currentGeneration !== generation) {
      await message({ action: 'cancelDiagnosticRun', runId: response.run.runId });
      return;
    }
    active = response.run;
    const info = active!;
    cancel.disabled = false;
    expiryTimer = setTimeout(() => { void clearRun('诊断已过期，预期与实际报告已清除。').catch(showError); }, Math.max(0, info.expiresAt - Date.now()));
    status.textContent = `正在采集 ${info.targetOrigin}；导航、重新加载或关闭目标将使本次 run 失效。`;
    const result = await message({ action: timingOnly ? 'executeInjectionTimingRun' : 'executeDiagnosticRun', runId: info.runId });
    if (currentGeneration !== generation) return;
    if (Date.now() >= info.expiresAt) { await clearRun('诊断已过期，报告已清除。'); return; }
    const rows = compareDiagnosticEvidence(result.evidence);
    render(rows);
    active = null; // 后台已消费 run；后续清除仅处理本地报告，无需再次取消。
    status.textContent = `诊断完成 · ${info.targetOrigin} · 报告将在 ${new Date(info.expiresAt).toLocaleTimeString()} 清除。后台 run 已释放。`;
    // 私有扩展模块的自动验收入口复用同一次 evidence/rows，不在网页增加桥或 marker。
    return { evidence: result.evidence, rows };
  } catch (error) {
    if (currentGeneration === generation) {
      await clearRun('诊断失败，报告已清除。');
      throw error;
    }
  } finally { if (currentGeneration === generation) setBusy(false); }
}
function showError(error: unknown) { status.textContent = error instanceof Error ? error.message : '诊断操作失败'; }
function action(id: string, fn: () => Promise<unknown>) {
  element(id).addEventListener('click', () => { void fn().catch(showError); });
}
action('refresh', () => refreshTargets());
action('run', () => run());
action('runTiming', () => run(true));
action('cancel', () => clearRun('已取消并清除报告。'));
for (const [id, kind] of [['openHosted', 'hosted'], ['openLocal', 'localhost']]) {
  action(id, async () => {
    const response = await message({ action: 'openDiagnosticTarget', target: kind, port: Number((element('port') as HTMLInputElement).value) });
    await refreshTargets(response.tabId);
    status.textContent = '目标已打开；配置并刷新目标页后，在本页运行诊断。';
  });
}
window.addEventListener('pagehide', () => { void clearRun('报告已清除。').catch(() => undefined); });
void refreshTargets().catch(showError);
