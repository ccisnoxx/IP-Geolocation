import { installLanguage } from './language';
import type { SpikePayload } from './language';

// 仅允许生成函数的这两个参数成为入口环境；类型声明不产生 JS。
declare const payload: SpikePayload;
declare const documentStateKey: string;

if (!documentStateKey) throw new Error('spike 缺少文档标识');
installLanguage(payload);
