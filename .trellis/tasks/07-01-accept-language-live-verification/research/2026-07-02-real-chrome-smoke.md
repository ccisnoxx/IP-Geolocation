# 2026-07-02 Real Chrome Smoke

## Setup

- Browser: Google Chrome real profile
- Extension under test: unpacked `IP-Geolocation`
- Target task: `07-01-accept-language-live-verification`
- Validation style: claim user-opened tabs in Chrome, then read server echo results from the live page

## Why Claimed Tabs Were Used

During this session, programmatic `browser.tabs.new() + goto(...)` to several header-echo pages produced `net::ERR_BLOCKED_BY_CLIENT` under the browser-control path, while the same pages were reachable when opened manually by the user in Chrome.

Confirmed examples:

- `https://httpbin.org/headers`
- `https://httpbingo.org/headers`
- `https://postman-echo.com/headers`

This means the reliable smoke path in the current environment is:

1. User manually opens the target page in Chrome
2. Browser automation claims the existing tab
3. Smoke reads the server echo from that live page

This is treated as an environment-specific browser-control constraint, not as an extension behavior bug.

## Findings

### Non-allowlist control before whitelisting

- Site: `https://example.com/`
- Validation path: Chrome CDP `Network.requestWillBeSentExtraInfo`
- Observed request header:
  - `accept-language`: `zh-CN,zh;q=0.9`

Interpretation:

- Non-allowlisted ordinary navigation kept the browser's native language header.

### Allowlist sample: `browserleaks.com/ip`

- Validation path: claimed user-opened tab
- Page section used: `HTTP Headers`
- Observed request header:
  - `Accept-Language`: `en-US,en;q=0.9`

Interpretation:

- Allowlisted `browserleaks.com` received the configured spoofed header.

### Allowlist sample after adding `httpbin.org` to whitelist

- Site: `https://httpbin.org/headers`
- Validation path: claimed user-opened tab
- Observed JSON header echo:
  - `Accept-Language`: `en-US,en;q=0.9`

Interpretation:

- After `httpbin.org` was added to the allowlist, it also received the configured spoofed header.

## Conclusion

Real Chrome smoke confirms the current `Accept-Language` behavior:

- non-allowlisted navigation keeps the browser-native header
- allowlisted navigation receives the spoofed `Accept-Language`

The newly added request-header probe logic is therefore aligned with real browser behavior on the tested sample pages.
