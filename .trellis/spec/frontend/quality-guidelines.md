# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

This project runs as a native browser extension without a bundler. Quality checks must protect load order, fixed entry filenames, and shared-runtime contracts, not just pure business logic.

---

## Forbidden Patterns

### Don't: Grow root entry files back into large controllers

`background.js`, `popup.js`, `options.js`, `test.js`, and `main_spoof.js` must stay thin. If a change adds meaningful logic there, move that logic into `background/`, `pages/`, `shared/`, or `spoof/`.

### Don't: Duplicate cross-page or cross-runtime helpers

If popup, options, test, background, or content/main-world code needs the same transform, formatting, or contract logic, put it in `shared/` before adding a third copy.

### Don't: Introduce bundler-only assumptions

Do not require path aliases, transpilation, ESM-only packaging, or build-time code generation for runtime correctness. The extension must remain directly loadable from the repository.

---

## Required Patterns

### Required: Wiring-safe module exports

Modules reused by extension runtime and Node tests should expose a browser global and `module.exports` so tests can import the same logic the extension uses.

### Required: Stable entry wiring checks

When adding or moving runtime files:

- verify every `<script src="...">` in extension HTML points to an existing file
- verify every `importScripts(...)` reference points to an existing file
- verify every `registerContentScripts(... js: [...])` reference points to an existing file

If these checks are not already covered, add or update a test.

### Required: Browser-boundary-preserving refactors

Refactors may change internal layout, but must not silently change:

- manifest entry filenames
- runtime message action names
- storage keys and payload shapes
- permission and host scope unless the task explicitly targets them

### Required: Module Worker bootstrap order

When generating a bootstrap wrapper for a module worker, do not place the real module load behind a static `import "..."` after the patch prelude.

Wrong:

```js
PATCH();
import "worker-module.js";
```

Correct:

```js
PATCH();
await import("worker-module.js");
```

Why:

- the patch must run before the real module worker code executes
- a dynamic import preserves that ordering in the generated wrapper
- this avoids the module-worker path silently behaving like an unpatched native worker

---

## Testing Requirements

### Minimum required after frontend extension refactors

1. Node-side unit tests for extracted pure logic
2. Wiring tests for root entry files, HTML script references, and content-script registration lists
3. Syntax validation for newly added runtime modules
4. At least one live smoke proving the unpacked extension still injects or runs in Chrome after reload

For this project, `npm test` is the baseline command. If a refactor changes runtime boundaries, add a test that would fail if a referenced file were renamed, moved, or omitted.

### Good

```js
// tests/extension-wiring.test.js
// checks manifest service worker, HTML script refs, importScripts refs,
// and registered content-script file lists
```

### Wrong

```js
// Only unit-test shared helpers while assuming Chrome entry wiring still works
```

---

## Code Review Checklist

- Are root entry files still thin shells?
- Did any shared transform get duplicated instead of extracted?
- Do HTML, `importScripts`, and dynamic content-script references still point to real files?
- Does the change preserve runtime contracts and permissions unless explicitly requested otherwise?
- Is there at least one runtime smoke or equivalent evidence that the unpacked extension still runs after reload?
