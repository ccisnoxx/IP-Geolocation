export const AUTOMATIC_EXIT_PROFILE_ID = 'automatic-exit';
export const AUTOMATIC_EXIT_ALARM = 'vanishgeo-automatic-exit';
export const AUTOMATIC_EXIT_STATE_KEY = 'automaticExitStateV1';
export const AUTOMATIC_EXIT_INTERVAL_MINUTES = 5;

// 仅操作自有闹钟；每次worker启动/配置变化都回读，不依赖闹钟跨重启持久化。
export async function reconcileAutomaticExitAlarm(enabled: boolean): Promise<void> {
  const current = await chrome.alarms.get(AUTOMATIC_EXIT_ALARM);
  if (!enabled) {
    if (current) await chrome.alarms.clear(AUTOMATIC_EXIT_ALARM);
    if (await chrome.alarms.get(AUTOMATIC_EXIT_ALARM)) throw new Error('自动出口闹钟撤销未确认');
    return;
  }
  if (current?.periodInMinutes !== AUTOMATIC_EXIT_INTERVAL_MINUTES) {
    await chrome.alarms.create(AUTOMATIC_EXIT_ALARM, { delayInMinutes: AUTOMATIC_EXIT_INTERVAL_MINUTES, periodInMinutes: AUTOMATIC_EXIT_INTERVAL_MINUTES });
  }
  if ((await chrome.alarms.get(AUTOMATIC_EXIT_ALARM))?.periodInMinutes !== AUTOMATIC_EXIT_INTERVAL_MINUTES) throw new Error('自动出口闹钟未确认');
}
