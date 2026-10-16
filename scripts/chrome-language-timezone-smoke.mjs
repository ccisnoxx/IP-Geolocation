import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { collectInsideLinuxVmGuard } from '../experiments/userscripts-document-start/lima-backend.mjs';
import { captureProduction, compareProduction, validateOutputPath } from '../experiments/userscripts-document-start/production-guard.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output') throw new Error('需要 --output JSON 路径');
const output = await validateOutputPath(args[1], root);
const before = await captureProduction(root);
let evidence;
try { evidence = await collectInsideLinuxVmGuard({ production: true }); }
catch { evidence = { checks: {}, cleanup: { status: 'UNKNOWN' }, stopReason: 'LINUX_PRODUCTION_COLLECTOR_FAILED' }; }
const comparison = compareProduction(before, await captureProduction(root));
const services = await readFile(new URL('../src/background/services.ts', import.meta.url), 'utf8');
const entry = await readFile(new URL('../src/injected/runtime-modules/language-timezone-entry.ts', import.meta.url), 'utf8');
const boundary = !/initializeRuntimeForSender|documentIds|executeScript/.test(services)
  && !/install(?:Geolocation|Canvas|Worker)|postMessage|eval\(|new Function/.test(entry);
evidence.production = { status: comparison.unchanged === 'PASS' && boundary ? 'PASS' : 'FAIL',
  unchanged: comparison.unchanged, languageTimezoneBoundary: boundary ? 'PASS' : 'FAIL',
  checkedFiles: comparison.checkedFiles, changedCount: comparison.changedCount };
const required = ['network', 'chrome-sandbox', 'fresh-disabled', 'normal-user-switch', 'register', 'earliest-top-iframe',
  'native-origin', 'paused-surfaces', 'specific-domain', 'snapshot-A-to-B', 'reload-B', 'compatible',
  'dnr-webrtc', 'worker-restart', 'extension-update', 'disabled-snapshot', 'disabled-reload'];
const pass = Object.keys(evidence.checks).length === required.length && required.every(id => evidence.checks[id] === 'PASS')
  && ['status', 'coordinator', 'staging'].every(key => evidence.cleanup[key] === 'PASS')
  && evidence.production.status === 'PASS' && !evidence.stopReason;
evidence.conclusion = pass ? 'GO' : 'BLOCKED'; evidence.exitCode = pass ? 0 : 2;
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2)); process.exitCode = evidence.exitCode;
