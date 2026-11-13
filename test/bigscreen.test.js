/* 接投影 / 大电视。原来字号和舞台宽度都写死上限:
   1080p 和 4K 上姓名一样是 104px、名字卡一样是 1180px —— 4K 上只占屏幕 31%,
   两边全是黑的,看起来就像把手机界面摆到了大屏中间。 */
'use strict';

const { reporter, chromium } = require('./lib/harness');

const ROWS = [
  ['รหัสพนักงาน', 'คำนำหน้า', 'ชื่อ(ไทย)', 'นามสกุล(ไทย)', 'แผนก'],
  ['01005', 'นาย', 'แพรวา', 'ไวยาประโคน', 'ตะกั่วอัลลอย'],
  ['01006', 'นางสาว', 'ณรงค์ศักดิ์', 'บรรดาศักดิ์', 'ตะกั่วอัลลอย'],
  ['01007', 'นาย', 'สิงหา', 'ผิวผา', 'ตะกั่วอัลลอย'],
];

module.exports = async function run({ url }) {
  const R = reporter('大屏 / 投影 bigscreen');
  const browser = await chromium().launch();
  const errs = [];

  /* 开一屏、导名单、抽一轮,回报舞台上各处的实际尺寸 */
  const measure = async (w, h, scale) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
    page.on('dialog', d => d.accept());
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await page.evaluate(v => applyScale(v, true), scale);
    await page.click('#bSetup'); await page.waitForTimeout(200);
    await page.fill('#orgMain', 'Bergsoe Metals Co Ltd');
    await page.fill('#orgSub', 'บริษัท เบิร์กโซ เมททัลส์ จำกัด');
    await page.waitForTimeout(200);
    await page.click('#vSetup [data-close]'); await page.waitForTimeout(200);
    await page.click('#bNames'); await page.waitForTimeout(200);
    await page.evaluate(r => { S.fromPdf = false; loadRows(r); }, ROWS);
    await page.waitForTimeout(250);
    await page.click('#bApplyFile'); await page.waitForTimeout(350);
    await page.evaluate(() => {
      S.tiers = [{ id: 't1', th: 'รางวัลที่ 1', zh: '一等奖', quota: 3, per: 1 }];
      S.winners = []; S.history = [];
      syncActive(); renderRail(); resetStage(); updateControls();
    });
    await page.click('#bPour'); await page.waitForTimeout(1000);
    await page.click('#bPour'); await page.waitForTimeout(3200);
    const m = await page.evaluate(() => {
      const px = el => el ? Math.round(+getComputedStyle(el).fontSize.replace('px', '')) : 0;
      const card = document.querySelector('.ingot').getBoundingClientRect();
      const cru = document.querySelector('#crucible').getBoundingClientRect();
      return {
        name: px(document.querySelector('.ingot .nm')),
        title: px(document.querySelector('.eb-main')),
        org: px(document.querySelector('#shOrg b')),
        tier: px(document.querySelector('.tier-th')),
        widthPct: Math.round(card.width / innerWidth * 100),
        inside: card.bottom <= cru.bottom + 2 && card.top >= cru.top - 2,
        noHScroll: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    await ctx.close();
    return m;
  };

  try {
    const hd = await measure(1366, 768, 1);      // 笔记本
    const fhd = await measure(1920, 1080, 1);    // 1080p 投影
    const uhd = await measure(3840, 2160, 1);    // 4K 电视
    const uhdBig = await measure(3840, 2160, 1.8);
    const phone = await measure(412, 915, 1);

    R.check('屏幕越大字越大(不再是三种屏幕一个字号)',
            fhd.name > hd.name && uhd.name > fhd.name,
            `1366→${hd.name}px, 1920→${fhd.name}px, 4K→${uhd.name}px`);
    /* 原来这里要求 ≥150px,其实是靠把姓 ไวยาประโคน 拆成「ไวยา / ประโคน」两行才塞下的;
       现在名字只在空格处换行,同一个名字整词放得下的最大字号是 ~144px */
    R.check('1080p 投影上姓名比原来的 104px 上限大得多(而且姓不会被拆成两行)',
            fhd.name >= 135, fhd.name + 'px');
    R.check('4K 电视上名字卡铺得开(原来只占 31%)',
            uhd.widthPct >= 70, uhd.widthPct + '%');
    R.check('显示比例调大,名字、标题、公司名、奖项名一起变大',
            uhdBig.name > uhd.name && uhdBig.title > uhd.title &&
            uhdBig.org > uhd.org && uhdBig.tier > uhd.tier,
            JSON.stringify({ 一倍: uhd, 一点八倍: uhdBig }));

    /* 放开上限之后最容易出的事:长泰文名把卡片撑出屏幕 */
    for (const [label, m] of [['笔记本', hd], ['1080p', fhd], ['4K', uhd],
                              ['4K@180%', uhdBig], ['手机', phone]]) {
      R.check(label + ':名字卡没被挤出舞台', m.inside, JSON.stringify(m));
    }
    R.check('所有尺寸都没有横向滚动条',
            [hd, fhd, uhd, uhdBig, phone].every(m => m.noHScroll));

    /* 比例是给大屏用的,不该把手机界面撑爆 */
    const phoneBig = await measure(412, 915, 1.8);
    R.check('手机上就算把比例拉到 180%,界面也不会溢出',
            phoneBig.inside && phoneBig.noHScroll, JSON.stringify(phoneBig));

    /* 记在本机,下次接同一台投影不用重调 */
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForTimeout(800);
    await p.click('#bSetup'); await p.waitForTimeout(200);
    await p.fill('#uiScale', '150');
    await p.dispatchEvent('#uiScale', 'input');
    await p.waitForTimeout(300);
    const set = await p.evaluate(() => ({
      sc: getComputedStyle(document.documentElement).getPropertyValue('--sc').trim(),
      label: document.querySelector('#uiScaleVal').textContent,
    }));
    R.check('拉滑杆立刻生效,旁边显示百分比',
            set.sc === '1.5' && set.label === '150%', JSON.stringify(set));

    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(1200);
    R.check('关掉重开还记得这个比例(接同一台投影不用重调)',
            await p.evaluate(() =>
              getComputedStyle(document.documentElement).getPropertyValue('--sc').trim() === '1.5'));

    await p.click('#bSetup'); await p.waitForTimeout(200);
    await p.click('#bScaleReset'); await p.waitForTimeout(300);
    R.check('「恢复 100%」能一键还原',
            await p.evaluate(() =>
              getComputedStyle(document.documentElement).getPropertyValue('--sc').trim() === '1' &&
              document.querySelector('#uiScale').value === '100'));
    await ctx.close();

    /* 平板竖屏:原来奖项条每张卡 width:100%,一张卡就占满 122px 高的一整条还要横滑,
       顶栏折成两行 115px,舞台只剩 65%。现在奖项条是一排小药丸,舞台要占大头。 */
    const portrait = async (w, h, draw) => {
      const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
      const pg = await c.newPage();
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto(url, { waitUntil: 'load' });
      await pg.waitForTimeout(700);
      await pg.evaluate(() => {
        S.pool = ['ณรงค์ศักดิ์', 'สุทธิพงษ์', 'ประสิทธิ์', 'สุดารัตน์', 'ศักดิ์ชาย', 'ณรงค์'].map(n => ({ name: n, sub: '' }));
        S.tiers = [{ id: 'a', th: 'รางวัลที่ 3', zh: '三等奖', quota: 6, per: 6 },
                   { id: 'b', th: 'รางวัลที่ 2', zh: '二等奖', quota: 3, per: 3 },
                   { id: 'c', th: 'รางวัลที่ 1', zh: '一等奖', quota: 1, per: 1 }];
        S.winners = []; S.history = [];
        syncActive(); renderRail(); resetStage(); updateControls();
      });
      await pg.waitForTimeout(200);
      if (draw){ await pg.click('#bPour'); await pg.waitForTimeout(900); await pg.click('#bPour'); await pg.waitForTimeout(5500); }
      const m = await pg.evaluate(() => {
        const h = s => Math.round(document.querySelector(s).getBoundingClientRect().height);
        const rail = document.querySelector('.rail');
        const btns = [...document.querySelectorAll('.topbar .tbtn')].filter(b => b.offsetParent);
        return {
          rail: h('.rail'), top: h('.topbar'),
          stagePct: Math.round(h('#crucible') / innerHeight * 100),
          tiersVisible: [...document.querySelectorAll('.tier')].filter(t => {
            const b = t.getBoundingClientRect(); return b.right <= innerWidth + 1 && b.left >= -1; }).length,
          railScroll: rail.scrollWidth > rail.clientWidth + 1,
          oneRow: btns.every(b => Math.abs(b.getBoundingClientRect().top - btns[0].getBoundingClientRect().top) < 12),
          /* 每个名字都是一个词(没有空格):应该一行放完,不能被拆成两行 */
          wordsWhole: [...document.querySelectorAll('.ingot .nm')].every(n =>
            n.getBoundingClientRect().height < parseFloat(getComputedStyle(n).fontSize) * 1.7),
          names: [...document.querySelectorAll('.ingot .nm')].map(n => n.textContent + '@' + getComputedStyle(n).fontSize),
          nmTooWide: cardsTooWide(document.querySelector('#slots')),
          noHScroll: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      await c.close();
      return m;
    };
    const tab = await portrait(755, 1000);
    R.check('平板竖屏:奖项条缩成一排小药丸(<60px),3 个奖项全看得到、不用横滑',
            tab.rail < 60 && tab.tiersVisible === 3 && !tab.railScroll, JSON.stringify(tab));
    R.check('平板竖屏:顶栏一行放得下,舞台占屏幕 75% 以上',
            tab.oneRow && tab.top < 70 && tab.stagePct >= 75, JSON.stringify(tab));
    const ph = await portrait(390, 844, true);
    R.check('手机竖屏:顶栏按钮泰文/中文叠两行,一排放下;奖项条很矮,舞台占 65% 以上',
            ph.oneRow && ph.top < 70 && ph.rail < 60 && ph.noHScroll && ph.stagePct >= 65, JSON.stringify(ph));
    R.check('手机窄卡上泰文名字不会从词中间拆开(原来 ณรงค์ 变成「ณรง / ค์」)',
            ph.wordsWhole && !ph.nmTooWide, JSON.stringify(ph));

    /* 滚动中名字上下跳:长名字(称谓 + 名 + 姓)折两行、短名字一行,
       卡片忽高忽矮,又是垂直居中的 —— iPad 竖屏实测上下跳 50px。现在整轮锁住高度。 */
    const rollJitter = async (w, h, per) => {
      const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < h, hasTouch: w < h });
      const pg = await c.newPage();
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto(url, { waitUntil: 'load' });
      await pg.waitForTimeout(700);
      await pg.evaluate(per => {
        S.pool = ['อัศวิน', 'มาลี', 'นาย ณรงค์ศักดิ์ บรรดาศักดิ์', 'นางสาว พัชรินทร์ ไวยาประโคน',
                  'อุดม', 'สมชาย ใจดี', 'ผดุง', 'วิภาดา ศรีสุข', '李明华', 'สุทธิพงษ์']
          .map(n => ({ name: n, sub: '' }));
        S.tiers = [{ id: 'a', th: 'รางวัลที่ 3', zh: '三等奖', quota: 6, per: per }];
        S.winners = []; S.history = [];
        syncActive(); renderRail(); resetStage(); updateControls();
      }, per);
      await pg.click('#bPour'); await pg.waitForTimeout(300);
      const m = await pg.evaluate(() => new Promise(res => {
        const tops = new Set(), hs = new Set(), fs = new Set(); let n = 0, clipped = false;
        (function f(){
          const slots = document.querySelector('#slots');
          const dy = parseFloat((slots.style.transform.match(/,\s*(-?[\d.]+)px/) || [0, 0])[1]);
          slots.querySelectorAll('.ingot').forEach(card => {
            const r = card.getBoundingClientRect();
            tops.add(Math.round(r.top - dy)); hs.add(Math.round(r.height));
            const nm = card.querySelector('.nm');
            fs.add(getComputedStyle(nm).fontSize);
            if (nm.scrollWidth > nm.clientWidth + 1) clipped = true;
          });
          if (++n < 200) requestAnimationFrame(f);
          else res({ tops: [...tops].length, heights: [...hs], fonts: [...fs], clipped });
        })();
      }));
      await c.close();
      return m;
    };
    const jPad = await rollJitter(755, 1000, 1);
    R.check('iPad 竖屏单人抽:滚动中名字卡不再上下跳(位置、高度、字号整轮不变)',
            jPad.tops === 1 && jPad.heights.length === 1 && jPad.fonts.length === 1 && !jPad.clipped,
            JSON.stringify(jPad));
    const jTv = await rollJitter(1920, 1080, 6);
    R.check('投影一次抽 6 人:每张卡高度一致、整轮不跳',
            jTv.heights.length === 1 && jTv.fonts.length === 1 && !jTv.clipped, JSON.stringify(jTv));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
