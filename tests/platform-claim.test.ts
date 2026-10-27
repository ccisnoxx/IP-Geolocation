import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  buildHighEntropyValues,
  installNavigatorPatch,
  platformClaimValues,
  rewriteUserAgent
} from '../src/injected/navigator-patch';
import {
  CLAIM_HEADER_VALUES,
  buildPlatformHeaders,
  rewriteUserAgent as rewriteUserAgentHeader
} from '../src/background/platform-headers';
import { normalizeConfig } from '../src/shared/config-model';
import { getEffectiveProfile } from '../src/shared/config-resolver';
import { buildAcceptLanguageRules } from '../src/background/dnr';
import { createRule } from '../src/shared/config-model';

const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

test('注入层与后台的平台表必须一模一样（两份实现、一份真值）', () => {
  for (const claim of ['mac', 'windows', 'linux'] as const) {
    const injected = platformClaimValues(claim);
    const headers = CLAIM_HEADER_VALUES[claim];
    assert.ok(injected, `${claim} 在注入层没有映射`);
    assert.deepEqual(
      { ...injected, platformVersion: headers.platformVersion, architecture: headers.architecture },
      headers,
      `${claim} 的两份表不一致：改了一边忘了另一边，UA 与请求头就会各说各话`
    );
  }
});

test('UA 只替换操作系统段，Chrome 版本保持真话', () => {
  const values = platformClaimValues('windows')!;
  const rewritten = rewriteUserAgent(REAL_UA, values);
  assert.match(rewritten, /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit/);
  assert.match(rewritten, /Chrome\/155\.0\.0\.0 Safari\/537\.36$/, '版本段必须原样保留');
  // 不能把 "(KHTML, like Gecko)" 也吞掉
  assert.match(rewritten, /\(KHTML, like Gecko\)/);
});

test('请求头改写与 JS 值用同一套值', () => {
  const headers = buildPlatformHeaders('windows', { version: '10.0.0', architecture: 'x86' }, REAL_UA);
  const byName = new Map(headers.map((header) => [header.header, header.value]));
  assert.match(String(byName.get('User-Agent')), /Windows NT 10\.0; Win64; x64/);
  assert.equal(byName.get('Sec-CH-UA-Platform'), '"Windows"');
  assert.equal(byName.get('Sec-CH-UA-Platform-Version'), '"10.0.0"', '覆盖值要生效');
  assert.equal(byName.get('Sec-CH-UA-Arch'), '"x86"');
  assert.equal(byName.get('Sec-CH-UA-Bitness'), '"64"');
  // 注入层的 platform 与请求头的 UA 段必须来自同一张表
  assert.match(String(byName.get('User-Agent')), new RegExp(platformClaimValues('windows')!.uaToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(rewriteUserAgentHeader(REAL_UA, CLAIM_HEADER_VALUES.windows.uaToken), byName.get('User-Agent'));
});

test('getHighEntropyValues 只回请求过的键', () => {
  const values = platformClaimValues('linux')!;
  const only = buildHighEntropyValues(['platform'], values, { brands: [] });
  assert.deepEqual(Object.keys(only), ['platform']);
  const all = buildHighEntropyValues(
    ['platform', 'platformVersion', 'architecture', 'model', 'uaFullVersion', 'bitness', 'wow64'],
    values,
    { brands: [], uaFullVersion: '155.0.0.0' }
  );
  assert.equal(all.platform, 'Linux');
  assert.equal(all.architecture, 'x86');
  assert.equal(all.uaFullVersion, '155.0.0.0', '版本沿用真实值');
  assert.equal(all.model, '');
});

function createScope() {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.Navigator = function Navigator() {};
    const define = (key, value) => Object.defineProperty(Navigator.prototype, key, {
      get() { return value; }, enumerable: true, configurable: true
    });
    define('userAgent', ${JSON.stringify(REAL_UA)});
    define('appVersion', ${JSON.stringify(REAL_UA.replace(/^Mozilla\//, ''))});
    define('platform', 'MacIntel');
    define('language', 'en-US');
    globalThis.navigator = new Navigator();

    globalThis.UAData = function UAData() {};
    Object.defineProperty(UAData.prototype, 'platform', { get() { return 'macOS'; }, enumerable: true, configurable: true });
    Object.defineProperty(UAData.prototype, 'brands', { get() { return [{ brand: 'Chromium', version: '155' }]; }, enumerable: true, configurable: true });
    UAData.prototype.getHighEntropyValues = function (hints) {
      return Promise.resolve(hints.reduce((acc, hint) => {
        acc[hint] = hint === 'platform' ? 'macOS' : (hint === 'uaFullVersion' ? '155.0.0.0' : '');
        return acc;
      }, {}));
    };
    UAData.prototype.toJSON = function () { return { brands: this.brands, platform: 'macOS' }; };
    const uaData = new UAData();
    globalThis.uaData = uaData;
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get() { return uaData; }, configurable: true });
  `, context);
  return context;
}

const deps = {
  disguise: (fn: any) => fn,
  define: (target: any, key: string, value: any) => {
    Object.defineProperty(target, key, { value, writable: true, enumerable: false, configurable: true });
  }
};

test('声称 windows：navigator 与 userAgentData 一起变，实例上零自有属性', () => {
  const context = createScope();
  const ok = installNavigatorPatch(context, 'windows', { version: '10.0.0', architecture: 'x86' }, deps as any);
  assert.equal(ok, true);
  const read = (code: string) => vm.runInContext(code, context);

  assert.match(String(read('navigator.userAgent')), /Windows NT 10\.0; Win64; x64/);
  assert.equal(read('navigator.platform'), 'Win32');
  assert.equal(read('navigator.appVersion'), String(read('navigator.userAgent')).replace(/^Mozilla\//, ''));
  assert.equal(read('navigator.userAgentData.platform'), 'Windows');
  assert.equal(read('Object.getOwnPropertyDescriptor(navigator, "userAgent")'), undefined, '属性必须落在原型上');
  assert.equal(read('Object.getOwnPropertyDescriptor(navigator, "platform")'), undefined);

  return read('navigator.userAgentData.getHighEntropyValues(["platform","platformVersion","architecture","uaFullVersion"]).then((v) => JSON.stringify(v))')
    .then((json: string) => {
      const values = JSON.parse(json);
      assert.equal(values.platform, 'Windows');
      assert.equal(values.platformVersion, '10.0.0');
      assert.equal(values.architecture, 'x86');
      assert.equal(values.uaFullVersion, '155.0.0.0');
    });
});

test('传 null 撤销：回到原生 mac 值（关掉开关必须能退回去）', () => {
  const context = createScope();
  installNavigatorPatch(context, 'linux', null, deps as any);
  assert.match(String(vm.runInContext('navigator.userAgent', context)), /X11; Linux x86_64/);
  installNavigatorPatch(context, null, null, deps as any);
  assert.equal(vm.runInContext('navigator.userAgent', context), REAL_UA);
  assert.equal(vm.runInContext('navigator.platform', context), 'MacIntel');
});

test('v3 迁移：canvas.platform 的声称搬到平台层，但不自动打开', () => {
  const migrated = normalizeConfig({ canvas: { enabled: true, platform: 'windows' } } as any);
  assert.equal(migrated.platform.claimed, 'windows');
  assert.equal(migrated.platform.enabled, false, '改写 UA 必须由用户自己点');
  assert.equal(migrated.schemaVersion, 4);

  const untouched = normalizeConfig({} as any);
  assert.equal(untouched.platform.claimed, 'auto');
  assert.equal(untouched.platform.enabled, false);
});

test('payload 里的字体层跟随声称：不会出现"UA 说 Windows、字体按 mac 判定"', () => {
  const config = normalizeConfig({
    platform: { enabled: true, claimed: 'windows', version: '', architecture: '' },
    canvas: { enabled: true, spoofFonts: true, platform: 'mac', hideCjkFonts: false, targetFonts: [] },
    rules: [{ ...createRule('example.com'), enabled: true }]
  } as any);

  const result = getEffectiveProfile(config, 'example.com', null);
  assert.ok(result.payload, '只开平台层也必须产出 payload');
  assert.deepEqual(result.payload!.platform, { claimed: 'windows', version: '', architecture: '' });
  assert.equal(result.payload!.canvasConfig.platform, 'windows', '字体层的平台必须被声称覆盖');
});

test('没声称时字体层保持自己的设置', () => {
  const config = normalizeConfig({
    canvas: { enabled: true, spoofFonts: true, platform: 'mac', hideCjkFonts: true, targetFonts: [] },
    rules: [{ ...createRule('example.com'), enabled: true }]
  } as any);
  const result = getEffectiveProfile(config, 'example.com', null);
  assert.equal(result.payload!.platform, null);
  assert.equal(result.payload!.canvasConfig.platform, 'mac');
});

test('DNR：声称打开后每个域名都带上 Sec-CH-UA-* 与改写后的 User-Agent', () => {
  const config = normalizeConfig({
    platform: { enabled: true, claimed: 'windows', version: '', architecture: '' },
    globalProfile: {
      language: { enabled: false, mode: 'custom', language: 'en-US', languages: ['en-US'], acceptLanguage: 'en-US' }
    },
    rules: [{ ...createRule('example.com'), enabled: true }]
  } as any);

  const rules = buildAcceptLanguageRules(config, null);
  const platformRule = rules.find((rule) => (rule.action.requestHeaders || []).some((header) => header.header === 'Sec-CH-UA-Platform'));
  assert.ok(platformRule, '缺少平台头规则');
  const headers = new Map((platformRule!.action.requestHeaders || []).map((header) => [header.header, header.value]));
  assert.equal(headers.get('Sec-CH-UA-Platform'), '"Windows"');
  assert.match(String(headers.get('User-Agent')), /Windows NT 10\.0; Win64; x64/);
  assert.deepEqual(platformRule!.condition.requestDomains, ['example.com']);

  // 关掉声称：一条平台规则都不该有
  const off = buildAcceptLanguageRules(normalizeConfig({ platform: { enabled: false, claimed: 'windows' }, rules: [{ ...createRule('example.com'), enabled: true }] } as any), null);
  assert.equal(off.some((rule) => (rule.action.requestHeaders || []).some((header) => header.header === 'Sec-CH-UA-Platform')), false);
});