#!/usr/bin/env node
/**
 * 把 images/banner-*.svg 渲染成同名的 PNG。
 *
 * 用无头 Chrome 当光栅化器：仓库里没有引入任何图像库依赖，而 Chrome 本来就
 * 是这个扩展的运行环境 —— 它渲染出来的字体、断行和用户在浏览器里看到的一致。
 *
 *   node scripts/render-banner.mjs            # 渲染全部
 *   node scripts/render-banner.mjs --check    # 只检查 PNG 是否存在且尺寸正确
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = { width: 1774, height: 887 };

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

function findChrome() {
  const found = CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error('找不到 Chrome。设置 CHROME_PATH 环境变量指向可执行文件后再跑。');
  }
  return found;
}

/** 只读 PNG 头部，不引依赖 */
function pngSize(path) {
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') throw new Error(`${path} 不是 PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const banners = ['banner-zh', 'banner-en'];
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  for (const name of banners) {
    const png = join(ROOT, 'images', `${name}.png`);
    if (!existsSync(png)) throw new Error(`缺 ${png}，先跑 node scripts/render-banner.mjs`);
    const size = pngSize(png);
    if (size.width !== SIZE.width || size.height !== SIZE.height) {
      throw new Error(`${name}.png 尺寸是 ${size.width}×${size.height}，应为 ${SIZE.width}×${SIZE.height}`);
    }
    console.log(`ok ${name}.png ${size.width}×${size.height} (${Math.round(statSync(png).size / 1024)} kB)`);
  }
} else {
  const chrome = findChrome();
  for (const name of banners) {
    const svg = join(ROOT, 'images', `${name}.svg`);
    const png = join(ROOT, 'images', `${name}.png`);
    execFileSync(chrome, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--virtual-time-budget=3000',
      `--window-size=${SIZE.width},${SIZE.height}`,
      `--screenshot=${png}`,
      `file://${svg}`
    ], { stdio: ['ignore', 'ignore', 'ignore'] });

    const size = pngSize(png);
    if (size.width !== SIZE.width || size.height !== SIZE.height) {
      throw new Error(`${name}.png 渲染成了 ${size.width}×${size.height}，应为 ${SIZE.width}×${SIZE.height}`);
    }
    console.log(`rendered ${name}.png ${size.width}×${size.height} (${Math.round(statSync(png).size / 1024)} kB)`);
  }
}
