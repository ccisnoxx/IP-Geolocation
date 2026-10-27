(function() {
  function snapshot() {
    return {
      workerType: 'classic',
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
})();
