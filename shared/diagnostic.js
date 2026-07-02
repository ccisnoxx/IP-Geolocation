// Shared diagnostic helpers used by background and extension pages.
(function(root) {
  const configApi = root.IPGeoConfig || (
    typeof module !== 'undefined' && module.exports
      ? require('../config')
      : null
  );

  if (!configApi) {
    throw new Error('IPGeoConfig is required before diagnostic.js');
  }

  const LAST_DIAGNOSTIC_TARGET_KEY = 'lastDiagnosticTarget';
  const REQUEST_HEADER_PROBE_SOURCES = {
    browserleaks_ip: 'browserleaks.com/ip',
    httpbin_headers: 'httpbin.org/headers',
    httpbingo_headers: 'httpbingo.org/headers'
  };
  const INTL_DEFINITIONS = [
    {
      key: 'numberFormat',
      label: 'Intl.NumberFormat',
      create: (locale) => new Intl.NumberFormat(locale),
      sample: (instance) => instance.format(123456.78)
    },
    {
      key: 'collator',
      label: 'Intl.Collator',
      create: (locale) => new Intl.Collator(locale),
      sample: (instance) => ['ä', 'a', 'z'].slice().sort(instance.compare).join(' | ')
    },
    {
      key: 'relativeTimeFormat',
      label: 'Intl.RelativeTimeFormat',
      create: (locale) => new Intl.RelativeTimeFormat(locale),
      sample: (instance) => instance.format(-2, 'day')
    },
    {
      key: 'listFormat',
      label: 'Intl.ListFormat',
      create: (locale) => new Intl.ListFormat(locale),
      sample: (instance) => instance.format(['Tokyo', 'Osaka', 'Nagoya'])
    },
    {
      key: 'pluralRules',
      label: 'Intl.PluralRules',
      create: (locale) => new Intl.PluralRules(locale),
      sample: (instance) => instance.select(2)
    },
    {
      key: 'displayNames',
      label: 'Intl.DisplayNames',
      create: (locale) => new Intl.DisplayNames(locale, { type: 'region' }),
      sample: (instance) => instance.of('JP') || ''
    },
    {
      key: 'segmenter',
      label: 'Intl.Segmenter',
      create: (locale) => new Intl.Segmenter(locale),
      sample: (instance) => Array.from(instance.segment('東京都に行きます')).slice(0, 8).map((part) => part.segment).join(' | ')
    }
  ];

  function currentDomainFromUrl(url) {
    try {
      return configApi.normalizeDomain(new URL(url).hostname);
    } catch (error) {
      return '';
    }
  }

  function isScriptableTabUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  function buildEffectiveDiagnosticPayload(input) {
    const payload = input && input.payload ? input.payload : input;
    if (!payload) return null;
    return {
      language: payload.languageConfig ? {
        language: payload.languageConfig.language,
        languages: Array.isArray(payload.languageConfig.languages)
          ? payload.languageConfig.languages.slice()
          : [],
        acceptLanguage: payload.languageConfig.acceptLanguage || ''
      } : null,
      timezone: payload.timezone || null,
      timezoneSource: payload.timezoneSource || null,
      geolocation: payload.geolocation ? {
        latitude: payload.geolocation.latitude,
        longitude: payload.geolocation.longitude,
        country: payload.geolocation.country || ''
      } : null
    };
  }

  function buildTimezoneDiagnostic(payload) {
    if (!payload || !payload.timezone) return null;
    const now = new Date();
    const sampleYear = now.getUTCFullYear();
    const januaryDate = new Date(Date.UTC(sampleYear, 0, 15, 12, 0, 0));
    const julyDate = new Date(Date.UTC(sampleYear, 6, 15, 12, 0, 0));
    const currentOffsetMinutes = configApi.getTimezoneOffsetMinutes(payload.timezone, now);
    const januaryOffsetMinutes = configApi.getTimezoneOffsetMinutes(payload.timezone, januaryDate);
    const julyOffsetMinutes = configApi.getTimezoneOffsetMinutes(payload.timezone, julyDate);

    return {
      timezone: payload.timezone,
      source: payload.timezoneSource || null,
      currentOffsetMinutes,
      currentOffsetLabel: configApi.formatTimezoneOffsetMinutes(currentOffsetMinutes),
      sampleYear,
      januaryOffsetMinutes,
      januaryOffsetLabel: configApi.formatTimezoneOffsetMinutes(januaryOffsetMinutes),
      julyOffsetMinutes,
      julyOffsetLabel: configApi.formatTimezoneOffsetMinutes(julyOffsetMinutes)
    };
  }

  function buildLastLocationSnapshot(lastLocation) {
    if (!lastLocation) return null;
    return {
      latitude: Number.isFinite(Number(lastLocation.latitude)) ? Number(lastLocation.latitude) : null,
      longitude: Number.isFinite(Number(lastLocation.longitude)) ? Number(lastLocation.longitude) : null,
      country: lastLocation.country || '',
      timezone: lastLocation.timezone || null,
      timezoneOffset: Number.isFinite(Number(lastLocation.timezoneOffset)) ? Number(lastLocation.timezoneOffset) : null,
      updateTime: lastLocation.updateTime || ''
    };
  }

  function buildIntlExpectedDiagnostics(language) {
    const diagnostics = {};
    if (!language) return diagnostics;

    INTL_DEFINITIONS.forEach((definition) => {
      let locale = null;
      let error = '';
      try {
        const instance = definition.create(language);
        const options = typeof instance.resolvedOptions === 'function' ? instance.resolvedOptions() : null;
        locale = options && options.locale ? options.locale : null;
      } catch (buildError) {
        error = buildError && buildError.message ? buildError.message : String(buildError);
      }
      diagnostics[definition.key] = { locale, error };
    });

    return diagnostics;
  }

  function stripHtml(value) {
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeObservedHeaderValue(value) {
    if (Array.isArray(value)) {
      const items = value.map((item) => String(item || '').trim()).filter(Boolean);
      return items.length ? items.join(', ') : null;
    }

    const normalized = String(value || '').trim();
    return normalized || null;
  }

  function unsupportedRequestHeaderProbe() {
    return {
      status: 'unsupported',
      source: null,
      observedAcceptLanguage: null,
      message: `当前页面不是已支持的请求头回显页。请在白名单内打开 ${REQUEST_HEADER_PROBE_SOURCES.browserleaks_ip}，或在非白名单打开 ${REQUEST_HEADER_PROBE_SOURCES.httpbin_headers}。`
    };
  }

  function parseBrowserleaksAcceptLanguage(html) {
    const tbodyMatch = String(html || '').match(/<tbody[^>]*id=(["'])headers\1[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) return null;

    const rowRegex = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    let match = null;
    while ((match = rowRegex.exec(tbodyMatch[2]))) {
      if (stripHtml(match[1]).toLowerCase() !== 'accept-language') continue;
      return normalizeObservedHeaderValue(stripHtml(match[2]));
    }
    return null;
  }

  function parseJsonHeaderEchoAcceptLanguage(text) {
    if (!String(text || '').trim()) return null;

    let parsed = null;
    try {
      parsed = JSON.parse(String(text));
    } catch (error) {
      return null;
    }

    const headers = parsed && typeof parsed === 'object' ? parsed.headers : null;
    if (!headers || typeof headers !== 'object') return null;

    const key = Object.keys(headers).find((name) => String(name).toLowerCase() === 'accept-language');
    return key ? normalizeObservedHeaderValue(headers[key]) : null;
  }

  function buildRequestHeaderProbe(input) {
    const url = input && input.url ? String(input.url) : '';
    let parsedUrl = null;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      return unsupportedRequestHeaderProbe();
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;
    if (hostname === 'browserleaks.com' && pathname === '/ip') {
      const observed = parseBrowserleaksAcceptLanguage(input && input.html ? input.html : '');
      return observed
        ? {
            status: 'ok',
            source: 'browserleaks_ip',
            observedAcceptLanguage: observed,
            message: '已从 browserleaks.com/ip 的 HTTP Headers 表格中读取回显值。'
          }
        : {
            status: 'parse_error',
            source: 'browserleaks_ip',
            observedAcceptLanguage: null,
            message: '已识别当前页为 browserleaks.com/ip，但解析 Accept-Language 回显失败。'
          };
    }

    if (
      (hostname === 'httpbin.org' && pathname === '/headers')
      || (hostname === 'httpbingo.org' && pathname === '/headers')
    ) {
      const source = hostname === 'httpbin.org' ? 'httpbin_headers' : 'httpbingo_headers';
      const observed = parseJsonHeaderEchoAcceptLanguage(input && input.bodyText ? input.bodyText : '');
      return observed
        ? {
            status: 'ok',
            source,
            observedAcceptLanguage: observed,
            message: `已从 ${REQUEST_HEADER_PROBE_SOURCES[source]} 的 JSON 回显中读取请求头。`
          }
        : {
            status: 'parse_error',
            source,
            observedAcceptLanguage: null,
            message: `已识别当前页为 ${REQUEST_HEADER_PROBE_SOURCES[source]}，但解析 Accept-Language 回显失败。`
          };
    }

    return unsupportedRequestHeaderProbe();
  }

  function collectIframeTargets() {
    return Array.from(document.querySelectorAll('iframe')).map((iframe, index) => {
      let resolvedUrl = null;
      try {
        resolvedUrl = iframe.src || null;
      } catch (error) {
        resolvedUrl = null;
      }

      return {
        index,
        id: iframe.id || '',
        name: iframe.name || '',
        title: iframe.title || '',
        scenario: iframe.dataset && iframe.dataset.scenario ? iframe.dataset.scenario : '',
        srcAttribute: iframe.getAttribute('src') || '',
        resolvedUrl,
        hasSrcdoc: iframe.hasAttribute('srcdoc')
      };
    });
  }

  function buildFrameProbeSnapshot(executionResults, frameTargets) {
    const normalizedResults = Array.isArray(executionResults)
      ? executionResults.reduce((items, entry) => {
          if (!entry || !entry.result) return items;
          items.push({
            frameId: Number.isInteger(entry.frameId) ? entry.frameId : null,
            documentId: entry.documentId || null,
            ...entry.result
          });
          return items;
        }, [])
      : [];

    const top = normalizedResults.find((entry) => entry.isTopFrame || entry.frameId === 0) || normalizedResults[0] || null;
    const frames = normalizedResults.filter((entry) => {
      if (!top) return true;
      return !(entry.frameId === top.frameId && entry.url === top.url && entry.frameName === top.frameName);
    });

    return {
      top,
      frames,
      frameTargets: Array.isArray(frameTargets) ? frameTargets.slice() : []
    };
  }

  function normalizeWorkerDiagnosticEntry(entry, fallbackNote) {
    const normalized = entry && typeof entry === 'object' ? entry : {};
    return {
      status: normalized.status || 'not_attempted',
      result: normalized.result && typeof normalized.result === 'object' ? normalized.result : null,
      error: normalized.error ? String(normalized.error) : '',
      note: normalized.note ? String(normalized.note) : (fallbackNote || '')
    };
  }

  function buildWorkerDiagnosticsSnapshot(input) {
    const normalized = input && typeof input === 'object' ? input : {};
    return {
      classicWorker: normalizeWorkerDiagnosticEntry(normalized.classicWorker),
      moduleWorker: normalizeWorkerDiagnosticEntry(normalized.moduleWorker),
      sharedWorker: normalizeWorkerDiagnosticEntry(normalized.sharedWorker),
      nestedWorker: normalizeWorkerDiagnosticEntry(
        normalized.nestedWorker,
        '第一轮只记录 nested worker 边界，不承诺当前已覆盖。'
      ),
      serviceWorker: normalizeWorkerDiagnosticEntry(
        normalized.serviceWorker,
        '当前未 hook navigator.serviceWorker.register；第一轮只记录 service worker 边界。'
      )
    };
  }

  function buildGeolocationBehaviorSnapshot(input) {
    const normalized = input && typeof input === 'object' ? input : {};
    return {
      status: normalized.status || 'not_attempted',
      successResult: normalized.successResult || '',
      watchResult: normalized.watchResult || '',
      clearWatchResult: normalized.clearWatchResult || '',
      errorResult: normalized.errorResult || '',
      note: normalized.note || ''
    };
  }

  async function resolveDiagnosticTab(chromeApi, tabId, savedTarget) {
    const tryTabId = async (candidate) => {
      if (!Number.isInteger(candidate)) return null;
      try {
        return await chromeApi.tabs.get(candidate);
      } catch (error) {
        return null;
      }
    };

    const directTab = await tryTabId(Number(tabId));
    if (directTab) return directTab;
    return savedTarget ? tryTabId(Number(savedTarget.tabId)) : null;
  }

  async function collectLivePageState() {
    const definitions = [
      ['numberFormat', 'NumberFormat', () => new Intl.NumberFormat(), (instance) => instance.format(123456.78)],
      ['collator', 'Collator', () => new Intl.Collator(), (instance) => ['ä', 'a', 'z'].slice().sort(instance.compare).join(' | ')],
      ['relativeTimeFormat', 'RelativeTimeFormat', () => new Intl.RelativeTimeFormat(), (instance) => instance.format(-2, 'day')],
      ['listFormat', 'ListFormat', () => new Intl.ListFormat(), (instance) => instance.format(['Tokyo', 'Osaka', 'Nagoya'])],
      ['pluralRules', 'PluralRules', () => new Intl.PluralRules(), (instance) => instance.select(2)],
      ['displayNames', 'DisplayNames', () => new Intl.DisplayNames(undefined, { type: 'region' }), (instance) => instance.of('JP') || ''],
      ['segmenter', 'Segmenter', () => new Intl.Segmenter(), (instance) => Array.from(instance.segment('東京都に行きます')).slice(0, 8).map((part) => part.segment).join(' | ')]
    ];
    const now = new Date();
    const createIntlDiagnostic = (createInstance, sampleBuilder) => {
      let instance = null;
      let errorMessage = '';
      let locale = null;
      let sample = '';

      try {
        instance = createInstance();
      } catch (error) {
        errorMessage = error && error.message ? error.message : String(error);
      }

      if (instance) {
        try {
          const options = typeof instance.resolvedOptions === 'function' ? instance.resolvedOptions() : null;
          locale = options && options.locale ? options.locale : null;
        } catch (error) {
          errorMessage = errorMessage || (error && error.message ? error.message : String(error));
        }

        try {
          sample = sampleBuilder(instance);
        } catch (error) {
          errorMessage = errorMessage || (error && error.message ? error.message : String(error));
        }
      }

      return {
        locale,
        sample,
        error: errorMessage
      };
    };

    const intlDiagnostics = {};
    definitions.forEach(([key, name, factory, sampleBuilder]) => {
      intlDiagnostics[key] = createIntlDiagnostic(() => {
        if (!Intl || typeof Intl[name] !== 'function') {
          throw new Error(`Intl.${name} is unavailable`);
        }
        return factory();
      }, sampleBuilder);
    });

    let timezone = null;
    let timezoneError = '';
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (error) {
      timezoneError = error && error.message ? error.message : String(error);
    }

    const pageUrl = location.href;
    const isTopFrame = window.parent === window;
    const requestHeaderProbe = isTopFrame
      ? (() => {
          let parsedUrl = null;
          try {
            parsedUrl = new URL(pageUrl);
          } catch (error) {
            return buildRequestHeaderProbe({ url: pageUrl });
          }

          const isBrowserleaksIp = parsedUrl.hostname.toLowerCase() === 'browserleaks.com' && parsedUrl.pathname === '/ip';
          return buildRequestHeaderProbe({
            url: pageUrl,
            html: isBrowserleaksIp && document.documentElement ? document.documentElement.outerHTML : '',
            bodyText: document.body ? (document.body.innerText || document.body.textContent || '') : ''
          });
        })()
      : null;

    let workerDiagnostics = null;
    if (isTopFrame && typeof window.runWorkerDiagnostics === 'function') {
      try {
        workerDiagnostics = buildWorkerDiagnosticsSnapshot(await window.runWorkerDiagnostics());
      } catch (error) {
        workerDiagnostics = buildWorkerDiagnosticsSnapshot({
          classicWorker: {
            status: 'error',
            error: error && error.message ? error.message : String(error),
            note: '运行 worker fixture 诊断时发生异常。'
          }
        });
      }
    }

    let geolocationBehavior = null;
    if (isTopFrame && typeof window.runGeolocationDiagnostics === 'function') {
      try {
        geolocationBehavior = buildGeolocationBehaviorSnapshot({
          status: 'ok',
          ...(await window.runGeolocationDiagnostics())
        });
      } catch (error) {
        geolocationBehavior = buildGeolocationBehaviorSnapshot({
          status: 'error',
          errorResult: error && error.message ? error.message : String(error),
          note: '运行 geolocation fixture 诊断时发生异常。'
        });
      }
    }

    return {
      url: pageUrl,
      title: document.title || '',
      frameName: window.name || '',
      isTopFrame,
      language: navigator.language || '',
      languages: Array.isArray(navigator.languages) ? Array.from(navigator.languages) : [],
      timezone,
      timezoneError,
      offsetMinutes: now.getTimezoneOffset(),
      dateString: now.toString(),
      hasGeolocationApi: Boolean(navigator.geolocation),
      intlDiagnostics,
      requestHeaderProbe,
      workerDiagnostics,
      geolocationBehavior
    };
  }

  async function probeLivePageState(chromeApi, targetTab) {
    if (!targetTab || !targetTab.id || !isScriptableTabUrl(targetTab.url)) {
      return {
        status: 'unsupported',
        message: '当前标签页不是可探测的 http/https 页面。'
      };
    }

    try {
      const [frameTargetsResult] = await chromeApi.scripting.executeScript({
        target: { tabId: targetTab.id, allFrames: false },
        world: 'MAIN',
        injectImmediately: true,
        func: collectIframeTargets
      });
      const frameResults = await chromeApi.scripting.executeScript({
        target: { tabId: targetTab.id, allFrames: true },
        world: 'MAIN',
        injectImmediately: true,
        func: collectLivePageState
      });
      const snapshot = buildFrameProbeSnapshot(
        frameResults,
        frameTargetsResult && Array.isArray(frameTargetsResult.result) ? frameTargetsResult.result : []
      );
      if (!snapshot.top) {
        return {
          status: 'error',
          message: '未读取到顶层页面诊断结果。'
        };
      }
      return {
        status: 'ok',
        ...snapshot.top,
        frameTargets: snapshot.frameTargets,
        frames: snapshot.frames
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  const api = {
    LAST_DIAGNOSTIC_TARGET_KEY,
    REQUEST_HEADER_PROBE_SOURCES,
    INTL_DEFINITIONS,
    currentDomainFromUrl,
    isScriptableTabUrl,
    buildEffectiveDiagnosticPayload,
    buildTimezoneDiagnostic,
    buildLastLocationSnapshot,
    buildIntlExpectedDiagnostics,
    buildRequestHeaderProbe,
    buildFrameProbeSnapshot,
    buildWorkerDiagnosticsSnapshot,
    buildGeolocationBehaviorSnapshot,
    resolveDiagnosticTab,
    collectIframeTargets,
    collectLivePageState,
    probeLivePageState
  };

  root.IPGeoDiagnostic = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
