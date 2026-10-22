# VG-031 执行记录

## 2026-10-22 实现

- config-model 新增统一默认列表生成：主语言、基础语言、英语去重；空列表使用当前主语言生成。
- normalizeLanguage 将主语言放到首位并移除其重复项，其他显式备用语言按原顺序保留。不批量删除存量多语言偏好。
- Popup、Options 监听主语言实际 change，重建列表。Popup 沿用失焦保存，Options 沿用明确保存；普通保存和重新填表不重建列表。
- 两个表单提示语言列表的重建行为及原生 Accept-Language 边界。
- 未改权限、站点覆盖、生产注册、HTTP 请求头、Worker 或旧文档快照合同。

## Accept-Language 调查

官方依据：

- [Chrome i18n API](https://developer.chrome.com/docs/extensions/reference/api/i18n#method-getAcceptLanguages)：getAcceptLanguages 读取浏览器偏好；现行 API 没有对应的设置方法。
- [Chrome 语言设置](https://support.google.com/chrome/answer/173424?hl=en)：原生偏好支持添加、排序和移除语言。
- [Chrome DNR API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)：支持 modifyHeaders，需要对应 DNR 权限及 host 权限。

当前可用方式是用户在 Chrome 设置 → 语言 → 首选语言中，将目标语言放在前面，移除不希望发送的中文，再将插件语言列表设置为相同偏好。原生请求头由 Chrome 编码，包括权重、基础语言回退及可能的信息缩减；以目标站点实际请求头回显为准，不能把页面列表或 i18n 查询等同于已发送请求头。浏览器偏好是全局设置，不能同时对应不同站点的不同语言覆盖。

如果后续授权按站点自动同步，需要单独恢复 DNR modifyHeaders，并处理：

- 复用 config-resolver 的站点匹配、最长域名优先和有效语言配置，避免建立平行配置来源；由列表生成有序权重。
- 重授权限前清理历史规则，验证旧 v2 跳级残留，防止旧规则重新生效；同步更新权限说明和 wiring 验证。
- 定义请求目标域、页面所属站点及第三方子资源的作用范围，避免把任意第三方请求错误归入同一种语言。
- 明确配置更新后请求头即时变化与旧文档保留快照之间的时序边界；Worker 仍原生，不能声称所有 realm 都一致。
- 用真实 Chrome 验证首个导航请求、普通 iframe、子资源、禁用恢复与权限变化。

本轮“也看看怎么”按调查执行，未重新引入 DNR，也未修改用户真实浏览器语言偏好。

## 验证

- 定向测试：config、profile-ui、page-scripts 共 40/40 通过。
- 完整单测：263/263 通过。
- npm run typecheck、npm run typecheck:tests 通过。
- npm run build、git diff --check 通过；dist 仅由构建生成。
- Node/VM 覆盖两个真实 change 监听器、保存和重读、显式备用语言、主语言排序去重，以及生产生成脚本覆盖含中文的原生列表。
- 本轮没有真实 Chrome 验收，也未声称正在使用的浏览器请求头已同步；人工验收 pending。

## 本地交付状态

- 最终差异核对仅含本任务语言表单、配置归一化、回归测试和任务记录；无权限、版本或无关运行时改动。
- task-manifest 与任务记录均为 review；等待人工验收，不标记 done。
- 没有提交、推送或发布。

后续用户于2026-10-22明确授权恢复必要DNR权限，实施及真实Chrome证据单独见VG-032。表单请求头提示已随新授权更新；上述原生请求头调查保留为VG-031当时范围，不代表当前候选的最终请求头行为。
