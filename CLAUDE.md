# VanishGeo 协作约定

- GitHub CI（`ci.yml` / `nightly.yml`）只手动触发，push 与 PR 不会自动跑：本地 `npm run verify`（已含构建）通过即合并，改到注入层、桥或权限时加跑相关 `smoke:*`。细则见 [RELEASE.md](RELEASE.md)「合并 PR 以本地检查为准」；发版仍按 RELEASE.md 第 3、4 节执行，`release.yml`（推 tag 触发）不变。
