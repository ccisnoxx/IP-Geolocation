import { createServer } from 'node:http';

// 响应序号用于检查 fixture 独立响应；首脚本另生成文档实例 token，正式证据只输出比较结果。
export function fixtureHtml(serial, child = false) {
  return `<!doctype html><html lang="zh-CN"><head><script>
(() => {
  const sample = () => ({
    value: navigator.language,
    readyState: document.readyState,
    scriptIndex: document.scripts.length,
    inline: Boolean(document.currentScript && !document.currentScript.src)
  });
  const earliest = sample();
  globalThis.vgObservation = {
    serial: ${JSON.stringify(serial)}, instance: crypto.randomUUID(), earliest, load: null, pageshow: []
  };
  globalThis.vgReadCurrent = sample;
  addEventListener('load', () => { vgObservation.load = sample(); }, { once: true });
  addEventListener('pageshow', event => {
    vgObservation.pageshow.push({ persisted: event.persisted, sample: sample() });
  });
})();
</script><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>userScripts 首脚本观测</title><link rel="icon" href="data:,"></head>
<body><p>只记录实际值，不接收预期、配置或脚本。</p>
${child ? '' : '<iframe title="ordinary-same-origin-http" src="/matched/child.html"></iframe>'}
</body></html>`;
}

export function createFixtureServer() {
  let serial = 0;
  const allowed = new Set([
    '/matched/top.html', '/matched/child.html', '/matched/sub/deep.html',
    '/outside/top.html', '/matchedness/top.html'
  ]);
  return createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'GET' || !allowed.has(url.pathname)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    // 普通可缓存 HTTP 响应，允许观察浏览器真实 BFCache 决策；不强制启停 BFCache。
    response.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.end(fixtureHtml(++serial, url.pathname === '/matched/child.html'));
  });
}
