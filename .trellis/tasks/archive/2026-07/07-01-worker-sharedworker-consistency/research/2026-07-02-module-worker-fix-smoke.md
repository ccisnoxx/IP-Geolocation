# 2026-07-02 Module Worker Fix Smoke

## Scope

Second-round focused follow-up for `07-01-worker-sharedworker-consistency`, aimed only at the question:

- why `module Worker` did not receive the locale/timezone patch

## Root Cause

The worker wrapper previously generated module-worker bootstrap code in this shape:

```js
PATCH();
import "worker-module.js";
```

In practice, this caused the module-worker path to behave like the native, unpatched path in the fixture smoke.

The fix changed the bootstrap to:

```js
PATCH();
await import("worker-module.js");
```

This preserves the intended order:

1. install the spoof patch
2. load the real module worker script only after patch installation

## Validation

### Node tests

- `npm test`
- Result: pass

### Local fixture smoke

Fixture:

- `http://localhost:8765/fixtures/workers/top.html`

Observed live result after the fix:

- top page
  - `DateTimeFormat locale`: `en-US`
  - `NumberFormat locale`: `en-US`
  - `timezone`: `America/Los_Angeles`
  - `offset`: `420`

- `module Worker`
  - `DateTimeFormat locale`: `en-US`
  - `NumberFormat locale`: `en-US`
  - `timezone`: `America/Los_Angeles`
  - `offset`: `420`

Interpretation:

- `module Worker` now matches the intended spoofed `Intl` / `Date` behavior.

## Updated Boundary After Fix

- classic `Worker`
  - `Intl` / `Date` spoof works
  - `navigator.language(s)` remains native
- `module Worker`
  - `Intl` / `Date` spoof now works
  - `navigator.language(s)` remains native
- `SharedWorker`
  - `Intl` / `Date` spoof works
  - `navigator.language(s)` remains native
- nested worker
  - still native
  - still treated as first-round boundary
- service worker
  - still boundary / not attempted

## Conclusion

The `module Worker` inconsistency was a real implementation issue and is now fixed.

The remaining open boundaries are:

- `navigator.language(s)` in worker contexts
- nested worker propagation
- service worker coverage
