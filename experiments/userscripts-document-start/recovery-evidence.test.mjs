import assert from 'node:assert/strict';
import test from 'node:test';
import { independentRecoveryPassed } from './recovery-evidence.mjs';

function complete() {
  const sample = { language: 'fr-FR', timezone: 'Europe/Paris', offset: -60 };
  return { trigger: 'CDP ServiceWorker.startWorker', managementPagesClosed: true, managementMessages: 0,
    workerStoppedBeforeTrigger: true, registrationsBeforeTrigger: [], exactRegistrationMatch: true,
    readback: 'CDP worker context: chrome.userScripts.getScripts()', registeredIds: ['synthetic-localhost'],
    newDocument: Array.from({ length: 2 }, () => ({ readyState: 'loading', scriptIndex: 1, inline: true,
      earliest: { ...sample }, load: { ...sample }, current: { ...sample } })) };
}

test('旧的恢复 PASS 或缺少隔离/清空证据不能作为自动恢复通过', () => {
  const trigger = 'CDP ServiceWorker.startWorker';
  assert.equal(independentRecoveryPassed(undefined, trigger), false);
  assert.equal(independentRecoveryPassed(complete(), trigger), true);
  for (const [key, value] of [['managementPagesClosed', false], ['managementMessages', 1],
    ['workerStoppedBeforeTrigger', false], ['registrationsBeforeTrigger', ['old-script']],
    ['readback', 'getSiteConfig'], ['exactRegistrationMatch', false], ['registeredIds', []]]) {
    assert.equal(independentRecoveryPassed({ ...complete(), [key]: value }, trigger), false, key);
    const missing = complete(); delete missing[key];
    assert.equal(independentRecoveryPassed(missing, trigger), false, key + ' 缺失');
  }
  const late = complete(); late.newDocument[1].scriptIndex = 2;
  assert.equal(independentRecoveryPassed(late, trigger), false);
  const native = complete(); native.newDocument[0].earliest.timezone = 'UTC';
  assert.equal(independentRecoveryPassed(native, trigger), false);
  assert.equal(independentRecoveryPassed(complete(), 'Extensions.loadUnpacked version update'), false);
});
