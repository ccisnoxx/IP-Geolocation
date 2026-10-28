// 只检查外部结构；迁移和内部规范化不能替代这个入口。
type Check = (value: unknown, path: string, errors: string[]) => void;
const scalar = (kind: 'string' | 'boolean' | 'number'): Check => (value, path, errors) => {
  if (typeof value !== kind || (kind === 'number' && !Number.isFinite(value))) errors.push(`${path}：请提供${kind === 'boolean' ? '布尔值' : kind === 'number' ? '有限数值' : '字符串'}`);
};
const string = scalar('string'), boolean = scalar('boolean'), number = scalar('number');
const optional = (check: Check): Check => (value, path, errors) => { if (value !== undefined) check(value, path, errors); };
const nullable = (check: Check): Check => (value, path, errors) => { if (value !== null) check(value, path, errors); };
const enumeration = (...values: readonly unknown[]): Check => (value, path, errors) => {
  if (!values.includes(value)) errors.push(`${path}：请选择 ${values.join(' / ')}`);
};
const array = (check: Check): Check => (value, path, errors) => {
  if (!Array.isArray(value)) { errors.push(`${path}：请提供数组`); return; }
  value.forEach((item, index) => check(item, `${path}[${index}]`, errors));
};
const object = (fields: Record<string, Check>): Check => (value, path, errors) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}：请提供配置对象`); return; }
  const input = value as Record<string, unknown>;
  for (const [key, check] of Object.entries(fields)) check(input[key], path ? `${path}.${key}` : key, errors);
};
const partial = (fields: Record<string, Check>) => object(Object.fromEntries(Object.entries(fields).map(([key, check]) => [key, optional(check)])));
const positive: Check = (value, path, errors) => {
  number(value, path, errors);
  if (typeof value === 'number' && value <= 0) errors.push(`${path}：必须大于 0`);
};
const nonnegative: Check = (value, path, errors) => {
  number(value, path, errors);
  if (typeof value === 'number' && value < 0) errors.push(`${path}：不能小于 0`);
};
const coordinate = (limit: number): Check => (value, path, errors) => {
  number(value, path, errors);
  if (typeof value === 'number' && Math.abs(value) > limit) errors.push(`${path}：必须在 [-${limit}, ${limit}] 范围内`);
};
const language = { enabled: boolean, mode: enumeration('preset', 'custom'), language: string, languages: array(string), acceptLanguage: optional(string) };
const timezone = { enabled: boolean, mode: enumeration('auto', 'manual'), timezone: string };
const geolocation = {
  enabled: boolean, mode: enumeration('auto', 'manual'), latitude: nullable(coordinate(90)), longitude: nullable(coordinate(180)),
  accuracy: positive, country: string, randomize: boolean, randomRadiusMeters: nonnegative, spoofPermission: boolean,
  history: array(object({ latitude: coordinate(90), longitude: coordinate(180), accuracy: positive, label: optional(string), createdAt: number }))
};
const fontExposure = object({ enabled: boolean, mode: enumeration('vendor-software', 'custom'), blockedFamilies: array(string),
  canvasSpoof: optional(object({ enabled: boolean, platform: enumeration('windows', 'macos') })) });
const override = (fields: Record<string, Check>) => object({ mode: enumeration('inherit', 'override', 'disable'), value: nullable(partial(fields)) });
const profile = object({
  id: string, name: string, description: optional(string),
  geolocation: object({ latitude: coordinate(90), longitude: coordinate(180), accuracy: positive, country: optional(string) }),
  language: object({ language: string, languages: array(string), enabled: optional(boolean), mode: optional(language.mode), acceptLanguage: optional(string) }),
  timezone: object({ timezone: string })
});
const exitProfile = object({
  id: string, name: string, verification: enumeration('verified', 'unverified'), publicIp: nullable(string),
  latitude: coordinate(90), longitude: coordinate(180), country: string, countryCode: optional(nullable(string)),
  timezone: nullable(string), provider: nullable(string), verifiedAt: nullable(positive)
});
const legacyCoordinate: Check = (value, path, errors) => {
  if (value !== null && value !== '' && typeof value !== 'number') errors.push(`${path}：旧坐标必须是数值或空值`);
};
const canvas = partial({ enabled: boolean, spoofFonts: boolean, targetFonts: array(string) });
const ruleFields = { id: string, domain: string, enabled: boolean, exitLocationProfileId: nullable(string),
  compatibilityPreset: optional(enumeration('native', 'consistency', 'full')),
  overrides: object({ language: override(language), timezone: override(timezone), geolocation: override(geolocation) }) };
const configFields = {
  schemaVersion: enumeration(2, 3), intlMode: enumeration('strict', 'compatible'), masterEnabled: boolean, debugMode: boolean,
  globalProfile: object({ language: object(language), timezone: object(timezone), geolocation: object(geolocation) }),
  webRtc: object({ globalMode: enumeration('default', 'compatible', 'strict') }),
  fontExposure: optional(fontExposure), canvas: optional(canvas),
  profile: object({ activeProfileId: nullable(string), profiles: array(profile) }), exitLocationProfiles: array(exitProfile),
  rules: array(object(ruleFields))
};

export function getConfigInputErrors(value: unknown): string[] {
  const errors: string[] = [];
  const isV2 = value !== null && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 2;
  object({ ...configFields, intlMode: isV2 ? optional(configFields.intlMode) : configFields.intlMode })(value, '', errors);
  // 旧 v3 尚无 fontExposure 时只补关闭默认；其余核心结构必须完整。
  return errors;
}

// 旧键只有历史格式允许缺字段；存在的字段仍须验证，不能把损坏值解释为启用。
export function getLegacyConfigErrors(value: unknown, kind: 'v1' | 'vanishme' | 'keys'): string[] {
  const errors: string[] = [];
  const legacyWebRtc = partial({ globalMode: enumeration('default', 'compatible', 'strict', 'off'),
    policy: enumeration('default', 'off', 'default_public_interface_only', 'disable_non_proxied_udp'), enabled: boolean });
  // 历史定位允许空/非有限坐标，转换器将其保留为 auto，绝不补成零坐标。
  const legacyFields = {
    globalEnabled: boolean, debugMode: boolean, matchMode: enumeration('whitelist', 'blacklist'), domainList: array(string),
    language: partial(language), timezone: partial(timezone), geolocation: partial({ ...geolocation, latitude: legacyCoordinate, longitude: legacyCoordinate }), webrtc: legacyWebRtc, canvas,
    profile: configFields.profile,
    siteRules: ((input, path, list) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) { list.push(`${path}：请提供对象`); return; }
      for (const [key, rule] of Object.entries(input)) partial({ enabled: boolean })(rule, `${path}.${key}`, list);
    }) satisfies Check
  };
  if (kind === 'v1') {
    object({ ...configFields, schemaVersion: enumeration(1), exitLocationProfiles: optional(configFields.exitLocationProfiles),
      intlMode: optional(configFields.intlMode), rules: array(object({ ...ruleFields, exitLocationProfileId: optional(ruleFields.exitLocationProfileId) })) })(value, '', errors);
  } else if (kind === 'vanishme') {
    partial(legacyFields)(value, 'bpg_config', errors);
    if (value && typeof value === 'object' && !Object.keys(legacyFields).some(key => key in value)) errors.push('bpg_config：缺少旧配置字段');
  } else {
    partial({ extensionEnabled: boolean, languageConfig: partial(language), timezoneConfig: partial(timezone), webRtcConfig: legacyWebRtc,
      lastLocation: object({ latitude: coordinate(90), longitude: coordinate(180), country: optional(string), timezone: optional(nullable(string)) }) })(value, '', errors);
  }
  return errors;
}
