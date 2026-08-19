/* PDF 导入:文字版 PDF 能不能还原成「姓名 / 工号 / 部门」三列,
   以及扫描件那种没有文字的 PDF 会不会给出清楚的提示。 */
'use strict';

const { reporter, chromium, staffRows } = require('./lib/harness');

module.exports = async function run({ url, staffPdf, blankPdf, usedLocalPdf }) {
  const R = reporter('PDF 导入 pdf');
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    if (!usedLocalPdf) {
      R.check('pdf.js 可用(装了 pdfjs-dist 才能离线测)', false, '跳过:npm install 后再跑');
      return R;
    }

    // ---------- 1. 文字版 PDF ----------
    await page.click('#bNames');
    await page.setInputFiles('#file', staffPdf);
    await page.waitForSelector('#mapWrap', { state: 'visible', timeout: 20000 });

    const parsed = await page.evaluate(() => ({
      rows: S.fileRows.length,
      width: Math.max.apply(null, S.fileRows.map(r => r.length)),
      head: S.fileRows[0],
      first: S.fileRows[1],
      last: S.fileRows[S.fileRows.length - 1],
      opts: [...document.querySelectorAll('#colName option')].length,
    }));
    const want = staffRows();
    R.check('PDF 解析出 61 行(表头 + 60 人)', parsed.rows === 61, 'rows=' + parsed.rows);
    R.check('还原成三列', parsed.width === 3, 'width=' + parsed.width);
    // 表头里也有泰文,同样不强求声调符号,只看中文部分和列数
    R.check('表头识别正确(中文部分)',
            parsed.head.length === 3 &&
            ['姓名', '工号', '部门'].every((w, i) => parsed.head[i].indexOf(w) === 0),
            JSON.stringify(parsed.head));
    R.check('第一行内容正确', JSON.stringify(parsed.first) === JSON.stringify(want[1]),
            JSON.stringify(parsed.first));
    R.check('跨页的最后一行也在', JSON.stringify(parsed.last) === JSON.stringify(want[60]),
            JSON.stringify(parsed.last));
    R.check('列选择器和 Excel 一样出现', parsed.opts === 3, 'options=' + parsed.opts);

    const names = await page.evaluate(() => S.fileRows.slice(1).map(r => r[0]));
    const wantNames = want.slice(1).map(r => r[0]);
    const ids = await page.evaluate(() => S.fileRows.slice(1).map(r => r[1]));

    /* 中文和英文名要一字不差 —— 这一条真正检验的是「按 y 归行、按 x 切列」的还原逻辑 */
    const nonThai = wantNames.map((n, i) => [n, names[i]]).filter(([w]) => !/[\u0E00-\u0E7F]/.test(w));
    R.check('中文和英文姓名一字不差(' + nonThai.length + ' 个)',
            nonThai.every(([w, g]) => w === g),
            nonThai.filter(([w, g]) => w !== g).slice(0, 3).map(([w, g]) => w + '→' + g).join(' | ') || '全对');

    R.check('工号 EMP001-060 全部正确',
            JSON.stringify(ids) === JSON.stringify(want.slice(1).map(r => r[1])),
            ids.filter((v, i) => v !== want[i + 1][1]).slice(0, 3).join(' | ') || '全对');

    /* 泰文:PDF 的文字提取本来就可能丢声调符号,取决于 PDF 是怎么生成的。
       这里只保证名字在、没被拆散、主体字符基本保留,不强求逐字相同。 */
    const thai = wantNames.map((n, i) => [n, names[i]]).filter(([w]) => /[\u0E00-\u0E7F]/.test(w));
    const keptRatio = thai.map(([w, g]) => {
      if (!g) return 0;
      const set = new Set(g.split(''));
      return w.split('').filter(c => set.has(c)).length / w.length;
    });
    R.check('泰文姓名都提取到了(不强求声调符号,PDF 本身会丢)',
            thai.length === 20 && keptRatio.every(r => r >= 0.8),
            '最差保留率 ' + Math.round(Math.min.apply(null, keptRatio) * 100) + '%');

    // ---------- 2. 走完导入 ----------
    await page.selectOption('#colName', '0');
    await page.selectOption('#colSub', '1');
    await page.click('#bApplyFile');
    await page.waitForTimeout(500);
    const pool = await page.evaluate(() => ({
      n: S.pool.length, first: S.pool[0],
      panelOpen: document.querySelector('#vNames').classList.contains('on'),
    }));
    R.check('导入后奖池 60 人', pool.n === 60, 'pool=' + pool.n);
    R.check('工号跟着进来了', pool.first && pool.first.sub === 'EMP001', JSON.stringify(pool.first));
    R.check('导入后自动关闭面板', !pool.panelOpen);

    // ---------- 3. 扫描件(没有文字层) ----------
    await page.click('#bNames');
    await page.setInputFiles('#file', blankPdf);
    await page.waitForTimeout(2500);
    const toastTxt = await page.evaluate(() => document.querySelector('#toast').textContent);
    R.check('扫描件给出清楚的提示而不是静默失败',
            /没有文字|扫描件/.test(toastTxt), toastTxt);
    R.check('扫描件不会覆盖已导入的名单',
            await page.evaluate(() => S.pool.length === 60));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
