import { observation } from './module-observation.js';

var connectionCount = 0;
var scopeId = crypto.randomUUID();
// capture listener 在顶层 await 完成前安装，覆盖早期事件重复交付及微任务时序。
self.addEventListener('connect', function(event) {
  var port = event.ports[0];
  connectionCount += 1;
  queueMicrotask(function() {
    port.postMessage({
      workerType: 'shared-module-delayed',
      scopeId: scopeId,
      connectionCount: connectionCount,
      language: navigator.language,
      languages: Array.from(navigator.languages),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      moduleObservation: observation
    });
  });
}, true);
await new Promise(function(resolve) { setTimeout(resolve, 100); });
