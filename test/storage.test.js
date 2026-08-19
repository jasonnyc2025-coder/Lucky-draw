/* 本机存档:关掉页面重开是否自动接着上次、开关是否生效、清除是否彻底。
   这里都是真的关闭页面再打开,不是直接改内存状态。 */
'use strict';

const { reporter, chromium } = require('./lib/harness');

// 1×1 红点 PNG,当 Logo 用
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
             'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

module.exports = async function run({ url, staffXlsx }) {
  const R = reporter('本机存档 storage');
  const browser = await chromium().launch();
  // 同一个 context = 同一个浏览器配置,IndexedDB 跨页面关闭仍在
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const errs = [];
  let page;

  const open = async () => {
    page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1200);          // 等 bootRestore 读完 IndexedDB
    return page;
  };
  const reopen = async () => { await page.close(); return open(); };
  const drawOnce = async (picks) => {
    await page.click('#bPour');
    await page.waitForTimeout(1400);
    await page.click('#bPour');
    await page.waitForTimeout(900 + picks * 650 + 900);
  };

  try {
    await open();
    R.check('首次打开:本机无存档', /还没有存档/.test(await page.textContent('#storeNote')),
            await page.textContent('#storeNote'));

    // ---------- 造数据 ----------
    await page.click('#bNames');
    if (staffXlsx) {
      await page.setInputFiles('#file', staffXlsx);
      await page.waitForSelector('#mapWrap', { state: 'visible' });
      await page.selectOption('#colName', '0');
      await page.selectOption('#colSub', '1');
      await page.click('#bApplyFile');
    } else {
      await page.fill('#paste', Array.from({ length: 60 },
        (_, i) => 'Tester ' + (i + 1) + ', EMP' + (i + 1)).join('\n'));
      await page.click('#bApplyPaste');
    }
    await page.waitForTimeout(400);

    await page.click('#bTiers');
    await page.waitForSelector('#vTiers.on');
    const ins = await page.$$('#tierRows tr:nth-child(1) input');
    await ins[2].fill('4');
    await ins[3].fill('2');
    await page.click('#bSaveTiers');
    await page.waitForTimeout(300);

    await page.evaluate(l => applyLogo(l), LOGO);
    await page.waitForTimeout(300);
    await drawOnce(2);

    const before = await page.evaluate(() => ({
      pool: S.pool.length, winners: S.winners.length,
      names: S.winners.map(w => w.name).sort(),
      quota: S.tiers[0].quota, per: S.tiers[0].per,
      logo: S.logo.slice(0, 40), active: S.activeTier,
      note: document.querySelector('#storeNote').textContent,
    }));
    R.check('抽完一轮后自动保存', /已自动保存/.test(before.note), before.note);

    // ---------- 模拟「不小心关掉 app」 ----------
    await reopen();
    const after = await page.evaluate(() => ({
      pool: S.pool.length, winners: S.winners.length,
      names: S.winners.map(w => w.name).sort(),
      quota: S.tiers[0].quota, per: S.tiers[0].per,
      logo: S.logo.slice(0, 40), active: S.activeTier,
      logoVisible: document.querySelector('#logoImg').classList.contains('on'),
      note: document.querySelector('#storeNote').textContent,
    }));
    R.check('重开后名单还在', after.pool === before.pool, before.pool + ' → ' + after.pool);
    R.check('重开后中奖记录还在',
            after.winners === before.winners &&
            JSON.stringify(after.names) === JSON.stringify(before.names), after.names.join(','));
    R.check('重开后奖项设置还在', after.quota === 4 && after.per === 2,
            'quota=' + after.quota + ' per=' + after.per);
    R.check('重开后 Logo 还在并显示', after.logo === before.logo && after.logoVisible);
    R.check('重开后停在同一档', after.active === before.active);
    R.check('恢复提示正确', /已从本机恢复/.test(after.note), after.note);

    await drawOnce(2);
    R.check('恢复后能接着抽完这一档', await page.evaluate(() => S.winners.length) === 4);

    // ---------- 关掉自动保存 ----------
    await page.click('#bSetup');
    await page.waitForSelector('#vSetup.on');
    await page.uncheck('#autoSave');
    await page.waitForTimeout(200);
    await page.click('#vSetup [data-close]');
    await drawOnce(1);                                   // 二等奖抽 1 人
    const offCount = await page.evaluate(() => S.winners.length);

    await reopen();
    const afterOff = await page.evaluate(() => ({
      w: S.winners.length, autoSave: document.querySelector('#autoSave').checked,
    }));
    R.check('关掉自动保存后新结果不再写入', afterOff.w === 4 && offCount === 5,
            '关前=' + offCount + ' 重开=' + afterOff.w);
    R.check('开关状态本身也记住了', afterOff.autoSave === false);

    await page.click('#bSetup');
    await page.waitForSelector('#vSetup.on');
    await page.check('#autoSave');
    await page.waitForTimeout(600);

    // ---------- 清除本机数据 ----------
    page.on('dialog', d => d.accept());
    await page.click('#bClearStore');
    await page.waitForTimeout(800);
    const cleared = await page.evaluate(() => ({
      pool: S.pool.length, winners: S.winners.length, logo: S.logo, tiers: S.tiers.length,
      logoVisible: document.querySelector('#logoImg').classList.contains('on'),
    }));
    R.check('清除后当前界面也清空',
            cleared.pool === 0 && cleared.winners === 0 && cleared.logo === '' &&
            !cleared.logoVisible && cleared.tiers === 3, JSON.stringify(cleared));

    await reopen();
    const afterClear = await page.evaluate(() => ({
      pool: S.pool.length, winners: S.winners.length, logo: S.logo,
      note: document.querySelector('#storeNote').textContent,
    }));
    R.check('清除后重开确实是空的',
            afterClear.pool === 0 && afterClear.winners === 0 && afterClear.logo === '' &&
            /还没有存档/.test(afterClear.note), JSON.stringify(afterClear));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
