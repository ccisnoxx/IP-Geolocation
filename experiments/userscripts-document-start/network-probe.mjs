import { createConnection, createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const denied = code => ['EPERM', 'EACCES'].includes(code) ? 'PASS' : code === 'ALLOWED' ? 'FAIL' : 'UNKNOWN';
function tcp(host, port) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(1500, () => finish('TIMEOUT'));
    socket.once('connect', () => finish('ALLOWED'));
    socket.once('error', error => finish(error.code));
  });
}
function udp(type, host) {
  return new Promise(resolve => {
    const socket = createSocket(type);
    let done = false;
    const finish = code => { if (done) return; done = true; clearTimeout(timer); socket.close(); resolve(denied(code)); };
    const timer = setTimeout(() => finish('TIMEOUT'), 1500);
    socket.once('error', error => finish(error.code));
    // TEST-NET-1 / IPv6 文档前缀：固定合成地址，不使用第三方服务或 DNS。
    socket.send(Buffer.from('vg-synthetic-network-control'), 9, host, error => finish(error?.code ?? 'ALLOWED'));
  });
}
async function loopbackTcp() {
  const server = createServer(socket => socket.end());
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return await tcp('127.0.0.1', server.address().port) === 'ALLOWED' ? 'PASS' : 'UNKNOWN';
  } catch { return 'UNKNOWN'; }
  finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
}
function loopbackUdp() {
  return new Promise(resolve => {
    const socket = createSocket('udp4');
    let done = false;
    const finish = status => { if (done) return; done = true; clearTimeout(timer); socket.close(); resolve(status); };
    const timer = setTimeout(() => finish('UNKNOWN'), 1500);
    socket.once('error', () => finish('UNKNOWN'));
    socket.once('message', value => finish(value.toString() === 'vg-loopback' ? 'PASS' : 'UNKNOWN'));
    socket.bind(0, '127.0.0.1', () => socket.send(Buffer.from('vg-loopback'), socket.address().port, '127.0.0.1'));
  });
}
export async function probeNetwork() {
  return {
    loopbackTcp: await loopbackTcp(), loopbackUdp: await loopbackUdp(),
    deniedTcp4: denied(await tcp('192.0.2.1', 9)), deniedTcp6: denied(await tcp('2001:db8::1', 9)),
    deniedUdp4: await udp('udp4', '192.0.2.1'), deniedUdp6: await udp('udp6', '2001:db8::1')
  };
}
export async function probeInheritedNetwork() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--probe-child'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  return new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.once('error', () => { clearTimeout(timer); resolve('UNKNOWN'); });
    child.once('exit', code => {
      clearTimeout(timer);
      try { resolve(code === 0 && Object.values(JSON.parse(output)).every(status => status === 'PASS') ? 'PASS' : 'UNKNOWN'); }
      catch { resolve('UNKNOWN'); }
    });
  });
}
if (process.argv[2] === '--probe-child') {
  const checks = await probeNetwork();
  console.log(JSON.stringify(checks));
  process.exitCode = Object.values(checks).every(status => status === 'PASS') ? 0 : 2;
}
