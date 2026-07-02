// Shared configuration primitives for browser runtime and Node-side tests.
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
      return value.map((item) => normalizeString(item)).filter(Boolean);
    }
    return String(value || '').split(',').map((item) => normalizeString(item)).filter(Boolean);
  }

  function normalizeLanguage(config) {
    const input = config || {};
    const languages = normalizeLanguages(input.languages);
    const language = normalizeString(input.language || languages[0] || DEFAULT_LANGUAGE.language);
    const normalizedLanguages = languages.length ? languages : clone(DEFAULT_LANGUAGE.languages);
    if (language && !normalizedLanguages.includes(language)) {
      normalizedLanguages.unshift(language);
    }
    const acceptLanguage = normalizeString(input.acceptLanguage)
      || normalizedLanguages
        .map((item, index) => (index === 0 ? item : `${item};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`))
        .join(',');

    return {
      enabled: input.enabled !== false,
      mode: input.mode === 'custom' ? 'custom' : 'preset',
      language,
      languages: normalizedLanguages,
      acceptLanguage
    };
  }

  function normalizeTimezone(config) {
    const input = config || {};
    return {
      enabled: input.enabled !== false,
      mode: input.mode === 'manual' ? 'manual' : 'auto',
      timezone: normalizeString(input.timezone)
    };
  }

  function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeGeolocation(config) {
    const input = config || {};
    return {
      enabled: input.enabled !== false,
      mode: input.mode === 'manual' ? 'manual' : 'auto',
      latitude: normalizeNumber(input.latitude),
      longitude: normalizeNumber(input.longitude),
      country: normalizeString(input.country)
    };
  }

  function normalizeWebRtc(config) {
    const input = config || {};
    const globalMode = input.globalMode === 'off' || input.globalMode === 'default'
      ? 'default'
      : input.globalMode === 'compatible'
        ? 'compatible'
        : 'strict';
    return { globalMode };
  }

  function normalizeOverride(override) {
    const input = override || {};
    const mode = input.mode === 'override'
      ? 'override'
      : input.mode === 'disable'
        ? 'disable'
        : 'inherit';
    return {
      mode,
      value: input.value === undefined ? null : input.value
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
    return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }

  function normalizeRule(rule) {
    const input = rule || {};
    return {
      id: normalizeString(input.id) || `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      domain: normalizeDomain(input.domain),
      enabled: input.enabled !== false,
      overrides: {
        language: normalizeOverride(input.overrides && input.overrides.language),
        timezone: normalizeOverride(input.overrides && input.overrides.timezone),
        geolocation: normalizeOverride(input.overrides && input.overrides.geolocation)
      }
    };
  }

  function normalizeConfig(config) {
    const input = config || {};
    const globalProfile = input.globalProfile || {};
    const rules = Array.isArray(input.rules) ? input.rules.map(normalizeRule) : [];
    return {
      schemaVersion: 1,
      masterEnabled: input.masterEnabled !== false,
      globalProfile: {
        language: normalizeLanguage(globalProfile.language || DEFAULT_LANGUAGE),
        timezone: normalizeTimezone(globalProfile.timezone || DEFAULT_TIMEZONE),
        geolocation: normalizeGeolocation(globalProfile.geolocation || DEFAULT_GEOLOCATION)
      },
      webRtc: normalizeWebRtc(input.webRtc || DEFAULT_WEBRTC),
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

  function getTimezoneOffsetMinutes(timezone, dateInput) {
    const value = normalizeString(timezone);
    const date = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput || Date.now());
    if (!value || Number.isNaN(date.getTime())) return null;

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: value,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const parts = {};
      formatter.formatToParts(date).forEach((part) => {
        if (part.type !== 'literal') parts[part.type] = part.value;
      });
      const asUTC = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second)
      );
      return Math.round((date.getTime() - asUTC) / 60000);
    } catch (error) {
      return null;
    }
  }

  function formatTimezoneOffsetMinutes(offset) {
    if (!Number.isFinite(Number(offset))) return null;
    const normalized = Number(offset);
    const sign = normalized <= 0 ? '+' : '-';
    const abs = Math.abs(normalized);
    return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
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
    OLD_EXTENSION_ENABLED_KEY,
    OLD_LANGUAGE_KEY,
    OLD_TIMEZONE_KEY,
    OLD_WEBRTC_KEY,
    DEFAULT_LANGUAGE,
    DEFAULT_TIMEZONE,
    DEFAULT_GEOLOCATION,
    DEFAULT_WEBRTC,
    DEFAULT_SIGNAL_OVERRIDE,
    DEFAULT_CONFIG,
    LANGUAGE_PRESETS,
    TIMEZONE_PRESETS,
    clone,
    normalizeString,
    normalizeLanguages,
    normalizeLanguage,
    normalizeTimezone,
    normalizeNumber,
    normalizeGeolocation,
    normalizeWebRtc,
    normalizeOverride,
    parseHostname,
    normalizeDomain,
    isValidDomain,
    normalizeRule,
    normalizeConfig,
    validateTimezone,
    getTimezoneOffsetMinutes,
    formatTimezoneOffsetMinutes,
    createRule
  };

  root.IPGeoConfigBase = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
