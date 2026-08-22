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
npm run test:roster     # 名单增删改
npm run test:pdf        # PDF 导入
npm run test:storage    # 本机存档
```

全部通过时退出码 0,有失败是 1,可以直接接 CI。

## 四个套件

| 文件 | 覆盖 |
|---|---|
| `draw.test.js` | Excel 导入、列映射、奖项设置、顺序锁定、四轮开奖、所见即所得、去重、结束总榜、中奖名单渲染、导出 CSV、保存进度、撤销、重置、从文件恢复、空格键、粘贴导入 |
| `roster.test.js` | 名单面板:看当前名单、改名、删人、中奖者只能改不能删、改动存进本机 |
| `pdf.test.js` | PDF 导入:按文字坐标还原行列、跨页重复表头去重、扫描件的错误提示 |
| `storage.test.js` | 自动存档、**真的关掉页面重新打开**后名单/Logo/奖项/中奖记录是否都在、自动保存开关、清除本机数据 |

## 关于 PDF 测试

测试用的 PDF 是现场用无头浏览器把一张 HTML 表格打印出来的,并且**嵌入了
Noto Sans Thai**(devDependency)。不嵌的话容器里没有泰文字体,打印出来的
PDF 连泰文声调符号都没有,测出来的会是环境问题而不是解析器问题。

即便嵌了字体,PDF 的文字提取仍会偶尔把某个泰文声调符号还原成 NUL —— 这是
PDF 格式本身的局限。所以断言是分层的:

- 中文和英文姓名、工号 → **一字不差**(这才是真正在检验行列还原逻辑)
- 泰文姓名 → 只要求提取到、没被拆散、主体字符保留 ≥ 80%

`storage.test.js` 复用同一个浏览器 context 来关闭再打开页面,这样 IndexedDB 才会保留 —— 换 context 相当于换了个浏览器配置,存档就没了。

## 它是怎么跑的

1. `test/lib/harness.js` 把仓库里的文件拷到一个临时目录,**不动仓库本身**
2. 页面正常是从 cdnjs 加载 xlsx 和 pdf.js 的;临时副本里换成 `node_modules` 里的那份,这样断网也能测 Excel / PDF 导入。没装 xlsx 依赖就退回粘贴名单,没装 pdfjs-dist 就跳过 PDF 套件
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
