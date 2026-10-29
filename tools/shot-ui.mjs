#!/usr/bin/env node
/*
 * UI 截图工具：真实加载 dist/ 扩展，截 popup / options 两个页面，供视觉核对。
 * 用法：node tools/shot-ui.mjs [--page=popup|options|all] [--legacy=1]
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CDP, killChrome, launchChrome } from './lib/cdp.mjs';
import { loadExtension } from './lib/extension.mjs';
import { evaluate, openPageStable, waitFor } from './lib/e2e.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'tools', 'out', 'ui');
mkdirSync(OUT, { recursive: true });

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const pageArg = String(argv.page || 'all');

if (argv.legacy === '1') {
  process.env.VANISHGEO_LEGACY_EXTENSION = '1';
  process.env.VANISHGEO_EXTENSION = DIST;
}

const chrome = await launchChrome({
  userDataDir: mkdtempSync(join(tmpdir(), 'vanishgeo-shot-')),
  headless: true,
  args: []
});
const cdp = await CDP.connect(chrome.websocketUrl);

async function shot(sessionId, file, { width, height, full = false, prepare = '' }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false
  }, sessionId);
  if (prepare) await evaluate(cdp, sessionId, prepare);
  if (full) {
    const metrics = await cdp.send('Page.getLayoutMetrics', {}, sessionId);
    const contentHeight = Math.ceil(metrics.cssContentSize?.height || height);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: contentHeight,
      deviceScaleFactor: 2,
      mobile: false
    }, sessionId);
  }
  await new Promise((r) => setTimeout(r, 280));
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`✓ ${file}`);
}

async function cleanup() {
  try { cdp.close(); } catch { /* noop */ }
  try { killChrome(chrome.child); } catch { /* noop */ }
  try { rmSync(chrome.userDataDir, { recursive: true, force: true }); } catch { /* noop */ }
}

try {
  const extensionId = await loadExtension(cdp, DIST);
  if (!extensionId) throw new Error('扩展没有返回 extension id');

  if (pageArg === 'popup' || pageArg === 'all') {
    const popup = await openPageStable(cdp, `chrome-extension://${extensionId}/popup/popup.html`);
    await waitFor(async () => {
      const text = await evaluate(cdp, popup.sessionId, 'document.getElementById("globalStatus")?.textContent || ""');
      return text.includes('全局保护');
    }, { timeout: 10000, label: 'popup load' });
    // 等 loadConfig 把当前站点写进来，再用展示值覆盖；避免扩展页自己的 host 抢镜
    await waitFor(async () => {
      const host = await evaluate(cdp, popup.sessionId, 'document.getElementById("currentSite")?.textContent || ""');
      return host && host !== '-';
    }, { timeout: 10000, label: 'popup site' });

    const showcase = `(() => {
      document.getElementById('currentSite').textContent = 'chatgpt.com';
      document.getElementById('currentSiteSites').textContent = 'chatgpt.com';
      const okBadge = document.getElementById('siteOk');
      okBadge.hidden = false;
      document.getElementById('geolocationEnabled').checked = true;
      document.getElementById('timezoneEnabled').checked = true;
      document.getElementById('languageEnabled').checked = true;
      document.getElementById('webrtcEnabled').checked = true;
    })()`;
    await shot(popup.sessionId, join(OUT, 'popup-viewport.png'), {
      width: 400, height: 600, prepare: showcase
    });
    await shot(popup.sessionId, join(OUT, 'popup-config.png'), {
      width: 400, height: 600,
      prepare: `document.querySelector('.seg-btn[data-view=\"config\"]')?.click()`
    });
    await shot(popup.sessionId, join(OUT, 'popup-sites.png'), {
      width: 400, height: 600,
      prepare: `document.querySelector('.seg-btn[data-view=\"sites\"]')?.click()`
    });
    await shot(popup.sessionId, join(OUT, 'popup-full.png'), {
      width: 400, height: 600, full: true,
      prepare: `${showcase}
        document.querySelector('.seg-btn[data-view=\"overview\"]')?.click();
        document.documentElement.style.height = 'auto';
        document.body.style.height = 'auto';
        document.body.style.overflow = 'visible';
        var app = document.querySelector('.app');
        if (app) app.style.height = 'auto';
        var views = document.querySelector('.views');
        if (views) { views.style.overflow = 'visible'; views.style.flex = 'none'; }
      `
    });
    await shot(popup.sessionId, join(OUT, 'popup-config-full.png'), {
      width: 400, height: 600, full: true,
      prepare: `${showcase}
        document.querySelector('.seg-btn[data-view=\"config\"]')?.click();
        document.querySelectorAll('details.setting').forEach((d) => { d.open = true; });
        document.documentElement.style.height = 'auto';
        document.body.style.height = 'auto';
        document.body.style.overflow = 'visible';
        var app = document.querySelector('.app');
        if (app) app.style.height = 'auto';
        var views = document.querySelector('.views');
        if (views) { views.style.overflow = 'visible'; views.style.flex = 'none'; }
      `
    });
  }

  if (pageArg === 'options' || pageArg === 'all') {
    const options = await openPageStable(cdp, `chrome-extension://${extensionId}/options/options.html`);
    await waitFor(async () => {
      const ready = await evaluate(cdp, options.sessionId, 'document.getElementById("save")?.disabled === false');
      return ready;
    }, { timeout: 10000, label: 'options load' });
    await shot(options.sessionId, join(OUT, 'options-viewport.png'), {
      width: 1080, height: 900,
      prepare: `(() => {
        document.getElementById('save').disabled = false;
        const status = document.getElementById('ipSyncStatus');
        if (status) status.textContent = '上次同步：2026-10-29 15:42 · 出口 203.0.113.42 · 美国 · 洛杉矶';
      })()`
    });
    await shot(options.sessionId, join(OUT, 'options-full.png'), {
      width: 1080, height: 900, full: true,
      prepare: `(() => {
        document.getElementById('save').disabled = false;
        const status = document.getElementById('ipSyncStatus');
        if (status) status.textContent = '上次同步：2026-10-29 15:42 · 出口 203.0.113.42 · 美国 · 洛杉矶';
      })()`
    });

    if (argv.states === '1') {
      for (const tab of ['timezone', 'language', 'webrtc']) {
        await shot(options.sessionId, join(OUT, `options-tab-${tab}.png`), {
          width: 1080, height: 900,
          prepare: `(() => {
            document.querySelector('.card-primary')?.scrollIntoView({ block: 'start' });
            document.querySelector('.tab-btn[data-tab="${tab}"]')?.click();
          })()`
        });
      }
      await shot(options.sessionId, join(OUT, 'options-modal.png'), {
        width: 1080, height: 900,
        prepare: `(() => {
          window.scrollTo(0, 0);
          document.getElementById('saveAsCustom')?.click();
        })()`
      });
      await evaluate(cdp, options.sessionId, `(() => {
        document.getElementById('cancelSaveProfileIcon')?.click();
        window.scrollTo(0, 0);
      })()`);
      await shot(options.sessionId, join(OUT, 'options-toast.png'), {
        width: 1080, height: 900,
        prepare: `(() => {
          document.getElementById('save')?.click();
        })()`
      });
    }

    if (argv.responsive === '1') {
      await shot(options.sessionId, join(OUT, 'options-wide.png'), {
        width: 1440, height: 960,
        prepare: `window.scrollTo(0, 0)`
      });
      await shot(options.sessionId, join(OUT, 'options-narrow.png'), {
        width: 760, height: 1000,
        prepare: `window.scrollTo(0, 0)`
      });
      await shot(options.sessionId, join(OUT, 'options-mid.png'), {
        width: 900, height: 1000,
        prepare: `(() => { window.scrollTo(0, 900); })()`
      });
      await shot(options.sessionId, join(OUT, 'options-mobile.png'), {
        width: 400, height: 900,
        prepare: `window.scrollTo(0, 0)`
      });
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
