// Diagnostic page controller.
(function(root) {
  const diagnostic = root.IPGeoDiagnostic;
  const formatters = root.IPGeoPageFormatters;

  function init(doc) {
    const refreshBtn = doc.getElementById('refresh');
    const summaryEl = doc.getElementById('summary');
    const intlDiagnosticsEl = doc.getElementById('intl-diagnostics');
    const tabId = new URLSearchParams(doc.defaultView.location.search).get('tabId');
    const sendRuntimeMessage = root.IPGeoRuntime.createRuntimeMessageSender(chrome);

    function setStatus(text, isError) {
      summaryEl.textContent = text;
      summaryEl.classList.toggle('error', Boolean(isError));
    }

    function setText(id, value) {
      doc.getElementById(id).textContent = value === null || value === undefined || value === '' ? '-' : String(value);
    }

    function appendIntlRow(dl, label, value) {
      const dt = doc.createElement('dt');
      dt.textContent = label;
      const dd = doc.createElement('dd');
      dd.textContent = value === null || value === undefined || value === '' ? '-' : String(value);
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    function formatRequestProbeSource(source) {
      if (!source) return '-';
      return diagnostic.REQUEST_HEADER_PROBE_SOURCES[source] || source;
    }

    function renderIntlDiagnostics(effective, livePage, matched) {
      const configuredLanguage = effective && effective.language ? effective.language.language : '';
      const expectedDiagnostics = diagnostic.buildIntlExpectedDiagnostics(configuredLanguage);
      const liveDiagnostics = livePage && livePage.status === 'ok' && livePage.intlDiagnostics
        ? livePage.intlDiagnostics
        : {};
      let comparableCount = 0;
      let matchedCount = 0;

      intlDiagnosticsEl.replaceChildren();

      diagnostic.INTL_DEFINITIONS.forEach((definition) => {
        const expected = expectedDiagnostics[definition.key] || { locale: null, error: '' };
        const live = liveDiagnostics[definition.key] || { locale: null, sample: '', error: '' };
        const canCompare = Boolean(matched && configuredLanguage && expected.locale && live.locale);
        const isMatch = canCompare && expected.locale === live.locale;
        if (canCompare) {
          comparableCount += 1;
          if (isMatch) matchedCount += 1;
        }

        const card = doc.createElement('div');
        card.className = 'intl-card';
        const title = doc.createElement('h3');
        title.textContent = definition.label;
        const dl = doc.createElement('dl');

        appendIntlRow(dl, '配置 language', configuredLanguage || '-');
        appendIntlRow(dl, '期望 locale', expected.locale || expected.error || '-');
        appendIntlRow(dl, 'Live locale', live.locale || '-');
        appendIntlRow(dl, 'Sample', live.sample || '-');
        appendIntlRow(dl, 'Compare', formatters.formatComparison(isMatch, canCompare));
        appendIntlRow(dl, 'Error', live.error || expected.error || '-');

        card.appendChild(title);
        card.appendChild(dl);
        intlDiagnosticsEl.appendChild(card);
      });

      return {
        comparableCount,
        matchedCount,
        allMatched: comparableCount > 0 && comparableCount === matchedCount
      };
    }

    function render(state) {
      setText('captured-at', state.capturedAt);
      setText('tab-id', state.tabId);
      setText('tab-url', state.tabUrl);
      setText('tab-title', state.tabTitle);
      setText('domain', state.domain);
      setText('master-enabled', formatters.formatBoolean(state.masterEnabled));
      setText('matched', formatters.formatBoolean(state.matched));
      setText('rule-domain', state.rule ? state.rule.domain : '-');

      const effective = state.effective || null;
      const timezoneDiagnostic = state.timezoneDiagnostic || null;
      const livePage = state.livePage || null;
      const intlSummary = renderIntlDiagnostics(effective, livePage, state.matched);
      const requestHeaderProbe = livePage && livePage.status === 'ok'
        ? (livePage.requestHeaderProbe || null)
        : null;
      const requestComparable = Boolean(
        state.matched
        && effective
        && effective.language
        && effective.language.acceptLanguage
        && requestHeaderProbe
        && requestHeaderProbe.status === 'ok'
        && requestHeaderProbe.observedAcceptLanguage
      );
      const requestMatches = requestComparable
        && effective.language.acceptLanguage === requestHeaderProbe.observedAcceptLanguage;
      const requestParseError = Boolean(requestHeaderProbe && requestHeaderProbe.status === 'parse_error');

      setText('effective-language', effective && effective.language ? effective.language.language : '-');
      setText('effective-languages', effective && effective.language ? formatters.formatArray(effective.language.languages) : '-');
      setText('effective-accept-language', effective && effective.language ? effective.language.acceptLanguage : '-');
      setText('effective-timezone', effective ? effective.timezone : '-');
      setText('effective-timezone-source', effective ? formatters.formatTimezoneSource(effective.timezoneSource) : '-');
      setText('effective-offset-now', timezoneDiagnostic ? `${timezoneDiagnostic.currentOffsetMinutes} / ${timezoneDiagnostic.currentOffsetLabel || '-'}` : '-');
      setText('effective-offset-jan', timezoneDiagnostic ? `${timezoneDiagnostic.sampleYear}-01-15: ${timezoneDiagnostic.januaryOffsetMinutes} / ${timezoneDiagnostic.januaryOffsetLabel || '-'}` : '-');
      setText('effective-offset-jul', timezoneDiagnostic ? `${timezoneDiagnostic.sampleYear}-07-15: ${timezoneDiagnostic.julyOffsetMinutes} / ${timezoneDiagnostic.julyOffsetLabel || '-'}` : '-');
      setText('effective-geolocation', effective ? formatters.formatGeolocation(effective.geolocation) : '-');
      setText('last-timezone', state.lastLocation ? state.lastLocation.timezone : '-');
      setText('last-updated', state.lastLocation ? state.lastLocation.updateTime : '-');
      setText('effective-errors', Array.isArray(state.errors) && state.errors.length ? state.errors.join('; ') : '-');
      setText('request-probe-source', formatRequestProbeSource(requestHeaderProbe && requestHeaderProbe.source));
      setText(
        'observed-accept-language',
        requestHeaderProbe && requestHeaderProbe.observedAcceptLanguage ? requestHeaderProbe.observedAcceptLanguage : '-'
      );
      setText('compare-accept-language', formatters.formatComparison(requestMatches, requestComparable));
      setText('request-probe-message', requestHeaderProbe && requestHeaderProbe.message ? requestHeaderProbe.message : '-');

      if (!livePage || livePage.status !== 'ok') {
        setText('live-url', livePage && livePage.message ? livePage.message : '-');
        setText('live-title', '-');
        setText('live-language', '-');
        setText('live-languages', '-');
        setText('live-timezone', '-');
        setText('live-offset', '-');
        setText('live-date', '-');
        setText('compare-timezone', '-');
        setText('compare-offset', '-');
        setText('live-geolocation', livePage && livePage.status === 'unsupported' ? '未探测' : '-');
      } else {
        setText('live-url', livePage.url);
        setText('live-title', livePage.title);
        setText('live-language', livePage.language);
        setText('live-languages', formatters.formatArray(livePage.languages));
        setText('live-timezone', livePage.timezone || livePage.timezoneError || '-');
        setText('live-offset', livePage.offsetMinutes);
        setText('live-date', livePage.dateString);
        const timezoneComparable = Boolean(effective && effective.timezone && livePage.timezone);
        const offsetComparable = Boolean(
          timezoneDiagnostic
          && Number.isFinite(Number(timezoneDiagnostic.currentOffsetMinutes))
          && Number.isFinite(Number(livePage.offsetMinutes))
        );
        setText(
          'compare-timezone',
          formatters.formatComparison(timezoneComparable && effective.timezone === livePage.timezone, timezoneComparable)
        );
        setText(
          'compare-offset',
          formatters.formatComparison(
            offsetComparable
              && Number(timezoneDiagnostic.currentOffsetMinutes) === Number(livePage.offsetMinutes),
            offsetComparable
          )
        );
        setText('live-geolocation', livePage.hasGeolocationApi ? '存在；为避免权限弹窗未主动调用' : '不存在');
      }

      if (state.error) {
        setStatus(state.error, true);
        return;
      }
      if (!state.masterEnabled) {
        setStatus('总开关已关闭。当前页面不应注入页面级伪装。');
        return;
      }
      if (!state.matched) {
        setStatus('当前标签页未命中白名单。页面实际值应保持浏览器原生值。');
        return;
      }
      if (Array.isArray(state.errors) && state.errors.length) {
        setStatus(`已命中白名单，但生效配置存在错误：${state.errors.join('; ')}`, true);
        return;
      }

      const timezoneMatches = effective && effective.timezone && livePage && livePage.status === 'ok' && effective.timezone === livePage.timezone;
      const offsetMatches = timezoneDiagnostic
        && Number.isFinite(Number(timezoneDiagnostic.currentOffsetMinutes))
        && livePage
        && livePage.status === 'ok'
        && Number.isFinite(Number(livePage.offsetMinutes))
        && Number(timezoneDiagnostic.currentOffsetMinutes) === Number(livePage.offsetMinutes);
      const hasExpectedIntl = Boolean(effective && effective.language && effective.language.language);
      const intlMatches = !hasExpectedIntl || intlSummary.allMatched;
      const requestOk = !state.matched || !requestComparable || requestMatches;

      if (requestParseError) {
        setStatus('已返回诊断数据；当前页的 Accept-Language 回显解析失败，请先检查回显页结构或 probe 逻辑。', true);
        return;
      }

      setStatus(
        timezoneMatches && offsetMatches && intlMatches && requestOk
          ? requestComparable
            ? hasExpectedIntl
              ? '当前标签页的 Accept-Language、timezone、offset 和 7 个 Intl locale 与解析结果一致。'
              : '当前标签页的 Accept-Language、timezone 与 offset 和解析结果一致。'
            : hasExpectedIntl
              ? '当前标签页的 timezone、offset 和 7 个 Intl locale 与解析结果一致；如需验证 Accept-Language，请切到支持的回显页。'
              : '当前标签页的 timezone 与 offset 和解析结果一致；如需验证 Accept-Language，请切到支持的回显页。'
          : requestComparable
            ? hasExpectedIntl
              ? '已返回诊断数据；如果当前标签页在白名单内，请重点检查 Accept-Language、timezone、offset 和 7 个 Intl locale 是否一致。'
              : '已返回诊断数据；如果当前标签页在白名单内，请重点检查 Accept-Language、timezone 与 offset 是否一致。'
            : hasExpectedIntl
              ? '已返回诊断数据；如果当前标签页在白名单内，请重点检查 timezone、offset 和 7 个 Intl locale；如需验证 Accept-Language，请切到支持的回显页。'
              : '已返回诊断数据；如果当前标签页在白名单内，请重点检查 timezone 与 offset；如需验证 Accept-Language，请切到支持的回显页。'
      );
    }

    async function load() {
      refreshBtn.disabled = true;
      setStatus('正在读取当前标签页诊断...');
      try {
        const response = await sendRuntimeMessage({ action: 'getDiagnosticState', tabId });
        render(response.state);
      } catch (error) {
        setStatus(`读取诊断失败: ${error.message}`, true);
      } finally {
        refreshBtn.disabled = false;
      }
    }

    refreshBtn.addEventListener('click', load);
    load();
  }

  root.IPGeoTestPage = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
