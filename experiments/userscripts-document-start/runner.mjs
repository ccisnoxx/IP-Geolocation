#!/usr/bin/env node
// 唯一公共入口：先应用网络限制，再采集，最后统一检查全部必需 GO 条件。
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createEvidence, decideAcceptance } from './acceptance.mjs';
import { collectInsideLoopbackGuard } from './network-guard.mjs';
import { captureProduction, compareProduction, validateOutputPath } from './production-guard.mjs';
import { probeSandboxReapplication } from './sandbox-compatibility.mjs';
import { collectInsideLinuxVmGuard } from './lima-backend.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
let evidence = createEvidence();
let before;
let output;
try {
  before = await captureProduction(repoRoot);
  const args = process.argv.slice(2);
  if (args.includes('--cdp-port') || args.includes('--extension-id')) throw new Error('EXTERNAL_CHROME_NOT_NETWORK_CONFINED');
  const linux = args[0] === '--linux-vm';
  if (linux) args.shift();
  if (args.length !== 2 || args[0] !== '--output') throw new Error('OUTPUT_ARGUMENT_REQUIRED');
  output = await validateOutputPath(args[1], repoRoot);
  if (linux) {
    evidence = await collectInsideLinuxVmGuard();
  } else {
    const sandboxCompatibility = probeSandboxReapplication();
    evidence = await collectInsideLoopbackGuard(fileURLToPath(new URL('./browser-experiment.mjs', import.meta.url)));
    evidence.environment.sandboxCompatibility = sandboxCompatibility;
  }
} catch (error) {
  const known = new Set(['EXTERNAL_CHROME_NOT_NETWORK_CONFINED', 'OUTPUT_ARGUMENT_REQUIRED',
    'OUTPUT_OUTSIDE_EXPERIMENT_OR_TEMP', 'OUTPUT_NOT_INDEPENDENT_FILE', 'LOOPBACK_ENFORCEMENT_UNAVAILABLE',
    'GUARDED_COLLECTOR_TIMEOUT', 'GUARDED_COLLECTOR_INTERRUPTED', 'LOOPBACK_ENFORCEMENT_LAUNCH_FAILED', 'GUARDED_COLLECTOR_INCOMPLETE',
    'LINUX_VM_STAGE_INVALID', 'LINUX_VM_COLLECTOR_FAILED']);
  evidence.stopReason = known.has(error.message) ? error.message : 'RUNNER_ENVIRONMENT_ERROR';
} finally {
  try { evidence.production = compareProduction(before, await captureProduction(repoRoot)); }
  catch { evidence.production = { status: 'UNKNOWN', unchanged: 'UNKNOWN', pauseGate: 'UNKNOWN' }; }
  Object.assign(evidence, decideAcceptance(evidence));
  if (output) {
    try { await writeFile(output, JSON.stringify(evidence, null, 2) + '\n'); }
    catch { evidence.conclusion = 'BLOCKED'; evidence.exitCode = 2; evidence.stopReason = 'EVIDENCE_WRITE_FAILED'; }
  }
  console.log(JSON.stringify(evidence, null, 2));
  process.exitCode = evidence.exitCode;
}
