const test = require('node:test');
const assert = require('node:assert/strict');

const diagnostic = require('../shared/diagnostic');

test('buildEffectiveDiagnosticPayload accepts raw payload and state wrapper', () => {
  const payload = {
    languageConfig: {
      language: 'en-US',
      languages: ['en-US', 'en'],
      acceptLanguage: 'en-US,en;q=0.9'
    },
    timezone: 'UTC',
    timezoneSource: 'manual',
    geolocation: {
      latitude: 1,
      longitude: 2,
      country: 'X'
    }
  };

  assert.deepEqual(
    diagnostic.buildEffectiveDiagnosticPayload(payload),
    diagnostic.buildEffectiveDiagnosticPayload({ payload })
  );
});

test('buildTimezoneDiagnostic derives UTC offsets and labels', () => {
  const result = diagnostic.buildTimezoneDiagnostic({
    timezone: 'UTC',
    timezoneSource: 'manual'
  });

  assert.equal(result.timezone, 'UTC');
  assert.equal(result.source, 'manual');
  assert.equal(result.currentOffsetMinutes, 0);
  assert.equal(result.currentOffsetLabel, 'GMT+00:00');
});

test('buildIntlExpectedDiagnostics returns keyed locale expectations', () => {
  const diagnostics = diagnostic.buildIntlExpectedDiagnostics('en-US');

  assert.ok(diagnostics.numberFormat);
  assert.ok(diagnostics.collator);
  assert.ok(diagnostics.segmenter);
  assert.equal(typeof diagnostics.numberFormat.locale, 'string');
});

test('buildRequestHeaderProbe parses browserleaks header table', () => {
  const result = diagnostic.buildRequestHeaderProbe({
    url: 'https://browserleaks.com/ip',
    html: `
      <table>
        <tbody id="headers">
          <tr><td>Request</td><td>GET /ip HTTP/2.0</td></tr>
          <tr><td>Accept-Language</td><td>ja-JP,ja;q=0.9,en;q=0.8</td></tr>
        </tbody>
      </table>
    `
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'browserleaks_ip');
  assert.equal(result.observedAcceptLanguage, 'ja-JP,ja;q=0.9,en;q=0.8');
});

test('buildRequestHeaderProbe parses httpbin header json', () => {
  const result = diagnostic.buildRequestHeaderProbe({
    url: 'https://httpbin.org/headers',
    bodyText: JSON.stringify({
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    })
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'httpbin_headers');
  assert.equal(result.observedAcceptLanguage, 'en-US,en;q=0.9');
});

test('buildRequestHeaderProbe normalizes httpbingo array header json', () => {
  const result = diagnostic.buildRequestHeaderProbe({
    url: 'https://httpbingo.org/headers',
    bodyText: JSON.stringify({
      headers: {
        'Accept-Language': ['en-US,en;q=0.9']
      }
    })
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'httpbingo_headers');
  assert.equal(result.observedAcceptLanguage, 'en-US,en;q=0.9');
});

test('buildRequestHeaderProbe returns unsupported for unrecognized pages', () => {
  const result = diagnostic.buildRequestHeaderProbe({ url: 'https://example.com/' });

  assert.equal(result.status, 'unsupported');
  assert.equal(result.observedAcceptLanguage, null);
  assert.match(result.message, /browserleaks\.com\/ip/);
});

test('buildRequestHeaderProbe returns parse_error when supported source lacks header', () => {
  const result = diagnostic.buildRequestHeaderProbe({
    url: 'https://httpbin.org/headers',
    bodyText: JSON.stringify({
      headers: {
        Accept: '*/*'
      }
    })
  });

  assert.equal(result.status, 'parse_error');
  assert.equal(result.source, 'httpbin_headers');
  assert.equal(result.observedAcceptLanguage, null);
});
