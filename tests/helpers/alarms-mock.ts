export function createAlarmsMock() {
  const alarms = new Map<string, chrome.alarms.Alarm>();
  const calls: string[] = [];
  return { alarms, calls, api: {
    get: async (name: string) => alarms.get(name),
    create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
      calls.push(`create:${name}`);
      alarms.set(name, { name, periodInMinutes: info.periodInMinutes, scheduledTime: Date.now() + (info.delayInMinutes || 0) * 60_000 });
    },
    clear: async (name: string) => { calls.push(`clear:${name}`); return alarms.delete(name); }
  } };
}
