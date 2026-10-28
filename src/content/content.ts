import { createContentBridge } from './content-bridge';

// 不负责初始化MAIN、不接受页面配置写入；只转送当前frame的最小只读更新。
if (/^https?:$/.test(location.protocol) && origin !== 'null') createContentBridge(window, chrome.runtime);
