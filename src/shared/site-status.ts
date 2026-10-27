import type { EffectiveProfileResult } from './types';

/**
 * 「这个站点到底有没有被改写」要能说清楚。
 *
 * 定位拿不到时注入侧是 fail-closed（payload=null，页面保持原生值），这本身是对的，
 * 但如果 UI 不吭声，用户会以为自己在受保护状态下注册账号 —— 这正是最危险的场景。
 */
export type SiteStatusReason =
  | 'not-allowlisted'
  | 'excluded'
  | 'timezone-unresolved'
  | 'geolocation-unresolved'
  | 'payload-missing';

export interface SiteStatus {
  /** 站点在白名单里且注入真的生效 */
  active: boolean;
  /** 站点在白名单里但没生效 */
  broken: boolean;
  reason: SiteStatusReason | null;
  /** 一句话说清楚现状 */
  text: string;
  /** 一句话说清楚下一步做什么 */
  hint: string;
}

type StatusInput = Pick<EffectiveProfileResult, 'matched' | 'payload' | 'errors'> & { excluded?: boolean };

export function describeSiteStatus(input: StatusInput): SiteStatus {
  const matched = Boolean(input && input.matched);
  const payload = input ? input.payload : null;
  const errors = (input && Array.isArray(input.errors) ? input.errors : []).map((item) => String(item).toLowerCase());

  // 显式排除优先于一切：它可能是从父域白名单里被"挖"出来的
  if (input && input.excluded) {
    return {
      active: false,
      broken: false,
      reason: 'excluded',
      text: '该站点被显式排除，不做任何改写（父域白名单不覆盖它）',
      hint: '点下面的「启用」把这条排除改成启用'
    };
  }

  if (!matched) {
    return {
      active: false,
      broken: false,
      reason: 'not-allowlisted',
      text: '该站点不在白名单内，扩展不做任何改写',
      hint: '需要改名时点下面的「启用」'
    };
  }

  const timezoneBroken = errors.some((error) => error.includes('timezone'));
  const geoBroken = errors.some((error) => error.includes('geolocation'));

  // 语言独立于定位：时区/定位没解析出来时，语言和请求头仍然是生效的
  if (payload && errors.length === 0) {
    return { active: true, broken: false, reason: null, text: '已生效：时区 / 语言 / 定位按当前配置改写', hint: '' };
  }

  if (payload && timezoneBroken) {
    return {
      active: false,
      broken: true,
      reason: 'timezone-unresolved',
      text: '部分生效：语言与请求头已改写，时区仍是本机原生值',
      hint: '点「重试定位」补齐时区；期间页面语言与 Accept-Language 保持一致'
    };
  }

  if (payload && geoBroken) {
    return {
      active: false,
      broken: true,
      reason: 'geolocation-unresolved',
      text: '部分生效：语言与请求头已改写，定位坐标不可用',
      hint: '点「重试定位」或在选项页手动填经纬度'
    };
  }

  if (!payload && timezoneBroken) {
    return {
      active: false,
      broken: true,
      reason: 'timezone-unresolved',
      text: '未生效：时区无法解析（auto 模式的定位接口没有返回结果）',
      hint: '先确认代理可用，再点「重试定位」；这段时间页面看到的是本机原生值'
    };
  }

  if (!payload && geoBroken) {
    return {
      active: false,
      broken: true,
      reason: 'geolocation-unresolved',
      text: '未生效：定位坐标不可用',
      hint: '点「重试定位」或在选项页手动填经纬度'
    };
  }

  return {
    active: false,
    broken: true,
    reason: 'payload-missing',
    text: '未生效：注入参数不完整',
    hint: '打开选项页检查时区/语言/定位三项配置'
  };
}