/* 结束画面:名字要完整显示出来,以及烟花。
   现场真遇到过:名单是「工号 | 称谓 | 名 | 姓」四列,原来只能二选一,
   结果总榜上大字是工号、小字是「นาย」,人名根本没出现。 */
'use strict';

const { reporter, chromium } = require('./lib/harness');

/* 现场那份真名单的表头(工号 / 称谓 / 名 / 姓 / 部门)。
   部门那列必须被排除 —— 拼进名字里会变成「นาย อร่าม จันพางาม ตะกั่วอัลลอย-โรง2」。 */
const REAL = [
  ['รหัสพนักงาน', 'คำนำหน้า', 'ชื่อ(ไทย)', 'นามสกุล(ไทย)', 'แผนก'],
  ['01018', 'นาย', 'อร่าม', 'จันพางาม', 'ตะกั่วอัลลอย-โรง2'],
  ['01027', 'นาย', 'จำปี', 'ภูเลาสิงห์', 'ตะกั่วเตาตะลง'],
  ['10007', 'นางสาว', 'ศรมณี', 'หงษ์ทอง', 'เตรียมวัตถุดิบ'],
];

/* 模拟泰文名单常见的排法:工号、称谓、名、姓 分成四列 */
const HEAD = ['รหัส 工号', 'คำนำหน้า 称谓', 'ชื่อ 名', 'นามสกุล 姓'];
const GIVEN = ['สมชาย', 'ณัฐพล', '王小美', '李明华', 'Vincent', 'อารีย์', '张敏', 'John'];
const FAM   = ['ใจดี', 'ศรีสุข', '—', '—', 'Chen', 'รักชาติ', '—', 'Smith'];
const ROWS = [HEAD].concat(GIVEN.map((g, i) =>
  [String(15000 + i), i % 3 === 0 ? 'นางสาว' : 'นาย', g, FAM[i]]));

module.exports = async function run({ url }) {
  const R = reporter('结束画面 finale');
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
  page.on('dialog', d => d.accept());

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    // ---------- 1. 列映射 ----------
    await page.click('#bNames'); await page.waitForTimeout(250);
    await page.evaluate(rows => { S.fromPdf = false; loadRows(rows); }, ROWS);
    await page.waitForTimeout(400);

    const guess = await page.evaluate(() => colRoles());
    R.check('工号那列会自动猜成「副信息」,其余猜成「姓名」',
            guess[0] === 'sub' && guess.slice(1).every(v => v === 'name'),
            JSON.stringify(guess));

    const demo = await page.evaluate(() => ({
      name: document.querySelector('#mapDemo b').textContent,
      sub: (document.querySelector('#mapDemo span') || {}).textContent || '',
    }));
    R.check('称谓 + 名 + 姓 三列拼成完整姓名(这是原来做不到的)',
            demo.name === 'นางสาว สมชาย ใจดี', JSON.stringify(demo));
    R.check('工号排在小字那一行,不会占掉姓名的位置',
            demo.sub === '15000', demo.sub);

    // 故意选错:把工号当姓名 —— 预览卡要当场露馅
    await page.evaluate(() => {
      const s = [...document.querySelectorAll('#cols select')];
      s[0].value = 'name'; s[1].value = ''; s[2].value = ''; s[3].value = '';
      previewMap();
    });
    await page.waitForTimeout(250);
    R.check('选错列时预览卡直接显示成工号,一眼看得出不对',
            await page.evaluate(() => document.querySelector('#mapDemo b').textContent) === '15000');

    // 改回来并导入
    await page.evaluate(() => {
      const s = [...document.querySelectorAll('#cols select')];
      s[0].value = 'sub'; s[1].value = 'name'; s[2].value = 'name'; s[3].value = 'name';
      previewMap();
    });
    await page.click('#bApplyFile'); await page.waitForTimeout(500);
    const pool = await page.evaluate(() => S.pool.slice(0, 2).map(x => x.name + '|' + x.sub));
    R.check('导进去的就是完整姓名 + 工号',
            pool[0] === 'นางสาว สมชาย ใจดี|15000', JSON.stringify(pool));

    // ---------- 1.5 按表头认列(现场那份真名单) ----------
    await page.click('#bNames'); await page.waitForTimeout(250);
    await page.evaluate(rows => { S.fromPdf = false; loadRows(rows); }, REAL);
    await page.waitForTimeout(400);
    const real = await page.evaluate(() => colRoles());
    R.check('看表头就能认出工号列(รหัสพนักงาน → 副信息)', real[0] === 'sub', JSON.stringify(real));
    R.check('称谓 / 名 / 姓 三列都认成姓名',
            real[1] === 'name' && real[2] === 'name' && real[3] === 'name', JSON.stringify(real));
    R.check('部门列(แผนก)默认不用,不会被拼进名字里',
            real[4] === '', 'แผนก → ' + JSON.stringify(real[4]));
    const realDemo = await page.evaluate(() => ({
      n: document.querySelector('#mapDemo b').textContent,
      s: (document.querySelector('#mapDemo span') || {}).textContent || '',
    }));
    R.check('这份表直接导进去就是「称谓 名 姓」+ 工号,不用手动调',
            realDemo.n === 'นาย อร่าม จันพางาม' && realDemo.s === '01018',
            JSON.stringify(realDemo));

    // 换回四列那份继续后面的流程
    await page.evaluate(rows => { S.fromPdf = false; loadRows(rows); }, ROWS);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const s = [...document.querySelectorAll('#cols select')];
      s[0].value = 'sub'; s[1].value = 'name'; s[2].value = 'name'; s[3].value = 'name';
      previewMap();
    });
    await page.click('#bApplyFile'); await page.waitForTimeout(500);

    // ---------- 2. 抽完 → 总榜上是名字,不是工号 ----------
    await page.evaluate(() => {
      S.tiers = [{ id: 't1', th: 'รางวัลที่ 2', zh: '二等奖', quota: 4, per: 4 },
                 { id: 't2', th: 'รางวัลที่ 1', zh: '一等奖', quota: 2, per: 2 }];
      S.winners = []; S.history = [];
      syncActive(); renderRail(); resetStage(); updateControls();
    });
    for (let i = 0; i < 2; i++) {
      await page.click('#bPour'); await page.waitForTimeout(900);
      await page.click('#bPour'); await page.waitForTimeout(5200);
    }
    await page.waitForTimeout(3200);

    const board = await page.evaluate(() => ({
      exists: !!document.querySelector('.board'),
      names: [...document.querySelectorAll('.board .bname b')].map(e => e.textContent),
      subs: [...document.querySelectorAll('.board .bname span')].map(e => e.textContent),
    }));
    R.check('总榜上大字是人名,不是工号',
            board.names.length === 6 && board.names.every(n => /[฀-๿一-龥A-Za-z]/.test(n) && !/^\d+$/.test(n)),
            JSON.stringify(board.names));
    R.check('工号跟在名字下面一起显示',
            board.subs.length === 6 && board.subs.every(v => /^\d{5}$/.test(v)),
            JSON.stringify(board.subs));

    // ---------- 2.5 工号要看得清 ----------
    /* 原来工号那行是固定 10-18px,名字最大 104px,差了五六倍,投影上看不清。
       现在跟着名字一起缩放,至少是名字的四分之一。 */
    {
      const sz = await page.evaluate(() => {
        const c = document.querySelector('.board .bname');
        return { nm: +getComputedStyle(c.querySelector('b')).fontSize.replace('px', ''),
                 sub: +getComputedStyle(c.querySelector('span')).fontSize.replace('px', '') };
      });
      R.check('总榜上工号不会小到看不清(至少是姓名的 1/4)',
              sz.sub / sz.nm >= 0.25, sz.nm + 'px / ' + sz.sub + 'px = ' +
              Math.round(sz.sub / sz.nm * 100) + '%');
    }

    // ---------- 2.5 工号要看得清 ----------
    /* 原来工号那行是固定 10-18px,名字最大能到 104px —— 差了五六倍,投影上看不清。
       现在跟着名字一起缩放。 */
    {
      const sz = await page.evaluate(() => {
        const c = document.querySelector('.board .bname');
        return { nm: +getComputedStyle(c.querySelector('b')).fontSize.replace('px', ''),
                 sub: +getComputedStyle(c.querySelector('span')).fontSize.replace('px', '') };
      });
      R.check('总榜上工号不会小到看不清(至少是姓名的 1/4)',
              sz.sub / sz.nm >= 0.25,
              sz.nm + 'px / ' + sz.sub + 'px = ' + Math.round(sz.sub / sz.nm * 100) + '%');
    }

    // ---------- 3. 烟花 ----------
    const fw = await page.evaluate(() => ({
      on: document.querySelector('#fw').classList.contains('on'),
      running: !!FW.raf, parts: FW.parts.length,
      /* 名字必须压在烟花上面 */
      zFw: +getComputedStyle(document.querySelector('#fw')).zIndex,
      zNames: +getComputedStyle(document.querySelector('#slots')).zIndex,
    }));
    R.check('总榜出来时烟花在放', fw.on && fw.running && fw.parts > 0, JSON.stringify(fw));
    R.check('名字压在烟花上面,不会被挡住', fw.zNames > fw.zFw, fw.zNames + ' > ' + fw.zFw);
    R.check('烟花画布不吃点击,不挡下面的按钮',
            await page.evaluate(() =>
              getComputedStyle(document.querySelector('#fw')).pointerEvents === 'none'));

    // 粒子数要有上限,投影机上不能越放越卡
    await page.waitForTimeout(6000);
    const grown = await page.evaluate(() => FW.parts.length);
    R.check('粒子数不会无限涨(放久了也不卡)', grown < 1400, 'parts=' + grown);

    // 撤销离开总榜 → 烟花要收掉
    await page.click('#bUndo'); await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      on: document.querySelector('#fw').classList.contains('on'),
      running: !!FW.raf, parts: FW.parts.length,
    }));
    R.check('离开总榜后烟花停掉,不会在后台一直烧 CPU',
            !after.on && !after.running && after.parts === 0, JSON.stringify(after));

    // ---------- 4. 开关 ----------
    await page.click('#bSetup'); await page.waitForTimeout(250);
    await page.uncheck('#fwOn'); await page.waitForTimeout(200);
    await page.click('#vSetup [data-close]'); await page.waitForTimeout(200);
    await page.click('#bPour'); await page.waitForTimeout(900);
    await page.click('#bPour'); await page.waitForTimeout(6500);
    const off = await page.evaluate(() => ({
      board: !!document.querySelector('.board'),
      on: document.querySelector('#fw').classList.contains('on'), running: !!FW.raf,
    }));
    R.check('关掉烟花后总榜照常出,只是不放烟花',
            off.board && !off.on && !off.running, JSON.stringify(off));

    // 开关要记住
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
    R.check('烟花开关关掉重开还记得',
            await page.evaluate(() => FW.on === false &&
                                      document.querySelector('#fwOn').checked === false));

    // ---------- 5. 每抽完一轮也放一次,放完自己收 ----------
    await page.evaluate(() => { FW.on = true; });
    await page.click('#bSetup'); await page.waitForTimeout(200);
    await page.check('#fwOn'); await page.waitForTimeout(200);
    await page.click('#vSetup [data-close]'); await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.tiers = [{ id: 'r1', th: 'รางวัลที่ 3', zh: '三等奖', quota: 9, per: 3 }];
      S.winners = []; S.history = [];
      syncActive(); renderRail(); resetStage(); updateControls();
    });
    await page.click('#bPour'); await page.waitForTimeout(1100);
    await page.click('#bPour'); await page.waitForTimeout(1400);
    const mid = await page.evaluate(() => ({
      mode: FW.mode, parts: FW.parts.length, on: document.querySelector('#fw').classList.contains('on'),
      done: allDone(),
    }));
    R.check('抽完一轮(还没抽完全部)就在这一屏点一次烟花',
            mid.mode === 'shot' && mid.parts > 0 && mid.on && !mid.done, JSON.stringify(mid));

    await page.waitForTimeout(5000);
    const settled = await page.evaluate(() => ({
      parts: FW.parts.length, raf: !!FW.raf,
      on: document.querySelector('#fw').classList.contains('on'),
    }));
    R.check('这一轮的烟花放完自己收,不会一直闪着挡名字',
            settled.parts === 0 && !settled.raf && !settled.on, JSON.stringify(settled));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
