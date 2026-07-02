// Shared UI formatting helpers for extension pages.
(function(root) {
  function formatEnabled(value) {
    return value ? '启用' : '关闭';
  }

  function formatArray(value) {
    return Array.isArray(value) && value.length ? JSON.stringify(value) : '-';
  }

  function formatBoolean(value) {
    return value ? '是' : '否';
  }

  function formatTimezoneSource(source) {
    if (source === 'manual') return '手动配置';
    if (source === 'lastLocation') return 'lastLocation';
    return source || '-';
  }

  function formatGeolocation(value) {
    if (!value) return '-';
    const latitude = Number.isFinite(Number(value.latitude)) ? Number(value.latitude) : null;
    const longitude = Number.isFinite(Number(value.longitude)) ? Number(value.longitude) : null;
    const country = value.country ? ` ${value.country}` : '';
    if (latitude === null || longitude === null) return country || '-';
    return `${latitude}, ${longitude}${country}`;
  }

  function formatComparison(isMatch, hasData) {
    if (!hasData) return '-';
    return isMatch ? '一致' : '不一致';
  }

  const api = {
    formatEnabled,
    formatArray,
    formatBoolean,
    formatTimezoneSource,
    formatGeolocation,
    formatComparison
  };

  root.IPGeoPageFormatters = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
