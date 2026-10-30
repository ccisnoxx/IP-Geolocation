// 普通页面观察值，不接触扩展消息桥。token 用于区分导航前后的文档。
window.opaqueProbe = function opaqueProbe({ kind, generation, nested = false }) {
  const token = `${performance.timeOrigin}-${Math.random()}`;
  let persisted = false;
  let shows = 0;
  const report = () => top.postMessage({
    fixture: 'opaque-regression', kind, generation, token, href: location.href,
    language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    persisted, shows
  }, '*');
  addEventListener('pageshow', (event) => {
    persisted = event.persisted;
    shows += 1;
    report();
  });
  setInterval(report, 100);
  report();
  if (nested) {
    const frame = document.createElement('iframe');
    const html = `<!doctype html><meta charset="utf-8"><script>(${opaqueProbe.toString()})(${JSON.stringify({ kind: 'nested-data', generation })});<\/script>`;
    frame.src = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    document.body.appendChild(frame);
  }
};
