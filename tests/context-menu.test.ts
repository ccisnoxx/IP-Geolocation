import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextMenus } from '../src/background/context-menu';

const menuIds = [
  'enable-globally', 'disable-globally', 'separator-1', 'enable-on-site',
  'disable-on-site', 'separator-2', 'open-leak-test', 'reset-webrtc'
];

function installMenuMock() {
  const previous = globalThis.chrome;
  const menus = new Map<string, chrome.contextMenus.CreateProperties>();
  const callbacks: Array<() => void> = [];
  const uncheckedErrors: string[] = [];
  const duplicateIds: string[] = [];
  let removals = 0;
  let removalError: string | null = null;
  let failingMenuId: string | null = null;
  let currentError: chrome.runtime.LastError | undefined;
  let errorRead = false;
  const runtime = {
    get lastError() { errorRead = true; return currentError; }
  };
  const complete = (callback: (() => void) | undefined, error?: string) => {
    callbacks.push(() => {
      currentError = error ? { message: error } : undefined;
      errorRead = false;
      try { callback?.(); }
      finally {
        if (error && !errorRead) uncheckedErrors.push(error);
        currentError = undefined;
      }
    });
  };
  Object.assign(globalThis, { chrome: { runtime, contextMenus: {
    removeAll(callback?: () => void) {
      removals++;
      if (!removalError) menus.clear();
      complete(callback, removalError || undefined);
    },
    create(item: chrome.contextMenus.CreateProperties, callback?: () => void) {
      const id = item.id!;
      if (menus.has(id)) {
        duplicateIds.push(id);
        complete(callback, `Cannot create item with duplicate id ${id}`);
      } else if (id === failingMenuId) {
        complete(callback, '合成菜单创建失败');
      } else {
        menus.set(id, item);
        complete(callback);
      }
      return id;
    }
  } } });
  return {
    menus, duplicateIds, uncheckedErrors,
    get removals() { return removals; },
    failRemoval(message: string | null) { removalError = message; },
    failCreation(id: string | null) { failingMenuId = id; },
    async flush() {
      while (callbacks.length) {
        callbacks.shift()!();
        await Promise.resolve();
      }
    },
    restore() { globalThis.chrome = previous; }
  };
}

test('安装与启动并发初始化菜单时不重复创建ID，后续初始化仍可重建', async () => {
  const mock = installMenuMock();
  try {
    mock.menus.set('obsolete-menu', { id: 'obsolete-menu', title: '旧菜单' });
    const first = createContextMenus();
    const second = createContextMenus();
    await mock.flush();
    await Promise.all([first, second]);
    assert.deepEqual(mock.duplicateIds, []);
    assert.deepEqual(mock.uncheckedErrors, []);
    assert.deepEqual([...mock.menus.keys()], menuIds);
    assert.equal(mock.removals, 1);
    assert.ok([...mock.menus.values()].every(item => item.contexts?.includes('action')));

    const next = createContextMenus();
    await mock.flush();
    await next;
    assert.equal(mock.removals, 2);
    assert.deepEqual([...mock.menus.keys()], menuIds);
    assert.deepEqual(mock.duplicateIds, []);
    assert.deepEqual(mock.uncheckedErrors, []);
  } finally { mock.restore(); }
});

test('菜单清理失败时显式拒绝，不继续创建，故障解除后可重试', async () => {
  const mock = installMenuMock();
  try {
    mock.menus.set('enable-globally', { id: 'enable-globally', title: '原菜单' });
    mock.failRemoval('合成菜单清理失败');
    const failed = createContextMenus();
    const rejection = assert.rejects(async () => { await failed; }, /合成菜单清理失败/);
    await mock.flush();
    await rejection;
    assert.equal(mock.menus.size, 1);
    assert.deepEqual(mock.duplicateIds, []);
    assert.deepEqual(mock.uncheckedErrors, []);

    mock.failRemoval(null);
    const recovered = createContextMenus();
    await mock.flush();
    await recovered;
    assert.deepEqual([...mock.menus.keys()], menuIds);
  } finally { mock.restore(); }
});

test('菜单创建失败通过回调传播，下一次重建可清理部分结果并恢复', async () => {
  const mock = installMenuMock();
  try {
    mock.failCreation('enable-on-site');
    const failed = createContextMenus();
    const rejection = assert.rejects(async () => { await failed; }, /合成菜单创建失败/);
    await mock.flush();
    await rejection;
    assert.deepEqual(mock.uncheckedErrors, []);

    mock.failCreation(null);
    const recovered = createContextMenus();
    await mock.flush();
    await recovered;
    assert.deepEqual([...mock.menus.keys()], menuIds);
    assert.deepEqual(mock.duplicateIds, []);
    assert.deepEqual(mock.uncheckedErrors, []);
  } finally { mock.restore(); }
});
