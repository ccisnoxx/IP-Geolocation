import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export interface UiDom {
  dom: JSDOM;
  window: any;
  document: Document;
  alerts: string[];
  downloads: Array<{ download: string; href: string }>;
  setConfirm(value: boolean): void;
}

/**
 * 把真实的 options/popup HTML 装进 jsdom，并把 Node 全局补齐成页面脚本看到的
 * 那几个构造器。UI 源码在 import 时就会读 DOM，所以调用方必须先 install 再动态 import。
 */
export function installUiDom(htmlFile: string, url: string): UiDom {
  const dom = new JSDOM(readFileSync(htmlFile, 'utf8'), {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const window = dom.window as any;
  const globals = [
    'window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
    'HTMLSelectElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLDivElement', 'HTMLSpanElement',
    'Event', 'MouseEvent', 'KeyboardEvent', 'Node', 'Element', 'Blob', 'File', 'FormData'
  ];
  for (const key of globals) {
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? window : (window as any)[key],
      configurable: true,
      writable: true
    });
  }

  const alerts: string[] = [];
  const downloads: Array<{ download: string; href: string }> = [];
  let confirmValue = true;
  (globalThis as any).alert = (message: string) => { alerts.push(String(message)); };
  (globalThis as any).confirm = () => confirmValue;

  // jsdom 不实现下载 / object URL；UI 只关心 anchor 的 download 和 href。
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:vanishgeo-test', configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  window.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push({ download: this.download, href: this.href });
  };

  return {
    dom,
    window,
    document: window.document,
    alerts,
    downloads,
    setConfirm(value: boolean) { confirmValue = value; }
  };
}

export async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!predicate()) throw new Error('condition not met before timeout');
}
