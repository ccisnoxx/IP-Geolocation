// Shared Chrome callback wrappers and runtime messaging helpers.
(function(root) {
  function chromeCall(fn) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise((resolve, reject) => {
      fn.apply(null, args.concat((...callbackArgs) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(callbackArgs.length > 1 ? callbackArgs : callbackArgs[0]);
      }));
    });
  }

  function storageGet(area, keys) {
    return new Promise((resolve, reject) => {
      area.get(keys, (items) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(items || {});
      });
    });
  }

  function storageSet(area, values) {
    return new Promise((resolve, reject) => {
      area.set(values, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  function unwrapRuntimeResponse(response, fallbackMessage) {
    const message = fallbackMessage || '未知错误';
    if (!response || response.status === 'error') {
      throw new Error(response && response.message ? response.message : message);
    }
    return response;
  }

  function createRuntimeMessageSender(chromeApi) {
    return function sendRuntimeMessage(message) {
      return new Promise((resolve, reject) => {
        chromeApi.runtime.sendMessage(message, (response) => {
          const error = chromeApi.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          try {
            resolve(unwrapRuntimeResponse(response));
          } catch (unwrapError) {
            reject(unwrapError);
          }
        });
      });
    };
  }

  const api = {
    chromeCall,
    storageGet,
    storageSet,
    unwrapRuntimeResponse,
    createRuntimeMessageSender
  };

  root.IPGeoRuntime = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
