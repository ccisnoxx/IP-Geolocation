# Custom site configuration refactor

## Goal

Treat v1.4 as the shipped baseline for the allowlist-based refactor, then execute the smallest safe second round: real Chrome smoke verification of the released extension, followed only by fixes for inconsistencies confirmed in that smoke pass. The only allowed scope addition is a small popup shortcut to `test.html` if it materially improves verification efficiency.

## Background And Evidence

- Local Git state shows the refactor is already released: `HEAD` is `6d9e469`, tagged `v1.4`, and matches `origin/main`. The previous upstream remains `upstream/main` at `6fabb80`.
- The worktree still has untracked local-only workflow and IDE directories: `.agents/`, `.codex/`, `.idea/`, `.trellis/`, and `AGENTS.md`. These are not part of the shipped extension source.
- `manifest.json` is now version `1.4`, declares `options_page: "options.html"`, exposes `test.html` as a web-accessible resource, and no longer requests the `proxy` permission.
- `config.js` now owns the unified `siteSpoofConfig` schema, validation, longest-suffix domain matching, effective-profile resolution, and legacy migration from `extensionEnabled`, `languageConfig`, `timezoneConfig`, and `webRtcConfig`.
- `background.js` now applies per-rule `Accept-Language` DNR rules, keeps WebRTC global through `chrome.privacy.network.webRTCIPHandlingPolicy`, migrates legacy config into `siteSpoofConfig`, and no longer uses `chrome.proxy.settings`.
- `popup.js` / `popup.html` already implement current-site allowlist quick actions, effective-profile summary, manual IP-location refresh, and an options-page entry point. There is not yet a one-click entry to `test.html`.
- `options.js` / `options.html` already implement global profile editing, per-rule inherit/override/disable controls, enable/disable toggles, add/delete rule management, and JSON import/export. There is not yet rule note metadata, rule duplication, or built-in common-site templates.
- `test.html` already checks `navigator.language`, `navigator.languages`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, `Date#getTimezoneOffset()`, `Date#toString()`, and `navigator.geolocation`.
- README has already been rewritten around allowlist behavior and no longer describes extension-managed proxying, but it still reminds users to route `ipwho.is`, `ipapi.co`, and `ipinfo.io` with the target sites.
- Repository evidence confirms first-round static validation was done, but there is still no confirmed end-to-end smoke result from a real Chrome extension session against external fingerprint-checking sites.

## Requirements

- R1: Treat the v1.4 release as the functional baseline. Second-round work must not re-open first-round design decisions unless real-browser evidence shows a defect.
- R2: The first mandatory second-round activity is real Chrome smoke verification of the shipped extension against representative allowlisted and non-allowlisted targets.
- R3: Smoke verification must explicitly cover:
  - allowlisted sites: `chatgpt.com`, `claude.ai`, `gemini.google.com`
  - external detection sites: `browserleaks.com`, `whoer.net`
  - at least one clearly non-allowlisted ordinary site to confirm no spoof side effects
- R4: Smoke verification must check page-level JavaScript values and request/header-facing behavior together where applicable: `navigator.language`, `navigator.languages`, `Accept-Language`, `Intl` timezone, `Date#getTimezoneOffset()`, geolocation behavior, and WebRTC global mode.
- R5: Any code changes in round two should default to confirmed inconsistency fixes discovered in smoke testing, not speculative fingerprint expansion.
- R6: A one-click popup entry to the local `test.html` page is allowed only as a small supporting change for smoke-test efficiency. It is not required if verification can proceed cleanly without it.
- R7: Rule notes, rule duplication, common-site templates, release packaging automation, and deeper fingerprint fields such as `navigator.userAgentData`, `Intl.Locale`, `screen`, or `deviceMemory` are explicitly deferred from this round.
- R8: If smoke verification does not reveal an inconsistency, the round may end with a verification record and zero runtime code changes.
- R9: If smoke verification reveals an inconsistency, fixes must stay scoped to the confirmed defect path plus the minimum supporting diagnostics or UI affordance needed to verify the fix.

## Acceptance Criteria

- AC1: Planning identifies one explicit second-round scope boundary instead of mixing smoke validation, UX polish, packaging automation, and deeper fingerprint work in one undifferentiated task.
- AC2: The chosen second-round scope includes a concrete smoke-test checklist for real Chrome verification before any speculative feature expansion.
- AC3: If smoke testing finds no inconsistencies, the task may complete with a verification record alone, or with at most one small popup shortcut to `test.html` if that shortcut was used to improve verification.
- AC4: If smoke testing finds inconsistencies, the next implementation task is scoped to those confirmed defects plus the minimum supporting diagnostics needed to reproduce and verify them.
- AC5: Optional follow-up work outside the chosen scope remains explicitly deferred rather than silently folded into the next implementation round.

## Out Of Scope

- Re-implementing or redesigning the already-shipped v1.4 allowlist architecture without defect evidence.
- Folding multiple unrelated follow-ups into one implementation round by default.
- Chrome Web Store publication, cloud sync, remote rule lists, or framework rewrites.
- Per-domain proxy or WebRTC control. Routing remains external and WebRTC remains browser-global.
- New fingerprint surfaces unless smoke evidence or an explicit scope decision justifies them.

## Open Questions

None. Planning is ready for review before `task.py start`.
