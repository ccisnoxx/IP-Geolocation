// 诊断页按当前页面环境格式化实际时间，不携带扩展预期配置。

export const LOCALE_DATETIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
};

export function formatLocaleDateTimeForPage(date: Date): string {
  return date.toLocaleString(undefined, LOCALE_DATETIME_FORMAT_OPTIONS);
}
