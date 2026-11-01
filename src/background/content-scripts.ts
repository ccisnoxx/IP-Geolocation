import { getContentScriptRegistration } from '../shared/config-resolver';
import type { SiteSpoofConfig } from '../shared/types';

/**
 * 动态注册的两条内容脚本：ISOLATED 桥与 MAIN runtime。
 *
 * 只按配置算 matches 并调用 chrome.scripting，不持有任何状态；串行化由调用方
 * （services 的 applyChain）负责。
 */
const MAIN_RUNTIME_SCRIPT_ID = 'vanishgeo-main-runtime';
const BRIDGE_SCRIPT_ID = 'vanishgeo-bridge';
const CONTENT_SCRIPT_IDS = [MAIN_RUNTIME_SCRIPT_ID, BRIDGE_SCRIPT_ID];
const MAIN_RUNTIME_FILES = ['injected/runtime.js'];

/** 烘焙进 manifest 的域名，供用户脚本模式判断是否为烘焙构建 */
export function bakedContentScriptDomains(): string[] {
  return bakedScriptDomains();
}
const BRIDGE_FILES = ['content/content.js'];

/** 构建期烘焙进 manifest 的域名（普通构建为空数组） */
function bakedScriptDomains(): string[] {
  if (typeof __VANISHGEO_STATIC_SCRIPT_DOMAINS__ === 'undefined') return [];
  const domains = __VANISHGEO_STATIC_SCRIPT_DOMAINS__;
  return Array.isArray(domains) ? domains : [];
}

async function unregisterSpoofContentScripts(): Promise<void> {
  if (!chrome.scripting?.unregisterContentScripts) return;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: CONTENT_SCRIPT_IDS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/non[- ]?existent|not found|does not exist/i.test(message)) {
      console.warn('Content script unregister failed:', message);
    }
  }
}

// 唯一调用链来自 applyConfigNow，整次注册已由 applyChain 串行化。
export async function registerSpoofContentScripts(config: SiteSpoofConfig): Promise<void> {
  if (!chrome.scripting?.registerContentScripts) return;
  // 烘焙构建把域名写进了 manifest 的静态 content_scripts：这些域名由浏览器在
  // 渲染进程创建时就注入，比动态注册早一个身位（Chromium 156 上动态注册会漏掉
  // 会话里的第一次导航）。这里只补注册不在烘焙清单里的域名。
  const { matches, excludeMatches } = getContentScriptRegistration(config, bakedScriptDomains());

  if (!matches.length) {
    await unregisterSpoofContentScripts();
    return;
  }

  // 已存在时走 updateContentScripts：unregister + register 之间有一个窗口期，
  // 这期间加载的页面不会有任何脚本注入，等于裸奔一次。
  // 桥排在 runtime 前面：握手要求 ISOLATED 先挂监听（见 content-bridge.ts 的 BRIDGE_EVENT）。
  // Chrome 119 / 156 实测动态注册时不论注册顺序都先跑 ISOLATED，这里按依赖顺序声明。
  const definitions: chrome.scripting.RegisteredContentScript[] = [
    {
      id: BRIDGE_SCRIPT_ID,
      matches,
      ...(excludeMatches.length ? { excludeMatches } : {}),
      js: BRIDGE_FILES,
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: true,
      world: 'ISOLATED',
      persistAcrossSessions: true
    },
    {
      id: MAIN_RUNTIME_SCRIPT_ID,
      matches,
      ...(excludeMatches.length ? { excludeMatches } : {}),
      js: MAIN_RUNTIME_FILES,
      runAt: 'document_start',
      allFrames: true,
      // 不透明来源的 iframe（about:blank / srcdoc / blob:）默认不注入。页面只要建一个
      // <iframe srcdoc> 进去读 contentWindow.Date，拿到的就是没打补丁的原生对象 ——
      // 主框架和子框架说法不一致，这一条比任何原型检测都硬。
      // matchOriginAsFallback 让这类 frame 按其**创建者**的来源参与匹配。
      matchOriginAsFallback: true,
      world: 'MAIN',
      persistAcrossSessions: true
    }
  ];

  const existing = await chrome.scripting
    .getRegisteredContentScripts({ ids: CONTENT_SCRIPT_IDS })
    .catch(() => [] as chrome.scripting.RegisteredContentScript[]);
  const existingIds = new Set(existing.map((script) => script.id));
  const toUpdate = definitions.filter((script) => existingIds.has(script.id));
  const toRegister = definitions.filter((script) => !existingIds.has(script.id));

  if (toRegister.length) {
    try {
      await chrome.scripting.registerContentScripts(toRegister);
    } catch (error) {
      // 浏览器重载后旧注册仍挂在配置里，但 getRegisteredContentScripts 可能暂时读不到，
      // 此时 register 会抛 Duplicate script ID；改走 update 即可，不必让重载报错。
      if (!/Duplicate script ID/i.test(String((error as Error)?.message ?? error))) throw error;
      await chrome.scripting.updateContentScripts(toRegister);
    }
  }
  if (toUpdate.length) {
    await chrome.scripting.updateContentScripts(toUpdate);
  }
}
