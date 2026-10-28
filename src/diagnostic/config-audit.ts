import { auditConfig } from '../shared/config-audit';
import type { SiteSpoofConfig } from '../shared/types';

const status = document.getElementById('auditStatus')!;
const results = document.getElementById('auditResults')!;
const refresh = document.getElementById('refreshAudit') as HTMLButtonElement;

async function request(action: string, findingId?: string) {
  const response = await chrome.runtime.sendMessage({ action, findingId });
  if (response?.status !== 'ok' && !(response?.saved && response.status === 'partial')) {
    throw new Error(response?.message || '配置体检读取失败，请重试。');
  }
  return response;
}

function render(config: SiteSpoofConfig) {
  const findings = auditConfig(config);
  status.textContent = findings.length ? `发现 ${findings.length} 项提示；配置分析不代表网页实际生效。` : '未发现配置问题；网页实际效果仍需运行诊断。';
  results.replaceChildren(...findings.map(finding => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.finding = finding.id;
    const title = document.createElement('strong');
    title.textContent = finding.title;
    const detail = document.createElement('p');
    detail.textContent = `${finding.severity === 'error' ? '未就绪' : finding.severity === 'warn' ? '注意' : '提示'} · ${finding.detail}`;
    row.append(title, detail);
    if (finding.fix) {
      const fix = document.createElement('button');
      fix.type = 'button';
      fix.textContent = finding.fix.label;
      fix.addEventListener('click', () => { void update(finding.id); });
      row.append(fix);
    }
    return row;
  }));
}

async function update(findingId?: string) {
  refresh.disabled = true;
  for (const button of Array.from(results.querySelectorAll('button'))) button.disabled = true;
  try {
    const response = await request(findingId ? 'applyConfigAuditFix' : 'getSiteConfig', findingId);
    render(response.config);
    if (response.saved && response.status === 'partial') status.textContent += ' 修复已保存，但运行时同步尚未完成。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '配置体检失败';
  } finally {
    refresh.disabled = false;
    for (const button of Array.from(results.querySelectorAll('button'))) button.disabled = false;
  }
}

refresh.addEventListener('click', () => { void update(); });
void update();
