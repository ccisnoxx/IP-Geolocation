// 页面和 worker 共用调用级策略；不拥有配置、匹配或持久化状态。
export function createIntlPolicy(mode: 'strict' | 'compatible' | undefined, language: string | null, timezone: string | null) {
  const compatible = mode === 'compatible';
  return {
    compatible,
    locale(locales?: string | string[]) {
      return compatible && locales !== undefined ? locales : language || locales;
    },
    options(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions | undefined {
      if (!compatible) {
        const normalized = { ...(options || {}) };
        if (timezone) normalized.timeZone = timezone;
        return normalized;
      }
      // null 保留原生错误；未启用时区时完全透传。
      if (!timezone || options === null) return options;
      if (options === undefined) {
        const defaults = Object.create(null);
        defaults.timeZone = timezone;
        return defaults;
      }
      const source = Object(options);
      // 空 target 避免冻结的 timeZone:undefined 触发 Proxy 不变量。
      // 按原生读取顺序转发，保留继承/不可枚举属性及 getter receiver/异常。
      return new Proxy(Object.create(null), {
        get(_target, property) {
          const value = Reflect.get(source, property, source);
          return property === 'timeZone' && value === undefined ? timezone : value;
        }
      });
    }
  };
}
