import { observation } from './module-observation.js';

function snapshot() {
  return {
    intl: {
        numberLocale: Intl.NumberFormat().resolvedOptions().locale,
        explicitLocale: Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().locale,
        explicitTimezone: Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone,
        explicitNumberLocale: Intl.NumberFormat('en-US').resolvedOptions().locale,
        explicitDateLocale: new Date(1768478400000).toLocaleString('en-US', { timeZone: 'UTC' }),
        explicitDateHour: Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(new Date(1768478400000))
      },
    workerType: 'module',
    moduleObservation: observation,
    language: navigator.language || '',
    languages: Array.isArray(navigator.languages) ? Array.from(navigator.languages) : [],
    dateTimeFormatLocale: Intl.DateTimeFormat().resolvedOptions().locale || '',
    numberFormatLocale: Intl.NumberFormat().resolvedOptions().locale || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    offsetMinutes: new Date().getTimezoneOffset(),
    dateString: new Date().toString()
  };
}

self.postMessage(snapshot());
