import type { SiteSpoofConfig, WebRtcMode } from '../shared/types';

export type WebRtcPolicyValue = 'default' | 'default_public_interface_only' | 'default_public_and_private_interfaces' | 'disable_non_proxied_udp';

export const WEBRTC_POLICY_VALUES: Record<WebRtcMode, WebRtcPolicyValue | null> = {
  strict: 'disable_non_proxied_udp',
  compatible: 'default_public_interface_only',
  default: null
};

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

export async function resetWebRTCPolicy(): Promise<void> {
  const setting = chrome.privacy?.network?.webRTCIPHandlingPolicy;
  if (!setting) return;
  await setting.clear({ scope: 'regular' });
}
