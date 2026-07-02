# 2026-07-02 Local Fixture Smoke

## Setup

- Local fixture host: `http://localhost:8765/fixtures/iframe/top.html`
- Whitelisted hosts:
  - `localhost`
  - `child.localhost`
- Non-whitelisted host:
  - `nonmatch.localhost`

## Key Observation

Two different observation methods produced different kinds of evidence:

1. **DOM snapshot of rendered page content**
   - reflects what the fixture page's own `frame-info.js` rendered at page script time
2. **CDP `Runtime.evaluate` live JS reads**
   - reflects the current runtime values after extension spoof may already be in place

This distinction matters because some frames showed native values in rendered DOM but spoofed values in current live JS, which indicates an **injection timing issue for page-owned early scripts**, not necessarily a final runtime spoof failure.

## Findings

### Top-level `localhost`

- DOM-rendered values: native
  - `language`: `zh-CN`
  - `timezone`: `Asia/Shanghai`
- Current live JS values via CDP: spoofed
  - `language`: `en-US`
  - `timezone`: `America/Los_Angeles`

Interpretation:

- Top-level runtime eventually receives spoofed values
- But page-owned script execution can still observe native values if it runs before spoof is fully applied
- This is evidence of a **timing issue**, not a plain allowlist miss

### Same-origin child (`localhost`)

- DOM-rendered values: native
- Current live JS values via CDP from top page: spoofed

Interpretation:

- Same-origin child has the same timing characteristic as the top-level page:
  runtime values end up spoofed, but early page scripts may have already rendered native values

### Allowlisted cross-host child (`child.localhost`)

- DOM snapshot already shows spoofed values
  - `language`: `en-US`
  - `timezone`: `America/Los_Angeles`

Interpretation:

- This child both matches the allowlist and shows spoofed values in rendered page content
- No contrary evidence was observed in this smoke

### Non-matching child (`nonmatch.localhost`)

- DOM snapshot shows native values
  - `language`: `zh-CN`
  - `timezone`: `Asia/Shanghai`

Interpretation:

- This matches the intended first-round boundary:
  child frame that does not match the allowlist stays native
- This is treated as **matching-model boundary**, not a bug

### `srcdoc` child

- DOM-rendered values: native
- Current live JS values via CDP from top page: spoofed

Interpretation:

- `srcdoc` appears reachable by current runtime spoof, but page-owned content can still render native values before spoof settles
- First-round conclusion should record this as “runtime eventually spoofed, page-script timing still risky”

### `about:blank` child

- DOM-rendered values: native
- Current live JS values via CDP from top page: spoofed
- Reported URL from child context: inherited top URL

Interpretation:

- `about:blank` behaves similarly to `srcdoc` in this fixture:
  runtime values end up spoofed, but initial rendered content can still reflect native values

## Conclusion

The first local fixture smoke establishes the following first-round boundary model:

- **Non-matching cross-host child stays native**: expected boundary, not bug
- **Allowlisted cross-host child can show spoofed values in page-rendered content**
- **Top-level / same-origin / `srcdoc` / `about:blank` can end up spoofed at runtime, but page-owned early scripts may still capture native values**

This means the current task is not only about “which frames are covered”, but also about **when spoof becomes visible relative to page script execution**.
