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

### Don't: Replace `Navigator.prototype` getters with plain page-visible closures

Browser fingerprint checks can flag custom getters on `Object.getPrototypeOf(navigator)`, especially `userAgent`, `platform`, and `languages`, because native getters stringify with `[native code]`. Do not replace these getters with plain closures or arrow functions.

If a spoofed page-visible surface requires descriptor or source-shape camouflage, route it through the central anti-detection registry in `src/injected/runtime.ts`. Do not add ad hoc reflection patches, marker globals, or one-off `Function.prototype.toString` overrides beside a local spoof.

If the runtime uses a hidden `Symbol` anchor for idempotence, hiding it from `Object.getOwnPropertySymbols(window)` is not sufficient. Exact-key probes such as `Symbol.for(anchorKey) in window` and `Symbol.keyFor(anchor)` must also be handled by the central registry virtualization.

Wrong:

```ts
const navigatorPrototype = Object.getPrototypeOf(navigator);
Object.defineProperty(navigatorPrototype, 'languages', {
  get: () => ['en-US', 'en'],
  configurable: true
});
```

Correct:

```ts
const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
const getter = descriptor?.get;

Object.defineProperty(Navigator.prototype, 'languages', {
  ...descriptor,
  get: new Proxy(getter, {
    apply(target, thisArg, args) {
      if (thisArg === navigator) return Object.freeze(['en-US', 'en']);
      return Reflect.apply(target, thisArg, args);
    }
  })
});
```

Why:

- `navigator` does not gain an obvious own `languages` property.
- The prototype descriptor stays in the native location.
- The getter proxy preserves native-like `name`, `length`, and `toString()` behavior from the original getter.
- Invalid receivers still flow to the native getter, preserving native error behavior.
- Reflection virtualization remains centralized and can hide internal anchors consistently across surfaces.
- Hidden anchors are not exposed by exact `Symbol.for`/`Symbol.keyFor` probes.

### Don't: Turn geo spoofing into broad device fingerprint fabrication by default

VanishGeo runs inside the user's real Chrome browser. Treat unrelated local-device surfaces such as WebGL/GPU, Audio, `screen`, hardware concurrency, device memory, native font inventory, codecs, and WebGPU as real pass-through signals unless a target-specific detection trace proves that a surface must be controlled.

Default anti-detection work should focus on the surfaces VanishGeo intentionally owns:

- language values and the `Accept-Language` request header
- timezone, locale, and `Intl`/`Date` outputs
- geolocation method behavior and geolocation permission state
- WebRTC network leak protection
- reflection, descriptor, marker, iframe, and worker consistency for surfaces already hooked

Why:

- IP location does not uniquely determine the user's GPU, CPU, fonts, screen, Audio path, or browser UI language.
- Spoofing unrelated high-entropy device surfaces creates new descriptor, `toString()`, iframe, worker, and value-consistency obligations.
- A real browser with a VPN, proxy, remote-work setup, or multilingual environment can legitimately have mixed geo and device signals.

If a future change adds WebGL, Audio, screen, hardware, font, codec, or WebGPU spoofing, it must cite the target detection trace and route the hook through the central registry and validation harness. Do not add one-off "full fingerprint profile" hooks.

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

### Required: Run leak diagnostics from an allowlisted web origin

`chrome-extension://` pages are extension origins, not target web pages. Chrome does
not inject this extension's dynamic content scripts into its own extension pages,
and users cannot validate allowlist behavior there.

Diagnostic pages that need to prove page-visible spoofing must be served from a
normal HTTP(S) origin that can be added to VanishGeo rules, such as
`http://localhost:<port>/...`. Extension-hosted diagnostic pages may exist only
as launcher, instruction, or baseline panels.

### Required: Keep a real-Chrome acceptance entry

Changes that touch injection, permissions, request headers, worker/iframe
propagation, WebRTC policy, or pass-through surface diagnostics must keep
`npm run test:e2e:chrome` runnable after `npm run build`.

The command may remain semi-automated, but it must launch or clearly target a
real Chrome profile with the unpacked `dist/` extension and must list checks for:

- `Accept-Language` request headers from a web origin
- WebRTC policy plus ICE candidate exposure
- timezone, locale, and geolocation behavior
- same-origin iframe and worker realms
- pass-through real-device surfaces that VanishGeo does not spoof by default

Do not replace this with a Node-only unit test. Unit tests may guard structure,
but they do not prove Chrome's MV3 permission, DNR, privacy, or injection
behavior.

### Required: Browser-boundary-preserving refactors

Refactors may change internal layout, but must not silently change:

- manifest entry filenames
- runtime message action names
- storage keys and payload shapes
- permission and host scope unless the task explicitly targets them

### Required: Extension popup viewport owns its own scroll container

Chrome action popups are sized differently from normal tabs. Do not rely on
`body { max-height: ...; overflow-y: auto; }` or a wide body such as 420px+ for
the popup page, because Chrome may crop the visible popup instead of showing the
intended layout.

Popup pages should define an explicit, conservative viewport on both `html` and
`body`, hide outer overflow, and put scrolling on an inner app container:

```css
html,
body {
  width: 380px;
  height: 600px;
  overflow: hidden;
}

.container {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
}
```

Grid and flex children inside the popup should set or inherit `min-width: 0`,
and long domain / status / button text should wrap instead of forcing horizontal
overflow. Add a wiring test when changing this contract so the popup does not
regress into a cropped Chrome action window.

### Required: Document manifest permission boundaries

Any manifest permission or host permission change must update `PERMISSIONS.md`
and a wiring test in the same change. Keep the manifest permission list minimal
but evidence-based: remove redundant permissions such as `activeTab` only when
existing permissions and code paths prove they are unnecessary; defer high-risk
host permission narrowing when it requires new UX, denied-permission states, or
DNR re-registration behavior.

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
