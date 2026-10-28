import vm from 'node:vm';
import type { LanguageTimezonePayload } from '../src/shared/types';

export type Fingerprint = { timezone: string; offset: number; locale: string; language: string; languages: string[] };
export type FingerprintSample = { native: Fingerprint; actual: Fingerprint };
const probeDate = '2026-01-15T12:00:00Z';

// JS 内建对象由每个 context 自己创建，避免补丁修改宿主或污染下一个样本。
export function sampleFingerprintRealm(source: string, payload: LanguageTimezonePayload, kind: 'top' | 'iframe' | 'worker'): FingerprintSample {
  const context = vm.createContext({ URL, Blob, addEventListener() {},
    location: { protocol: 'https:', href: `https://example.test/${kind}`, origin: 'https://example.test' },
    origin: 'https://example.test'
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`globalThis.self = globalThis;
    globalThis.Navigator = class Navigator {
      get language() { return 'zh-CN'; }
      get languages() { return Object.freeze(['zh-CN', 'zh']); }
    };
    globalThis.navigator = new Navigator();
    ${kind === 'worker' ? '' : "globalThis.document = { documentElement: { lang: 'zh-CN' } };"}`, context);
  const observe = () => JSON.parse(vm.runInContext(`JSON.stringify({
    timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date(${JSON.stringify(probeDate)}).getTimezoneOffset(),
    locale: new Intl.DateTimeFormat().resolvedOptions().locale,
    language: navigator.language, languages: [...navigator.languages]
  })`, context)) as Fingerprint;
  const native = observe();
  vm.runInContext(`(${source})(${JSON.stringify(payload)});`, context);
  return { native, actual: observe() };
}

export function fingerprintFailures(payload: LanguageTimezonePayload, samples: Record<string, FingerprintSample>): string[] {
  const failures: string[] = [];
  // 用原生 Intl 的 offset 标记建立参考，不复用被测 Date 补丁的计算实现。
  const zone = payload.timezone ? new Intl.DateTimeFormat('en-US', { timeZone: payload.timezone }) : null;
  const offsetName = zone ? new Intl.DateTimeFormat('en-US', { timeZone: payload.timezone!, timeZoneName: 'longOffset' })
    .formatToParts(new Date(probeDate)).find(part => part.type === 'timeZoneName')!.value : '';
  const offsetParts = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetName);
  const offset = offsetParts ? (Number(offsetParts[2]) * 60 + Number(offsetParts[3])) * (offsetParts[1] === '+' ? -1 : 1) : 0;
  const language = payload.language?.language || null;
  const locale = language ? new Intl.DateTimeFormat(language).resolvedOptions().locale : null;
  for (const [kind, { native, actual }] of Object.entries(samples)) {
    // resolvedOptions反映实例真实槽，时区别名沿用原生规范化。
    const expected: Fingerprint = { timezone: zone ? zone.resolvedOptions().timeZone : native.timezone,
      offset: zone ? offset : native.offset, locale: locale || native.locale,
      language: language || native.language,
      languages: language ? payload.language!.languages.length ? payload.language!.languages : [language] : native.languages };
    for (const field of Object.keys(expected) as Array<keyof Fingerprint>) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
        failures.push(`${kind}.${field}: expected ${JSON.stringify(expected[field])}, received ${JSON.stringify(actual[field])}`);
      }
    }
  }
  for (const field of ['timezone', 'offset', 'locale', 'language', 'languages'] as const) {
    const seen = new Set(Object.values(samples).map(sample => JSON.stringify(sample.actual[field])));
    if (seen.size !== 1) failures.push(`${field}: ${[...seen].join(' vs ')}`);
  }
  return failures;
}
