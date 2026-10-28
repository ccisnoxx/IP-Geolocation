/**
 * SharedWorker 身份与覆盖面的实测夹具。
 *
 * 用途：`tools/smoke-workers.mjs` 用它在两个独立标签页里各连一次同名 SharedWorker。
 *
 * 关键观测点：
 *   - `connections`：全局计数。真 SharedWorker 在同一 (URL, name) 下跨文档共享，
 *     第二个连接会拿到 2；被 blob 包装时每个文档各建一个实例，永远是 1。
 *   - `workerUrl`：`blob:` 说明入口被换过（不是页面的脚本地址）。
 *   - 时区/语言：SharedWorker 是否被伪装，直接看它自己读到的值。
 */
var connections = 0;
var createdAt = Date.now();

self.onconnect = function (event) {
  connections += 1;
  var port = event.ports && event.ports[0];
  if (!port) return;
  port.postMessage({
    workerType: 'shared-counter',
    connections: connections,
    createdAt: createdAt,
    workerUrl: self.location.href,
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    offsetMinutes: new Date().getTimezoneOffset()
  });
};