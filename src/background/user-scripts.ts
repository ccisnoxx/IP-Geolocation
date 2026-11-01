import { getContentScriptRegistration } from '../shared/config-resolver';
import type { LastLocation, SiteSpoofConfig } from '../shared/types';

/**
 * 用户脚本模式：让普通构建也做到"首屏即生效"。
 *
 * 普通构建的注入层是静态文件，配置只能在页面开始运行后经桥异步送到 —— 页面最前面的
 * 内联脚本先读到真实值。chrome.userScripts 允许注册**代码字符串**：保存配置时把
 * "配置 + 注入层源码"拼成一段代码注册到 MAIN world 的 document_start，效果等同于
 * 在浏览器里现场烘焙，不用本地构建。
 *
 * 实测（Chrome 156 / Helium 0.20，见 tools/out/poc-userscripts*.mjs）决定了下面几条：
 * - 执行顺序：ISOLATED 桥 → 动态注册的 MAIN 内容脚本 → 用户脚本 → 页面第一个脚本。
 *   所以用户脚本里的注入层仍能与桥同步握手，且早于页面脚本。
 * - 用户脚本没有 matchOriginAsFallback，about:blank / srcdoc / blob / data 子框架注入不到：
 *   这些文档仍由内容脚本里的注入层负责。所以内容脚本照常注册，同一 http(s) 文档里会有两份
 *   注入层：用户脚本那份首屏即按快照打补丁，再带着口令同步"认领"；内容脚本那份收到第一份
 *   可信配置（带同一口令）时核对认领，对得上就休眠并转发配置，对不上就自己应用（见 runtime.ts）。
 *   开关关掉 / 浏览器不支持时没有认领，自动回到普通模式 —— 正确性不依赖后台及时察觉开关变化。
 * - 开关在 Chrome 138+ 是扩展详情页的「允许用户脚本」，之前是开发者模式；没开时
 *   chrome.userScripts 不存在，关掉后方法调用抛 "not available"。关掉时扩展不会重载、
 *   后台收不到通知，已注册的脚本立刻停止注入（重新打开后仍在）。
 * - 扩展更新会清空用户脚本，onInstalled / bootstrap 时重新注册。
 */

export const USER_SCRIPT_ID = 'vanishgeo-runtime';
const RUNTIME_FILE = 'injected/runtime.js';
const TOKEN_KEY = 'userScriptToken';

let tokenCache: string | null = null;

/**
 * 认领口令：写进用户脚本代码，并随每份 payload 经桥与私有端口交给注入层，页面两处都看不到。
 * 持久保存、长期不变：Service Worker 重启后发给页面的口令必须仍与已注册脚本里的一致。
 */
export async function userScriptToken(): Promise<string> {
  if (tokenCache) return tokenCache;
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  let token = stored[TOKEN_KEY];
  if (typeof token !== 'string' || token.length < 16) {
    token = crypto.randomUUID();
    await chrome.storage.local.set({ [TOKEN_KEY]: token });
  }
  tokenCache = token;
  return token;
}

/** @types/chrome 0.0.268 尚无 userScripts 声明，这里只描述用到的部分 */
interface UserScriptsApi {
  getScripts(filter?: { ids?: string[] }): Promise<Array<{ id: string }>>;
  register(scripts: unknown[]): Promise<void>;
  update(scripts: unknown[]): Promise<void>;
  unregister(filter?: { ids?: string[] }): Promise<void>;
}

function api(): UserScriptsApi | null {
  const candidate = (globalThis as any).chrome?.userScripts;
  return candidate && typeof candidate.getScripts === 'function' ? candidate as UserScriptsApi : null;
}

/** 开关是否开着：官方推荐的检测法 —— 没开时 getScripts 同步抛错 */
export function userScriptsAvailable(): boolean {
  const userScripts = api();
  if (!userScripts) return false;
  try {
    userScripts.getScripts().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** 浏览器主版本号：决定提示用户去哪里开开关（138 起是扩展详情页的独立开关） */
export function chromeMajorVersion(userAgent: string = (globalThis as any).navigator?.userAgent || ''): number | null {
  const match = /Chrome\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) : null;
}

/**
 * 用户脚本代码：把快照作为参数传进注入层，注入层按名字 `__VANISHGEO_DYNAMIC__` 读取。
 * 参数绑定只存在于这层函数作用域里，不留任何全局。末尾的 sourceURL 让调用栈不报出扩展地址。
 */
export function buildUserScriptCode(runtimeSource: string, snapshot: { config: SiteSpoofConfig; lastLocation: LastLocation | null; token: string }): string {
  return `(function (__VANISHGEO_DYNAMIC__) {\n${runtimeSource}\n})(${JSON.stringify(snapshot)});\n//# sourceURL=<anonymous>`;
}

let runtimeSourceCache: string | null = null;

async function runtimeSource(): Promise<string> {
  if (runtimeSourceCache === null) {
    const response = await fetch(chrome.runtime.getURL(RUNTIME_FILE));
    if (!response.ok) throw new Error(`cannot read ${RUNTIME_FILE}: HTTP ${response.status}`);
    runtimeSourceCache = await response.text();
  }
  return runtimeSourceCache;
}

export async function removeUserScript(): Promise<void> {
  const userScripts = api();
  if (!userScripts || !userScriptsAvailable()) return;
  await userScripts.unregister({ ids: [USER_SCRIPT_ID] }).catch(() => undefined);
}

/**
 * 按当前配置注册 / 更新用户脚本，返回之后是否处于用户脚本模式。
 *
 * 只在普通构建里启用：烘焙构建的配置已经编进注入层（静态清单、首屏即生效），
 * 再叠一份用户脚本只会重复注入。开关没开、没有命中的域名时返回 false，由内容脚本照旧负责。
 */
export async function syncUserScript(
  config: SiteSpoofConfig,
  lastLocation: LastLocation | null,
  bakedDomains: string[]
): Promise<boolean> {
  const userScripts = api();
  if (!userScripts || !userScriptsAvailable()) return false;
  const bridgeOn = typeof __VANISHGEO_BRIDGE__ !== 'boolean' || __VANISHGEO_BRIDGE__;
  const { matches, excludeMatches } = getContentScriptRegistration(config, bakedDomains);
  if (bakedDomains.length || !bridgeOn || !config.masterEnabled || !matches.length) {
    await removeUserScript();
    return false;
  }

  const script = {
    id: USER_SCRIPT_ID,
    matches,
    ...(excludeMatches.length ? { excludeMatches } : {}),
    js: [{ code: buildUserScriptCode(await runtimeSource(), { config, lastLocation, token: await userScriptToken() }) }],
    runAt: 'document_start',
    allFrames: true,
    world: 'MAIN'
  };
  const existing = await userScripts.getScripts({ ids: [USER_SCRIPT_ID] }).catch(() => []);
  if (existing.length) await userScripts.update([script]);
  else await userScripts.register([script]);
  return true;
}
