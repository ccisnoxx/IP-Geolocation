/*
 * 出口 IP 查询（只走 HTTPS）。
 *
 * 为什么不能用 ip-api.com：本机代理只接管 HTTPS，明文请求会看到直连出口
 * （实测返回 China/Shanghai），拿它下结论会完全说反。三个接口都可能限流，
 * 所以按顺序试，并且全程给超时。
 */
const ENDPOINTS = [
  'https://ipwho.is/',
  'https://ipwhois.app/json/',
  'https://ipinfo.io/json',
  'https://ipapi.co/json/'
];

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupExit({ timeoutMs = 8000 } = {}) {
  for (const endpoint of ENDPOINTS) {
    try {
      const data = await fetchJson(endpoint, timeoutMs);
      if (typeof data.timezone === 'string') {
        return { ip: data.ip, country: data.country_name || data.country, city: data.city, tz: data.timezone, source: endpoint };
      }
      if (data && data.timezone && data.timezone.id) {
        return { ip: data.ip, country: data.country, city: data.city, tz: data.timezone.id, source: endpoint };
      }
    } catch { /* 换下一个 */ }
  }
  // 兜底：Cloudflare trace 不限额，但没有时区字段，只能核对国家
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const text = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace/', { signal: controller.signal })).text();
    clearTimeout(timer);
    const ip = (text.match(/^ip=(.*)$/m) || [])[1];
    const loc = (text.match(/^loc=(.*)$/m) || [])[1];
    if (ip) return { ip, country: loc, city: '', tz: null, source: 'cloudflare-trace' };
  } catch { /* 放弃 */ }
  return null;
}
