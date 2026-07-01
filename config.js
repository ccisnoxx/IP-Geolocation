// Shared configuration, validation, and matching helpers for the extension.
(function(root) {
  const SITE_CONFIG_KEY = 'siteSpoofConfig';
  const LAST_LOCATION_KEY = 'lastLocation';
  const OLD_EXTENSION_ENABLED_KEY = 'extensionEnabled';
  const OLD_LANGUAGE_KEY = 'languageConfig';
  const OLD_TIMEZONE_KEY = 'timezoneConfig';
  const OLD_WEBRTC_KEY = 'webRtcConfig';

  const DEFAULT_LANGUAGE = {
    enabled: true,
    mode: 'preset',
    language: 'en-US',
    languages: ['en-US', 'en'],
    acceptLanguage: 'en-US,en;q=0.9'
  };
  const DEFAULT_TIMEZONE = {
    enabled: true,
    mode: 'auto',
    timezone: ''
  };
  const DEFAULT_GEOLOCATION = {
    enabled: true,
    mode: 'auto',
    latitude: null,
    longitude: null,
    country: ''
  };
  const DEFAULT_WEBRTC = {
    globalMode: 'strict'
  };
  const DEFAULT_SIGNAL_OVERRIDE = {
    mode: 'inherit',
    value: null
  };
  const DEFAULT_CONFIG = {
    schemaVersion: 1,
    masterEnabled: true,
    globalProfile: {
      language: DEFAULT_LANGUAGE,
      timezone: DEFAULT_TIMEZONE,
      geolocation: DEFAULT_GEOLOCATION
    },
    webRtc: DEFAULT_WEBRTC,
    rules: []
  };

  const LANGUAGE_PRESETS = [
    { label: 'English (US)', language: 'en-US', languages: ['en-US', 'en'], acceptLanguage: 'en-US,en;q=0.9' },
    { label: 'English (UK)', language: 'en-GB', languages: ['en-GB', 'en'], acceptLanguage: 'en-GB,en;q=0.9' },
    { label: '中文 (简体)', language: 'zh-CN', languages: ['zh-CN', 'zh', 'en'], acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8' },
    { label: '中文 (繁体)', language: 'zh-TW', languages: ['zh-TW', 'zh', 'en'], acceptLanguage: 'zh-TW,zh;q=0.9,en;q=0.8' },
    { label: '日本語', language: 'ja-JP', languages: ['ja-JP', 'ja', 'en'], acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8' },
    { label: '한국어', language: 'ko-KR', languages: ['ko-KR', 'ko', 'en'], acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8' },
    { label: 'Deutsch', language: 'de-DE', languages: ['de-DE', 'de', 'en'], acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8' },
    { label: 'Français', language: 'fr-FR', languages: ['fr-FR', 'fr', 'en'], acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8' }
  ];

  const TIMEZONE_PRESETS = [
    'UTC',
    'America/Los_Angeles',
    'America/New_York',
    'America/Chicago',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Singapore',
    'Australia/Sydney'
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeLanguages(value) {
    if (Array.isArray(value)) {
      return value.map(item => normalizeString(item)).filter(Boolean);
    }
    return String(value || '').split(',').map(item => normalizeString(item)).filter(Boolean);
  }

  function normalizeLanguage(config = {}) {
    const languages = normalizeLanguages(config.languages);
    const language = normalizeString(config.language || languages[0] || DEFAULT_LANGUAGE.language);
    const normalizedLanguages = languages.length ? languages : clone(DEFAULT_LANGUAGE.languages);
    if (language && !normalizedLanguages.includes(language)) {
      normalizedLanguages.unshift(language);
    }
    const acceptLanguage = normalizeString(config.acceptLanguage)
      || normalizedLanguages.map((item, index) => index === 0 ? item : `${item};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`).join(',');

    return {
      enabled: config.enabled !== false,
      mode: config.mode === 'custom' ? 'custom' : 'preset',
      language,
      languages: normalizedLanguages,
      acceptLanguage
    };
  }

  function normalizeTimezone(config = {}) {
    return {
      enabled: config.enabled !== false,
      mode: config.mode === 'manual' ? 'manual' : 'auto',
      timezone: normalizeString(config.timezone)
    };
  }

  function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeGeolocation(config = {}) {
    return {
      enabled: config.enabled !== false,
      mode: config.mode === 'manual' ? 'manual' : 'auto',
      latitude: normalizeNumber(config.latitude),
      longitude: normalizeNumber(config.longitude),
      country: normalizeString(config.country)
    };
  }

  function normalizeWebRtc(config = {}) {
    const globalMode = config.globalMode === 'off'
      ? 'off'
      : config.globalMode === 'compatible'
        ? 'compatible'
        : 'strict';
    return { globalMode };
  }

  function normalizeOverride(override = {}) {
    const mode = override.mode === 'override'
      ? 'override'
      : override.mode === 'disable'
        ? 'disable'
        : 'inherit';
    return {
      mode,
      value: override.value === undefined ? null : override.value
    };
  }

  function parseHostname(input) {
    const raw = normalizeString(input).toLowerCase();
    if (!raw) return '';
    try {
      return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^\.+|\.+$/g, '');
    } catch (error) {
      return raw.split('/')[0].split(':')[0].replace(/^\.+|\.+$/g, '');
    }
  }

  function normalizeDomain(input) {
    return parseHostname(input);
  }

  function isValidDomain(domain) {
    if (!domain || domain.includes('*') || domain.length > 253) return false;
    if (domain === 'localhost') return true;
    const labels = domain.split('.');
    if (labels.length < 2) return false;
    return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }

  function normalizeRule(rule = {}) {
    return {
      id: normalizeString(rule.id) || `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      domain: normalizeDomain(rule.domain),
      enabled: rule.enabled !== false,
      overrides: {
        language: normalizeOverride(rule.overrides && rule.overrides.language),
        timezone: normalizeOverride(rule.overrides && rule.overrides.timezone),
        geolocation: normalizeOverride(rule.overrides && rule.overrides.geolocation)
      }
    };
  }

  function normalizeConfig(config = {}) {
    const globalProfile = config.globalProfile || {};
    const rules = Array.isArray(config.rules) ? config.rules.map(normalizeRule) : [];
    return {
      schemaVersion: 1,
      masterEnabled: config.masterEnabled !== false,
      globalProfile: {
        language: normalizeLanguage(globalProfile.language || DEFAULT_LANGUAGE),
        timezone: normalizeTimezone(globalProfile.timezone || DEFAULT_TIMEZONE),
        geolocation: normalizeGeolocation(globalProfile.geolocation || DEFAULT_GEOLOCATION)
      },
      webRtc: normalizeWebRtc(config.webRtc || DEFAULT_WEBRTC),
      rules
    };
  }

  function validateTimezone(timezone) {
    const value = normalizeString(timezone);
    if (!value) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
      return true;
    } catch (error) {
      return false;
    }
  }

  function validateLanguage(language, path, errors) {
    if (!normalizeString(language.language)) {
      errors.push(`${path}: language is required`);
    }
    if (!Array.isArray(language.languages) || language.languages.length === 0 || language.languages.some(item => !normalizeString(item))) {
      errors.push(`${path}: navigator.languages must not be empty`);
    }
    if (!normalizeString(language.acceptLanguage)) {
      errors.push(`${path}: Accept-Language is required`);
    }
  }

  function validateGeolocation(geolocation, path, errors) {
    if (geolocation.mode !== 'manual') return;
    if (!Number.isFinite(geolocation.latitude) || geolocation.latitude < -90 || geolocation.latitude > 90) {
      errors.push(`${path}: latitude must be between -90 and 90`);
    }
    if (!Number.isFinite(geolocation.longitude) || geolocation.longitude < -180 || geolocation.longitude > 180) {
      errors.push(`${path}: longitude must be between -180 and 180`);
    }
  }

  function validateConfig(config) {
    const normalized = normalizeConfig(config);
    const errors = [];
    const seen = new Set();

    validateLanguage(normalized.globalProfile.language, 'global language', errors);
    if (normalized.globalProfile.timezone.mode === 'manual' && !validateTimezone(normalized.globalProfile.timezone.timezone)) {
      errors.push('global timezone: custom timezone must be a valid IANA timezone');
    }
    validateGeolocation(normalized.globalProfile.geolocation, 'global geolocation', errors);

    normalized.rules.forEach((rule, index) => {
      const path = `rule ${index + 1}`;
      if (!isValidDomain(rule.domain)) {
        errors.push(`${path}: domain is invalid`);
      }
      if (seen.has(rule.domain)) {
        errors.push(`${path}: duplicate domain`);
      }
      seen.add(rule.domain);

      if (rule.overrides.language.mode === 'override') {
        validateLanguage(normalizeLanguage(rule.overrides.language.value || {}), `${path} language`, errors);
      }
      if (rule.overrides.timezone.mode === 'override') {
        const timezone = normalizeTimezone(rule.overrides.timezone.value || {});
        if (timezone.mode === 'manual' && !validateTimezone(timezone.timezone)) {
          errors.push(`${path} timezone: custom timezone must be a valid IANA timezone`);
        }
      }
      if (rule.overrides.geolocation.mode === 'override') {
        validateGeolocation(normalizeGeolocation(rule.overrides.geolocation.value || { mode: 'manual' }), `${path} geolocation`, errors);
      }
    });

    return {
      ok: errors.length === 0,
      errors,
      config: normalized
    };
  }

  function domainMatches(hostname, domain) {
    const host = parseHostname(hostname);
    return host === domain || host.endsWith(`.${domain}`);
  }

  function findMatchingRule(config, hostname) {
    const normalized = normalizeConfig(config);
    return normalized.rules
      .filter(rule => rule.enabled && domainMatches(hostname, rule.domain))
      .sort((a, b) => b.domain.length - a.domain.length)[0] || null;
  }

  function resolveSignal(globalValue, override, normalizer) {
    if (!override || override.mode === 'inherit') {
      return globalValue.enabled ? globalValue : null;
    }
    if (override.mode === 'disable') return null;
    return normalizer(override.value || {});
  }

  function resolveTimezoneValue(timezoneConfig, geolocationConfig, lastLocation) {
    if (!timezoneConfig) return null;
    if (timezoneConfig.mode === 'manual' && timezoneConfig.timezone) {
      return {
        timezone: timezoneConfig.timezone,
        timezoneOffset: null
      };
    }
    if (geolocationConfig && geolocationConfig.timezone) {
      return {
        timezone: geolocationConfig.timezone,
        timezoneOffset: null
      };
    }
    return {
      timezone: lastLocation && lastLocation.timezone ? lastLocation.timezone : null,
      timezoneOffset: lastLocation && Number.isFinite(Number(lastLocation.timezoneOffset))
        ? Number(lastLocation.timezoneOffset)
        : null
    };
  }

  function resolveGeolocationValue(geolocationConfig, lastLocation) {
    if (!geolocationConfig) return null;
    if (geolocationConfig.mode === 'manual') {
      return {
        latitude: geolocationConfig.latitude,
        longitude: geolocationConfig.longitude,
        country: geolocationConfig.country || ''
      };
    }
    if (!lastLocation || !Number.isFinite(Number(lastLocation.latitude)) || !Number.isFinite(Number(lastLocation.longitude))) {
      return null;
    }
    return {
      latitude: Number(lastLocation.latitude),
      longitude: Number(lastLocation.longitude),
      country: lastLocation.country || '',
      timezone: lastLocation.timezone || null,
      timezoneOffset: Number.isFinite(Number(lastLocation.timezoneOffset)) ? Number(lastLocation.timezoneOffset) : null
    };
  }

  function getEffectiveProfile(config, hostname, lastLocation) {
    const normalized = normalizeConfig(config);
    if (!normalized.masterEnabled) {
      return { matched: false, rule: null, payload: null, errors: [] };
    }

    const rule = findMatchingRule(normalized, hostname);
    if (!rule) {
      return { matched: false, rule: null, payload: null, errors: [] };
    }

    const language = resolveSignal(normalized.globalProfile.language, rule.overrides.language, normalizeLanguage);
    const timezoneConfig = resolveSignal(normalized.globalProfile.timezone, rule.overrides.timezone, normalizeTimezone);
    const geolocationConfig = resolveSignal(normalized.globalProfile.geolocation, rule.overrides.geolocation, normalizeGeolocation);
    const geolocation = resolveGeolocationValue(geolocationConfig, lastLocation);
    const timezone = resolveTimezoneValue(timezoneConfig, geolocation, lastLocation);
    const errors = [];

    if (geolocationConfig && !geolocation) {
      errors.push('geolocation is enabled but no valid coordinates are available');
    }
    if (timezoneConfig && !timezone.timezone) {
      errors.push('timezone is enabled but no valid timezone is available');
    }

    if (errors.length) {
      return { matched: true, rule, payload: null, errors };
    }

    return {
      matched: true,
      rule,
      payload: {
        extensionEnabled: true,
        ruleId: rule.id,
        domain: rule.domain,
        geolocation,
        latitude: geolocation && geolocation.latitude,
        longitude: geolocation && geolocation.longitude,
        timezone: timezone && timezone.timezone,
        timezoneOffset: timezone && timezone.timezoneOffset,
        languageConfig: language,
        timezoneConfig: timezoneConfig ? {
          enabled: true,
          mode: timezoneConfig.mode,
          timezone: timezoneConfig.timezone
        } : { enabled: false, mode: 'auto', timezone: '' }
      },
      errors: []
    };
  }

  function migrateLegacyConfig(storageData = {}) {
    if (storageData[SITE_CONFIG_KEY]) {
      return normalizeConfig(storageData[SITE_CONFIG_KEY]);
    }
    return normalizeConfig({
      masterEnabled: storageData[OLD_EXTENSION_ENABLED_KEY] !== false,
      globalProfile: {
        language: normalizeLanguage(storageData[OLD_LANGUAGE_KEY] || DEFAULT_LANGUAGE),
        timezone: normalizeTimezone(storageData[OLD_TIMEZONE_KEY] || DEFAULT_TIMEZONE),
        geolocation: DEFAULT_GEOLOCATION
      },
      webRtc: normalizeWebRtc(storageData[OLD_WEBRTC_KEY] || DEFAULT_WEBRTC),
      rules: []
    });
  }

  function createRule(domain) {
    return normalizeRule({
      id: `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      domain,
      enabled: true,
      overrides: {
        language: DEFAULT_SIGNAL_OVERRIDE,
        timezone: DEFAULT_SIGNAL_OVERRIDE,
        geolocation: DEFAULT_SIGNAL_OVERRIDE
      }
    });
  }

  const api = {
    SITE_CONFIG_KEY,
    LAST_LOCATION_KEY,
    DEFAULT_CONFIG,
    DEFAULT_LANGUAGE,
    DEFAULT_TIMEZONE,
    DEFAULT_GEOLOCATION,
    DEFAULT_WEBRTC,
    LANGUAGE_PRESETS,
    TIMEZONE_PRESETS,
    clone,
    normalizeConfig,
    normalizeLanguage,
    normalizeTimezone,
    normalizeGeolocation,
    normalizeWebRtc,
    normalizeDomain,
    normalizeRule,
    isValidDomain,
    validateConfig,
    validateTimezone,
    findMatchingRule,
    getEffectiveProfile,
    migrateLegacyConfig,
    createRule
  };

  root.IPGeoConfig = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
