import type { SiteSpoofConfig, WebRtcMode } from '../shared/types';

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
    let callbackSettled = false;
    const callback = (result?: T) => {
      callbackSettled = true;
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
      if (method.length < 2) {
        queueMicrotask(() => {
          if (callbackSettled) return;
          const error = getChromeRuntimeError();
          if (error) reject(error);
          else resolve(undefined);
        });
      }
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
      leakProtectionActive: requestedPolicy === 'disable_non_proxied_udp'
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

export async function applyWebRTCPolicy(config: SiteSpoofConfig): Promise<WebRtcPolicyState> {
  const setting = getWebRTCPolicySetting();
  if (!setting) return getWebRTCPolicyState(config);

  const policy = resolveRequestedWebRTCPolicy(config);
  if (policy) {
    await callChromeSetting(setting.set.bind(setting), { value: policy, scope: 'regular' });
  } else {
    await callChromeSetting(setting.clear.bind(setting), { scope: 'regular' });
  }
  return getWebRTCPolicyState(config);
}

export async function resetWebRTCPolicy(): Promise<void> {
  const setting = getWebRTCPolicySetting();
  if (!setting) return;
  await callChromeSetting(setting.clear.bind(setting), { scope: 'regular' });
}
