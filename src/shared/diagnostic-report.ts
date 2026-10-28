import type { EffectivePayload, LanguageConfig, IntlMode } from './types';
import { getAcceptLanguageValue } from './config-model';

export type DiagnosticVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';
export interface Observation<T> { value: T | null; error: string | null }
export interface IntlCallObservation {
  numberLocale: string;
  explicitLocale: string;
  explicitTimezone: string;
  explicitNumberLocale: string;
  explicitDateLocale: string;
  explicitDateHour: string;
}
export interface DiagnosticRealm {
  language: string;
  languages: string[];
  locale: string;
  timezone: string;
  offsetMinutes: number;
  localeString?: string;
  intl?: IntlCallObservation;
}
export interface DiagnosticCoordinate { latitude: number; longitude: number; accuracy: number }
export type PassThroughValues = Record<string, string | number | boolean | null>;
export interface DiagnosticActual {
  realm: Observation<DiagnosticRealm>;
  header: Observation<string>;
  position: Observation<DiagnosticCoordinate>;
  watch: Observation<DiagnosticCoordinate>;
  permission: Observation<string>;
  ice: Observation<{ total: number; ip: number; mdns: number; other: number; complete: boolean }>;
  workers: Record<string, Observation<DiagnosticRealm>>;
}
// 只截取本次比较需要的字段；不保存完整配置、历史或出口 IP。
export interface DiagnosticExpectation {
  intlMode?: IntlMode;
  language: LanguageConfig | null;
  timezone: string | null;
  geolocation: (DiagnosticCoordinate & { randomRadiusMeters: number; spoofPermission: boolean }) | null;
}
export interface DiagnosticPolicy {
  supported: boolean;
  requestedPolicy: string | null;
  actualPolicy: string | null;
  levelOfControl: string | null;
  controlledByThisExtension: boolean;
}
export interface DiagnosticRunInfo { runId: string; expiresAt: number; targetOrigin: string; state: 'ready' }
export interface InjectionSnapshot extends Omit<DiagnosticRealm, 'localeString'> {
  readyState: string;
  scriptIndex: number;
  inline: boolean;
  capturedAtMs: number;
}
export interface InjectionTimingActual { version: 1; earliest: InjectionSnapshot; load: InjectionSnapshot; postLoad: InjectionSnapshot }
export interface InjectionTimingEvidence {
  runId: string;
  expiresAt: number;
  targetOrigin: string;
  timing: Array<{ frameId: number; kind: string; expectation: DiagnosticExpectation | null; actual: Observation<InjectionTimingActual> }>;
}
export interface DiagnosticEvidence {
  runId: string;
  expiresAt: number;
  targetOrigin: string;
  expectation: DiagnosticExpectation;
  actual: DiagnosticActual;
  policy: Observation<DiagnosticPolicy>;
  requestedPolicy: string | null;
  passThrough: Observation<PassThroughValues>;
  reference: Observation<PassThroughValues>;
  frames: Array<{ frameId: number; expectation: DiagnosticExpectation | null; actual: Observation<DiagnosticRealm>; reason: string }>;
}
export interface DiagnosticRow {
  label: string;
  verdict: DiagnosticVerdict;
  actual: unknown;
  expected: unknown;
  detail: string;
}

export function diagnosticExpectation(payload: EffectivePayload): DiagnosticExpectation {
  return {
    language: payload.languageConfig ? { ...payload.languageConfig, languages: [...payload.languageConfig.languages] } : null,
    timezone: payload.timezone,
    intlMode: payload.intlMode,
    geolocation: payload.geolocation ? {
      latitude: payload.geolocation.latitude,
      longitude: payload.geolocation.longitude,
      accuracy: payload.geolocation.accuracy,
      randomRadiusMeters: payload.geolocation.randomize ? payload.geolocation.randomRadiusMeters : 0,
      spoofPermission: payload.geolocation.spoofPermission
    } : null
  };
}

// 原生 Intl 会规范化和协商 locale；strict DTF 的历史强制回报另行保留。
function nativeLocale(locale: string | undefined, kind: 'date' | 'number'): string | null {
  if (!locale) return null;
  try {
    return kind === 'date' ? new Intl.DateTimeFormat(locale).resolvedOptions().locale
      : new Intl.NumberFormat(locale).resolvedOptions().locale;
  } catch { return null; }
}

function defaultDateLocale(expected: DiagnosticExpectation | null): string | null {
  return expected?.intlMode === 'compatible' ? nativeLocale(expected.language?.language, 'date')
    : expected?.language?.language || null;
}

// 比较只在扩展报告页调用，MAIN 采集函数不导入此模块。
export function compareDiagnosticEvidence(evidence: DiagnosticEvidence | InjectionTimingEvidence): DiagnosticRow[] {
  if ('timing' in evidence) return compareInjectionTimingEvidence(evidence);
  const rows: DiagnosticRow[] = [];
  const unknown = (label: string, detail: string, actual: unknown = null, expected: unknown = null) => {
    rows.push({ label, verdict: 'UNKNOWN', actual, expected, detail });
  };
  const compare = (label: string, actual: unknown, expected: unknown, detail = '', matches?: boolean) => {
    if (actual == null || expected == null) unknown(label, detail || '未配置或无法观测', actual, expected);
    else rows.push({ label, verdict: (matches ?? (JSON.stringify(actual) === JSON.stringify(expected))) ? 'PASS' : 'FAIL', actual, expected, detail });
  };
  function realmRows(prefix: string, observation: Observation<DiagnosticRealm>, expected: DiagnosticExpectation | null) {
    const value = observation.value;
    compare(`${prefix} language`, value?.language, expected?.language?.language, observation.error || '');
    compare(`${prefix} languages`, value?.languages, expected?.language?.languages, observation.error || '');
    compare(`${prefix} locale`, value?.locale, defaultDateLocale(expected), observation.error || '');
    let zone: string | null = null;
    let offset: number | null = null;
    if (expected?.timezone) {
      zone = new Intl.DateTimeFormat('en-US', { timeZone: expected.timezone }).resolvedOptions().timeZone;
      // 采集固定时间，避免诊断期间跨 DST 边界或墙钟变化。
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: expected.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(1768478400000));
      const part = (name: string) => Number(parts.find((p) => p.type === name)?.value);
      offset = (1768478400000 - Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'))) / 60000;
    }
    let observedZone: string | null = null;
    try { if (value?.timezone) observedZone = new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).resolvedOptions().timeZone; }
    catch { /* 非法实际时区不能等价于有效配置。 */ }
    compare(`${prefix} timezone`, value?.timezone, expected?.timezone, observation.error || '按同一 Intl 规范化比较时区别名，显示原始值', observedZone !== null && observedZone === zone);
    compare(`${prefix} NumberFormat default locale`, value?.intl?.numberLocale, nativeLocale(expected?.language?.language, 'number'), observation.error || '默认调用，按原生 locale 协商比较');
    if (expected) {
      const strict = expected.intlMode !== 'compatible';
      const locale = strict && expected.language ? expected.language.language : 'en-US';
      const timezone = strict && expected.timezone ? expected.timezone : 'UTC';
      const detail = `${expected.intlMode || 'strict'}：固定显式 en-US / UTC 调用`;
      compare(`${prefix} explicit locale`, value?.intl?.explicitLocale, locale, observation.error || detail);
      let explicitZone: string | null = null;
      try { if (value?.intl?.explicitTimezone) explicitZone = new Intl.DateTimeFormat('en-US', { timeZone: value.intl.explicitTimezone }).resolvedOptions().timeZone; }
      catch { /* 非法实际时区保持 FAIL。 */ }
      const expectedZone = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
      compare(`${prefix} explicit timezone`, value?.intl?.explicitTimezone, timezone, observation.error || detail, explicitZone === expectedZone);
      compare(`${prefix} NumberFormat explicit locale`, value?.intl?.explicitNumberLocale, nativeLocale(locale, 'number'), observation.error || detail);
      let dateLocale: string | null = null;
      let dateHour: string | null = null;
      try {
        dateLocale = new Date(1768478400000).toLocaleString(locale, { timeZone: timezone });
        dateHour = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(1768478400000));
      } catch { /* 无法生成预期时保持 UNKNOWN。 */ }
      compare(`${prefix} Date explicit locale`, value?.intl?.explicitDateLocale, dateLocale, observation.error || detail);
      compare(`${prefix} DateTimeFormat explicit hour`, value?.intl?.explicitDateHour, dateHour, observation.error || detail);
    } else {
      unknown(`${prefix} explicit Intl/Date`, observation.error || '无有效规则预期，无法判断模式');
    }
    // Worker fixtures 采集当前时间，仅比较其时区身份，固定时间偏移由窗口采集。
    if (!prefix.startsWith('Worker')) compare(`${prefix} Date offset`, value?.offsetMinutes, offset, observation.error || '');
    if (!prefix.startsWith('Worker')) {
      let localeString: string | null = null;
      try {
        if (expected?.language && expected.timezone) localeString = new Date(1768478400000).toLocaleString(expected.language.language, { timeZone: expected.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      } catch { /* 非法 locale 的预期无法生成，保持 UNKNOWN。 */ }
      compare(`${prefix} Date locale`, value?.localeString, localeString, observation.error || '固定时间的原生 locale 格式化比较');
    }
  }
  realmRows('Top', evidence.actual.realm, evidence.expectation);
  if (evidence.expectation.language) {
    compare('Accept-Language', evidence.actual.header.value, getAcceptLanguageValue(evidence.expectation.language.languages),
      evidence.actual.header.error || '比较目标实际请求头与站点语言列表；旧文档需完整重载。');
  } else unknown('Accept-Language', '此站点语言未启用，请求头保持原生，仅观测。', evidence.actual.header.value);
  unknown('目标内置字体过滤', '固定内置名单可按已启用HTTP(S)规则注册；本报告未采样目标字体，不能据注册状态判定当前文档字体过滤通过。自定义及三层名单需要允许用户脚本。');
  unknown('非目标字体原生', '内置名单以外的字体保持原生；本报告未采样字体宽度，不能判定实际字体库存。');
  unknown('字体探测覆盖', '不承诺隐藏全部字体；DOM 尺寸、@font-face local()、Canvas 像素及 Worker 字体探测未覆盖。');
  for (const [name, observation] of [['getCurrentPosition', evidence.actual.position], ['watchPosition', evidence.actual.watch]] as const) {
    const expected = evidence.expectation.geolocation;
    const actual = observation.value;
    if (!expected || !actual) {
      unknown(name, observation.error || '位置信号未启用', actual, expected);
      continue;
    }
    const rad = (n: number) => n * Math.PI / 180;
    const a = Math.sin(rad(actual.latitude - expected.latitude) / 2) ** 2 + Math.cos(rad(expected.latitude)) * Math.cos(rad(actual.latitude)) * Math.sin(rad(actual.longitude - expected.longitude) / 2) ** 2;
    const distance = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
    rows.push({ label: name, verdict: Number.isFinite(distance) && distance <= expected.randomRadiusMeters + 0.1 ? 'PASS' : 'FAIL', actual, expected, detail: `距离 ${distance.toFixed(2)}m；允许随机半径 ${expected.randomRadiusMeters}m` });
    compare(`${name} accuracy`, actual.accuracy, expected.accuracy);
  }
  compare('Geolocation permission', evidence.actual.permission.value, evidence.expectation.geolocation?.spoofPermission ? 'granted' : null, evidence.actual.permission.error || '未接管权限时不推断原生授权');
  const policy = evidence.policy.value;
  if (!policy?.supported || !policy.actualPolicy || !policy.levelOfControl) unknown('WebRTC policy', evidence.policy.error || 'privacy API 状态不可观察', policy, evidence.requestedPolicy);
  else if (evidence.requestedPolicy) {
    rows.push({ label: 'WebRTC policy', verdict: policy.actualPolicy === evidence.requestedPolicy && policy.controlledByThisExtension ? 'PASS' : 'FAIL', actual: policy, expected: evidence.requestedPolicy, detail: '同时检查实际策略与控制权' });
  } else {
    rows.push({ label: 'WebRTC policy', verdict: policy.controlledByThisExtension ? 'FAIL' : 'PASS', actual: policy, expected: '本扩展已释放控制', detail: '浏览器 default 不代表无其他策略' });
  }
  const ice = evidence.actual.ice.value;
  if (ice && ice.ip > 0) rows.push({ label: 'WebRTC ICE', verdict: 'FAIL', actual: ice, expected: '无可见 IP 候选', detail: '观测到 IPv4/IPv6 地址；地址不保留在报告' });
  else unknown('WebRTC ICE', evidence.actual.ice.error || '未观测到 IP 候选不能证明防护有效', ice);
  if (!evidence.frames.length) unknown('iframe', '未发现可采样子文档');
  for (const frame of evidence.frames) realmRows(`iframe ${frame.frameId}`, frame.actual, frame.expectation);
  for (const [name, actual] of Object.entries(evidence.actual.workers)) realmRows(`Worker ${name}`, actual, evidence.expectation);
  const keys = new Set([...Object.keys(evidence.passThrough.value || {}), ...Object.keys(evidence.reference.value || {})]);
  if (!keys.size) unknown('Pass-through', evidence.passThrough.error || evidence.reference.error || '无原生参考');
  for (const key of keys) compare(`Pass-through ${key}`, evidence.passThrough.value?.[key], evidence.reference.value?.[key], '同文档 MAIN 与 ISOLATED 原生参考比较；仅证明当次观测');
  return rows;
}

function compareInjectionTimingEvidence(evidence: InjectionTimingEvidence): DiagnosticRow[] {
  const rows: DiagnosticRow[] = [];
  if (!evidence.timing.length) return [{ label: 'Injection timing', verdict: 'UNKNOWN', actual: null, expected: null, detail: '未发现可采样文档' }];
  for (const kind of ['top', 'iframe', 'srcdoc', 'about:blank']) {
    if (!evidence.timing.some((frame) => frame.kind === kind)) rows.push({ label: `${kind} timing coverage`, verdict: 'UNKNOWN', actual: null, expected: '独立文档快照', detail: '缺失场景不能由其他帧通过替代' });
  }
  for (const frame of evidence.timing) {
    for (const stage of ['earliest', 'load', 'postLoad'] as const) {
      const value = frame.actual.value?.[stage];
      const prefix = `${frame.kind} #${frame.frameId} ${stage}`;
      const push = (field: string, actual: unknown, expected: unknown, matches = JSON.stringify(actual) === JSON.stringify(expected)) => {
        rows.push({ label: `${prefix} ${field}`, verdict: actual == null || expected == null ? 'UNKNOWN' : matches ? 'PASS' : 'FAIL', actual, expected,
          detail: frame.actual.error || '仅比较该阶段实际快照与当前扩展配置；load 通过不能补足 earliest 失败。页面观测可能受页面干预。' });
      };
      push('capture', value ? { readyState: value.readyState, scriptIndex: value.scriptIndex, inline: value.inline } : null,
        stage === 'earliest' ? 'loading / first inline script' : stage === 'load' ? 'complete / load callback' : 'complete / diagnostic sample',
        stage === 'earliest' ? value?.readyState === 'loading' && value.scriptIndex === 1 && value.inline : value?.readyState === 'complete');
      push('language', value?.language, frame.expectation?.language?.language);
      push('languages', value?.languages, frame.expectation?.language?.languages);
      push('locale', value?.locale, defaultDateLocale(frame.expectation));
      let zone: string | null = null;
      let actualZone: string | null = null;
      let offset: number | null = null;
      if (frame.expectation?.timezone) {
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: frame.expectation.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
        zone = formatter.resolvedOptions().timeZone;
        const parts = formatter.formatToParts(new Date(1768478400000));
        const part = (name: string) => Number(parts.find((p) => p.type === name)?.value);
        offset = (1768478400000 - Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second'))) / 60000;
      }
      try { if (value?.timezone) actualZone = new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).resolvedOptions().timeZone; }
      catch { /* 非法实际时区保留 FAIL。 */ }
      push('timezone', value?.timezone, frame.expectation?.timezone, actualZone !== null && actualZone === zone);
      push('Date offset', value?.offsetMinutes, offset);
    }
  }
  return rows;
}
