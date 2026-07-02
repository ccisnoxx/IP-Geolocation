# Phase 2B 实施计划

## Ordered Checklist

1. 补共享边界派生 helper
   - 在 `IPGeoConfig` 侧新增启用规则域名、content script `matches`、URL 白名单命中判断 helper
   - 先补对应 Node 测试或同步更新现有 config 测试
2. 收缩 background 注册和 reinjection 边界
   - `registerSpoofContentScripts(config)` 改成消费派生 `matches`
   - `applyRuntimeSideEffects(config)` 传入 config，空范围时只注销
   - `updateAllTabs()` / `injectScript()` 只触达白名单 scriptable tab
   - 程序化注入补 main-world spoof 文件，保证已开白名单页在配置变更后仍能立即生效
3. 收缩 manifest 资源暴露面
   - 移除不再需要的 `web_accessible_resources`
   - 确认扩展内部页面引用仍成立
4. 补充 wiring / manifest 断言
   - `tests/extension-wiring.test.js` 增加对无 `<all_urls>` 动态注册和无多余 WAR 的断言
   - 如需要，增加 config helper 的单测
5. 运行验证
   - `npm test`
   - 如果测试覆盖不足，补最小人工检查说明

## Validation Commands

```bash
npm test
node --test tests/*.test.js
```

## Risky Files / Rollback Points

- `background/services.js`
  - content script 注册范围和程序化注入顺序都在这里，最容易把白名单即时生效做坏。
- `shared/config-profile.js`
  - 新增 helper 必须复用现有 normalize/matching 语义，不能引入第二套域名规则。
- `manifest.json`
  - 资源暴露面收缩后要确认扩展内部页面仍能打开、图片仍能加载。

## Pre-Completion Review Gates

- 不允许把本任务扩展成安装时权限模型改造。
- 不允许牺牲非白名单诊断链来换取更小的运行边界。
- 不允许新增“background 自己一套、diagnostic 自己一套”的域名判断逻辑。
- 必须确认程序化 reinjection 仍能覆盖“配置变更时已打开白名单页面”这个场景。
