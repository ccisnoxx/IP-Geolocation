# Directory Structure

> How frontend code is organized in this project.

---

## Overview

This project is a native Chromium extension, not a bundled SPA. Frontend code is split by runtime boundary first, then by page or shared concern. Entry files stay at the repository root only when Chrome or HTML requires a fixed path; real logic belongs in grouped modules.

---

## Directory Layout

```
.
├── popup.html / popup.js          # Popup page shell + fixed entry filename
├── options.html / options.js      # Options page shell + fixed entry filename
├── test.html / test.js            # Diagnostic page shell + fixed entry filename
├── main_spoof.js                  # Main-world fixed entry filename
├── content.js                     # Bridge content-script fixed entry filename
├── background.js                  # Service worker fixed entry filename
├── pages/
│   ├── popup-page.js              # Popup controller and rendering logic
│   ├── options-page.js            # Options controller and form logic
│   └── test-page.js               # Diagnostic page controller
├── fixtures/
│   └── iframe/                    # Repo-local iframe/subframe smoke fixtures for diagnostic boundary checks
├── shared/
│   ├── config-*.js                # Shared config normalization / profile resolution
│   ├── diagnostic.js              # Shared diagnostic model helpers
│   ├── runtime.js                 # Shared Chrome callback/runtime wrappers
│   ├── page-formatters.js         # Shared page formatting helpers
│   └── options-form.js            # Shared options form helpers
├── spoof/
│   ├── date-time.js               # Main-world timezone / locale patch logic
│   ├── worker-hooks.js            # Worker / SharedWorker patch logic
│   └── apply.js                   # Payload application entry helpers
└── background/
    ├── services.js                # Background service implementations
    └── message-router.js          # Runtime action dispatch
```

---

## Module Organization

### Rule: Keep root files as thin shells

Root files such as `background.js`, `popup.js`, `options.js`, `test.js`, and `main_spoof.js` exist because Chrome or HTML refers to those exact paths. They should only:

- load grouped modules in a fixed order
- register listeners
- call one top-level initializer

Do not put new business logic directly into those files unless the logic is inseparable from the entry contract.

### Rule: Split by runtime boundary before feature

Put code where it runs:

- `background/` for service-worker-only logic
- `spoof/` for main-world injection logic
- `pages/` for extension page controllers
- `fixtures/` for repo-local smoke or boundary fixtures that support extension diagnostics without introducing a separate app stack
- `shared/` for logic reused across more than one runtime boundary

If a helper is used by both browser runtime and Node tests, prefer a `shared/` module with a browser global export plus `module.exports`.

---

## Naming Conventions

- Use kebab-case for grouped module filenames, for example `popup-page.js`, `message-router.js`, `page-formatters.js`.
- Reserve `*.html` + same-name root `*.js` pairs for actual extension pages.
- Name modules by responsibility, not by screen section count or temporary refactor phase.

### Wrong

```js
// popup.js
// 250+ lines of DOM lookup, runtime messaging, formatting, and action handling
```

### Correct

```js
// popup.js
document.addEventListener('DOMContentLoaded', () => {
  window.IPGeoPopupPage.init(document);
});
```

---

## Examples

- Thin entry example: `/popup.js`
- Shared reusable logic example: `/shared/diagnostic.js`
- Background shell + service split example: `/background.js` and `/background/services.js`
