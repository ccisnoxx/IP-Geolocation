import type { SiteSpoofConfig } from './types';

/**
 * 配置体检。
 *
 * 起因：检测站权重最高的两项是时区（24）与语言（18）。preset 都是一致的，但手动改
 * 极容易配出一个自己跟自己打架的 persona —— 而这类矛盾与"伪装得够不够真"无关，
 * 是配置本身自相矛盾，本地就能查出来，不该等访问站点才发现。
 *
 * 分两类，措辞上刻意区分：
 *
 * - **error / warn（内部不一致）**：浏览器原生保证不了的组合，一定是配错了。
 *   比如首选语言不在 languages 列表里、`Accept-Language` 与实际语言不同、
 *   定位开了但坐标是空的。
 * - **info（语义矛盾）**：不一定是错，取决于你想讲哪个故事。比如时区在美国而语言
 *   是中文 —— 想装成美国用户时这句会先露，只想去掉时区线索时它就没错。
 *   所以这类只报告、把两面都写出来，让用户自己决定。
 *
 * 纯函数，不碰 chrome API，不读存储：输入配置，输出问题清单与修法。
 */

export type AuditSeverity = 'error' | 'warn' | 'info';

export interface AuditFix {
  /** 按钮文案，动词开头 */
  label: string;
  /** 返回修好的配置（不改原对象） */
  apply: (config: SiteSpoofConfig) => SiteSpoofConfig;
  /** 修完这条就消失了？false 表示只是缓解 */
  resolves: boolean;
}

export interface AuditFinding {
  id: string;
  severity: AuditSeverity;
  title: string;
  detail: string;
  fix?: AuditFix;
}

// ---------- 区域推导 ----------

const TIMEZONE_REGIONS: Array<[RegExp, string]> = [
  [/^Asia\/(Shanghai|Chongqing|Urumqi|Harbin)$/i, 'CN'],
  [/^Asia\/Taipei$/i, 'TW'],
  [/^Asia\/(Hong_Kong|Macau)$/i, 'HK'],
  [/^Asia\/Tokyo$/i, 'JP'],
  [/^Asia\/Seoul$/i, 'KR'],
  [/^Asia\/Singapore$/i, 'SG'],
  [/^Asia\/(Bangkok|Jakarta|Manila|Ho_Chi_Minh)$/i, 'SEA'],
  [/^Asia\/(Kolkata|Calcutta)$/i, 'IN'],
  [/^America\//i, 'US'],
  [/^Europe\//i, 'EU'],
  [/^Australia\//i, 'AU'],
  [/^Africa\//i, 'AF'],
  [/^Atlantic\//i, 'EU'],
  [/^(UTC|Etc\/)/i, 'NEUTRAL']
];

const LANGUAGE_REGIONS: Array<[RegExp, string]> = [
  [/^zh-(tw|hant)/i, 'TW'],
  [/^zh-(hk|mo)/i, 'HK'],
  [/^zh/i, 'CN'],
  [/^ja/i, 'JP'],
  [/^ko/i, 'KR'],
  [/^en-(us|ca)/i, 'US'],
  [/^en-(gb|au|nz|ie)/i, 'EU'],
  [/^en-sg/i, 'SG'],
  [/^en$/i, 'US'],
  [/^(de|fr|es|it|nl|pt|pl|sv|da|fi|no|cs|el|hu|ro|tr|ru|uk)/i, 'EU'],
  [/^(th|vi|id|ms|fil)/i, 'SEA'],
  [/^hi|^bn|^ta|^te/i, 'IN']
];

function pickRegion(table: Array<[RegExp, string]>, value: string): string | null {
  for (const [pattern, region] of table) {
    if (pattern.test(value)) return region;
  }
  return null;
}

export function timezoneRegion(timezone: string): string | null {
  if (!timezone) return null;
  return pickRegion(TIMEZONE_REGIONS, timezone);
}

export function languageRegion(language: string): string | null {
  if (!language) return null;
  return pickRegion(LANGUAGE_REGIONS, language);
}

/** 这个时区当前相对 UTC 的小时偏移；取不到返回 null */
export function timezoneOffsetHours(timezone: string, at: Date = new Date()): number | null {
  if (!timezone) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    }).formatToParts(at);
    const name = formatted.find((part) => part.type === 'timeZoneName')?.value || '';
    if (name === 'GMT' || name === 'UTC') return 0;
    const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return null;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) + Number(match[3] || 0) / 60);
  } catch {
    return null;
  }
}

/** 经度换算成"太阳时"偏移，用来判断坐标与声明时区是否在一个地方 */
export function longitudeOffsetHours(longitude: number): number {
  return longitude / 15;
}

function primaryLanguage(config: SiteSpoofConfig): string {
  return (config.globalProfile.language.language || '').trim();
}

function acceptLanguagePrimary(value: string): string {
  return (value.split(',')[0] || '').split(';')[0].trim();
}

function hasCoordinates(config: SiteSpoofConfig): boolean {
  const geo = config.globalProfile.geolocation;
  return typeof geo.latitude === 'number' && typeof geo.longitude === 'number';
}

// ---------- 体检 ----------

export function auditConfig(config: SiteSpoofConfig): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const language = config.globalProfile.language;
  const timezone = config.globalProfile.timezone;
  const geolocation = config.globalProfile.geolocation;
  const canvas = config.canvas;

  // ---- 内部不一致：一定是配错了 ----

  if (language.enabled) {
    const primary = primaryLanguage(config);
    const headerPrimary = acceptLanguagePrimary(language.acceptLanguage);
    if (primary && headerPrimary && headerPrimary.toLowerCase() !== primary.toLowerCase()) {
      findings.push({
        id: 'accept-language-mismatch',
        severity: 'warn',
        title: 'Accept-Language 与主语言对不上',
        detail: `请求头第一项是 ${headerPrimary}，而 JS 里 navigator.language 是 ${primary}。`
          + 'Chrome 的 Accept-Language 就是由 languages 拼出来的，两边不一致等于服务端与页面互相打脸。',
        fix: {
          label: `把请求头对齐到 ${primary}`,
          resolves: true,
          apply: (current) => ({
            ...current,
            globalProfile: {
              ...current.globalProfile,
              language: {
                ...current.globalProfile.language,
                acceptLanguage: [primary, primary.split('-')[0]]
                  .filter((tag, index, list) => tag && list.indexOf(tag) === index)
                  .map((tag, index) => (index === 0 ? tag : `${tag};q=0.9`))
                  .join(',')
              }
            }
          })
        }
      });
    }
  }

  if (!timezone.enabled && timezone.timezone) {
    findings.push({
      id: 'timezone-declared-but-off',
      severity: 'warn',
      title: '时区填了但没打开',
      detail: `配置里写着 ${timezone.timezone}，但时区伪装是关闭的 —— 页面读到的还是本机真实时区。`
        + '这条最容易在"改了字段忘了保存开关"的时候出现。',
      fix: {
        label: '打开时区伪装',
        resolves: true,
        apply: (current) => ({
          ...current,
          globalProfile: {
            ...current.globalProfile,
            timezone: { ...current.globalProfile.timezone, enabled: true }
          }
        })
      }
    });
  }

  if (geolocation.enabled && geolocation.mode === 'manual' && !hasCoordinates(config)) {
    findings.push({
      id: 'geolocation-no-coordinates',
      severity: 'warn',
      title: '定位开着但没有坐标',
      detail: '经纬度为空时走的是"跟随出口 IP"模式。如果 IP 出口本身就在国内，'
        + '这一步等于没做；想伪造就给一组坐标。',
      fix: undefined
    });
  }

  if (!geolocation.enabled && hasCoordinates(config)) {
    findings.push({
      id: 'geolocation-coordinates-but-off',
      severity: 'warn',
      title: '坐标填了但定位伪装没打开',
      detail: `配置里有 ${geolocation.latitude}, ${geolocation.longitude}，但定位伪装处于关闭状态，站点拿到的仍是真实位置。`,
      fix: {
        label: '打开定位伪装',
        resolves: true,
        apply: (current) => ({
          ...current,
          globalProfile: {
            ...current.globalProfile,
            geolocation: { ...current.globalProfile.geolocation, enabled: true }
          }
        })
      }
    });
  }

  if (geolocation.enabled && !geolocation.spoofPermission) {
    findings.push({
      id: 'permission-not-spoofed',
      severity: 'info',
      title: '权限提示没接管',
      detail: '定位开着，但权限状态仍按真实策略走 —— 页面会看到 "prompt" 而不是 "granted"，'
        + '一个从没授权过的状态本身就说明这台机器很"新"。',
      fix: {
        label: '接管权限状态',
        resolves: true,
        apply: (current) => ({
          ...current,
          globalProfile: {
            ...current.globalProfile,
            // 接管权限就有资格承诺"不碰原生"：两者一起打开，归一化里也是这个绑定
            geolocation: { ...current.globalProfile.geolocation, spoofPermission: true, noNativeCall: true }
          }
        })
      }
    });
  }

  if (!canvas.enabled && canvas.targetFonts.length > 0) {
    findings.push({
      id: 'canvas-off-with-fonts',
      severity: 'warn',
      title: '手动字体表配了但 canvas 伪装没开',
      detail: `targetFonts 里有 ${canvas.targetFonts.length} 条，但 canvas 总开关是关闭的 —— 这些设置一条都不会生效。`,
      fix: {
        label: '打开 canvas 伪装',
        resolves: true,
        apply: (current) => ({ ...current, canvas: { ...current.canvas, enabled: true } })
      }
    });
  }

  if (canvas.enabled && !canvas.spoofFonts) {
    findings.push({
      id: 'canvas-chrome-only',
      severity: 'info',
      title: 'canvas 开着但字体层关着',
      detail: '目前只会在噪声/指纹层面动 canvas，字体这一层不参与 —— 中文字体探测照旧命中。',
      fix: {
        label: '打开字体层',
        resolves: true,
        apply: (current) => ({ ...current, canvas: { ...current.canvas, spoofFonts: true } })
      }
    });
  }

  if (!config.masterEnabled) {
    const configured = language.enabled || timezone.enabled || geolocation.enabled
      || canvas.enabled || config.webRtc.globalMode !== 'default';
    if (configured) {
      findings.push({
        id: 'master-off',
        severity: 'warn',
        title: '总开关是关的',
        detail: '下面配了一堆，但 masterEnabled 为 false —— 所有伪装都不会注入。',
        fix: {
          label: '打开总开关',
          resolves: true,
          apply: (current) => ({ ...current, masterEnabled: true })
        }
      });
    }
  }

  if (config.debugMode) {
    findings.push({
      id: 'debug-mode',
      severity: 'info',
      title: '调试模式开着',
      detail: '调试模式会往控制台写日志。页面脚本读不到别人的 console，但一旦录屏/远程协助，痕迹会留在那儿。',
      fix: {
        label: '关掉调试模式',
        resolves: true,
        apply: (current) => ({ ...current, debugMode: false })
      }
    });
  }

  // ---- 语义矛盾：看你想讲哪个故事 ----

  if (timezone.enabled && language.enabled) {
    const tzRegion = timezoneRegion(timezone.timezone);
    const langRegion = languageRegion(primaryLanguage(config));
    if (tzRegion && langRegion && tzRegion !== langRegion
      && tzRegion !== 'NEUTRAL' && langRegion !== 'NEUTRAL') {
      findings.push({
        id: 'timezone-language-region',
        severity: 'info',
        title: '时区与语言指向两个地方',
        detail: `时区 ${timezone.timezone}（${tzRegion}）+ 主语言 ${primaryLanguage(config)}（${langRegion}）。`
          + `两者在检测里权重最高（24 / 18）：想让这台机器看起来在 ${tzRegion}，语言这一项会先把故事说破；`
          + `只是想让时区不指向原地区，那这个组合是对的。`,
        fix: undefined
      });
    }
  }

  if (timezone.enabled && geolocation.enabled && hasCoordinates(config)) {
    const declared = timezoneOffsetHours(timezone.timezone);
    const solar = longitudeOffsetHours(geolocation.longitude as number);
    if (declared !== null && Math.abs(declared - solar) > 4) {
      findings.push({
        id: 'coordinates-timezone',
        severity: 'warn',
        title: '坐标与声明时区差太远',
        detail: `坐标 ${geolocation.latitude}, ${geolocation.longitude} 的太阳时约 UTC${solar >= 0 ? '+' : ''}${solar.toFixed(1)}，`
          + `而声明时区 ${timezone.timezone} 是 UTC${declared >= 0 ? '+' : ''}${declared}。`
          + '站点只要把 IP / 坐标 / 时区三者并排看一眼就能发现不是同一个地方。',
        fix: undefined
      });
    }
  }

  if (canvas.enabled && canvas.hideCjkFonts && language.enabled
    && /^zh/i.test(primaryLanguage(config))) {
    findings.push({
      id: 'cjk-hidden-but-zh',
      severity: 'info',
      title: '藏了中文字体，语言却还是中文',
      detail: '中文层把"装了中文字体"这条线索消掉了，但 navigator.language 仍然明说 zh —— '
        + '权重 18 的那一项还在。要么把语言也换掉，要么承认这台机器就是中文环境（把中文层关掉更自洽）。',
      fix: {
        label: '关掉中文层（承认中文环境）',
        resolves: true,
        apply: (current) => ({ ...current, canvas: { ...current.canvas, hideCjkFonts: false } })
      }
    });
  }

  return findings;
}

/** 按严重程度排序，UI 直接照着渲染 */
export function sortFindings(findings: AuditFinding[]): AuditFinding[] {
  const order: Record<AuditSeverity, number> = { error: 0, warn: 1, info: 2 };
  return [...findings].sort((left, right) => order[left.severity] - order[right.severity]);
}
