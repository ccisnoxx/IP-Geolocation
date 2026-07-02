// Main-world worker patch helpers.
(function(root) {
  function buildTimezonePatchSource(config) {
    return `;(${root.IPGeoSpoofDateTime.installDateTimeSpoof.toString()})(${JSON.stringify(config)});`;
  }

  function buildWorkerBootstrapSource(sourceUrl, isModule, patchSource) {
    if (isModule) {
      // Module workers must run the patch before loading the target module.
      return `${patchSource}\nawait import(${JSON.stringify(sourceUrl)});`;
    }
    return `${patchSource}\nimportScripts(${JSON.stringify(sourceUrl)});`;
  }

  function installWorkerHooks(patchSource) {
    if (!patchSource || window.__ipGeoWorkerHooked) return;
    window.__ipGeoWorkerHooked = true;

    const makeWorkerUrl = (scriptURL, options) => {
      const sourceUrl = new URL(String(scriptURL), location.href).href;
      const isModule = options && typeof options === 'object' && options.type === 'module';
      const body = buildWorkerBootstrapSource(sourceUrl, isModule, patchSource);
      return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    };

    if (typeof Worker === 'function') {
      const NativeWorker = Worker;
      window.Worker = function(scriptURL, options) {
        try {
          return new NativeWorker(makeWorkerUrl(scriptURL, options), options);
        } catch (error) {
          return new NativeWorker(scriptURL, options);
        }
      };
      Object.setPrototypeOf(window.Worker, NativeWorker);
      window.Worker.prototype = NativeWorker.prototype;
    }

    if (typeof SharedWorker === 'function') {
      const NativeSharedWorker = SharedWorker;
      window.SharedWorker = function(scriptURL, optionsOrName) {
        try {
          const options = optionsOrName && typeof optionsOrName === 'object' ? optionsOrName : undefined;
          return new NativeSharedWorker(makeWorkerUrl(scriptURL, options), optionsOrName);
        } catch (error) {
          return new NativeSharedWorker(scriptURL, optionsOrName);
        }
      };
      Object.setPrototypeOf(window.SharedWorker, NativeSharedWorker);
      window.SharedWorker.prototype = NativeSharedWorker.prototype;
    }
  }

  root.IPGeoSpoofWorkers = {
    buildTimezonePatchSource,
    buildWorkerBootstrapSource,
    installWorkerHooks
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.IPGeoSpoofWorkers;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
