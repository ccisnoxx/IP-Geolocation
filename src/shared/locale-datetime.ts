// Shared locale/timezone formatting contract for leak-test acceptance URLs.

export const LOCALE_DATETIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
};

export function formatLocaleDateTimeForProfile(date: Date, language: string, timezone: string): string {
  return date.toLocaleString(language, {
    ...LOCALE_DATETIME_FORMAT_OPTIONS,
    timeZone: timezone
  });
}

export function formatLocaleDateTimeForPage(date: Date): string {
  return date.toLocaleString(undefined, LOCALE_DATETIME_FORMAT_OPTIONS);
}

export function normalizeLocaleDateTimeText(value: string): string {
  return String(value || '')
    .replace(/\u00a0|\u202f/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
