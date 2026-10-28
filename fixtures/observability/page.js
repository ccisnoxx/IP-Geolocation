import { capturePage, captureSurface } from './probe.js';
const parameters = new URLSearchParams(location.search);
const frame = parameters.has('frame');
const earliest = captureSurface();
const children = new Map();
const expected = new Map();
if (!frame) {
  for (const [name, host] of [['same-origin', location.hostname], ['cross-origin', location.hostname === 'localhost' ? '127.0.0.1' : 'localhost']]) {
    const element = document.createElement('iframe');
    element.title = name; element.allow = 'geolocation'; element.referrerPolicy = 'origin';
    element.src = `${location.protocol}//${host}:${location.port}/?frame=1${parameters.has('position') ? '&position=1' : ''}`;
    document.body.append(element); expected.set(element.contentWindow, { name, origin: new URL(element.src).origin });
  }
  window.addEventListener('message', event => {
    const target = expected.get(event.source);
    if (target && event.origin === target.origin && event.data?.kind === 'surface-observation') children.set(target.name, event.data.observation);
  });
}
const result = { earliest, page: await capturePage({ position: parameters.has('position') }) };
if (frame) {
  parent.postMessage({ kind: 'surface-observation', observation: result }, new URL(document.referrer).origin);
} else {
  const sampleWorker = (url, options, shared = false) => new Promise(resolve => {
    let worker; let timer;
    const finish = value => { clearTimeout(timer); if (shared) worker?.port.close(); else worker?.terminate(); resolve(value); };
    try {
      worker = shared ? new SharedWorker(url, options) : new Worker(url, options);
      const channel = shared ? worker.port : worker;
      channel.onmessage = event => finish(event.data);
      worker.onerror = () => finish({ status: 'UNKNOWN', reason: 'Worker 加载或执行失败' });
      if (shared) channel.start();
      timer = setTimeout(() => finish({ status: 'UNKNOWN', reason: 'Worker 无响应' }), 4000);
    } catch (error) { finish({ status: typeof Worker === 'undefined' ? 'UNSUPPORTED' : 'UNKNOWN', error: error.name }); }
  });
  result.workers = {};
  for (const type of ['classic', 'module']) {
    result.workers[`http-${type}`] = await sampleWorker(`/worker.js?type=${type}`, { type });
    const prefix = `import { captureSurface } from '${location.origin}/probe.js'; postMessage(captureSurface());`;
    const source = type === 'module' ? prefix : `importScripts('${location.origin}/worker-classic.js');`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    result.workers[`blob-${type}`] = await sampleWorker(url, { type }); URL.revokeObjectURL(url);
  }
  result.workers.shared = typeof SharedWorker === 'function' ? await sampleWorker('/shared.js', { type: 'module', name: 'surface-audit' }, true) : { status: 'UNSUPPORTED' };
  const deadline = Date.now() + 5000;
  while (children.size < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  result.frames = Object.fromEntries(['same-origin', 'cross-origin'].map(name => [name, children.get(name) || { status: 'UNKNOWN', reason: 'iframe 无响应' }]));
}
document.querySelector('#result').textContent = JSON.stringify(result, null, 2);
document.querySelector('#result').dataset.complete = 'true';
