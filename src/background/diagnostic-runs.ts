import { getEffectiveProfile } from '../shared/config-resolver';
import { diagnosticExpectation } from '../shared/diagnostic-report';
import type { DiagnosticEvidence, DiagnosticExpectation, DiagnosticRunInfo, Observation, DiagnosticRealm, InjectionTimingEvidence } from '../shared/diagnostic-report';
import type { SiteSpoofConfig } from '../shared/types';
import { WEBRTC_POLICY_VALUES, getWebRTCPolicyState } from './webrtc';
import { collectDiagnosticActual, collectDiagnosticPassThrough, collectDiagnosticRealm, collectInjectionTiming, createDiagnosticFrame, readDiagnosticDocument, removeDiagnosticFrame } from './diagnostic-probe';

export const DIAGNOSTIC_TTL_MS = 120000;
const ERRORS = {
  invalid_target: '目标必须是普通 HTTP(S) 标签页',
  not_allowlisted: '目标未启用 allowlist 规则，请先配置并刷新目标页',
  invalid_configuration: '目标配置无法解析，请检查出口档案绑定和信号设置',
  permission_denied: '目标 host 权限受限，无法采集',
  injection_failed: '脚本执行失败，目标可能被浏览器或站点策略限制',
  navigated: '目标文档已导航或重新加载，请重新运行',
  target_closed: '目标标签页已关闭或无法读取',
  expired: '诊断 run 已过期，请重新运行',
  cancelled: '诊断 run 已取消',
  consumed: '诊断 run 已消费，请重新运行',
  running: '诊断 run 正在执行，不能重复消费',
  missing: '诊断 run 不存在或后台已重启，请重新运行',
  wrong_owner: '诊断 run 只允许创建它的扩展报告文档访问',
  configuration_changed: '诊断期间配置已改变，请刷新目标页后重新运行'
} as const;
type ErrorCode = keyof typeof ERRORS;
export class DiagnosticRunError extends Error {
  constructor(readonly code: ErrorCode) { super(ERRORS[code]); }
}
interface Run {
  info: DiagnosticRunInfo;
  tabId: number;
  url: string;
  documentId: string;
  ownerTabId: number;
  ownerDocumentId: string;
  expectation: DiagnosticExpectation | null;
  requestedPolicy: string | null;
  state: 'ready' | 'running';
  timer: ReturnType<typeof setTimeout>;
  invalidation: AbortController;
}
export interface DiagnosticOwner { tabId: number; documentId: string }

// 内存是唯一 run 状态来源；MV3 worker 终止即失效，永不写 local/session。
export function createDiagnosticRuns(getConfig: () => Promise<SiteSpoofConfig>) {
  const runs = new Map<string, Run>();
  const preparing = new Map<string, { tabId: number; owner: DiagnosticOwner }>();
  const ended = new Map<string, { code: ErrorCode; owner: DiagnosticOwner; expiresAt: number }>();
  function end(run: Run, code: ErrorCode) {
    clearTimeout(run.timer);
    run.expectation = null;
    runs.delete(run.info.runId);
    if (code !== 'consumed') run.invalidation.abort(new DiagnosticRunError(code));
    for (const [id, item] of ended) if (item.expiresAt <= Date.now()) ended.delete(id);
    // 终态仅保留原因与所有者，无敏感观测；限制内存数量。
    if (ended.size >= 32) ended.delete(ended.keys().next().value!);
    ended.set(run.info.runId, { code, owner: { tabId: run.ownerTabId, documentId: run.ownerDocumentId }, expiresAt: Date.now() + DIAGNOSTIC_TTL_MS });
  }
  function requireRun(id: string, owner: DiagnosticOwner): Run {
    const run = runs.get(id);
    const terminal = ended.get(id);
    if (!run) {
      if (terminal && (terminal.owner.tabId !== owner.tabId || terminal.owner.documentId !== owner.documentId)) throw new DiagnosticRunError('wrong_owner');
      throw new DiagnosticRunError(terminal?.code || 'missing');
    }
    if (run.ownerTabId !== owner.tabId || run.ownerDocumentId !== owner.documentId) throw new DiagnosticRunError('wrong_owner');
    if (run.info.expiresAt <= Date.now()) { end(run, 'expired'); throw new DiagnosticRunError('expired'); }
    return run;
  }
  async function getTab(tabId: number) {
    try { return await chrome.tabs.get(tabId); }
    catch { throw new DiagnosticRunError('target_closed'); }
  }
  async function identity(tabId: number) {
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: readDiagnosticDocument });
      if (!result?.documentId || !result.result?.url) throw new Error();
      return result;
    } catch { throw new DiagnosticRunError('injection_failed'); }
  }
  function resolve(config: SiteSpoofConfig, url: string) {
    const result = getEffectiveProfile(config, new URL(url).hostname);
    if (!result.matched) throw new DiagnosticRunError('not_allowlisted');
    if (!result.payload) throw new DiagnosticRunError('invalid_configuration');
    return diagnosticExpectation(result.payload);
  }
  async function prepare(tabId: number, owner: DiagnosticOwner): Promise<DiagnosticRunInfo> {
    if (!Number.isInteger(tabId) || tabId < 0) throw new DiagnosticRunError('invalid_target');
    for (const run of runs.values()) if (run.ownerTabId === owner.tabId && run.ownerDocumentId === owner.documentId) end(run, 'cancelled');
    const key = `${owner.tabId}:${owner.documentId}`;
    const preparation = { tabId, owner };
    preparing.set(key, preparation);
    try {
      const tab = await getTab(tabId);
      const url = tab.url || '';
      if (!/^https?:\/\//i.test(url)) throw new DiagnosticRunError('invalid_target');
      const config = await getConfig();
      const expectation = resolve(config, url);
      let allowed: boolean;
      try { allowed = await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }); }
      catch { throw new DiagnosticRunError('permission_denied'); }
      if (!allowed) throw new DiagnosticRunError('permission_denied');
      const document = await identity(tabId);
      if (document.result!.url !== url || (await getTab(tabId)).url !== url) throw new DiagnosticRunError('navigated');
      if (preparing.get(key) !== preparation) throw new DiagnosticRunError('cancelled');
      const info: DiagnosticRunInfo = { runId: crypto.randomUUID(), expiresAt: Date.now() + DIAGNOSTIC_TTL_MS, targetOrigin: new URL(url).origin, state: 'ready' };
      const run: Run = { info, tabId, url, documentId: document.documentId, ownerTabId: owner.tabId, ownerDocumentId: owner.documentId, expectation, requestedPolicy: config.masterEnabled ? WEBRTC_POLICY_VALUES[config.webRtc.globalMode] : null, state: 'ready', invalidation: new AbortController(), timer: setTimeout(() => end(run, 'expired'), DIAGNOSTIC_TTL_MS) };
      run.timer.unref?.();
      runs.set(info.runId, run);
      return info;
    } finally { if (preparing.get(key) === preparation) preparing.delete(key); }
  }
  async function check(run: Run, owner: DiagnosticOwner) {
    requireRun(run.info.runId, owner);
    if ((await getTab(run.tabId)).url !== run.url) throw new DiagnosticRunError('navigated');
    const document = await identity(run.tabId);
    if (document.documentId !== run.documentId || document.result!.url !== run.url) throw new DiagnosticRunError('navigated');
    const config = await getConfig();
    if (JSON.stringify(resolve(config, run.url)) !== JSON.stringify(run.expectation) || WEBRTC_POLICY_VALUES[config.webRtc.globalMode] !== run.requestedPolicy) throw new DiagnosticRunError('configuration_changed');
    requireRun(run.info.runId, owner);
    return config;
  }
  async function collect(id: string, owner: DiagnosticOwner, timingOnly: boolean): Promise<DiagnosticEvidence | InjectionTimingEvidence> {
    const run = requireRun(id, owner);
    if (run.state === 'running') throw new DiagnosticRunError('running');
    run.state = 'running';
    let frameToken: string | null = null;
    let delivering = false;
    let frameRemoved = false;
    const frameContracts: Array<{ documentId: string; url: string; origin?: string; resolutionUrl?: string; expectation: DiagnosticExpectation; temporary: boolean }> = [];
    const target = { tabId: run.tabId, documentIds: [run.documentId] };
    const sample = async <T>(world: chrome.scripting.ExecutionWorld, func: () => T): Promise<Awaited<T>> => {
      const results = await chrome.scripting.executeScript({ target, world, func });
      const result = results.find((entry) => entry.documentId === run.documentId);
      if (!result || result.result === undefined) throw new DiagnosticRunError('injection_failed');
      return result.result as Awaited<T>;
    };
    try {
      const config = await check(run, owner);
      if (timingOnly) {
        const timing: InjectionTimingEvidence['timing'] = [];
        const documents = await chrome.scripting.executeScript({ target: { tabId: run.tabId, allFrames: true }, world: 'ISOLATED', func: readDiagnosticDocument });
        if (!documents.some((document) => document.frameId === 0 && document.documentId === run.documentId)) throw new DiagnosticRunError('navigated');
        for (const document of documents) {
          await check(run, owner);
          const url = document.result?.url || '';
          const origin = document.result?.origin;
          // fallback 仅用于诊断比较，由 ISOLATED 的有效 origin 独立确定，绝不改变生产注入授权。
          const resolutionUrl = /^https?:\/\//i.test(url) ? url
            : ['about:blank', 'about:srcdoc'].includes(url) && origin && /^https?:\/\//i.test(origin) ? origin : null;
          const resolved = resolutionUrl ? getEffectiveProfile(config, new URL(resolutionUrl).hostname) : null;
          const expectation = resolved?.payload ? diagnosticExpectation(resolved.payload) : null;
          let actual: InjectionTimingEvidence['timing'][number]['actual'] = { value: null, error: 'frame_not_allowlisted_or_origin_unknown' };
          if (expectation && resolutionUrl) {
            const current = getEffectiveProfile(await getConfig(), new URL(resolutionUrl).hostname);
            if (!current.payload || JSON.stringify(diagnosticExpectation(current.payload)) !== JSON.stringify(expectation)) throw new DiagnosticRunError('configuration_changed');
            requireRun(id, owner);
            frameContracts.push({ documentId: document.documentId, url, origin, resolutionUrl, expectation, temporary: false });
            try {
              const results = await chrome.scripting.executeScript({ target: { tabId: run.tabId, documentIds: [document.documentId] }, world: 'MAIN', func: collectInjectionTiming });
              actual = results.find((r) => r.documentId === document.documentId)?.result || { value: null, error: 'timing_frame_unavailable' };
            } catch { actual = { value: null, error: 'timing_frame_injection_failed' }; }
          }
          timing.push({ frameId: document.frameId, kind: document.frameId === 0 ? 'top' : document.result?.frameSource === 'about:blank' ? 'about:blank' : url === 'about:srcdoc' ? 'srcdoc' : 'iframe', expectation, actual });
        }
        await check(run, owner);
        await checkFrames();
        delivering = true;
        return { runId: id, expiresAt: run.info.expiresAt, targetOrigin: run.info.targetOrigin, timing };
      }
      const reference = await sample('ISOLATED', collectDiagnosticPassThrough);
      await check(run, owner);
      const passThrough = await sample('MAIN', collectDiagnosticPassThrough);
      await check(run, owner);
      const actual = await sample('MAIN', collectDiagnosticActual);
      await check(run, owner);
      // 创建 iframe 失败不丢弃已获得的 top/worker/header 证据。
      let frameError = '';
      try { frameToken = await sample('MAIN', createDiagnosticFrame); }
      catch { frameError = 'iframe_creation_failed'; }
      await check(run, owner);
      const frames: DiagnosticEvidence['frames'] = [];
      try {
        const documents = await chrome.scripting.executeScript({ target: { tabId: run.tabId, allFrames: true }, world: 'ISOLATED', func: readDiagnosticDocument });
        for (const document of documents.filter((entry) => entry.frameId !== 0)) {
          requireRun(id, owner);
          const url = document.result?.url || '';
          const resolved = /^https?:\/\//i.test(url) ? getEffectiveProfile(config, new URL(url).hostname) : null;
          let observation: Observation<DiagnosticRealm> = { value: null, error: 'frame_not_allowlisted_or_origin_unknown' };
          if (resolved?.payload) {
            const expectation = diagnosticExpectation(resolved.payload);
            // 顶层不变也可能撤销子帧规则；不能用首次配置授权后续 MAIN 采样。
            const current = getEffectiveProfile(await getConfig(), new URL(url).hostname);
            if (!current.payload || JSON.stringify(diagnosticExpectation(current.payload)) !== JSON.stringify(expectation)) throw new DiagnosticRunError('configuration_changed');
            requireRun(id, owner);
            frameContracts.push({ documentId: document.documentId, url, expectation, temporary: Boolean(frameToken && document.result?.diagnosticFrameToken === frameToken) });
            try {
              const [result] = await chrome.scripting.executeScript({ target: { tabId: run.tabId, documentIds: [document.documentId] }, world: 'MAIN', func: collectDiagnosticRealm });
              if (result?.documentId === document.documentId && result.result) observation = result.result;
              else observation = { value: null, error: 'frame_document_changed' };
            } catch { observation = { value: null, error: 'frame_injection_failed' }; }
          }
          frames.push({ frameId: document.frameId, expectation: resolved?.payload ? diagnosticExpectation(resolved.payload) : null, actual: observation, reason: observation.error || '' });
        }
      } catch (error) {
        if (error instanceof DiagnosticRunError) throw error;
        frameError = 'frame_enumeration_failed';
      }
      if (frameError) frames.push({ frameId: -1, expectation: null, actual: { value: null, error: frameError }, reason: frameError });
      let policy: DiagnosticEvidence['policy'];
      try { policy = { value: await getWebRTCPolicyState(config), error: null }; }
      catch { policy = { value: null, error: 'privacy_api_failed' }; }
      await check(run, owner);
      await checkFrames();
      delivering = true;
      return { runId: id, expiresAt: run.info.expiresAt, targetOrigin: run.info.targetOrigin, expectation: run.expectation!, requestedPolicy: run.requestedPolicy, actual, policy, reference, passThrough, frames };
    } catch (error) {
      const code = await failureCode(error);
      if (runs.has(id)) end(run, code);
      throw new DiagnosticRunError(code);
    } finally {
      if (frameToken) {
        try { await chrome.scripting.executeScript({ target, world: 'MAIN', func: removeDiagnosticFrame, args: [frameToken] }); frameRemoved = true; }
        catch (error) {
          if (delivering) {
            const code = await failureCode(error);
            if (runs.has(id)) end(run, code);
            throw new DiagnosticRunError(code);
          }
        }
      }
      if (delivering) {
        try { await check(run, owner); await checkFrames(); }
        catch (error) {
          const code = await failureCode(error);
          if (runs.has(id)) end(run, code);
          throw new DiagnosticRunError(code);
        }
      }
      if (runs.has(id)) end(run, 'consumed');
    }
    async function failureCode(error: unknown): Promise<ErrorCode> {
      let code: ErrorCode = error instanceof DiagnosticRunError ? error.code : 'injection_failed';
      // Chrome 可先拒绝旧文档的执行/清理，再发送 tabs.onUpdated。
      // 用可信标签/新文档身份分类，不使用网页异常文本判断。
      if (code === 'injection_failed') {
        try {
          const tab = await getTab(run.tabId);
          if (tab.url !== run.url || tab.status === 'loading') code = 'navigated';
          else if ((await identity(run.tabId)).documentId !== run.documentId) code = 'navigated';
        } catch (failure) {
          if (failure instanceof DiagnosticRunError && failure.code === 'target_closed') code = 'target_closed';
        }
      }
      return code;
    }
    async function checkFrames() {
      if (!frameContracts.length) return;
      const documents = await chrome.scripting.executeScript({ target: { tabId: run.tabId, allFrames: true }, world: 'ISOLATED', func: readDiagnosticDocument });
      const config = await getConfig();
      for (const frame of frameContracts) {
        // 临时帧已由 finally 移除时不再检查文档，但仍检查配置撤销。
        if (!frameRemoved || !frame.temporary) {
          const document = documents.find((entry) => entry.documentId === frame.documentId);
          if (!document || document.result?.url !== frame.url || (frame.origin !== undefined && document.result?.origin !== frame.origin)) throw new DiagnosticRunError('navigated');
        }
        const current = getEffectiveProfile(config, new URL(frame.resolutionUrl || frame.url).hostname);
        if (!current.payload || JSON.stringify(diagnosticExpectation(current.payload)) !== JSON.stringify(frame.expectation)) throw new DiagnosticRunError('configuration_changed');
      }
      requireRun(id, owner);
    }
  }
  async function executeRun(id: string, owner: DiagnosticOwner, timingOnly: boolean): Promise<DiagnosticEvidence | InjectionTimingEvidence> {
    const run = requireRun(id, owner);
    if (run.state === 'running') throw new DiagnosticRunError('running');
    let onAbort!: () => void;
    const invalidated = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(run.invalidation.signal.reason);
      run.invalidation.signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([collect(id, owner, timingOnly), invalidated]); }
    finally { run.invalidation.signal.removeEventListener('abort', onAbort); }
  }
  function cancel(id: string, owner: DiagnosticOwner) {
    if (ended.has(id)) {
      const item = ended.get(id)!;
      if (item.owner.tabId !== owner.tabId || item.owner.documentId !== owner.documentId) throw new DiagnosticRunError('wrong_owner');
      return;
    }
    end(requireRun(id, owner), 'cancelled');
  }
  function invalidateTab(tabId: number, closed = false) {
    for (const [key, item] of preparing) if (item.tabId === tabId || item.owner.tabId === tabId) preparing.delete(key);
    for (const run of runs.values()) {
      if (run.ownerTabId === tabId) end(run, 'cancelled');
      else if (run.tabId === tabId) end(run, closed ? 'target_closed' : 'navigated');
    }
  }
  // 两个固定入口共享生命周期；类型由调用入口决定，不接受页面提供的 mode 或预期。
  async function execute(id: string, owner: DiagnosticOwner): Promise<DiagnosticEvidence> {
    return await executeRun(id, owner, false) as DiagnosticEvidence;
  }
  async function executeTiming(id: string, owner: DiagnosticOwner): Promise<InjectionTimingEvidence> {
    return await executeRun(id, owner, true) as InjectionTimingEvidence;
  }
  return { prepare, execute, executeTiming, cancel, invalidateTab };
}
