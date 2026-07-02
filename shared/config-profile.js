// Shared configuration validation and profile resolution helpers.
(function(root) {
  const base = root.IPGeoConfigBase || (
    typeof module !== 'undefined' && module.exports
      ? require('./config-base')
      : null
  );

  if (!base) {
    throw new Error('IPGeoConfigBase is required before config-profile.js');
  }

  function validateLanguage(language, path, errors) {
    if (!base.normalizeString(language.language)) {
      errors.push(`${path}: language is required`);
    }
    if (
      !Array.isArray(language.languages)
      || language.languages.length === 0
      || language.languages.some((item) => !base.normalizeString(item))
    ) {
      errors.push(`${path}: navigator.languages must not be empty`);
    }
    if (!base.normalizeString(language.acceptLanguage)) {
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
    const normalized = base.normalizeConfig(config);
    const errors = [];
    const seen = new Set();

    validateLanguage(normalized.globalProfile.language, 'global language', errors);
    if (
      normalized.globalProfile.timezone.mode === 'manual'
      && !base.validateTimezone(normalized.globalProfile.timezone.timezone)
    ) {
      errors.push('global timezone: custom timezone must be a valid IANA timezone');
    }
    validateGeolocation(normalized.globalProfile.geolocation, 'global geolocation', errors);

    normalized.rules.forEach((rule, index) => {
      const path = `rule ${index + 1}`;
      if (!base.isValidDomain(rule.domain)) {
        errors.push(`${path}: domain is invalid`);
      }
      if (seen.has(rule.domain)) {
        errors.push(`${path}: duplicate domain`);
      }
      seen.add(rule.domain);

      if (rule.overrides.language.mode === 'override') {
        validateLanguage(base.normalizeLanguage(rule.overrides.language.value || {}), `${path} language`, errors);
      }
      if (rule.overrides.timezone.mode === 'override') {
        const timezone = base.normalizeTimezone(rule.overrides.timezone.value || {});
        if (timezone.mode === 'manual' && !base.validateTimezone(timezone.timezone)) {
          errors.push(`${path} timezone: custom timezone must be a valid IANA timezone`);
        }
      }
      if (rule.overrides.geolocation.mode === 'override') {
        validateGeolocation(
          base.normalizeGeolocation(rule.overrides.geolocation.value || { mode: 'manual' }),
          `${path} geolocation`,
          errors
        );
      }
    });

    return {
      ok: errors.length === 0,
      errors,
      config: normalized
    };
  }

  function domainMatches(hostname, domain) {
    const host = base.parseHostname(hostname);
    return host === domain || host.endsWith(`.${domain}`);
  }

  function findMatchingRule(config, hostname) {
    const normalized = base.normalizeConfig(config);
    return normalized.rules
      .filter((rule) => rule.enabled && domainMatches(hostname, rule.domain))
      .sort((a, b) => b.domain.length - a.domain.length)[0] || null;
  }

  function getEnabledRuleDomains(config) {
    const normalized = base.normalizeConfig(config);
    if (!normalized.masterEnabled) return [];

    const seen = new Set();
    return normalized.rules.reduce((domains, rule) => {
      if (!rule.enabled || !rule.domain || seen.has(rule.domain)) return domains;
      seen.add(rule.domain);
      domains.push(rule.domain);
      return domains;
    }, []);
  }

  function buildContentScriptMatchesForDomain(domain) {
    const normalized = base.normalizeDomain(domain);
    if (!normalized) return [];

    const patterns = [`*://${normalized}/*`];
    if (normalized !== 'localhost') {
      patterns.push(`*://*.${normalized}/*`);
    }
    return patterns;
  }

  function getContentScriptMatches(config) {
    return getEnabledRuleDomains(config).reduce((matches, domain) => (
      matches.concat(buildContentScriptMatchesForDomain(domain))
    ), []);
  }

  function isUrlMatchedByEnabledRule(config, url) {
    const normalized = base.normalizeConfig(config);
    if (!normalized.masterEnabled) return false;
    const hostname = base.parseHostname(url);
    if (!hostname) return false;

    return normalized.rules.some((rule) => rule.enabled && domainMatches(hostname, rule.domain));
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
        source: 'manual'
      };
    }
    if (geolocationConfig && geolocationConfig.timezone) {
      return {
        timezone: geolocationConfig.timezone,
        source: 'lastLocation'
      };
    }
    return {
      timezone: lastLocation && lastLocation.timezone ? lastLocation.timezone : null,
      source: lastLocation && lastLocation.timezone ? 'lastLocation' : null
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
    if (
      !lastLocation
      || !Number.isFinite(Number(lastLocation.latitude))
      || !Number.isFinite(Number(lastLocation.longitude))
    ) {
      return null;
    }
    return {
      latitude: Number(lastLocation.latitude),
      longitude: Number(lastLocation.longitude),
      country: lastLocation.country || '',
      timezone: lastLocation.timezone || null
    };
  }

  function getEffectiveProfile(config, hostname, lastLocation) {
    const normalized = base.normalizeConfig(config);
    if (!normalized.masterEnabled) {
      return { matched: false, rule: null, payload: null, errors: [] };
    }

    const rule = findMatchingRule(normalized, hostname);
    if (!rule) {
      return { matched: false, rule: null, payload: null, errors: [] };
    }

    const language = resolveSignal(normalized.globalProfile.language, rule.overrides.language, base.normalizeLanguage);
    const timezoneConfig = resolveSignal(normalized.globalProfile.timezone, rule.overrides.timezone, base.normalizeTimezone);
    const geolocationConfig = resolveSignal(normalized.globalProfile.geolocation, rule.overrides.geolocation, base.normalizeGeolocation);
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
        timezoneSource: timezone && timezone.source,
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

  function migrateLegacyConfig(storageData) {
    const input = storageData || {};
    if (input[base.SITE_CONFIG_KEY]) {
      return base.normalizeConfig(input[base.SITE_CONFIG_KEY]);
    }
    return base.normalizeConfig({
      masterEnabled: input[base.OLD_EXTENSION_ENABLED_KEY] !== false,
      globalProfile: {
        language: base.normalizeLanguage(input[base.OLD_LANGUAGE_KEY] || base.DEFAULT_LANGUAGE),
        timezone: base.normalizeTimezone(input[base.OLD_TIMEZONE_KEY] || base.DEFAULT_TIMEZONE),
        geolocation: base.DEFAULT_GEOLOCATION
      },
      webRtc: base.normalizeWebRtc(input[base.OLD_WEBRTC_KEY] || base.DEFAULT_WEBRTC),
      rules: []
    });
  }

  const api = {
    validateLanguage,
    validateGeolocation,
    validateConfig,
    domainMatches,
    findMatchingRule,
    getEnabledRuleDomains,
    buildContentScriptMatchesForDomain,
    getContentScriptMatches,
    isUrlMatchedByEnabledRule,
    resolveSignal,
    resolveTimezoneValue,
    resolveGeolocationValue,
    getEffectiveProfile,
    migrateLegacyConfig
  };

  root.IPGeoConfigProfile = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
