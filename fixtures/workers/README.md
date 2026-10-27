# Worker Fixture

Minimal local fixture pages for `Worker / SharedWorker` locale-timezone checks.

## Start

Run a local static server from the repository root:

```bash
python3 -m http.server 8765
```

Then open:

```text
http://localhost:8765/fixtures/workers/top.html
```

## Suggested Allowlist Setup

- Add `localhost`

## Covered In First Round

- classic `Worker`
- module `Worker`
- `SharedWorker`
- nested worker boundary observation

## Not Covered In First Round

- `serviceWorker` runtime hook support
