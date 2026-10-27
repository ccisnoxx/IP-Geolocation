function snapshot() {
  return {
    workerType: 'shared',
    language: navigator.language || '',
    languages: Array.isArray(navigator.languages) ? Array.from(navigator.languages) : [],
    dateTimeFormatLocale: Intl.DateTimeFormat().resolvedOptions().locale || '',
    numberFormatLocale: Intl.NumberFormat().resolvedOptions().locale || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    offsetMinutes: new Date().getTimezoneOffset(),
    dateString: new Date().toString()
  };
}

self.onconnect = function(event) {
  var port = event.ports && event.ports[0];
  if (!port) return;
  port.postMessage(snapshot());
};
