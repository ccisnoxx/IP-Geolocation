import { StringDecoder } from 'node:string_decoder';

// 原始 stderr 只经过有界行缓冲，不进入证据、日志或异常文本。
export function createChromeStartupDiagnostics() {
  const decoder = new StringDecoder('utf8');
  const result = { status: 'NOT_OBSERVED', policyMode: 'NOT_OBSERVED', permissionDenied: false };
  let pending = '';
  function inspect(line) {
    const source = /SandboxSerializer: Failed to initialize sandbox with source mode policy:/.test(line);
    const compiled = /SandboxSerializer: Failed to apply compiled policy:/.test(line);
    if ((source || compiled) && /Operation not permitted|Permission denied/.test(line)) {
      Object.assign(result, { status: 'DENIED', policyMode: source ? 'SOURCE' : 'COMPILED', permissionDenied: true });
    } else if (/sandbox initialization failed: (?:Operation not permitted|Permission denied)/.test(line)) {
      // 本机 Chrome 的实际签名没有输出策略模式；不能据此猜测 SOURCE/COMPILED。
      Object.assign(result, { status: 'DENIED', permissionDenied: true });
    }
  }
  return {
    result,
    feed(chunk) {
      pending += decoder.write(chunk);
      const lines = pending.split('\n');
      pending = lines.pop().slice(-8192);
      for (const line of lines) inspect(line);
      // Chrome 可能在写出换行前退出；对尾行也只识别固定完整签名。
      inspect(pending);
    },
    finish() { pending += decoder.end(); inspect(pending); pending = ''; }
  };
}
