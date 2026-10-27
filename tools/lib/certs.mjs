import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CERT_DIR = join(HERE, '..', '.certs');
export const CERT_FILE = join(CERT_DIR, 'audit-cert.pem');
export const KEY_FILE = join(CERT_DIR, 'audit-key.pem');

/**
 * 本地 HTTPS 测试用的自签证书。
 *
 * 必须带 SAN：Chrome/Helium 只看 subjectAltName，CN 被忽略；没有 SAN 的证书会让
 * 主文档导航偶发卡在 handshake（net_error -100），表现为"页面永远加载不出来"。
 * 所以这里按需要映射的域名现生成，并且证书不存在就自动补。
 */
export function ensureCerts(domains = ['claude.ai'], { force = false } = {}) {
  mkdirSync(CERT_DIR, { recursive: true });
  const list = [...new Set(['localhost', '127.0.0.1', ...domains.flatMap((domain) => [domain, `*.${domain}`])])];
  const san = list
    .map((item) => (/^\d/.test(item) ? `IP:${item}` : `DNS:${item}`))
    .join(',');

  if (!force && existsSync(CERT_FILE) && existsSync(KEY_FILE)) {
    try {
      const text = execFileSync('openssl', ['x509', '-in', CERT_FILE, '-noout', '-ext', 'subjectAltName'], { encoding: 'utf8' });
      const missing = list.filter((item) => !text.includes(item));
      if (!missing.length) return { cert: CERT_FILE, key: KEY_FILE, san, generated: false };
    } catch { /* 证书坏了就重生成 */ }
  }

  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
    '-keyout', KEY_FILE, '-out', CERT_FILE,
    '-subj', '/CN=vanishgeo-audit',
    '-addext', `subjectAltName=${san}`
  ], { stdio: 'ignore' });
  return { cert: CERT_FILE, key: KEY_FILE, san, generated: true };
}