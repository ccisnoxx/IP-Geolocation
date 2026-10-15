// 在依赖模块顶层采样，验证 bootstrap 先于整个业务模块图。
export const observation = {
  language: navigator.language,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
};
