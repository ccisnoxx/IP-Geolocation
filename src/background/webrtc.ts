import type { SiteSpoofConfig, WebRtcMode } from '../shared/types';

export type WebRtcPolicyValue = 'default' | 'default_public_interface_only' | 'default_public_and_private_interfaces' | 'disable_non_proxied_udp';

export const WEBRTC_POLICY_VALUES: Record<WebRtcMode, WebRtcPolicyValue | null> = {
  strict: 'disable_non_proxied_udp',
  compatible: 'default_public_interface_only',
  default: null
};

/**
 * 读回浏览器里 WebRTC IP 处理策略的实际值与控制权。
 *
 * 写入成功不代表生效：另一个扩展控制着这项设置（`controlled_by_other_extensions`）或
 * 企业策略锁定（`not_controllable`）时，set 不会改变实际值，界面上的档位就只是配置。
 */
export async function readWebRTCPolicy(): Promise<{ value: string; levelOfControl: string } | null> {
  const setting = chrome.privacy?.network?.webRTCIPHandlingPolicy;
  if (!setting) return null;
  return new Promise((resolve, reject) => {
    setting.get({}, (details) => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message || 'webRTCIPHandlingPolicy.get failed'));
      else resolve({ value: String(details.value), levelOfControl: String(details.levelOfControl) });
    });
  });
}

export async function applyWebRTCPolicy(config: SiteSpoofConfig): Promise<WebRtcPolicyValue | null> {
  const setting = chrome.privacy?.network?.webRTCIPHandlingPolicy;
  if (!setting) return null;

  const policy = config.masterEnabled ? WEBRTC_POLICY_VALUES[config.webRtc.globalMode] : null;
  if (policy) {
    await setting.set({ value: policy as any, scope: 'regular' });
  } else {
    await setting.clear({ scope: 'regular' });
  }
  return policy;
}
