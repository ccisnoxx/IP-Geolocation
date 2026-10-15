# Real Chrome Smoke Results (2026-07-01)

> 历史证据：描述当时的 v1.4，不能作为当前稳定化任务的验收结果。VG-004 仅脱敏个人绝对路径，保留原始观测与结论。

## Environment

- Browser: Chrome 149.0.7827.157
- Extension ID: `lanbapglahcigjilhlfjmhnfgnalhmlc`
- Extension source: `<仓库根目录>`
- Smoke configuration used:
  - allowlisted domains: `chatgpt.com`, `claude.ai`, `gemini.google.com`, `browserleaks.com`, `whoer.net`, `yalala.com`
  - global language: `ja-JP`, `["ja-JP", "ja", "en"]`
  - global `Accept-Language`: `ja-JP,ja;q=0.9,en;q=0.8`
  - global timezone: `Asia/Tokyo`
  - global geolocation: `35.6762, 139.6503` (`Japan`)
  - WebRTC global mode: `strict`

## Summary

- No allowlist-matching defect was found in the shipped v1.4 runtime.
- Allowlisted sites received the configured spoofed language, timezone, date offset, and geolocation.
- Non-allowlisted ordinary pages kept the browser's native values instead of the allowlisted spoof.
- DNR `Accept-Language` was different between allowlisted and non-allowlisted pages, matching the expected allowlist split.
- WebRTC strict mode behaved as expected on detection sites.

## Findings

### Allowlisted site: `browserleaks.com`

- `Accept-Language` request header on `/ip`: `ja-JP,ja;q=0.9,en;q=0.8`
- JavaScript page values on `/javascript`:
  - `System Time`: `Wed Jul 01 2026 12:33:26 GMT+0900 (Japan Standard Time)`
  - `locale`: `ja-JP`
  - `timeZone`: `Asia/Tokyo`
  - `language`: `ja-JP`
  - `languages`: `["ja-JP","ja","en"]`
- Geolocation page `/geo`:
  - `Latitude`: `35.6762`
  - `Longitude`: `139.6503`
  - reverse geocoding resolved to Tokyo, Japan
- WebRTC page `/webrtc`:
  - `WebRTC Leak Test`: `No Leak`
  - local/public WebRTC IPs were not exposed

### Allowlisted site: `whoer.net`

- Page reported:
  - IP location remained Los Angeles / United States
  - `System`: `Wed Jul 01 2026 12:34:31 GMT+0900 (Japan Standard Time)`
  - `Zone`: `America/Los_Angeles`
  - `Local`: `Tue Jun 30 2026 20:34:25 GMT-0700 (PDT)`
  - `LANGUAGE`: `EN / JP`
- Interpretation:
  - Whoer continued to show server-side IP geography from the exit IP.
  - Browser-side time moved to Japan Standard Time as configured.
  - This is consistent with the test profile intentionally diverging from the current exit IP.

### Allowlisted site: `yalala.com`

- Site language switched to Japanese UI text.
- Page reported:
  - `言語`: `ja-JP`
  - `ブラウザ: +09:00, サーバー: -08:00`
  - `ブラウザ: ja, サーバー: en`
- CDP page-context reads on the same page:
  - `navigator.language`: `ja-JP`
  - `navigator.languages`: `["ja-JP","ja","en"]`
  - `Intl.DateTimeFormat().resolvedOptions().timeZone`: `Asia/Tokyo`
  - `Date#getTimezoneOffset()`: `-540`
  - spoofed geolocation returned `35.6762, 139.6503`
- Interpretation:
  - Page-level spoofing is active and coherent.
  - IP-based checks still show the exit IP's US geography, which is expected for this deliberately mismatched test profile.

### Allowlisted sites: product targets

- `chatgpt.com`
  - landed on Cloudflare waiting page, but page-context values were spoofed:
    - `language`: `ja-JP`
    - `languages`: `["ja-JP","ja","en"]`
    - `timezone`: `Asia/Tokyo`
    - `offset`: `-540`
    - geolocation returned Tokyo coordinates
- `claude.ai`
  - redirected to `https://claude.ai/restricted` / login flow
  - page-context values were spoofed:
    - `language`: `ja-JP`
    - `languages`: `["ja-JP","ja","en"]`
    - `timezone`: `Asia/Tokyo`
    - `offset`: `-540`
    - geolocation returned Tokyo coordinates
- `gemini.google.com`
  - loaded `https://gemini.google.com/app`
  - page-context values were spoofed:
    - `language`: `ja-JP`
    - `languages`: `["ja-JP","ja","en"]`
    - `timezone`: `Asia/Tokyo`
    - `offset`: `-540`
    - geolocation returned Tokyo coordinates

### Non-allowlisted ordinary page: `example.com`

- CDP page-context reads showed native browser values instead of the allowlisted spoof:
  - `language`: `zh-CN`
  - `languages`: `["zh-CN","zh"]`
  - `timezone`: `Asia/Shanghai`
  - `offset`: `-480`
  - `Date`: `Wed Jul 01 2026 11:36:10 GMT+0800 (中国标准时间)`
- Captured request header on the same page:
  - `accept-language`: `zh-CN,zh;q=0.9`

## Judgment

- v1.4 passed the second-round smoke goal for:
  - allowlist scoping
  - longest-path runtime resolution in practice
  - page-context spoof activation on allowlisted targets
  - non-allowlisted isolation
  - DNR language-header scoping
  - WebRTC strict-mode behavior
- No code change was required from this smoke pass.

## Residual Note

- Detection sites that compare browser signals against the current exit IP will still report mismatches if the configured spoof profile intentionally diverges from the exit IP geography.
- That behavior was observed in this smoke run and is expected configuration behavior, not evidence of a v1.4 runtime defect.
