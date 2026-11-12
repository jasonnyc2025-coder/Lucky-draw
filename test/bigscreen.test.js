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
    R.check('1080p 投影上姓名比原来的 104px 上限大得多',
            fhd.name >= 150, fhd.name + 'px');
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

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
