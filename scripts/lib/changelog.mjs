/**
 * CHANGELOG.md 的小节提取。
 *
 * 单独一个模块是为了能单测：release-notes.mjs 是 CLI，顶层就跑发布流程，
 * import 它等于执行一次发版。
 */

/**
 * 取某个版本在 CHANGELOG.md 里的小节（`## 2.4.2` 到下一个 `## ` 之间）。
 *
 * 版本号里的点按字面量匹配，避免 `2.4.2` 命中 `2.4.20`。
 */
export function sectionOf(markdown, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = String(markdown).split('\n');
  const start = lines.findIndex((line) => new RegExp(`^##\\s+v?${escaped}\\s*$`).test(line.trim()));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}
