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
| `test/` | 端到端测试,不参与部署 |
| `manifest.webmanifest` | 应用名称、图标、启动方式 |
| `sw.js` | Service Worker,离线缓存 |
| `icon-*.png` `apple-touch-icon.png` `favicon-64.png` | 图标 |

## 测试

```bash
npm install
npx playwright install chromium    # 只需一次
npm test
```

44 项端到端测试,用真实浏览器跑完整流程(导入 → 开奖 → 名单 → 导出 → 存档 → 恢复),
另外会真的关掉页面再打开,验证本机存档没丢。详见 [`test/README.md`](test/README.md)。

应用本身仍然是零构建的纯静态页面,`package.json` 和 `node_modules` 只服务于测试,
不影响部署。

## 改版本

改完 `index.html` 后,把 `sw.js` 第 3 行的 `VERSION` 加一(`v1` → `v2`),
用户下次打开会收到「有新版本」提示。不改版本号的话缓存不会刷新。

## 使用要点

- 抽奖顺序 = 奖项列表由上到下,最后一项压轴。前面没抽完后面锁住。
- 空格 = 开始/停止,F = 全屏,Esc = 关闭弹窗。
- 抽签用 `crypto.getRandomValues`,非 `Math.random`。
- **所见即所得**:按下停止时,定格在屏幕当前显示的那一组人,他们就是中奖者。
  每一帧本来就是随机抽的,同一帧内不会重复;一帧只停留 34–74 毫秒,远短于
  人的反应误差,卡不住任何人。
- 名单、Logo、奖项和已中奖名单会**自动存在本机浏览器里**(IndexedDB)。误关页面、
  断电、手机杀后台,重新打开自动接着上次继续,不用手动恢复。
- 数据只在本机,不上传。换设备或换浏览器不会同步 —— 那种情况用「设置 → 保存进度」
  导出 .json 带走,到新设备再「恢复进度」。
- 「设置 → 本机存档」里可以关掉自动保存,或一键清除本机数据(连名单和 Logo 一起删)。
- 第一次要联网打开一遍,缓存泰文字体和 Excel 解析库,之后才能完全离线。
