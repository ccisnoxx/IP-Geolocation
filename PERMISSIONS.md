# VanishGeo Permission Boundary

This file records the current Manifest V3 permission boundary. It is part of the P0 engineering guardrail after the BrowserInsight anti-detection work.

## Required Permissions

| Permission | Owner | Why it is required |
|---|---|---|
| `storage` | background, options, popup | Stores `siteSpoofConfig`, last IP location, migration markers, and error state. |
| `alarms` | background | Runs scheduled IP geolocation refreshes. |
| `scripting` | background | Registers dynamic content scripts for allowlisted domains and applies the main-world runtime to matching tabs. |
| `tabs` | background, popup, context menu | Reads active/all tab URLs for site status, reinjects matching tabs after config changes, opens diagnostics, and reloads tabs from context menu actions. |
| `contextMenus` | background | Provides action-menu controls for enabling/disabling rules, opening diagnostics, and resetting WebRTC policy. |
| `privacy` | background | Sets and reads `chrome.privacy.network.webRTCIPHandlingPolicy` for WebRTC leak protection. |
| `declarativeNetRequest` | background | Updates dynamic rules that align `Accept-Language` request headers with the effective language profile. |
| `declarativeNetRequestWithHostAccess` | background | Allows DNR header modification on hosts covered by `host_permissions`. |

## Host Permission Boundary

`host_permissions` currently remains `"<all_urls>"` because users can add arbitrary allowlisted domains at runtime, and the extension must be able to register content scripts, execute immediate injections, and apply DNR header rules for those configured domains.

The runtime does not register static `<all_urls>` content scripts. Dynamic script matches are still derived from enabled allowlist rules in `getContentScriptMatches()`.

Moving from `"<all_urls>"` to optional per-site host permissions is intentionally deferred. That change needs a separate UX and error-state design for host permission prompts, denied permissions, re-registration after permission changes, and DNR rule repair.

## Removed Or Avoided Permissions

`activeTab` is intentionally not requested. The extension already requires `tabs` for all-tab refresh, context-menu tab reloads, diagnostic tab creation, and current-tab site status. Keeping both `tabs` and `activeTab` would add a redundant permission without reducing the existing warning surface.

The extension must not request permissions for default spoofing of unrelated device fingerprint surfaces such as WebGL/GPU, Audio, screen, hardware concurrency, device memory, codecs, fonts, or WebGPU. Those surfaces stay pass-through unless a target-specific detection trace justifies a future, separately planned change.
