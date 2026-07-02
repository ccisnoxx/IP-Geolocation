// Popup page controller.
(function(root) {
  const formatters = root.IPGeoPageFormatters;

  function init(doc) {
    const elements = {
      masterEnableBtn: doc.getElementById('master-enable-btn'),
      masterDisableBtn: doc.getElementById('master-disable-btn'),
      masterStatusEl: doc.getElementById('master-status'),
      currentDomainEl: doc.getElementById('current-domain'),
      currentStatusEl: doc.getElementById('current-status'),
      matchedRuleEl: doc.getElementById('matched-rule'),
      addDomainBtn: doc.getElementById('add-domain-btn'),
      toggleDomainBtn: doc.getElementById('toggle-domain-btn'),
      deleteDomainBtn: doc.getElementById('delete-domain-btn'),
      domainStatusEl: doc.getElementById('domain-status'),
      summaryLanguageEl: doc.getElementById('summary-language'),
      summaryTimezoneEl: doc.getElementById('summary-timezone'),
      summaryGeolocationEl: doc.getElementById('summary-geolocation'),
      summaryStatusEl: doc.getElementById('summary-status'),
      webRtcStrictBtn: doc.getElementById('webrtc-strict-btn'),
      webRtcCompatibleBtn: doc.getElementById('webrtc-compatible-btn'),
      webRtcDefaultBtn: doc.getElementById('webrtc-default-btn'),
      lastCountryEl: doc.getElementById('last-country'),
      lastCoordinatesEl: doc.getElementById('last-coordinates'),
      lastTimezoneEl: doc.getElementById('last-timezone'),
      lastUpdatedEl: doc.getElementById('last-updated'),
      refreshBtn: doc.getElementById('refresh-btn'),
      diagnosticBtn: doc.getElementById('diagnostic-btn'),
      optionsBtn: doc.getElementById('options-btn'),
      refreshStatusEl: doc.getElementById('refresh-status')
    };

    const sendRuntimeMessage = root.IPGeoRuntime.createRuntimeMessageSender(chrome);
    let currentState = null;

    function setStatus(element, text, isError) {
      element.textContent = text;
      element.classList.toggle('error', Boolean(isError));
    }

    function formatLanguage(payload) {
      const language = payload && payload.languageConfig;
      if (!language) return '未启用';
      return `${language.language} / ${language.acceptLanguage}`;
    }

    function formatTimezone(payload) {
      if (!payload || !payload.timezone) return '未启用';
      return payload.timezone;
    }

    function renderMaster(config) {
      const enabled = config.masterEnabled !== false;
      elements.masterEnableBtn.classList.toggle('is-active', enabled);
      elements.masterDisableBtn.classList.toggle('is-active', !enabled);
      setStatus(
        elements.masterStatusEl,
        enabled
          ? '总开关已启用；页面级伪装只对白名单域名生效。'
          : '总开关已关闭；页面级伪装和 WebRTC 全局策略已停止。'
      );
    }

    function renderWebRtc(config) {
      const mode = config.webRtc && config.webRtc.globalMode ? config.webRtc.globalMode : 'strict';
      elements.webRtcStrictBtn.classList.toggle('is-active', mode === 'strict');
      elements.webRtcCompatibleBtn.classList.toggle('is-active', mode === 'compatible');
      elements.webRtcDefaultBtn.classList.toggle('is-active', mode === 'default');
    }

    function renderCurrentSite(state) {
      const domain = state.domain;
      const matched = state.matched;
      const rule = state.rule;
      const payload = state.payload;
      const errors = state.errors;

      elements.currentDomainEl.textContent = domain || '非网页标签页';
      elements.matchedRuleEl.textContent = rule ? rule.domain : '-';
      elements.addDomainBtn.disabled = !domain || Boolean(rule);
      elements.toggleDomainBtn.disabled = !rule;
      elements.deleteDomainBtn.disabled = !rule;
      elements.diagnosticBtn.disabled = !domain;

      if (!domain) {
        elements.currentStatusEl.textContent = '不可配置';
        setStatus(elements.domainStatusEl, '当前标签页没有可配置域名。');
        return;
      }

      if (!rule) {
        elements.currentStatusEl.textContent = '未加入白名单';
        elements.toggleDomainBtn.textContent = '停用';
        setStatus(elements.domainStatusEl, '点击“加入”后，该域名及其子域名会应用全局默认配置。');
        return;
      }

      elements.currentStatusEl.textContent = rule.enabled ? (matched ? '已启用' : '规则未生效') : '已停用';
      elements.toggleDomainBtn.textContent = rule.enabled ? '停用' : '启用';
      if (errors && errors.length) {
        setStatus(elements.domainStatusEl, errors.join('; '), true);
      } else if (payload) {
        setStatus(elements.domainStatusEl, '当前网站会应用下方生效配置。');
      } else {
        setStatus(elements.domainStatusEl, '规则已保存，但当前不会注入页面级配置。');
      }
    }

    function renderSummary(state) {
      elements.summaryLanguageEl.textContent = formatLanguage(state.payload);
      elements.summaryTimezoneEl.textContent = formatTimezone(state.payload);
      elements.summaryGeolocationEl.textContent = formatters.formatGeolocation(state.payload && state.payload.geolocation);
      if (!state.matched) {
        setStatus(elements.summaryStatusEl, '未命中白名单，不注入页面级配置。');
      } else if (state.errors && state.errors.length) {
        setStatus(elements.summaryStatusEl, state.errors.join('; '), true);
      } else {
        setStatus(elements.summaryStatusEl, '语言、时区、定位按当前生效 profile 应用。');
      }
    }

    function renderLastLocation(location) {
      if (!location) {
        elements.lastCountryEl.textContent = '-';
        elements.lastCoordinatesEl.textContent = '-';
        elements.lastTimezoneEl.textContent = '-';
        elements.lastUpdatedEl.textContent = '-';
        return;
      }
      elements.lastCountryEl.textContent = location.country || '-';
      elements.lastCoordinatesEl.textContent = Number.isFinite(Number(location.latitude))
        && Number.isFinite(Number(location.longitude))
        ? `${location.latitude}, ${location.longitude}`
        : '-';
      elements.lastTimezoneEl.textContent = location.timezone || '-';
      elements.lastUpdatedEl.textContent = location.updateTime || '-';
    }

    function renderState(state) {
      currentState = state;
      renderMaster(state.config);
      renderWebRtc(state.config);
      renderCurrentSite(state);
      renderSummary(state);
      renderLastLocation(state.lastLocation);
    }

    async function loadState() {
      try {
        const response = await sendRuntimeMessage({ action: 'getCurrentTabState' });
        renderState(response.state);
      } catch (error) {
        setStatus(elements.domainStatusEl, `读取状态失败: ${error.message}`, true);
      }
    }

    async function setMaster(enabled) {
      await sendRuntimeMessage({ action: 'setExtensionEnabled', enabled });
      await loadState();
    }

    async function setWebRtcMode(mode) {
      await sendRuntimeMessage({ action: 'setWebRtcGlobalMode', mode });
      await loadState();
    }

    elements.masterEnableBtn.addEventListener('click', () => setMaster(true));
    elements.masterDisableBtn.addEventListener('click', () => setMaster(false));

    elements.addDomainBtn.addEventListener('click', async () => {
      if (!currentState || !currentState.domain) return;
      try {
        await sendRuntimeMessage({ action: 'addDomainRule', domain: currentState.domain });
        await loadState();
      } catch (error) {
        setStatus(elements.domainStatusEl, `加入失败: ${error.message}`, true);
      }
    });

    elements.toggleDomainBtn.addEventListener('click', async () => {
      if (!currentState || !currentState.rule) return;
      try {
        await sendRuntimeMessage({
          action: 'setDomainRuleEnabled',
          domain: currentState.rule.domain,
          enabled: !currentState.rule.enabled
        });
        await loadState();
      } catch (error) {
        setStatus(elements.domainStatusEl, `切换失败: ${error.message}`, true);
      }
    });

    elements.deleteDomainBtn.addEventListener('click', async () => {
      if (!currentState || !currentState.rule) return;
      try {
        await sendRuntimeMessage({ action: 'deleteDomainRule', domain: currentState.rule.domain });
        await loadState();
      } catch (error) {
        setStatus(elements.domainStatusEl, `删除失败: ${error.message}`, true);
      }
    });

    elements.webRtcStrictBtn.addEventListener('click', () => setWebRtcMode('strict'));
    elements.webRtcCompatibleBtn.addEventListener('click', () => setWebRtcMode('compatible'));
    elements.webRtcDefaultBtn.addEventListener('click', () => setWebRtcMode('default'));

    elements.refreshBtn.addEventListener('click', async () => {
      elements.refreshBtn.disabled = true;
      setStatus(elements.refreshStatusEl, '正在刷新出口 IP 定位...');
      try {
        const response = await sendRuntimeMessage({ action: 'manualUpdate' });
        if (!response.geo || !response.geo.ok) {
          setStatus(
            elements.refreshStatusEl,
            response.geo && response.geo.error ? response.geo.error : '刷新失败',
            true
          );
        } else {
          setStatus(elements.refreshStatusEl, '出口 IP 定位已刷新。');
        }
        await loadState();
      } catch (error) {
        setStatus(elements.refreshStatusEl, `刷新失败: ${error.message}`, true);
      } finally {
        elements.refreshBtn.disabled = false;
      }
    });

    elements.diagnosticBtn.addEventListener('click', async () => {
      elements.diagnosticBtn.disabled = true;
      setStatus(elements.refreshStatusEl, '正在打开诊断页...');
      try {
        await sendRuntimeMessage({ action: 'openDiagnosticPage' });
        setStatus(elements.refreshStatusEl, '诊断页已打开。');
      } catch (error) {
        setStatus(elements.refreshStatusEl, `打开诊断页失败: ${error.message}`, true);
      } finally {
        elements.diagnosticBtn.disabled = !currentState || !currentState.domain;
      }
    });

    elements.optionsBtn.addEventListener('click', () => {
      sendRuntimeMessage({ action: 'openOptions' });
    });

    loadState();
  }

  root.IPGeoPopupPage = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
