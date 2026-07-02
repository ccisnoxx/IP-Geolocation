# 2026-07-02 Local Geolocation Fixture Smoke

## Setup

- Fixture page: `http://localhost:8765/fixtures/geolocation/top.html`
- Validation path: local fixture + Chrome CDP `Runtime.evaluate`

## Findings

### Top-level fixture state

- `window.__ipGeoGeolocationController`: `false`

Interpretation:

- The current fixture page did not receive the extension's geolocation controller injection during this smoke.
- Therefore the page was still using the browser's native geolocation implementation.

### Success branch result

- Returned coordinates:
  - latitude: `34.0522342`
  - longitude: `-118.2436849`

Interpretation:

- These are not the extension's spoof payload values from the local fixture path.
- This confirms the success result came from the browser-native geolocation path in this smoke.

### watchPosition / clearWatch

- `watchResult` showed a started watch id, but it was not controlled by the extension state model.
- `clearWatchResult` only reflected the parsed watch id and did not prove extension-controlled clearing semantics.

Interpretation:

- Current smoke cannot yet be used to validate the extension's own `watchPosition` / `clearWatch` behavior model.

### Forced error branch

- Returned:
  - `code`: `0`
  - `message`: `missing geolocation controller`

Interpretation:

- The forced-error path is currently unreachable in the live fixture because the extension controller did not attach.

## Conclusion

This first smoke does **not** yet validate the geolocation behavior model itself.

What it proves is narrower but still useful:

- the fixture page is reachable and executable
- the current local fixture host is still running through native geolocation
- before evaluating `watchPosition` / `clearWatch` / forced error semantics, the next step must verify why the extension-controlled geolocation controller is not attached on this page

So the immediate next focus for this task is:

- determine whether `localhost` is currently allowlisted in the active Chrome extension state
- if yes, determine whether the controller injection path is missing or running too late

## Root Cause Follow-up

The root cause was confirmed in code after the first smoke:

- `spoof/geolocation.js` had already been implemented
- but it was **not included** in `MAIN_WORLD_SCRIPT_FILES`
- therefore `root.IPGeoSpoofGeolocation` was `undefined` in `spoof/apply.js`
- so the geolocation controller branch never installed, even when the page itself was allowlisted

Relevant code path:

- `background/services.js` registers main-world files
- `spoof/apply.js` only installs the controller when `root.IPGeoSpoofGeolocation` exists

Fix:

- add `spoof/geolocation.js` into `MAIN_WORLD_SCRIPT_FILES` before `spoof/apply.js`

## Re-Smoke After Fix

After reloading the unpacked extension in Chrome, the same fixture page was re-run.

### Updated result

- top-level page
  - `language`: `en-US`
  - `timezone`: `America/Los_Angeles`
  - `window.__ipGeoGeolocationController`: `true`

- fixture behavior result
  - `successResult`: returned fixture-controlled coordinates
  - `watchResult`: returned stable `watchId = 1`
  - `clearWatchResult`: returned `cleared = true`
  - `errorResult`: returned forced error
    - `code = 1`
    - `message = "Permission denied (fixture)"`

- controller state after run
  - `hasForcedError = false`
  - `activeWatchIds = []`
  - `nextWatchId = 2`

### Interpretation

- The geolocation controller is now attached correctly on an allowlisted local fixture page.
- The first-round minimal behavior model is working as intended:
  - success branch
  - deterministic watch id
  - observable `clearWatch`
  - forced error branch

## Updated Conclusion

The local fixture smoke now proves the extension-controlled geolocation behavior model is active and testable.

Any remaining follow-up work should therefore focus on:

- optional real-site spot checks
- whether to expand beyond the current minimal behavior model

## Real-Site Spot Check

Site:

- `https://browserleaks.com/geo`

Observed page state:

- `Permissions API`
  - `Origin Permissions`: `prompt`
  - `Global Permissions`: `denied`
- `Geolocation API`
  - `API Status`: supported
  - `watchPosition`: active
- `Geolocation Data`
  - latitude: `34.0522342`
  - longitude: `-118.2436849`
  - accuracy: about `25.7 meters`

Interpretation:

- The real-site page was able to observe a stable geolocation result without needing the native browser permission flow to succeed in the ordinary way.
- The returned coordinates matched the fixture-controlled / spoof-controlled result shape rather than an empty or rejected state.
- This is sufficient as a first-round real-site spot check for the current minimal behavior model.
