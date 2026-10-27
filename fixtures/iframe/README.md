# iframe Fixture

Minimal local fixture pages for iframe/subframe consistency checks.

## Start

Run a local static server from the repository root:

```bash
python3 -m http.server 8765
```

Then open:

```text
http://localhost:8765/fixtures/iframe/top.html
```

The current machine resolves these hosts to `127.0.0.1`:

- `localhost`
- `child.localhost`
- `nonmatch.localhost`

## Suggested Allowlist Setup

- Add `localhost`
- Add `child.localhost`
- Do not add `nonmatch.localhost`

## Scenarios

- same-origin child
- allowlisted child
- non-matching child
- `srcdoc` child
- `about:blank` child
