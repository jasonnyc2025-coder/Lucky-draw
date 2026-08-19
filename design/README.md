# 图标

应用图标的唯一来源是 `icon.html` 里的两段 SVG:

| 变体 | 用途 |
|---|---|
| `std` | 普通图标(iOS、浏览器标签、桌面) |
| `msk` | Android maskable —— 系统会把图标裁成圆形、水滴形等各种形状,所有图形必须落在中心 **80% 直径**的安全圆内,所以这一版整体缩到 74%,背景仍铺满整个方形 |

改完 SVG 后重新生成:

```bash
node design/make-icons.js
```

会覆盖仓库根目录的 5 个 PNG:`icon-512` / `icon-192` / `apple-touch-icon` /
`favicon-64` / `icon-maskable-512`。

生成完**必须**把 `index.html` 的 `APP_VERSION` 和 `sw.js` 的 `VERSION` 一起加一,
否则图标被 Service Worker 缓存着,用户看到的还是旧的。

> 已经装到手机桌面的 PWA,换图标后系统未必会刷新桌面上那个图标 ——
> 通常要把它从桌面删掉、重新「添加到主屏幕」才会变。
