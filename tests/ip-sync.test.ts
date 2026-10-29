import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, DEFAULT_IP_SYNC, normalizeConfig } from '../src/shared/config-model';
import {
  COUNTRY_LANGUAGES,
  IP_SYNC_ALARM_NAME,
  ensureIpSyncAlarmFor,
  ipSyncIntervalMinutes,
  isExitIpSyncRunning,
  isIpSyncEnabled,
  isSameLocation,
  isValidTimeZone,
  canonicalCountry,
  parseExitIpResponse,
  codeFromCountryName,
  lookupExitIp,
  planExitIpApply,
  planExitIpSync,
  resetExitIpSyncState,
  runExitIpSync
} from '../src/background/ip-sync';
import type { ExitIpInfo, ExitIpSyncDeps } from '../src/background/ip-sync';
import type { LastLocation, SiteSpoofConfig } from '../src/shared/types';

/** ipwho.is 的真实形状 */
const IPWHO_TOKYO = {
  ip: '203.0.113.7',
  success: true,
  country: 'Japan',
  country_code: 'JP',
  latitude: 35.6895,
  longitude: 139.6917,
  timezone: { id: 'Asia/Tokyo', offset: 32400 }
};

const TOKYO_INFO: ExitIpInfo = {
  ip: '203.0.113.7',
  latitude: 35.6895,
  longitude: 139.6917,
  country: 'Japan',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  timezoneOffset: -540
};

function configWith(patch: Partial<SiteSpoofConfig> = {}): SiteSpoofConfig {
  return normalizeConfig({
    ...patch,
    ipSync: { enabled: true, intervalMinutes: 15, syncLanguage: false, ...(patch.ipSync || {}) }
  });
}

function tokyoLocation(updateTime = '2026/10/28 12:00:00'): LastLocation {
  return {
    latitude: TOKYO_INFO.latitude,
    longitude: TOKYO_INFO.longitude,
    country: TOKYO_INFO.country,
    timezone: TOKYO_INFO.timezone,
    timezoneOffset: TOKYO_INFO.timezoneOffset,
    updateTime
  };
}

test('parseExitIpResponse 接受 ipwho.is 形状，并把 offset 换算成分钟', () => {
  const parsed = parseExitIpResponse(IPWHO_TOKYO);
  assert.equal(parsed?.ip, '203.0.113.7');
  assert.equal(parsed?.timezone, 'Asia/Tokyo');
  assert.equal(parsed?.countryCode, 'JP');
  // ipwho 的 offset 是秒、符号与 Date#getTimezoneOffset 相反
  assert.equal(parsed?.timezoneOffset, -540);
});

test('parseExitIpResponse 接受 ipinfo 的 loc 形状（country 本身就是国家码）', () => {
  const parsed = parseExitIpResponse({ ip: '198.51.100.9', country: 'SG', loc: '1.2897,103.8501', timezone: 'Asia/Singapore' });
  assert.equal(parsed?.countryCode, 'SG');
  assert.equal(parsed?.latitude, 1.2897);
  assert.equal(parsed?.longitude, 103.8501);
});

test('归属地接口只回国名不回国码时，照样能推出两字母码', () => {
  // 真实接口都会带 country_code，但响应可能被裁剪；缺了代码 syncLanguage 会静默不生效
  const parsed = parseExitIpResponse({ ip: '198.51.100.42', country: 'United States', timezone: 'America/Chicago', latitude: 41.85, longitude: -87.65 });
  assert.equal(parsed?.countryCode, 'US');
  assert.equal(parsed?.country, 'United States');

  // 只认识 COUNTRY_LANGUAGES 里那十个国家，其余宁可留空也不猜
  const unknown = parseExitIpResponse({ ip: '198.51.100.43', country: 'Brazil', timezone: 'America/Sao_Paulo', latitude: -23.5, longitude: -46.6 });
  assert.equal(unknown?.countryCode, null);
});

test('codeFromCountryName 大小写与空格不敏感', () => {
  assert.equal(codeFromCountryName('  united states '), 'US');
  assert.equal(codeFromCountryName('JAPAN'), 'JP');
  assert.equal(codeFromCountryName(''), null);
  assert.equal(codeFromCountryName(null), null);
});

test('parseExitIpResponse 拒绝没有 ip 的响应', () => {
  assert.equal(parseExitIpResponse({ latitude: 35, longitude: 139, timezone: { id: 'Asia/Tokyo' } }), null);
  assert.equal(parseExitIpResponse({ ip: '   ', latitude: 35, longitude: 139, timezone: { id: 'Asia/Tokyo' } }), null);
});

test('parseExitIpResponse 拒绝不存在的时区', () => {
  assert.equal(parseExitIpResponse({ ...IPWHO_TOKYO, timezone: { id: 'Mars/Olympus' } }), null);
  // 时区缺失也不行：跟随 IP 的核心产出就是时区，缺了这条就什么都没得改
  assert.equal(parseExitIpResponse({ ip: '203.0.113.7', latitude: 35.6895, longitude: 139.6917 }), null);
});

test('parseExitIpResponse 拒绝只有国家没有坐标的响应', () => {
  assert.equal(parseExitIpResponse({ ip: '203.0.113.7', success: true, country: 'China', country_code: 'CN' }), null);
});

test('isValidTimeZone 只认 Intl 认得的 IANA 名', () => {
  assert.equal(isValidTimeZone('Asia/Tokyo'), true);
  assert.equal(isValidTimeZone('America/New_York'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone('   '), false);
});

test('planExitIpSync 在总开关关闭时跳过', () => {
  const plan = planExitIpSync(configWith({ masterEnabled: false }), TOKYO_INFO, '');
  assert.equal(plan.skipped, 'extension-disabled');
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.layers, []);
});

test('planExitIpSync 在跟随出口 IP 关闭时跳过', () => {
  const plan = planExitIpSync(configWith({ ipSync: { ...DEFAULT_IP_SYNC, enabled: false } }), TOKYO_INFO, '');
  assert.equal(plan.skipped, 'sync-disabled');
  assert.equal(plan.changed, false);
});

test('planExitIpSync 在出口 IP 未变时不动配置', () => {
  const plan = planExitIpSync(configWith(), TOKYO_INFO, TOKYO_INFO.ip);
  assert.equal(plan.skipped, 'same-ip');
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.layers, []);
  // 没变也要给出定位，调用方据此判断要不要刷 lastLocation
  assert.equal(plan.location.timezone, 'Asia/Tokyo');
});

test('planExitIpSync 换 IP 后把时区与坐标切到 auto，并清掉手选预设', () => {
  const config = configWith({
    globalProfile: {
      ...configWith().globalProfile,
      timezone: { enabled: true, mode: 'manual', timezone: 'America/New_York' },
      geolocation: { ...configWith().globalProfile.geolocation, mode: 'manual', latitude: 40.7, longitude: -74, country: 'United States' }
    },
    profile: { ...configWith().profile, activeProfileId: 'united-states' }
  });

  const plan = planExitIpSync(config, TOKYO_INFO, '198.51.100.9', { now: 0 });

  assert.equal(plan.changed, true);
  assert.equal(plan.ipChanged, true);
  assert.equal(plan.skipped, undefined);
  assert.deepEqual(plan.layers, ['timezone', 'geolocation', 'profile']);
  assert.equal(plan.config.globalProfile.timezone.mode, 'auto');
  assert.equal(plan.config.globalProfile.timezone.timezone, 'Asia/Tokyo');
  assert.equal(plan.config.globalProfile.geolocation.mode, 'auto');
  assert.equal(plan.config.globalProfile.geolocation.latitude, 35.6895);
  assert.equal(plan.config.globalProfile.geolocation.country, 'Japan');
  assert.equal(plan.config.profile.activeProfileId, null);
  assert.equal(typeof plan.location.updateTime, 'string');
});

test('planExitIpSync 默认不动语言层', () => {
  const plan = planExitIpSync(configWith(), TOKYO_INFO, '198.51.100.9');
  assert.equal(plan.layers.includes('language'), false);
  assert.equal(plan.config.globalProfile.language.language, 'en-US');
  assert.equal(plan.config.globalProfile.language.mode, 'preset');
});

test('planExitIpSync 只有打开 syncLanguage 才按国家改语言', () => {
  const plan = planExitIpSync(
    configWith({ ipSync: { enabled: true, intervalMinutes: 15, syncLanguage: true } }),
    TOKYO_INFO,
    '198.51.100.9'
  );
  assert.equal(plan.layers.includes('language'), true);
  assert.equal(plan.config.globalProfile.language.language, 'ja-JP');
  assert.equal(plan.config.globalProfile.language.languages.includes('ja'), true);
  assert.equal(plan.config.globalProfile.language.acceptLanguage.startsWith('ja-JP'), true);
});

test('planExitIpSync 对没有对照表的国家保持原语言', () => {
  const plan = planExitIpSync(
    configWith({ ipSync: { enabled: true, intervalMinutes: 15, syncLanguage: true } }),
    { ...TOKYO_INFO, country: 'Iceland', countryCode: 'IS' },
    '198.51.100.9'
  );
  assert.equal(plan.layers.includes('language'), false);
  assert.equal(plan.config.globalProfile.language.language, 'en-US');
});

test('planExitIpSync 的产物再过一遍是幂等的', () => {
  const first = planExitIpSync(configWith(), TOKYO_INFO, '198.51.100.9');
  const second = planExitIpSync(first.config, TOKYO_INFO, TOKYO_INFO.ip, { force: true });
  // 已经全部对齐，即使用 force 也不再改任何一层
  assert.equal(second.changed, false);
  assert.deepEqual(second.layers, []);
});

test('planExitIpSync 的 force 能让同 IP 也重建定位', () => {
  const plan = planExitIpSync(configWith(), TOKYO_INFO, TOKYO_INFO.ip, { force: true });
  assert.equal(plan.skipped, undefined);
  assert.equal(plan.location.latitude, TOKYO_INFO.latitude);
});

test('isSameLocation 比较坐标、时区与国家', () => {
  assert.equal(isSameLocation(null, tokyoLocation()), false);
  assert.equal(isSameLocation(tokyoLocation(), tokyoLocation()), true);
  // updateTime 不参与比较：否则每轮都会判定"变了"，白写一次 storage
  assert.equal(isSameLocation(tokyoLocation('旧'), tokyoLocation('新')), true);
  assert.equal(isSameLocation({ ...tokyoLocation(), timezone: 'Asia/Seoul' }, tokyoLocation()), false);
  assert.equal(isSameLocation({ ...tokyoLocation(), country: 'Korea' }, tokyoLocation()), false);
  assert.equal(isSameLocation({ ...tokyoLocation(), latitude: 0 }, tokyoLocation()), false);
});

test('runExitIpSync 成功时先写定位再写配置，最后应用一次', async () => {
  const writes: string[] = [];
  let config = configWith();
  const locations: LastLocation[] = [];
  let storedIp = '198.51.100.9';
  let applied = 0;

  const outcome = await runExitIpSync({
    getConfig: async () => config,
    saveConfig: async (next) => { writes.push('config'); config = next; },
    saveLocation: async (next) => { writes.push('location'); locations.push(next); },
    getLastLocation: async () => locations.at(-1) || null,
    getStoredIp: async () => storedIp,
    saveStoredIp: async (ip) => { writes.push(`ip:${ip}`); storedIp = ip; },
    applyNow: async () => { applied += 1; },
    lookup: async (url) => { writes.push(`fetch:${url}`); return IPWHO_TOKYO; },
    now: () => 0
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.changed, true);
  assert.deepEqual(outcome.ok && outcome.layers, ['timezone', 'geolocation', 'profile']);
  // 定位先落盘：config 的 auto 模式要靠它解析，顺序反了会应用出一份"新配置 + 旧坐标"
  assert.deepEqual(writes.filter((item) => item !== 'fetch:https://ipwho.is/'), ['location', 'config', `ip:${TOKYO_INFO.ip}`]);
  assert.equal(applied, 1);
  assert.equal(locations.at(-1)?.timezone, 'Asia/Tokyo');
  assert.equal(config.globalProfile.timezone.timezone, 'Asia/Tokyo');
  assert.equal(storedIp, TOKYO_INFO.ip);
});

test('runExitIpSync 只查一个接口就够（响应自带 ip 与坐标）', async () => {
  const urls: string[] = [];
  await runExitIpSync({
    getConfig: async () => configWith(),
    saveConfig: async () => undefined,
    saveLocation: async () => undefined,
    getLastLocation: async () => tokyoLocation(),
    getStoredIp: async () => '198.51.100.9',
    saveStoredIp: async () => undefined,
    applyNow: async () => undefined,
    lookup: async (url) => { urls.push(url); return IPWHO_TOKYO; }
  });
  assert.deepEqual(urls, ['https://ipwho.is/']);
});

test('runExitIpSync 接口全挂时不推进 IP、不改配置', async () => {
  let savedIp = '';
  let savedConfig = false;
  const logs: string[] = [];

  const outcome = await runExitIpSync({
    getConfig: async () => configWith(),
    saveConfig: async () => { savedConfig = true; },
    saveLocation: async () => undefined,
    getLastLocation: async () => null,
    getStoredIp: async () => '',
    saveStoredIp: async (ip) => { savedIp = ip; },
    applyNow: async () => undefined,
    lookup: async (url) => { throw new Error(`blocked ${url}`); },
    log: (message) => logs.push(message)
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.error.includes('exit IP lookup failed'), true);
  // 失败必须留白：推进了 lastSyncedExitIp 就永远停在"已同步"的假状态
  assert.equal(savedIp, '');
  assert.equal(savedConfig, false);
  assert.equal(logs.length, 1);
});

test('runExitIpSync 逐个回退到下一个接口', async () => {
  const urls: string[] = [];
  const outcome = await runExitIpSync({
    getConfig: async () => configWith(),
    saveConfig: async () => undefined,
    saveLocation: async () => undefined,
    getLastLocation: async () => tokyoLocation(),
    getStoredIp: async () => '198.51.100.9',
    saveStoredIp: async () => undefined,
    applyNow: async () => undefined,
    lookup: async (url) => {
      urls.push(url);
      if (url.includes('ipwho.is')) return { success: false };
      return IPWHO_TOKYO;
    }
  });
  assert.equal(urls.length, 2);
  assert.equal(outcome.ok, true);
});

test('runExitIpSync 单飞：并发调用只打一次接口', async () => {
  resetExitIpSyncState();
  let lookups = 0;
  const deps: ExitIpSyncDeps = {
    getConfig: async () => configWith(),
    saveConfig: async () => undefined,
    saveLocation: async () => undefined,
    getLastLocation: async () => tokyoLocation(),
    getStoredIp: async () => '198.51.100.9',
    saveStoredIp: async () => undefined,
    applyNow: async () => undefined,
    lookup: async () => {
      lookups += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return IPWHO_TOKYO;
    }
  };

  const [first, second] = await Promise.all([runExitIpSync(deps), runExitIpSync(deps)]);
  assert.equal(lookups, 1);
  assert.deepEqual(first, second);
  assert.equal(isExitIpSyncRunning(), false);
});

test('runExitIpSync 带 force 时不复用别人那一趟（否则「立即同步」会被当成 same-ip 跳过）', async () => {
  resetExitIpSyncState();
  let lookups = 0;
  const deps: ExitIpSyncDeps = {
    getConfig: async () => configWith(),
    saveConfig: async () => undefined,
    saveLocation: async () => undefined,
    getLastLocation: async () => tokyoLocation(),
    // 存储里的 IP 就是当前出口 IP：不带 force 的那一趟必然走 same-ip 早退
    getStoredIp: async () => TOKYO_INFO.ip,
    saveStoredIp: async () => undefined,
    applyNow: async () => undefined,
    lookup: async () => {
      lookups += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return IPWHO_TOKYO;
    }
  };

  const plain = runExitIpSync(deps);
  const forced = runExitIpSync({ ...deps, force: true });
  const [first, second] = await Promise.all([plain, forced]);

  // 两趟各自查了一次接口：force 没有挤进第一趟
  assert.equal(lookups, 2);
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.skipped, 'same-ip');
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.changed, true);
  assert.deepEqual(second.ok && second.layers, ['timezone', 'geolocation', 'profile']);
  assert.equal(isExitIpSyncRunning(), false);
});

test('runExitIpSync 请求期间被关掉：不写任何东西', async () => {
  resetExitIpSyncState();
  let configCalls = 0;
  let wrote = false;

  const outcome = await runExitIpSync({
    getConfig: async () => {
      configCalls += 1;
      // 第一次读是有开的，网络回来之后的第二次读已经关了
      return configCalls === 1
        ? configWith()
        : configWith({ ipSync: { ...DEFAULT_IP_SYNC, enabled: false } });
    },
    saveConfig: async () => { wrote = true; },
    saveLocation: async () => { wrote = true; },
    getLastLocation: async () => null,
    getStoredIp: async () => '198.51.100.9',
    saveStoredIp: async () => { wrote = true; },
    applyNow: async () => { wrote = true; },
    lookup: async () => IPWHO_TOKYO
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.skipped, 'sync-disabled');
  assert.equal(wrote, false);
});

test('runExitIpSync 出口没变时什么都不写', async () => {
  resetExitIpSyncState();
  let wrote = false;
  const outcome = await runExitIpSync({
    getConfig: async () => configWith(),
    saveConfig: async () => { wrote = true; },
    saveLocation: async () => { wrote = true; },
    getLastLocation: async () => tokyoLocation(),
    getStoredIp: async () => TOKYO_INFO.ip,
    saveStoredIp: async () => { wrote = true; },
    applyNow: async () => { wrote = true; },
    lookup: async () => IPWHO_TOKYO
  });
  assert.equal(outcome.ok && outcome.skipped, 'same-ip');
  assert.equal(wrote, false);
});

test('runExitIpSync 配置已对齐、只有定位变了时不重写配置', async () => {
  resetExitIpSyncState();
  const aligned = planExitIpSync(configWith(), TOKYO_INFO, '198.51.100.9').config;
  const writes: string[] = [];

  const outcome = await runExitIpSync({
    getConfig: async () => aligned,
    saveConfig: async () => { writes.push('config'); },
    saveLocation: async () => { writes.push('location'); },
    // 上一次的定位是旧值（例如手动定位过），坐标与时区都对不上
    getLastLocation: async () => ({ ...tokyoLocation(), latitude: 1.3, longitude: 103.8, timezone: 'Asia/Singapore' }),
    getStoredIp: async () => '198.51.100.9',
    saveStoredIp: async () => { writes.push('ip'); },
    applyNow: async () => { writes.push('apply'); },
    lookup: async () => IPWHO_TOKYO
  });

  assert.equal(outcome.ok && outcome.changed, false);
  assert.deepEqual(writes, ['location', 'apply', 'ip']);
});

test('runExitIpSync 内部异常不会抛出，只记日志', async () => {
  resetExitIpSyncState();
  const logs: unknown[] = [];
  const outcome = await runExitIpSync({
    getConfig: async () => { throw new Error('storage exploded'); },
    saveConfig: async () => undefined,
    saveLocation: async () => undefined,
    getLastLocation: async () => null,
    getStoredIp: async () => '',
    saveStoredIp: async () => undefined,
    applyNow: async () => undefined,
    log: (message, error) => logs.push([message, error])
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.error.includes('storage exploded'), true);
  assert.equal(logs.length, 1);
});

test('ipSyncIntervalMinutes 把周期夹在 5..1440 之间', () => {
  assert.equal(ipSyncIntervalMinutes(configWith({ ipSync: { enabled: true, intervalMinutes: 1, syncLanguage: false } })), 5);
  assert.equal(ipSyncIntervalMinutes(configWith({ ipSync: { enabled: true, intervalMinutes: 99999, syncLanguage: false } })), 1440);
  assert.equal(ipSyncIntervalMinutes(configWith({ ipSync: { enabled: true, intervalMinutes: 30, syncLanguage: false } })), 30);
  assert.equal(ipSyncIntervalMinutes(null), DEFAULT_IP_SYNC.intervalMinutes);
});

test('isIpSyncEnabled 同时看总开关与跟随开关', () => {
  assert.equal(isIpSyncEnabled(configWith()), true);
  assert.equal(isIpSyncEnabled(configWith({ masterEnabled: false })), false);
  assert.equal(isIpSyncEnabled(configWith({ ipSync: { ...DEFAULT_IP_SYNC, enabled: false } })), false);
  assert.equal(isIpSyncEnabled(null), false);
});

function fakeAlarms(existing: { periodInMinutes?: number } | undefined) {
  const calls: string[] = [];
  return {
    calls,
    gateway: {
      get: async (name: string) => { calls.push(`get:${name}`); return existing; },
      create: async (name: string, info: { periodInMinutes: number }) => {
        calls.push(`create:${name}:${info.periodInMinutes}`);
      },
      clear: async (name: string) => { calls.push(`clear:${name}`); }
    }
  };
}

test('ensureIpSyncAlarmFor 关闭时真的 clear', async () => {
  const { calls, gateway } = fakeAlarms({ periodInMinutes: 15 });
  const running = await ensureIpSyncAlarmFor(configWith({ ipSync: { ...DEFAULT_IP_SYNC, enabled: false } }), gateway);
  assert.equal(running, false);
  // 只 clear 不 create：留着的 alarm 会在下一轮把刚关掉的功能再跑一遍
  assert.deepEqual(calls, [`clear:${IP_SYNC_ALARM_NAME}`]);
});

test('ensureIpSyncAlarmFor 开启但没有 alarm 时创建', async () => {
  const { calls, gateway } = fakeAlarms(undefined);
  const running = await ensureIpSyncAlarmFor(configWith({ ipSync: { enabled: true, intervalMinutes: 20, syncLanguage: false } }), gateway);
  assert.equal(running, true);
  assert.deepEqual(calls, [`get:${IP_SYNC_ALARM_NAME}`, `create:${IP_SYNC_ALARM_NAME}:20`]);
});

test('ensureIpSyncAlarmFor 周期一致时不重建', async () => {
  const { calls, gateway } = fakeAlarms({ periodInMinutes: 20 });
  await ensureIpSyncAlarmFor(configWith({ ipSync: { enabled: true, intervalMinutes: 20, syncLanguage: false } }), gateway);
  assert.deepEqual(calls, [`get:${IP_SYNC_ALARM_NAME}`]);
});

test('ensureIpSyncAlarmFor 周期变了要重建', async () => {
  const { calls, gateway } = fakeAlarms({ periodInMinutes: 20 });
  await ensureIpSyncAlarmFor(configWith({ ipSync: { enabled: true, intervalMinutes: 45, syncLanguage: false } }), gateway);
  assert.deepEqual(calls, [`get:${IP_SYNC_ALARM_NAME}`, `create:${IP_SYNC_ALARM_NAME}:45`]);
});

test('国家 → 语言对照表都是合法时区国家的两字母码', () => {
  for (const [code, tag] of Object.entries(COUNTRY_LANGUAGES)) {
    assert.equal(/^[A-Z]{2}$/.test(code), true, `${code} 不是两字母国家码`);
    assert.equal(/^[a-z]{2}-[A-Z]{2}$/.test(tag), true, `${tag} 不是 xx-YY 形状`);
  }
});
test('canonicalCountry 把两字母码与国名折成同一个形状', () => {
  assert.equal(canonicalCountry('US'), 'United States');
  assert.equal(canonicalCountry('us'), 'United States');
  assert.equal(canonicalCountry(' United States '), 'United States');
  assert.equal(canonicalCountry(''), '');
  assert.equal(canonicalCountry('N/A'), 'N/A');
});

test('换接口时国家形状不同不会让 geolocation 每轮都被判"变了"', () => {
  // ipinfo 给 `country: 'US'`，ipwho.is 给 `country: 'United States'`
  const asCode = parseExitIpResponse({
    ip: '203.0.113.4', country: 'US', city: 'Los Angeles', region: 'California',
    latitude: 34.05, longitude: -118.24, timezone: 'America/Los_Angeles'
  });
  const asName = parseExitIpResponse({
    ip: '203.0.113.4', country: 'United States', city: 'Los Angeles', region: 'California',
    latitude: 34.05, longitude: -118.24, timezone: 'America/Los_Angeles'
  });
  assert.ok(asCode && asName);
  assert.equal(asCode.country, asName.country);

  // 配置里已是归一后的国名 + 同一坐标：force 也不该再报 geolocation
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    ipSync: { enabled: true, syncLanguage: false, intervalMinutes: 5 },
    globalProfile: {
      ...DEFAULT_CONFIG.globalProfile,
      timezone: { ...DEFAULT_CONFIG.globalProfile.timezone, mode: 'auto', timezone: 'America/Los_Angeles' },
      geolocation: {
        ...DEFAULT_CONFIG.globalProfile.geolocation,
        mode: 'auto',
        latitude: 34.05,
        longitude: -118.24,
        country: 'United States'
      }
    }
  });
  const plan = planExitIpSync(config, asCode, '203.0.113.3', { force: true });
  assert.deepEqual(plan.layers, ['profile']);
});

// ---------- 手动「从 IP 自动配置」 ----------

const APPLY_TOKYO: ExitIpInfo = {
  ip: '203.0.113.7',
  latitude: 35.6895,
  longitude: 139.6917,
  country: 'Japan',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  timezoneOffset: 540
};

test('planExitIpApply 把坐标/时区钉成 manual —— 点完按钮表单必须看得见新值', () => {
  const plan = planExitIpApply(DEFAULT_CONFIG, APPLY_TOKYO, { now: 1_730_000_000_000 });

  // 关键差异：自动同步写 auto，界面永远显示空框；手动路径必须落 manual
  assert.equal(plan.config.globalProfile.timezone.mode, 'manual');
  assert.equal(plan.config.globalProfile.timezone.timezone, 'Asia/Tokyo');
  assert.equal(plan.config.globalProfile.geolocation.mode, 'manual');
  assert.equal(plan.config.globalProfile.geolocation.latitude, 35.6895);
  assert.equal(plan.config.globalProfile.geolocation.longitude, 139.6917);
  assert.equal(plan.config.globalProfile.geolocation.country, 'Japan');

  // 按钮文案承诺了「+ 语言」：手动路径默认连语言一起改
  assert.equal(plan.config.globalProfile.language.language, 'ja-JP');
  assert.match(plan.config.globalProfile.language.acceptLanguage, /^ja-JP/);

  // 手选预设与真实坐标对不上，清成 null
  assert.equal(plan.config.profile.activeProfileId, null);
  assert.deepEqual([...plan.layers].sort(), ['geolocation', 'language', 'profile', 'timezone']);

  // lastLocation 同步写：auto 档的显示与状态行都读它
  assert.equal(plan.location.latitude, 35.6895);
  assert.equal(plan.location.timezone, 'Asia/Tokyo');
});

test('planExitIpApply 不看「跟随出口 IP」开关（用户是手点的）', () => {
  const off = normalizeConfig({ ...DEFAULT_CONFIG, ipSync: { ...DEFAULT_IP_SYNC, enabled: false } });
  const plan = planExitIpApply(off, APPLY_TOKYO);

  assert.equal(plan.config.globalProfile.timezone.timezone, 'Asia/Tokyo');
  assert.equal(plan.config.globalProfile.geolocation.mode, 'manual');
  // 开关本来就是关的，别被手动配置顺手打开
  assert.equal(plan.config.ipSync.enabled, false);
});

test('planExitIpApply 是幂等的：同一份出口再点一次没有层要改', () => {
  const once = planExitIpApply(DEFAULT_CONFIG, APPLY_TOKYO);
  const twice = planExitIpApply(once.config, APPLY_TOKYO);

  assert.deepEqual(twice.layers, []);
  assert.deepEqual(twice.config.globalProfile, once.config.globalProfile);
});

test('planExitIpApply 可以只改坐标时区、保留用户的语言', () => {
  const plan = planExitIpApply(DEFAULT_CONFIG, APPLY_TOKYO, { syncLanguage: false });

  assert.equal(plan.layers.includes('language'), false);
  assert.equal(plan.config.globalProfile.language.language, DEFAULT_CONFIG.globalProfile.language.language);
  assert.equal(plan.config.globalProfile.timezone.timezone, 'Asia/Tokyo');
});

test('planExitIpApply 对没有语言对照表的国家保持原语言', () => {
  const info: ExitIpInfo = { ...APPLY_TOKYO, country: 'Brazil', countryCode: 'BR', timezone: 'America/Sao_Paulo' };
  const plan = planExitIpApply(DEFAULT_CONFIG, info);

  assert.equal(plan.layers.includes('language'), false);
  assert.equal(plan.config.globalProfile.timezone.timezone, 'America/Sao_Paulo');
});

test('lookupExitIp 用第一个能解析的接口，失败时把原因拼起来', async () => {
  const urls: string[] = [];
  const ok = await lookupExitIp(async (url: string) => {
    urls.push(url);
    if (url.includes('ipwho.is')) throw new Error('timeout');
    if (url.includes('ipapi.co')) return { nope: true };
    return IPWHO_TOKYO;
  });

  assert.ok('info' in ok, '第三个接口可用时不该带着错误返回');
  if (!('info' in ok)) throw new Error('unreachable');
  assert.equal(ok.info.ip, APPLY_TOKYO.ip);
  assert.equal(urls.length, 3, '前两个接口失败/无用时要继续兜底');

  const failed = await lookupExitIp(async () => ({ nope: true }));
  assert.ok('error' in failed);
  assert.match(failed.error, /exit IP lookup failed/);
  assert.match(failed.error, /no usable exit ip/);
});
