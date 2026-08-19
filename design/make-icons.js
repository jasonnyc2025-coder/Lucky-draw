#!/usr/bin/env node
/* 从 design/icon.html 重新生成全部图标 PNG:node design/make-icons.js
   需要先 npm install(用的是测试那套 playwright)。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const chromium = require(require.resolve('playwright', { paths: [ROOT] })).chromium;

const JOBS = [
  ['icon-512.png',          512, 'std'],
  ['icon-192.png',          192, 'std'],
  ['apple-touch-icon.png',  180, 'std'],
  ['favicon-64.png',         64, 'std'],
  ['icon-maskable-512.png', 512, 'msk'],
];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'icon.html'));
  for (const [name, size, variant] of JOBS) {
    await p.evaluate(([s, v]) => setIcon(s, v), [size, variant]);
    await p.waitForTimeout(120);
    await p.locator('#box').screenshot({ path: path.join(ROOT, name) });
    console.log(name, size + '×' + size, variant);
  }
  await b.close();
  console.log('\n改完图标记得把 index.html 的 APP_VERSION 和 sw.js 的 VERSION 一起加一,否则用户拿到的还是缓存里的旧图标。');
})().catch(e => { console.error(e); process.exit(1); });
