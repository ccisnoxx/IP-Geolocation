# 图标

`public/icons/` 下的四张 PNG 是扩展的图标集，构建时原样复制到 `dist/icons/`。

| 文件 | 尺寸 | 用在 |
| --- | --- | --- |
| `icon16.png` | 16×16 | 工具栏、`action.default_icon` |
| `icon32.png` | 32×32 | Windows 缩放、`action.default_icon` |
| `icon48.png` | 48×48 | 扩展管理页列表 |
| `icon128.png` | 128×128 | 安装弹窗、详情页、README 顶部 |

## 唯一来源

母版是 `images/icon.png`（1254×1254）。四张 PNG 都是它的等比缩小版，
**改图标只改母版，然后重新导出这四个尺寸** —— 不要单独编辑某一档，否则小尺寸会和大尺寸跑偏。

## 视觉规范

- 深色底（`#1a1a1a` 附近），与外框和浅色主题都能分开
- 主色绿 `#4caf50`，与界面里的成功色一致
- 造型在 16px 下仍然可辨认：不要放细线、不要放文字
- 四档都用同一套安全边距（四周留白约 8%），不要在某一档单独放大

## 引用位置

改完确认这三处一致，没有遗漏：

1. `manifest.json` → `icons`（四档）
2. `manifest.json` → `action.default_icon`（四档）
3. `README.md` 顶部的 `<img src="public/icons/icon128.png">`

## 横幅

`images/banner-zh.svg` / `images/banner-en.svg` 是**源文件**（1774×887），
`images/banner-zh.png` / `images/banner-en.png` 是由它们渲染出来的位图，README 顶部引用的
是后者。改字标、配色、文案只改 SVG，然后重新渲染：

```bash
node scripts/render-banner.mjs           # 用无头 Chrome 渲染两张 PNG
node scripts/render-banner.mjs --check   # 只校验尺寸（CI 里用）
```

- 配色取自图标母版：底色 `#05090d`，主色绿 `#4caf50`，亮绿 `#58e06a`
- 字标 `VanishGeo` 用系统几何无衬线（`-apple-system` / `SF Pro Display` 栈），中文标语用
  `PingFang SC` 栈；两栈都在 SVG 里显式写出，换机器渲染结果一致
- 图标以 base64 内嵌在 SVG 里：横幅改颜色时不用同时改图标文件

`images/before/`、`images/after/` 是旧版界面截图，已不在 README 里引用，重出图后再挂回去。
