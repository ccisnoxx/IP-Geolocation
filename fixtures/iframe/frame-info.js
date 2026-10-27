(function() {
  var prefix = document.body && document.body.dataset && document.body.dataset.infoPrefix
    ? String(document.body.dataset.infoPrefix)
    : 'frame';

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value == null || value === '' ? '-' : String(value);
  }

  text(prefix + '-url', location.href);
  text(prefix + '-title', document.title || '');
  text(prefix + '-name', window.name || '');
  text(prefix + '-language', navigator.language || '');
  text(prefix + '-languages', Array.isArray(navigator.languages) ? JSON.stringify(navigator.languages) : '-');

  try {
    text(prefix + '-timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  } catch (error) {
    text(prefix + '-timezone', error && error.message ? error.message : String(error));
  }

  text(prefix + '-offset', new Date().getTimezoneOffset());
  text(prefix + '-date', new Date().toString());

  // 跨域 iframe 的 DOM 父页读不到，测试用 postMessage 把自检值送上去。
  // 生产页面不会加载这个 fixture，纯测试辅助。payload 是异步拉取的，所以
  // 首次上报之后还要补几次，否则测试读到的是 document_start 之前的原生快照。
  var lastReport = '';
  function report() {
    try {
      if (!window.parent || window.parent === window) return;
      var payload = {
        __vanishGeoFrameInfo: true,
        url: location.href,
        name: window.name || '',
        language: navigator.language || '',
        languages: Array.isArray(navigator.languages) ? navigator.languages.slice() : [],
        timezone: (function () {
          try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (error) { return ''; }
        })(),
        offset: new Date().getTimezoneOffset()
      };
      var serialized = JSON.stringify(payload);
      if (serialized === lastReport) return;
      lastReport = serialized;
      window.parent.postMessage(payload, '*');
    } catch { /* ignore */ }
  }
  report();
  setTimeout(report, 400);
  setTimeout(report, 1200);
  setTimeout(report, 2600);
  setInterval(report, 1000);
})();
