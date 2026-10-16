#!/usr/bin/env node
// 发布前只读核对版本；不改写文件或操作 Git tag。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const pkg = read('package.json');
const lock = read('package-lock.json');
const manifest = read('manifest.json');

assert.equal(process.argv[2], `v${pkg.version}`, 'tag 必须为 v 加 package.json 版本');
assert.equal(lock.version, pkg.version, 'package-lock.json 顶层版本不一致');
assert.equal(lock.packages[''].version, pkg.version, 'package-lock.json 根包版本不一致');
assert.equal(manifest.version, pkg.version, 'manifest.json 版本不一致');
console.log(`版本一致性检查通过：v${pkg.version}`);
