# 测试

用 Playwright 驱动真实的 Chromium,像人一样点按钮、选文件、按空格,不直接改内存状态。

## 跑起来

```bash
npm install
npx playwright install chromium    # 只需一次,下载浏览器
npm test
```

单独跑一个套件:

```bash
npm run test:draw       # 抽奖全流程
npm run test:storage    # 本机存档
```

全部通过时退出码 0,有失败是 1,可以直接接 CI。

## 两个套件

| 文件 | 覆盖 |
|---|---|
| `draw.test.js` | Excel 导入、列映射、奖项设置、顺序锁定、四轮开奖、去重、中奖名单渲染、导出 CSV、保存进度、撤销、重置、从文件恢复、空格键、粘贴导入 |
| `storage.test.js` | 自动存档、**真的关掉页面重新打开**后名单/Logo/奖项/中奖记录是否都在、自动保存开关、清除本机数据 |

`storage.test.js` 复用同一个浏览器 context 来关闭再打开页面,这样 IndexedDB 才会保留 —— 换 context 相当于换了个浏览器配置,存档就没了。

## 它是怎么跑的

1. `test/lib/harness.js` 把仓库里的文件拷到一个临时目录,**不动仓库本身**
2. 页面正常是从 cdnjs 加载 xlsx 库的;临时副本里换成 `node_modules` 里的那份,这样断网也能测 Excel 导入。没装 xlsx 依赖就退回粘贴名单,其余断言不变
3. 起一个随机端口的静态服务器(不需要额外依赖)
4. 跑完删掉临时目录

## 改了代码之后

改完 `index.html` 直接 `npm test`。几个容易踩的点已经有回归断言盯着了:

- 中奖名单的名字为空(`el(tag, cls, txt)` 少传一个参数,姓名被当成 class)
- 抽出重复的人 / 中奖者没从待抽池移除
- 导出的 CSV 少了 BOM,Excel 打开中文乱码
- 关掉页面重开丢数据

## 没覆盖的

需要真机确认:离线运行(Service Worker 缓存)、PWA 安装、音效、全屏投影、真实网络下能否加载到 cdnjs 的 xlsx。
