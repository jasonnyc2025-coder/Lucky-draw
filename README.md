# จับรางวัล · 幸运抽奖 PWA

泰中双语抽奖程序。Excel/CSV 导入名单,分等级依次开奖,可安装、可离线。

## 部署到 GitHub Pages

1. 新建仓库(Public),把本文件夹里**所有文件**上传到根目录
2. Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save
3. 访问 `https://<用户名>.github.io/<仓库名>/`

> 注意:必须保持这个文件结构,`index.html`、`manifest.webmanifest`、`sw.js`
> 和图标要在同一层目录里,否则 Service Worker 注册不了。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 程序本体,全部逻辑与样式 |
| `manifest.webmanifest` | 应用名称、图标、启动方式 |
| `sw.js` | Service Worker,离线缓存 |
| `icon-*.png` `apple-touch-icon.png` `favicon-64.png` | 图标 |

## 改版本

改完 `index.html` 后,把 `sw.js` 第 3 行的 `VERSION` 加一(`v1` → `v2`),
用户下次打开会收到「有新版本」提示。不改版本号的话缓存不会刷新。

## 使用要点

- 抽奖顺序 = 奖项列表由上到下,最后一项压轴。前面没抽完后面锁住。
- 空格 = 开始/停止,F = 全屏,Esc = 关闭弹窗。
- 抽签用 `crypto.getRandomValues`,非 `Math.random`。
- 数据只存在内存里,不写浏览器存储。**每抽完一档,到「设置」保存一次进度 JSON**。
- 第一次要联网打开一遍,缓存泰文字体和 Excel 解析库,之后才能完全离线。
