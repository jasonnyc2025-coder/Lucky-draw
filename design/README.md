# 图标

现在的图标是一个**转盘**(红/金相间的扇形 + 顶上的指针),一眼能看出是抽奖用的。
盘面和指针画在一段共用的 `<defs>` 里,两个变体用 `<use>` 引,只是缩放不同。

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

生成完**必须**改三个地方,少一个用户就还是看到旧图标:

1. `index.html` 的 `APP_VERSION` 和 `sw.js` 的 `VERSION` 一起加一 —— 否则整个 Service
   Worker 缓存不会换代
2. **图标改版号 `?r=N` 加一**,三处同时改:`index.html` 的三个 `<link>`、
   `manifest.webmanifest` 的 `icons[].src`、`sw.js` 的 `ICON_REV`。
   浏览器(尤其是标签页上那个 favicon)是按 **URL** 缓存图标的,同一个 URL 换了
   内容它未必会去重新拿;换了 URL 才一定会。三处必须一致,否则 SW 缓存的地址
   和页面请求的地址对不上,离线时图标拿不到
3. `npm run test:assets` 跑一遍,上面这些它都会替你核对

> 已经装到手机桌面的 PWA,换图标后系统未必会刷新桌面上那个图标 ——
> 通常要把它从桌面删掉、重新「添加到主屏幕」才会变。

## 一个踩过的坑

`icon.html` 里控制显示哪个变体的选择器必须写成 `#box>svg.v.on`。
写成 `.v.on` 的话权重比 `#box>svg{display:block}` 低,两个变体会同时排在
box 里往下堆,截图永远截到第一个 —— 导出的 `icon-maskable-512.png` 和
`icon-512.png` 会一模一样(内容顶到边,Android 裁圆角时会被切掉)。
改完记得 `md5sum icon-512.png icon-maskable-512.png` 对一下,两个必须不同。
