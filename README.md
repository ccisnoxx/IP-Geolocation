# VanishGeo

VanishGeo is a Chromium MV3 privacy extension based on
[VanishMe](https://github.com/XiNian-dada/VanishMe). It keeps VanishMe's popup,
options, profile, import/export, and canvas capabilities while using a single
site configuration model and dynamic injection pipeline from the IP-Geolocation
project.

## Core Capabilities

- Per-domain allowlist rules with global profile inheritance and per-rule
  overrides.
- Dynamic MAIN-world runtime injection for language, timezone, geolocation, and
  worker environments.
- Dynamic DNR rules for per-domain `Accept-Language` request headers.
- WebRTC IP leak policy control with strict, compatible, and browser-default
  modes.
- Automatic IP geolocation refresh with cached `lastLocation`.
- Popup/options profile management, import/export, canvas font spoofing, and
  diagnostic fixtures.

## Development

```bash
npm install
npm test
npm run build
```

The production extension is emitted to `dist/`. Load `dist/` as an unpacked
extension in Chromium-based browsers for manual smoke testing.

## Architecture

VanishGeo intentionally has one authoritative source for configuration and
matching:

- `src/shared/config-model.ts` owns normalization, defaults, and primitive
  validation.
- `src/shared/config-resolver.ts` owns rule matching and effective payload
  resolution.
- `src/shared/storage.ts` owns storage migration and persistence.
- `src/background/services.ts` owns runtime side effects: dynamic content script
  registration, DNR, WebRTC, IP geolocation, and tab payload injection.
- `src/injected/runtime.ts` owns all page-world spoofing.

Do not add a second domain matcher, storage key, or static all-URL injection
path.

## License

VanishGeo is distributed under the MIT License. See `LICENSE` and `NOTICE`.
