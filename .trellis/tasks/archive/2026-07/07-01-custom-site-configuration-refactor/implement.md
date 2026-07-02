# Custom site configuration refactor implementation plan

## Ordered Checklist

1. Prepare the real-browser smoke environment.
   - Use the repository worktree as the unpacked extension source.
   - Load the extension in Chrome from `chrome://extensions`.
   - Confirm the extension version is `1.4`.
   - Confirm no proxy permission is requested.

2. Seed a deterministic smoke configuration.
   - Enable the master switch.
   - Add allowlist rules for `chatgpt.com`, `claude.ai`, and `gemini.google.com`.
   - Choose one clear global language/timezone/geolocation profile that is easy to recognize on detection sites.
   - Keep WebRTC mode explicit during the run and note which mode is under test.

3. Run the smoke pass.
   - Visit the local `test.html` page when needed to confirm baseline injected values.
   - Visit `chatgpt.com`, `claude.ai`, and `gemini.google.com`.
   - Visit `browserleaks.com` and `whoer.net`.
   - Visit at least one clearly non-allowlisted site.
   - Record, for each site, whether language, timezone, geolocation, `Accept-Language`, and WebRTC behavior match expectations.

4. Decide whether code changes are needed.
   - If no inconsistency is found, stop implementation work.
   - If opening `test.html` repeatedly was a real bottleneck, optionally add one popup shortcut to it and keep the change local to popup/runtime page-opening flow.
   - If inconsistencies are found, pick the smallest confirmed defect path and fix that path only.

5. Re-verify only the affected areas after each fix.
   - Re-run the exact site/signal cases that failed before.
   - Confirm non-allowlisted behavior still stays untouched.
   - Reconfirm DNR or WebRTC behavior if the fix touched those paths.

6. Run static verification if code changed.
   - `node --check config.js`
   - `node --check background.js`
   - `node --check popup.js`
   - `node --check options.js`
   - `node --check content.js`
   - `node --check main_spoof.js`

## Decision Gates

- Gate A: no real Chrome smoke evidence, no runtime changes.
- Gate B: no confirmed inconsistency, no speculative fingerprint work.
- Gate C: popup `test.html` shortcut is allowed only if it directly helps smoke efficiency.
- Gate D: each fix must name the failing site, failing signal, code owner, and verification step that proves it is fixed.

## Likely Touch Points If Defects Appear

- `background.js`
  - DNR `Accept-Language` rule generation
  - tab update injection timing
  - WebRTC policy application
- `config.js`
  - domain normalization and longest-match logic
  - effective-profile resolution
- `content.js`
  - page bridge behavior on allowlisted vs non-allowlisted sites
- `main_spoof.js`
  - page-world overrides for language, timezone, geolocation, and worker-related behavior
- `popup.html` / `popup.js`
  - optional `test.html` entry only

## Verification Notes

- Prefer proving issues in the browser before touching code.
- Keep a simple result log by site and signal so the same checks can be replayed after fixes.
- If a detection site exposes only partial information, use the local `test.html` page plus browser devtools/network evidence to close the gap.

## Rollback Points

- If a fix attempt broadens scope beyond one confirmed defect path, pause and rescope before editing further.
- If a popup shortcut begins to pull in extra testing UX, remove that addition and return to the smoke-only plan.
- If no inconsistency can be reproduced reliably, do not patch based on suspicion alone.
