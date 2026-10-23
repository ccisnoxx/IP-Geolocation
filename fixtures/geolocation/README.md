# Geolocation Fixture

Minimal local fixture page for geolocation behavior checks.

## Start

Run a local static server from the repository root:

```bash
python3 -m http.server 8765
```

Then open:

```text
http://localhost:8765/fixtures/geolocation/top.html
```

## Covered In First Round

- `getCurrentPosition` success
- `watchPosition`
- `clearWatch`

## Not Covered In First Round

- `permissions.query({ name: "geolocation" })`
- real browser permission prompt lifecycle
- full native geolocation timing semantics
