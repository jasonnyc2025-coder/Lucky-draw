#!/usr/bin/env node
/* 跑全部测试:node test/run.js  (或 npm test)
   只跑一个:node test/run.js draw   /   node test/run.js storage */
'use strict';

const fs = require('fs');
const { buildHarness, startServer, makeStaffXlsx, makeStaffPdf, makeBlankPdf } = require('./lib/harness');

const SUITES = {
  draw: require('./draw.test.js'),
  roster: require('./roster.test.js'),
  pdf: require('./pdf.test.js'),
  storage: require('./storage.test.js'),
};

(async () => {
  const want = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const names = want.length ? want : Object.keys(SUITES);
  for (const n of names) {
    if (!SUITES[n]) {
      console.error('没有这个测试套件: ' + n + '(可用:' + Object.keys(SUITES).join(', ') + ')');
      process.exit(2);
    }
  }

  const { dir, usedLocalXlsx, usedLocalPdf } = buildHarness();
  const staffXlsx = makeStaffXlsx(dir);
  const needPdf = names.includes('pdf');
  const staffPdf = needPdf ? await makeStaffPdf(dir) : null;
  const blankPdf = needPdf ? await makeBlankPdf(dir) : null;
  const server = await startServer(dir);

  console.log('临时副本 : ' + dir);
  console.log('服务地址 : ' + server.url);
  console.log('xlsx     : ' + (usedLocalXlsx ? '本地 node_modules(离线也能测 Excel 导入)'
                                             : 'cdnjs(需要联网,否则 Excel 相关断言会失败)'));
  console.log('pdf.js   : ' + (usedLocalPdf ? '本地 node_modules(离线也能测 PDF 导入)'
                                            : '未安装 pdfjs-dist,PDF 套件会跳过'));
  if (!staffXlsx) {
    console.log('提示     : 没装 xlsx 依赖,导入环节改用粘贴名单。跑 npm install 可覆盖 Excel 路径。');
  }

  const reports = [];
  let failed = 0;
  for (const n of names) {
    const R = await SUITES[n]({ url: server.url, fixtures: dir, staffXlsx,
                                staffPdf, blankPdf, usedLocalPdf });
    R.print();
    reports.push([n, R]);
    failed += R.failed;
  }

  const total = reports.reduce((s, [, R]) => s + R.rows.length, 0);
  console.log('\n' + '='.repeat(56));
  for (const [n, R] of reports) {
    console.log('  ' + n.padEnd(10) + (R.failed ? R.failed + ' 项失败 / ' : '全部通过 ') + R.rows.length + ' 项');
  }
  console.log(failed ? '\n✗ ' + failed + ' 项失败(共 ' + total + ' 项)'
                     : '\n✓ 全部通过(共 ' + total + ' 项)');

  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('\n测试运行失败:', e && e.stack ? e.stack : e);
  process.exit(2);
});
