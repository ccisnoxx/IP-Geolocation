/**
 * 装载未打包扩展。
 *
 * Chrome 126+ 才支持 CDP 的 Extensions.loadUnpacked；更老的版本只能靠启动参数
 * `--load-extension`。审计脚本对老引擎会同时设置 VANISHGEO_EXTENSION 和
 * VANISHGEO_LEGACY_EXTENSION=1，launchChrome 负责带参数，这里负责跳过 CDP 并
 * 从已有的 service worker target 里找回扩展 id。
 */
import { setTimeout as sleep } from 'node:timers/promises';

function extensionIdFromTargets(targetInfos) {
  for (const target of targetInfos) {
    const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(target.url || '');
    if (match) return match[1];
  }
  return '';
}

export async function loadExtension(cdp, path) {
  try {
    const loaded = await cdp.send('Extensions.loadUnpacked', { path });
    return loaded && loaded.id ? loaded.id : '';
  } catch (error) {
    if (process.env.VANISHGEO_LEGACY_EXTENSION !== '1') throw error;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const id = extensionIdFromTargets(targetInfos || []);
      if (id) return id;
      await sleep(250);
    }
    throw new Error(`Chrome 119 已通过 --load-extension 启动，但找不到扩展 target：${error.message}`);
  }
}
