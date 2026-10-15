import type { SiteSpoofConfig, WebRtcMode } from '../shared/types';
import { RuntimeSyncOperationError } from '../shared/runtime-sync';

export type WebRtcPolicyValue = 'default' | 'default_public_interface_only' | 'default_public_and_private_interfaces' | 'disable_non_proxied_udp';
export type WebRtcPolicyLevelOfControl = chrome.types.ChromeSettingGetResultDetails['levelOfControl'];

export interface WebRtcPolicyState {
  supported: boolean;
  requestedPolicy: WebRtcPolicyValue | null;
  actualPolicy: WebRtcPolicyValue | null;
  levelOfControl: WebRtcPolicyLevelOfControl | null;
  controlledByThisExtension: boolean;
  leakProtectionActive: boolean;
}

export const WEBRTC_POLICY_VALUES: Record<WebRtcMode, WebRtcPolicyValue | null> = {
  strict: 'disable_non_proxied_udp',
  compatible: 'default_public_interface_only',
  default: null
};

function getWebRTCPolicySetting(): chrome.types.ChromeSetting | null {
  const setting = chrome.privacy?.network?.webRTCIPHandlingPolicy;
  return setting || null;
}

function resolveRequestedWebRTCPolicy(config: SiteSpoofConfig): WebRtcPolicyValue | null {
  return config.masterEnabled ? WEBRTC_POLICY_VALUES[config.webRtc.globalMode] : null;
}

function getChromeRuntimeError(): Error | null {
  const message = chrome.runtime?.lastError?.message;
  return message ? new Error(message) : null;
}

function callChromeSetting<T>(
  method: (details: any, callback?: (result?: T) => void) => void | Promise<T>,
  details: Record<string, unknown>
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const callback = (result?: T) => {
      const error = getChromeRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    try {
      const maybePromise = method(details, callback);
      if (maybePromise && typeof (maybePromise as Promise<T>).then === 'function') {
        (maybePromise as Promise<T>).then(resolve, reject);
        return;
      }
      // Chrome 原生函数的 length 不表示回调时机；仅回调/Promise 确认完成。
    } catch (error) {
      reject(error);
    }
  });
}

function normalizePolicyValue(value: unknown): WebRtcPolicyValue | null {
  return value === 'default'
    || value === 'default_public_interface_only'
    || value === 'default_public_and_private_interfaces'
    || value === 'disable_non_proxied_udp'
    ? value
    : null;
}

export async function getWebRTCPolicyState(config: SiteSpoofConfig): Promise<WebRtcPolicyState> {
  const requestedPolicy = resolveRequestedWebRTCPolicy(config);
  const setting = getWebRTCPolicySetting();
  if (!setting) {
    return {
      supported: false,
      requestedPolicy,
      actualPolicy: null,
      levelOfControl: null,
      controlledByThisExtension: false,
      leakProtectionActive: false
    };
  }

  if (!setting.get) {
    return {
      supported: true,
      requestedPolicy,
      actualPolicy: null,
      levelOfControl: null,
      controlledByThisExtension: false,
      leakProtectionActive: false
    };
  }

  const details = await callChromeSetting<chrome.types.ChromeSettingGetResultDetails>(
    setting.get.bind(setting),
    {}
  );
  const actualPolicy = normalizePolicyValue(details?.value);
  return {
    supported: true,
    requestedPolicy,
    actualPolicy,
    levelOfControl: details?.levelOfControl || null,
    controlledByThisExtension: details?.levelOfControl === 'controlled_by_this_extension',
    leakProtectionActive: actualPolicy === 'disable_non_proxied_udp'
  };
}

export async function applyWebRTCPolicy(config: SiteSpoofConfig, releaseConfirmed = false): Promise<WebRtcPolicyState> {
  const setting = getWebRTCPolicySetting();
  if (!setting?.get || !setting.set || !setting.clear) {
    throw new RuntimeSyncOperationError('unsupported', '浏览器不支持完整的 WebRTC 策略控制与读取。');
  }

  const policy = resolveRequestedWebRTCPolicy(config);
  const before = await getWebRTCPolicyState(config);
  const converged = (state: WebRtcPolicyState) => policy
    ? state.actualPolicy === policy && state.controlledByThisExtension
    : state.actualPolicy !== null && state.levelOfControl !== null && !state.controlledByThisExtension;
  // effective level 不能证明被其他控制者遮蔽的 own override 已清除。
  // default 只在当前签名已有 clear 确认时跳过；首次对账必须释放自身设置。
  if (converged(before) && (policy || releaseConfirmed)) return before;
  if (policy && ['not_controllable', 'controlled_by_other_extensions'].includes(before.levelOfControl || '')) {
    throw new RuntimeSyncOperationError('not-controllable', 'WebRTC 策略被浏览器或其他扩展控制。');
  }
  if (policy) {
    await callChromeSetting(setting.set.bind(setting), { value: policy, scope: 'regular' });
  } else {
    await callChromeSetting(setting.clear.bind(setting), { scope: 'regular' });
  }
  const after = await getWebRTCPolicyState(config);
  if (!converged(after)) throw new RuntimeSyncOperationError('verification-failed', 'WebRTC 策略更新后仍未确认生效。');
  return after;
}

export async function resetWebRTCPolicy(): Promise<void> {
  const setting = getWebRTCPolicySetting();
  if (!setting) return;
  await callChromeSetting(setting.clear.bind(setting), { scope: 'regular' });
}
