// Diagnostic page controller.
(function(root) {
  const diagnostic = root.IPGeoDiagnostic;
  const formatters = root.IPGeoPageFormatters;

  function init(doc) {
    const refreshBtn = doc.getElementById('refresh');
    const summaryEl = doc.getElementById('summary');
    const intlDiagnosticsEl = doc.getElementById('intl-diagnostics');
    const frameDiagnosticsEl = doc.getElementById('frame-diagnostics');
    const workerDiagnosticsEl = doc.getElementById('worker-diagnostics');
    const geolocationDiagnosticsEl = doc.getElementById('geolocation-diagnostics');
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

    function formatFrameScenario(target) {
      if (!target || !target.scenario) return 'frame';
      const labels = {
        'same-origin-child': 'same-origin child',
        'allowlisted-child': 'allowlisted child',
        'nonmatch-child': 'nonmatch child',
        'srcdoc-child': 'srcdoc child',
        'aboutblank-child': 'about:blank child'
      };
      return labels[target.scenario] || target.scenario;
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

    function renderFrameDiagnostics(livePage) {
      const targets = livePage && livePage.status === 'ok' && Array.isArray(livePage.frameTargets)
        ? livePage.frameTargets
        : [];
      const frames = livePage && livePage.status === 'ok' && Array.isArray(livePage.frames)
        ? livePage.frames
        : [];
      const usedFrameIndexes = new Set();

      frameDiagnosticsEl.replaceChildren();

      if (!targets.length && !frames.length) {
        const empty = doc.createElement('p');
        empty.textContent = '当前页面未发现 iframe / subframe，或尚未返回 frame 级诊断结果。';
        frameDiagnosticsEl.appendChild(empty);
        return { targetCount: 0, matchedCount: 0, extraCount: 0 };
      }

      const findFrameResult = (target) => {
        const directIndex = frames.findIndex((frame, index) => {
          if (usedFrameIndexes.has(index)) return false;
          if (target.name && frame.frameName && target.name === frame.frameName) return true;
          if (target.resolvedUrl && frame.url && target.resolvedUrl === frame.url) return true;
          if (target.hasSrcdoc && frame.url && frame.url.startsWith('about:srcdoc')) return true;
          if (target.srcAttribute === 'about:blank' && frame.url === 'about:blank') return true;
          return false;
        });
        if (directIndex < 0) return null;
        usedFrameIndexes.add(directIndex);
        return frames[directIndex];
      };

      const appendFrameCard = (heading, rows) => {
        const card = doc.createElement('div');
        card.className = 'intl-card';
        const title = doc.createElement('h3');
        title.textContent = heading;
        const dl = doc.createElement('dl');
        rows.forEach(([label, value]) => appendIntlRow(dl, label, value));
        card.appendChild(title);
        card.appendChild(dl);
        frameDiagnosticsEl.appendChild(card);
      };

      targets.forEach((target) => {
        const frame = findFrameResult(target);
        const compareLanguage = Boolean(frame && livePage && livePage.language && frame.language);
        const compareTimezone = Boolean(frame && livePage && livePage.timezone && frame.timezone);
        const compareOffset = Boolean(
          frame
          && livePage
          && Number.isFinite(Number(livePage.offsetMinutes))
          && Number.isFinite(Number(frame.offsetMinutes))
        );
        appendFrameCard(formatFrameScenario(target), [
          ['iframe name', target.name || '-'],
          ['iframe id', target.id || '-'],
          ['src', target.srcAttribute || '-'],
          ['resolved URL', target.resolvedUrl || '-'],
          ['srcdoc', target.hasSrcdoc ? '是' : '否'],
          ['frame URL', frame ? frame.url : '未读取到结果'],
          ['title', frame ? frame.title : '-'],
          ['language', frame ? frame.language : '-'],
          ['languages', frame ? formatters.formatArray(frame.languages) : '-'],
          ['timezone', frame ? frame.timezone : '-'],
          ['offset', frame ? frame.offsetMinutes : '-'],
          ['language 对比', formatters.formatComparison(compareLanguage && livePage.language === frame.language, compareLanguage)],
          ['timezone 对比', formatters.formatComparison(compareTimezone && livePage.timezone === frame.timezone, compareTimezone)],
          ['offset 对比', formatters.formatComparison(compareOffset && Number(livePage.offsetMinutes) === Number(frame.offsetMinutes), compareOffset)]
        ]);
      });

      frames.forEach((frame, index) => {
        if (usedFrameIndexes.has(index)) return;
        appendFrameCard(`未映射 frame #${index + 1}`, [
          ['frame name', frame.frameName || '-'],
          ['URL', frame.url || '-'],
          ['title', frame.title || '-'],
          ['language', frame.language || '-'],
          ['timezone', frame.timezone || '-'],
          ['offset', frame.offsetMinutes]
        ]);
      });

      return {
        targetCount: targets.length,
        matchedCount: usedFrameIndexes.size,
        extraCount: frames.length - usedFrameIndexes.size
      };
    }

    function renderWorkerDiagnostics(effective, livePage) {
      const diagnostics = livePage && livePage.status === 'ok' && livePage.workerDiagnostics
        ? livePage.workerDiagnostics
        : null;

      workerDiagnosticsEl.replaceChildren();

      if (!diagnostics) {
        const empty = doc.createElement('p');
        empty.textContent = '当前页面未返回 Worker / SharedWorker 诊断结果。';
        workerDiagnosticsEl.appendChild(empty);
        return { comparableCount: 0, matchedCount: 0 };
      }

      const labels = {
        classicWorker: 'classic Worker',
        moduleWorker: 'module Worker',
        sharedWorker: 'SharedWorker',
        nestedWorker: 'nested worker',
        serviceWorker: 'service worker'
      };
      let comparableCount = 0;
      let matchedCount = 0;

      Object.keys(labels).forEach((key) => {
        const entry = diagnostics[key] || { status: 'not_attempted', result: null, error: '', note: '' };
        const card = doc.createElement('div');
        card.className = 'intl-card';
        const title = doc.createElement('h3');
        title.textContent = labels[key];
        const dl = doc.createElement('dl');
        const canCompare = Boolean(
          entry.status === 'ok'
          && entry.result
          && effective
          && effective.language
          && effective.timezone
          && entry.result.dateTimeFormatLocale
          && entry.result.numberFormatLocale
          && entry.result.timezone
        );
        const compareLocale = canCompare
          && effective.language.language === entry.result.dateTimeFormatLocale
          && effective.language.language === entry.result.numberFormatLocale;
        const compareTimezone = canCompare && effective.timezone === entry.result.timezone;
        const compareOffset = Boolean(
          canCompare
          && Number.isFinite(Number(entry.result.offsetMinutes))
          && Number.isFinite(Number(livePage.offsetMinutes))
          && Number(livePage.offsetMinutes) === Number(entry.result.offsetMinutes)
        );
        if (canCompare) {
          comparableCount += 1;
          if (compareLocale && compareTimezone && compareOffset) matchedCount += 1;
        }

        appendIntlRow(dl, 'status', entry.status || '-');
        appendIntlRow(dl, 'language', entry.result ? entry.result.language : '-');
        appendIntlRow(dl, 'languages', entry.result ? formatters.formatArray(entry.result.languages) : '-');
        appendIntlRow(dl, 'DTF locale', entry.result ? entry.result.dateTimeFormatLocale : '-');
        appendIntlRow(dl, 'NF locale', entry.result ? entry.result.numberFormatLocale : '-');
        appendIntlRow(dl, 'timezone', entry.result ? entry.result.timezone : '-');
        appendIntlRow(dl, 'offset', entry.result ? entry.result.offsetMinutes : '-');
        appendIntlRow(
          dl,
          'Compare',
          formatters.formatComparison(compareLocale && compareTimezone && compareOffset, canCompare)
        );
        appendIntlRow(dl, 'Error', entry.error || '-');
        appendIntlRow(dl, 'Note', entry.note || '-');

        card.appendChild(title);
        card.appendChild(dl);
        workerDiagnosticsEl.appendChild(card);
      });

      return { comparableCount, matchedCount };
    }

    function renderGeolocationDiagnostics(livePage) {
      const diagnostics = livePage && livePage.status === 'ok' && livePage.geolocationBehavior
        ? livePage.geolocationBehavior
        : null;

      geolocationDiagnosticsEl.replaceChildren();

      if (!diagnostics) {
        const empty = doc.createElement('p');
        empty.textContent = '当前页面未返回 geolocation 行为诊断结果。';
        geolocationDiagnosticsEl.appendChild(empty);
        return;
      }

      const card = doc.createElement('div');
      card.className = 'intl-card';
      const title = doc.createElement('h3');
      title.textContent = 'geolocation behavior';
      const dl = doc.createElement('dl');
      appendIntlRow(dl, 'status', diagnostics.status || '-');
      appendIntlRow(dl, 'success', diagnostics.successResult || '-');
      appendIntlRow(dl, 'watch', diagnostics.watchResult || '-');
      appendIntlRow(dl, 'clearWatch', diagnostics.clearWatchResult || '-');
      appendIntlRow(dl, 'error', diagnostics.errorResult || '-');
      appendIntlRow(dl, 'note', diagnostics.note || '-');
      card.appendChild(title);
      card.appendChild(dl);
      geolocationDiagnosticsEl.appendChild(card);
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
      renderFrameDiagnostics(livePage);
      const workerSummary = renderWorkerDiagnostics(effective, livePage);
      renderGeolocationDiagnostics(livePage);
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
      const workerMatches = workerSummary.comparableCount === 0 || workerSummary.comparableCount === workerSummary.matchedCount;
      const requestOk = !state.matched || !requestComparable || requestMatches;

      if (requestParseError) {
        setStatus('已返回诊断数据；当前页的 Accept-Language 回显解析失败，请先检查回显页结构或 probe 逻辑。', true);
        return;
      }

      setStatus(
        timezoneMatches && offsetMatches && intlMatches && workerMatches && requestOk
          ? requestComparable
            ? hasExpectedIntl
              ? workerSummary.comparableCount > 0
                ? '当前标签页的 Accept-Language、timezone、offset、7 个 Intl locale 与 Worker 诊断结果一致。'
                : '当前标签页的 Accept-Language、timezone、offset 和 7 个 Intl locale 与解析结果一致。'
              : workerSummary.comparableCount > 0
                ? '当前标签页的 Accept-Language、timezone、offset 与 Worker 诊断结果一致。'
                : '当前标签页的 Accept-Language、timezone 与 offset 和解析结果一致。'
            : hasExpectedIntl
              ? workerSummary.comparableCount > 0
                ? '当前标签页的 timezone、offset、7 个 Intl locale 与 Worker 诊断结果一致；如需验证 Accept-Language，请切到支持的回显页。'
                : '当前标签页的 timezone、offset 和 7 个 Intl locale 与解析结果一致；如需验证 Accept-Language，请切到支持的回显页。'
              : workerSummary.comparableCount > 0
                ? '当前标签页的 timezone、offset 与 Worker 诊断结果一致；如需验证 Accept-Language，请切到支持的回显页。'
                : '当前标签页的 timezone 与 offset 和解析结果一致；如需验证 Accept-Language，请切到支持的回显页。'
          : requestComparable
            ? hasExpectedIntl
              ? workerSummary.comparableCount > 0
                ? '已返回诊断数据；如果当前标签页在白名单内，请重点检查 Accept-Language、timezone、offset、Worker 与 7 个 Intl locale 是否一致。'
                : '已返回诊断数据；如果当前标签页在白名单内，请重点检查 Accept-Language、timezone、offset 和 7 个 Intl locale 是否一致。'
              : workerSummary.comparableCount > 0
                ? '已返回诊断数据；如果当前标签页在白名单内，请重点检查 Accept-Language、timezone、offset 与 Worker 结果是否一致。'
                : '已返回诊断数据；如果当前标签页在白名单内，请重点检查 Accept-Language、timezone 与 offset 是否一致。'
            : hasExpectedIntl
              ? workerSummary.comparableCount > 0
                ? '已返回诊断数据；如果当前标签页在白名单内，请重点检查 timezone、offset、Worker 与 7 个 Intl locale；如需验证 Accept-Language，请切到支持的回显页。'
                : '已返回诊断数据；如果当前标签页在白名单内，请重点检查 timezone、offset 和 7 个 Intl locale；如需验证 Accept-Language，请切到支持的回显页。'
              : workerSummary.comparableCount > 0
                ? '已返回诊断数据；如果当前标签页在白名单内，请重点检查 timezone、offset 与 Worker 结果；如需验证 Accept-Language，请切到支持的回显页。'
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
