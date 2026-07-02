// Public configuration API assembled from shared config modules.
(function(root) {
  const base = root.IPGeoConfigBase || (
    typeof module !== 'undefined' && module.exports
      ? require('./shared/config-base')
      : null
  );
  const profile = root.IPGeoConfigProfile || (
    typeof module !== 'undefined' && module.exports
      ? require('./shared/config-profile')
      : null
  );

  if (!base || !profile) {
    throw new Error('config.js requires shared/config-base.js and shared/config-profile.js');
  }

  const api = {
    SITE_CONFIG_KEY: base.SITE_CONFIG_KEY,
    LAST_LOCATION_KEY: base.LAST_LOCATION_KEY,
    DEFAULT_CONFIG: base.DEFAULT_CONFIG,
    DEFAULT_LANGUAGE: base.DEFAULT_LANGUAGE,
    DEFAULT_TIMEZONE: base.DEFAULT_TIMEZONE,
    DEFAULT_GEOLOCATION: base.DEFAULT_GEOLOCATION,
    DEFAULT_WEBRTC: base.DEFAULT_WEBRTC,
    LANGUAGE_PRESETS: base.LANGUAGE_PRESETS,
    TIMEZONE_PRESETS: base.TIMEZONE_PRESETS,
    clone: base.clone,
    normalizeConfig: base.normalizeConfig,
    normalizeLanguage: base.normalizeLanguage,
    normalizeTimezone: base.normalizeTimezone,
    normalizeGeolocation: base.normalizeGeolocation,
    normalizeWebRtc: base.normalizeWebRtc,
    normalizeDomain: base.normalizeDomain,
    normalizeRule: base.normalizeRule,
    isValidDomain: base.isValidDomain,
    validateConfig: profile.validateConfig,
    validateTimezone: base.validateTimezone,
    getTimezoneOffsetMinutes: base.getTimezoneOffsetMinutes,
    formatTimezoneOffsetMinutes: base.formatTimezoneOffsetMinutes,
    findMatchingRule: profile.findMatchingRule,
    getEnabledRuleDomains: profile.getEnabledRuleDomains,
    buildContentScriptMatchesForDomain: profile.buildContentScriptMatchesForDomain,
    getContentScriptMatches: profile.getContentScriptMatches,
    isUrlMatchedByEnabledRule: profile.isUrlMatchedByEnabledRule,
    getEffectiveProfile: profile.getEffectiveProfile,
    migrateLegacyConfig: profile.migrateLegacyConfig,
    createRule: base.createRule
  };

  root.IPGeoConfig = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
