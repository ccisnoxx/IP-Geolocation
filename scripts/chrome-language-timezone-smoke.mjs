import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { collectInsideLinuxVmGuard } from '../experiments/userscripts-document-start/lima-backend.mjs';
import { captureProduction, compareProduction, validateOutputPath } from '../experiments/userscripts-document-start/production-guard.mjs';
import { independentRecoveryPassed } from '../experiments/userscripts-document-start/recovery-evidence.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const recoveryOnly = args[0] === '--recovery-only';
if (recoveryOnly) args.shift();
if (args.length !== 2 || args[0] !== '--output') throw new Error('需要 --output JSON 路径');
const output = await validateOutputPath(args[1], root);
const before = await captureProduction(root);
let evidence;
try { evidence = await collectInsideLinuxVmGuard({ production: true, recoveryOnly }); }
catch { evidence = { checks: {}, cleanup: { status: 'UNKNOWN' }, stopReason: 'LINUX_PRODUCTION_COLLECTOR_FAILED' }; }
const comparison = compareProduction(before, await captureProduction(root));
const services = await readFile(new URL('../src/background/services.ts', import.meta.url), 'utf8');
const entry = await readFile(new URL('../src/injected/runtime-modules/language-timezone-entry.ts', import.meta.url), 'utf8');
const boundary = !/initializeRuntimeForSender|documentIds|executeScript/.test(services)
  && !/install(?:Geolocation|FontExposure|Worker)|postMessage|eval\(|new Function/.test(entry);
evidence.production = { status: comparison.unchanged === 'PASS' && boundary ? 'PASS' : 'FAIL',
  unchanged: comparison.unchanged, languageTimezoneBoundary: boundary ? 'PASS' : 'FAIL',
  checkedFiles: comparison.checkedFiles, changedCount: comparison.changedCount };
const required = recoveryOnly ? ['network', 'chrome-sandbox', 'fresh-disabled', 'normal-user-switch', 'register',
  'worker-restart', 'extension-update'] : ['network', 'chrome-sandbox', 'fresh-disabled', 'normal-user-switch', 'register', 'earliest-top-iframe',
  'native-origin', 'paused-surfaces', 'specific-domain', 'snapshot-A-to-B', 'reload-B', 'compatible',
  'dnr-webrtc', 'worker-restart', 'extension-update', 'disabled-snapshot', 'disabled-reload'];
const pass = Object.keys(evidence.checks).length === required.length && required.every(id => evidence.checks[id] === 'PASS')
  && evidence.schemaVersion === 2
  && evidence.scope === (recoveryOnly ? 'automatic-language-timezone-recovery' : 'full-language-timezone-smoke')
  && independentRecoveryPassed(evidence.observations?.workerRestart, 'CDP ServiceWorker.startWorker')
  && independentRecoveryPassed(evidence.observations?.update, 'Extensions.loadUnpacked version update')
  && evidence.observations.update.explicitWorkerStart === false
  && ['status', 'coordinator', 'staging'].every(key => evidence.cleanup[key] === 'PASS')
  && evidence.production.status === 'PASS' && !evidence.stopReason;
evidence.conclusion = pass ? 'GO' : 'BLOCKED'; evidence.exitCode = pass ? 0 : 2;
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2)); process.exitCode = evidence.exitCode;
