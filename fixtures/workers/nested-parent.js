self.onmessage = function(event) {
  var childUrl = event && event.data && event.data.childUrl ? String(event.data.childUrl) : '';
  if (!childUrl) {
    self.postMessage({
      status: 'error',
      error: 'missing childUrl'
    });
    return;
  }

  try {
    var nested = new Worker(childUrl);
    nested.onmessage = function(messageEvent) {
      self.postMessage({
        status: 'ok',
        result: messageEvent.data
      });
      nested.terminate();
    };
    nested.onerror = function(errorEvent) {
      self.postMessage({
        status: 'error',
        error: errorEvent && errorEvent.message ? errorEvent.message : 'nested worker failed'
      });
    };
  } catch (error) {
    self.postMessage({
      status: 'error',
      error: error && error.message ? error.message : String(error)
    });
  }
};
