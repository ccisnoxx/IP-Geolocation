#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auditPersona } from './lib/persona-artifact.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { zip: { type: 'string' }, preset: { type: 'string' }, domains: { type: 'string' }, output: { type: 'string' } } });
if (!values.zip || !values.preset || !values.domains || !values.output) throw new Error('参数：--zip <文件> --preset <预设> --domains <域名> --output <新JSON>；预期配置不可省略');
const report = await auditPersona(root, resolve(values.zip), values.preset, values.domains);
await writeFile(resolve(values.output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log('persona静态产物审查通过；未执行浏览器验收。');
