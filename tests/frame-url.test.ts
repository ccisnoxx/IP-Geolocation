import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePayloadHostname, resolvePayloadUrl } from '../src/shared/frame-url';

/**
 * 这一组对应一个真实的检测路径：
 *
 *   const frame = document.createElement('iframe');
 *   frame.srcdoc = '<html></html>';
 *   document.body.append(frame);
 *   frame.contentWindow.navigator.language   // 旧实现：原生值
 *
 * 注入层确实进了 srcdoc 框架（matchOriginAsFallback），但 payload 是按
 * `about:srcdoc` 去解析的，匹配不到任何规则，于是框架保持原生。同源父页面
 * 可以直接读 contentWindow，这比任何原型检测都硬。
 */

test('普通 http(s) 页面按自己的 URL 解析', () => {
  assert.equal(
    resolvePayloadUrl('https://mail.google.com/mail/u/0', 'https://google.com/'),
    'https://mail.google.com/mail/u/0'
  );
  assert.equal(resolvePayloadHostname('https://mail.google.com/mail/u/0', ''), 'mail.google.com');
});

test('about:blank / about:srcdoc 用 referrer 落到父页面的规则上', () => {
  assert.equal(resolvePayloadUrl('about:blank', 'https://mail.google.com/'), 'https://mail.google.com/');
  assert.equal(resolvePayloadUrl('about:srcdoc', 'http://localhost:8765/'), 'http://localhost:8765/');
  assert.equal(resolvePayloadHostname('about:srcdoc', 'http://localhost:8765/'), 'localhost');
});

test('data: / blob: 同样用 referrer', () => {
  assert.equal(resolvePayloadUrl('data:text/html,<p>x</p>', 'https://a.example/'), 'https://a.example/');
  assert.equal(resolvePayloadUrl('blob:https://a.example/1234', 'https://a.example/'), 'https://a.example/');
});

test('没有 referrer 时退回原 URL，不会凭空命中', () => {
  assert.equal(resolvePayloadUrl('about:blank', ''), 'about:blank');
  assert.equal(resolvePayloadHostname('about:blank', ''), '');
  assert.equal(resolvePayloadHostname('', ''), '');
});

test('file: 页面保持自己的 URL（不拿 referrer 冒充）', () => {
  assert.equal(resolvePayloadUrl('file:///Users/x/page.html', 'https://a.example/'), 'file:///Users/x/page.html');
});