/**
 * 构建期注入的常量（见 vite.config.ts 的 define）。
 * - __VANISHGEO_BAKED__：烘焙进注入层的配置快照，null 表示走运行时通道
 * - __VANISHGEO_NONCE__：本次构建的随机通道标识
 * - __VANISHGEO_BRIDGE__：是否启用运行时更新通道（persona 构建为 false）
 */
declare const __VANISHGEO_BAKED__: { config: unknown; lastLocation: unknown } | null;
declare const __VANISHGEO_NONCE__: string;
declare const __VANISHGEO_BRIDGE__: boolean;
/**
 * 不是构建期常量：用户脚本模式下由包裹函数作为参数传入的配置快照（见 background/user-scripts.ts）。
 * 注入层作为普通内容脚本执行时这个名字不存在，只能用 typeof 判断。
 */
declare const __VANISHGEO_DYNAMIC__: { config: unknown; lastLocation: unknown; token: string } | undefined;

/** 本次构建烘焙出来的静态 DNR 规则（manifest 里的 baked-language ruleset），普通构建为 null */
declare const __VANISHGEO_STATIC_RULES__: chrome.declarativeNetRequest.Rule[] | null;
/** 烘焙进 manifest 静态 content_scripts 的域名（普通构建为空数组） */
declare const __VANISHGEO_STATIC_SCRIPT_DOMAINS__: string[];
