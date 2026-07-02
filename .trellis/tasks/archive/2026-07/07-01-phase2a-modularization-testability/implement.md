# Phase 2A 实施计划

## Ordered Checklist

1. 建立最小测试工具链
   - 新增 `package.json`
   - 定义 `npm test` 指向 Node 内建测试
   - 创建测试目录与首批测试入口
2. 抽共享纯逻辑模块
   - 从 `config.js` 拆出 config 纯函数模块
   - 从 `background.js` / `test.js` 抽出 diagnostic 共享模块
   - 抽出 runtime message / Promise 包装共享模块
3. 重组 background
   - 下沉 geo、runtime side effects、diagnostic service、message router
   - 让 `background.js` 退化为装配层
4. 重组 main-world / content
   - 拆 timezone/date、Intl locale、worker hooks、payload bootstrap
   - 保持 content bridge 行为兼容
5. 重组 popup / options / test 页面
   - 拆页面控制器、格式化器、渲染辅助
   - 保持现有 DOM id、页面路径、用户动作语义
6. 补齐测试与最小手工验证
   - 跑 Node 测试
   - 检查扩展入口文件仍可被 `manifest.json` 直接引用
   - 最小扫描运行边界未被 Phase 2A 误改

## Validation Commands

```bash
npm test
node --test
```

如果后续补充了更细的测试文件，可在 `implement.md` 里追加更具体命令，但本阶段不引入重型验证链。

## Risky Files / Rollback Points

- `background.js` / `main_spoof.js`: 入口装配和加载顺序最敏感，重组时每一步都要保持可回放。
- `config.js`: 需要同时兼顾浏览器侧全局出口与 Node 测试出口，避免导出形态漂移。
- `popup.js` / `options.js` / `test.js`: 页面逻辑拆分时不能破坏既有 DOM id 与用户动作流。

## Pre-Completion Review Gates

- 不允许新增权限边界变更混入本任务。
- 不允许为了测试而改变配置语义或 runtime message 契约。
- 必须确认 background 与 test 页重复 diagnostic 逻辑已经收敛。
- 必须确认 Node 测试真实覆盖了新抽出的共享纯逻辑，而不是只测入口文件是否存在。
