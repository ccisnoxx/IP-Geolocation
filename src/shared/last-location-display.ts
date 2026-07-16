// UI 共用的坐标格式化，避免各页面产生不同精度。
export function formatCoordinate(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '';
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}
