# VanishGeo 协作约定

- 合并 PR 不等 GitHub CI：本地 `npm run verify`（已含构建）通过即合并，改到注入层、桥或权限时加跑相关 `smoke:*`，CI 只在失败时回头处理。细则见 [RELEASE.md](RELEASE.md)「合并 PR 不等 CI」；发版仍按 RELEASE.md 第 3、4 节执行。
