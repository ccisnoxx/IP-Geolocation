# 2026-07-02 Local Worker Fixture Smoke

## Setup

- Fixture page: `http://localhost:8765/fixtures/workers/top.html`
- Whitelisted host:
  - `localhost`
- Validation style:
  - DOM snapshot after fixture auto-run delay
  - CDP `Runtime.evaluate` on the live page

## Key Findings

### Top-level page

- Current live values were spoofed:
  - `language`: `en-US`
  - `DateTimeFormat locale`: `en-US`
  - `NumberFormat locale`: `en-US`
  - `timezone`: `America/Los_Angeles`
  - `offset`: `420`

Interpretation:

- The fixture host itself was correctly allowlisted and top-level spoofing was active.

### classic Worker

- `navigator.language`: native `zh-CN`
- `navigator.languages`: native `["zh-CN","zh"]`
- `Intl.DateTimeFormat().resolvedOptions().locale`: spoofed `en-US`
- `Intl.NumberFormat().resolvedOptions().locale`: spoofed `en-US`
- `timezone`: spoofed `America/Los_Angeles`
- `offset`: spoofed `420`

Interpretation:

- Current classic worker hook successfully carries locale/timezone derived behavior (`Intl` + `Date`) into worker context.
- It does **not** spoof `navigator.language(s)` in worker context.

### module Worker

- `navigator.language`: native `zh-CN`
- `navigator.languages`: native `["zh-CN","zh"]`
- `Intl.DateTimeFormat().resolvedOptions().locale`: native `zh-CN`
- `Intl.NumberFormat().resolvedOptions().locale`: native `zh-CN`
- `timezone`: native `Asia/Shanghai`
- `offset`: native `-480`

Interpretation:

- Current module worker path did **not** receive the locale/timezone patch in this smoke.
- This is stronger than a mere `navigator.language` difference; the `Intl` / `Date` signals also remained native.

### SharedWorker

- `navigator.language`: native `zh-CN`
- `navigator.languages`: native `["zh-CN","zh"]`
- `Intl.DateTimeFormat().resolvedOptions().locale`: spoofed `en-US`
- `Intl.NumberFormat().resolvedOptions().locale`: spoofed `en-US`
- `timezone`: spoofed `America/Los_Angeles`
- `offset`: spoofed `420`

Interpretation:

- `SharedWorker` currently behaves like classic `Worker`:
  locale/timezone derived behavior is spoofed, but `navigator.language(s)` stays native.

### nested worker

- `navigator.language`: native `zh-CN`
- `navigator.languages`: native `["zh-CN","zh"]`
- `Intl.DateTimeFormat().resolvedOptions().locale`: native `zh-CN`
- `Intl.NumberFormat().resolvedOptions().locale`: native `zh-CN`
- `timezone`: native `Asia/Shanghai`
- `offset`: native `-480`

Interpretation:

- nested worker currently behaves as an uncovered boundary.
- This matches the code-structure expectation that `installWorkerHooks` is not reinstalled inside worker context.

### service worker

- status: `not_attempted`
- note: current implementation does not hook `navigator.serviceWorker.register`

Interpretation:

- `service worker` remains outside first-round coverage.

## First-Round Conclusion

The local fixture smoke establishes this first-round boundary:

- **classic Worker**: `Intl` / `Date` spoof works; `navigator.language(s)` stays native
- **SharedWorker**: `Intl` / `Date` spoof works; `navigator.language(s)` stays native
- **module Worker**: current patch did not take effect in this smoke
- **nested worker**: uncovered boundary
- **service worker**: explicit out-of-scope boundary

This means the first round now has stable evidence for each worker class, and any next round should focus on whether module worker and/or nested worker deserve actual fixes.
