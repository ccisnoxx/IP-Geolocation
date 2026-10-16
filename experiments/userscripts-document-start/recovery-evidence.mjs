// 宿主只接受无管理页/业务消息介入、注册确曾清空且新文档完成观测的自动恢复证据。
export function independentRecoveryPassed(observation, trigger) {
  return observation?.trigger === trigger && observation.managementPagesClosed === true
    && observation.managementMessages === 0 && observation.workerStoppedBeforeTrigger === true
    && Array.isArray(observation.registrationsBeforeTrigger) && observation.registrationsBeforeTrigger.length === 0
    && observation.readback === 'CDP worker context: chrome.userScripts.getScripts()'
    && observation.exactRegistrationMatch === true && Array.isArray(observation.registeredIds)
    && observation.registeredIds.length > 0 && new Set(observation.registeredIds).size === observation.registeredIds.length
    && Array.isArray(observation.newDocument) && observation.newDocument.length === 2
    && observation.newDocument.every(row => row.readyState === 'loading' && row.scriptIndex === 1 && row.inline === true
      && ['earliest', 'load', 'current'].every(phase => row[phase]?.language === 'fr-FR'
        && row[phase].timezone === 'Europe/Paris' && row[phase].offset === -60));
}
