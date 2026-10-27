/**
 * 给 payload 解析用的"有效 URL"。
 *
 * 注入层会通过 `matchOriginAsFallback` / `match_about_blank` 进入 `about:blank`、
 * `about:srcdoc`、`data:` 这类不透明来源的子框架，但这些 URL 本身没有主机名：
 *
 *   window.location.href === 'about:srcdoc'
 *   document.referrer    === 'http://localhost:8765/'
 *
 * 旧实现直接拿 `location.href` 去问后台，后台按 hostname 匹配不到任何规则，于是
 * 子框架虽然装了 runtime，却拿不到 payload —— 同源父页面只要读一下
 * `iframe.contentWindow.navigator.language` 就能看到原生值。
 *
 * 这类框架的 `document.referrer` 是父文档的地址，用它解析才能落到与父页面相同的
 * 规则上。真正的跨域子框架不受影响：它的 URL 是 http(s)，按自己的主机名解析。
 */
const WEB_SCHEMES = new Set(['http:', 'https:', 'file:']);

export function resolvePayloadUrl(href: string, referrer: string): string {
  try {
    const url = new URL(href);
    if (WEB_SCHEMES.has(url.protocol)) return href;
  } catch {
    // href 不是绝对 URL（例如空串）：继续走 referrer
  }
  return referrer || href;
}

/** 同上，但只取主机名；拿不到时返回空串 */
export function resolvePayloadHostname(href: string, referrer: string): string {
  const resolved = resolvePayloadUrl(href, referrer);
  try {
    return new URL(resolved, href || undefined).hostname;
  } catch {
    return '';
  }
}