# Custom site configuration refactor design

## Design Goal

Use the shipped v1.4 extension as the baseline and keep round two evidence-driven. The primary deliverable is a real Chrome smoke pass that can prove whether allowlisted and non-allowlisted behavior match the intended design. Runtime code changes happen only if the smoke pass exposes a concrete inconsistency.

## Scope Boundary

- In scope:
  - Load the real extension in Chrome and verify behavior on selected allowlisted and non-allowlisted sites.
  - Record inconsistencies by signal and by site.
  - Fix only confirmed defects in the path that produces the inconsistency.
  - Optionally add a popup shortcut to `test.html` if repeatedly opening the test page becomes friction during verification.
- Out of scope:
  - New fingerprint surfaces.
  - Rule-note, rule-template, rule-duplication, or packaging automation work.
  - Reopening the first-round configuration model without smoke evidence.

## Verification Matrix

Smoke coverage should use one Chrome session with the unpacked extension loaded from the repository and should exercise:

- allowlisted sites: `chatgpt.com`, `claude.ai`, `gemini.google.com`
- detection sites: `browserleaks.com`, `whoer.net`
- one ordinary non-allowlisted site to confirm no page-level spoof side effects

For each target, verify:

- whether the site is allowlisted or not
- page JavaScript values:
  - `navigator.language`
  - `navigator.languages`
  - `Intl.DateTimeFormat().resolvedOptions().timeZone`
  - `Date#getTimezoneOffset()`
  - `navigator.geolocation`
- request/header-facing behavior where visible:
  - `Accept-Language`
- global browser behavior:
  - WebRTC mode effects under the configured global policy

## Defect Triage Rules

If smoke exposes a mismatch, triage it into one authoritative code path before editing:

- DNR or request-header mismatch:
  - inspect `background.js` rule generation and rule refresh timing
- allowlist mismatch or wrong domain targeting:
  - inspect `config.js` normalization, matching, and effective-profile resolution
- injected page value mismatch:
  - inspect `content.js`, `background.js` injection flow, and `main_spoof.js`
- popup state mismatch:
  - inspect `popup.js` state loading versus the same effective-profile resolver used by runtime code
- option-save mismatch:
  - inspect `options.js` form serialization and `config.js` validation/normalization

Fixes should stay inside the confirmed ownership boundary instead of adding a second resolver or fallback path.

## Optional Popup Shortcut

`popup.html` currently has a compact actions area and an existing “完整配置” button. A `test.html` shortcut is feasible as a local popup change because the popup already exposes action buttons and `background.js` already opens other extension pages.

This shortcut remains optional and should be added only when:

- the smoke workflow requires repeatedly opening `test.html`, and
- the shortcut meaningfully reduces verification friction

The shortcut should not pull additional config or testing features into popup scope.

## Validation Strategy

Round-two validation is layered:

1. Real Chrome smoke verification against the selected sites.
2. If code changes occur, rerun the relevant smoke cases that failed before.
3. Re-run the existing static syntax checks:
   - `node --check config.js`
   - `node --check background.js`
   - `node --check popup.js`
   - `node --check options.js`
   - `node --check content.js`
   - `node --check main_spoof.js`

## Rollback Shape

- If smoke finds no defects, no runtime rollback is needed because no functional code changes are required.
- If a targeted fix regresses unrelated behavior, revert only the local defect fix rather than reopening the whole v1.4 refactor.
- If the optional popup shortcut creates noise or layout pressure, drop that shortcut and keep the smoke-only scope.
