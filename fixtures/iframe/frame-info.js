(function() {
  var prefix = document.body && document.body.dataset && document.body.dataset.infoPrefix
    ? String(document.body.dataset.infoPrefix)
    : 'frame';

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value == null || value === '' ? '-' : String(value);
  }

  text(prefix + '-url', location.href);
  text(prefix + '-title', document.title || '');
  text(prefix + '-name', window.name || '');
  text(prefix + '-language', navigator.language || '');
  text(prefix + '-languages', Array.isArray(navigator.languages) ? JSON.stringify(navigator.languages) : '-');

  try {
    text(prefix + '-timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  } catch (error) {
    text(prefix + '-timezone', error && error.message ? error.message : String(error));
  }

  text(prefix + '-offset', new Date().getTimezoneOffset());
  text(prefix + '-date', new Date().toString());
})();
