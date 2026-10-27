// 被探针页注册的 Service Worker：只回答"我这个环境里的时间/语言是什么"
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'vg-probe') return;
  const out = {
    tz: null,
    locale: null,
    lang: null,
    offset: null,
    dateStr: null,
    numberFormat: null
  };
  try { out.tz = new Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ }
  try { out.locale = new Intl.DateTimeFormat().resolvedOptions().locale; } catch { /* ignore */ }
  try { out.lang = navigator.language; } catch { /* ignore */ }
  try { out.offset = new Date().getTimezoneOffset(); } catch { /* ignore */ }
  try { out.dateStr = new Date(0).toString(); } catch { /* ignore */ }
  try { out.numberFormat = new Intl.NumberFormat().format(1234.5); } catch { /* ignore */ }
  const port = event.ports && event.ports[0];
  if (port) port.postMessage(out);
});
