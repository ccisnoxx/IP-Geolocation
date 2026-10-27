#!/usr/bin/env node
/**
 * 安装审计用的 Chrome for Testing 119。
 *
 * Chrome 126 之后才有 CDP Extensions.loadUnpacked，119 只能靠 --load-extension
 * 启动；为了不在每台机器上手工下载，这个脚本负责下载、校验 SHA256、解压到：
 *
 *   ~/.vanishgeo/browsers/chrome-119/
 *
 * 用法：
 *   node scripts/setup-browsers.mjs --chrome=119
 *   node scripts/setup-browsers.mjs --chrome=119 --check
 *   node scripts/setup-browsers.mjs --chrome=119 --force
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '119.0.6045.105';
const ZIP_SHA256 = 'ba5a4a88d1de68676f5fc6d6e65ecccbc585cf525cc5bfc3d246c3035e0bce28';
const BROWSERS = join(homedir(), '.vanishgeo', 'browsers');
const TARGET = join(BROWSERS, 'chrome-119');

function platformArchive() {
  // 固定版本只提供 mac-arm64 的发布哈希；其它平台请手动安装到同一路径。
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
  throw new Error(`Chrome 119 自动安装只支持 macOS arm64，当前：${process.platform}/${process.arch}`);
}

function binaryPath() {
  return join(TARGET, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
}

function runVersion() {
  const binary = binaryPath();
  if (!existsSync(binary)) return '';
  try {
    return execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
  } catch {
    return '';
  }
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function sha256(file) {
  const hash = createHash('sha256');
  // 文件 130MB 左右，用流式读取避免把整包读进内存
  return new Promise((resolveHash, reject) => {
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function install({ force }) {
  const platform = platformArchive();
  const archive = `chrome-${platform}.zip`;
  const url = `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/${platform}/${archive}`;
  const temp = mkdtempSync(join(tmpdir(), 'vanishgeo-chrome119-'));
  const zip = join(temp, archive);
  try {
    console.log(`下载 Chrome ${VERSION} (${platform}) …`);
    await download(url, zip);
    const digest = await sha256(zip);
    if (digest !== ZIP_SHA256) {
      throw new Error(`SHA256 不匹配：expected ${ZIP_SHA256}, got ${digest}`);
    }
    console.log('SHA256 校验通过，解压 …');
    const extract = join(temp, 'extract');
    mkdirSync(extract, { recursive: true });
    execFileSync('unzip', ['-q', zip, '-d', extract], { stdio: 'inherit' });
    const unpacked = join(extract, `chrome-${platform}`);
    if (!existsSync(unpacked)) throw new Error(`解压目录不存在：${unpacked}`);
    if (existsSync(TARGET)) rmSync(TARGET, { recursive: true, force: true });
    mkdirSync(BROWSERS, { recursive: true });
    renameSync(unpacked, TARGET);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value === undefined ? true : value];
}));
const wanted = String(argv.chrome || '119');
if (wanted !== '119') throw new Error(`只支持 --chrome=119，收到 ${wanted}`);
const checkOnly = Boolean(argv.check);
const force = Boolean(argv.force);

if (checkOnly) {
  const version = runVersion();
  if (!version) {
    console.error(`Chrome 119 未安装：${binaryPath()}`);
    process.exit(1);
  }
  console.log(version);
  console.log(binaryPath());
  process.exit(0);
}

const existing = runVersion();
if (existing && !force) {
  console.log(`已安装：${existing}`);
  console.log(binaryPath());
  process.exit(0);
}

await install({ force });
const version = runVersion();
if (!version) throw new Error(`安装后无法启动：${binaryPath()}`);
console.log(`完成：${version}`);
console.log(binaryPath());
