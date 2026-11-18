/* 管理密码。现场设备摆在台上,谁都能走过去点一下「重置」或删掉名单里的人。
   设了密码以后:名单 / 奖项设置 / 设置 / 撤销 / 重置 / 换 Logo 都要先输密码;
   看「中奖」名单、开始抽奖不用。输对一次,到关掉 App 前都不用再输。 */
'use strict';

const { reporter, chromium, menu } = require('./lib/harness');

module.exports = async function run({ url }) {
  const R = reporter('管理密码 lock');
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  const on = (p, id) => p.evaluate(i => document.querySelector(i).classList.contains('on'), id);
  const closeAll = p => p.evaluate(() =>
    document.querySelectorAll('.veil.on').forEach(v => v.classList.remove('on')));

  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
  page.on('dialog', d => d.accept());

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await page.evaluate(() => { try { localStorage.removeItem('lucky-draw.lock'); } catch (e) {} });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(800);

    // ---------- 默认没有密码 ----------
    await menu(page, '#bNames'); await page.waitForTimeout(200);
    R.check('默认没设密码,点「名单」直接打开', await on(page, '#vNames') && !(await on(page, '#vLock')));
    await closeAll(page);

    // ---------- 设密码:太短、两次不一样都不收 ----------
    await menu(page, '#bSetup'); await page.waitForTimeout(200);
    R.check('没设密码时,「目前没有设密码,谁拿到……」那行不显示(用户要求去掉)',
            await page.evaluate(() => document.querySelector('#lockState').hidden === true));
    const order = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('#vSetup .sec')].filter(e => !e.hidden).map(e => e.id || e.querySelector('.sec-h').textContent.trim());
      return vis.slice(0, 2);
    });
    const moved = await page.evaluate(() => {
      const vis = e => !!(e && e.checkVisibility && e.checkVisibility({ checkVisibilityCSS: true }));
      const full = document.querySelector('#bFull');
      return { topIcons: [...document.querySelectorAll('.topbar .tbtn.icon')].filter(vis).length,
               fullVis: vis(full), fullInSound: !!full.closest('.sec') &&
                 /音效/.test(full.closest('.sec').querySelector('.sec-h').textContent) };
    });
    R.check('顶栏右上角的 🔊 / ⛶ 去掉了;全屏按钮在「设置 → 音效」下面',
            moved.topIcons === 0 && moved.fullVis && moved.fullInSound, JSON.stringify(moved));
    R.check('设置里第一块是「公司 Logo」,紧接着是「管理密码」',
            order[0] === 'logoSec' && order[1] === 'lockSec', JSON.stringify(order));
    await page.fill('#pwNew', '12'); await page.fill('#pwNew2', '12');
    await page.click('#bPwSet'); await page.waitForTimeout(200);
    R.check('密码少于 4 位不收',
            /至少 4 位/.test(await page.textContent('#pwNote')) &&
            await page.evaluate(() => !localStorage.getItem('lucky-draw.lock')));
    await page.fill('#pwNew', '2580'); await page.fill('#pwNew2', '2581');
    await page.click('#bPwSet'); await page.waitForTimeout(200);
    R.check('两次输入不一样不收',
            /不一样/.test(await page.textContent('#pwNote')) &&
            await page.evaluate(() => !localStorage.getItem('lucky-draw.lock')));

    await page.fill('#pwNew', '2580'); await page.fill('#pwNew2', '2580');
    await page.click('#bPwSet'); await page.waitForTimeout(300);
    const rec = await page.evaluate(() => localStorage.getItem('lucky-draw.lock') || '');
    R.check('设好了;本机存的是加盐的指纹,不是密码原文',
            /"hash":"[0-9a-f]{64}"/.test(rec) && /"salt":"[0-9a-f]{32}"/.test(rec) && rec.indexOf('2580') < 0,
            rec.slice(0, 80));
    R.check('刚设完还是解锁状态,不用马上再输一遍',
            /解锁状态/.test(await page.textContent('#lockState')));

    // ---------- 立即上锁 ----------
    await page.click('#bLockNow'); await page.waitForTimeout(250);
    R.check('点「立即上锁」后设置面板关掉', !(await on(page, '#vSetup')));

    await menu(page, '#bNames'); await page.waitForTimeout(250);
    R.check('上锁后点「名单」先弹输密码框,名单没打开',
            await on(page, '#vLock') && !(await on(page, '#vNames')));

    await page.fill('#lockPw', '0000'); await page.click('#lockOk'); await page.waitForTimeout(300);
    R.check('密码输错:提示不对,名单还是不打开',
            /密码不对/.test(await page.textContent('#lockErr')) &&
            await on(page, '#vLock') && !(await on(page, '#vNames')));

    await page.fill('#lockPw', '2580'); await page.press('#lockPw', 'Enter'); await page.waitForTimeout(300);
    R.check('输对(按回车也行)后直接进到名单',
            !(await on(page, '#vLock')) && await on(page, '#vNames'));
    await closeAll(page);

    await menu(page, '#bTiers'); await page.waitForTimeout(200);
    R.check('解锁后再点别的(奖项设置)不用再输',
            await on(page, '#vTiers') && !(await on(page, '#vLock')));
    await closeAll(page);

    // ---------- 关掉重开:又锁上 ----------
    await page.evaluate(() => {
      S.pool = ['A', 'B', 'C', 'D', 'E', 'F'].map(n => ({ name: n, sub: '' }));
      S.tiers = [{ id: 't1', th: 'รางวัลที่ 1', zh: '一等奖', quota: 4, per: 2 }];
      S.winners = []; S.history = [];
      syncActive(); renderRail(); resetStage(); updateControls(); autosave();
    });
    await page.waitForTimeout(600);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1200);

    await page.click('#bPour'); await page.waitForTimeout(900);
    await page.click('#bPour'); await page.waitForTimeout(4500);
    R.check('开始抽奖不用密码', await page.evaluate(() => S.winners.length) === 2 && !(await on(page, '#vLock')));

    await menu(page, '#bWinners'); await page.waitForTimeout(200);
    R.check('看「中奖」名单不用密码', await on(page, '#vWinners') && !(await on(page, '#vLock')));
    await closeAll(page);

    await page.click('#bReset'); await page.waitForTimeout(250);
    R.check('关掉重开后又锁上了:点「重置」先要密码', await on(page, '#vLock'));
    await page.click('#vLock [data-close]'); await page.waitForTimeout(200);
    R.check('取消输密码 → 什么都没重置', await page.evaluate(() => S.winners.length) === 2);

    await page.click('#bUndo'); await page.waitForTimeout(250);
    R.check('「撤销上一轮」也要密码', await on(page, '#vLock') &&
            await page.evaluate(() => S.winners.length) === 2);
    await closeAll(page);

    await menu(page, '#bSetup'); await page.waitForTimeout(250);
    R.check('「设置」也要密码(不然谁都能进去把密码取消掉)',
            await on(page, '#vLock') && !(await on(page, '#vSetup')));
    await closeAll(page);

    /* 换 Logo:选图框只有手指直接点才弹得出来,所以先解锁、再点一次 */
    const picked = await page.evaluate(() => new Promise(res => {
      let hit = false;
      const f = document.querySelector('#logoFile');
      const orig = f.click; f.click = () => { hit = true; };
      document.querySelector('#logoImg').click();
      setTimeout(() => { f.click = orig; res({ hit, lock: document.querySelector('#vLock').classList.contains('on') }); }, 150);
    }));
    R.check('上锁时点 Logo 不会弹选图框,先要密码', !picked.hit && picked.lock, JSON.stringify(picked));
    await page.fill('#lockPw', '2580'); await page.click('#lockOk'); await page.waitForTimeout(300);
    R.check('解锁后提示「再点一次 Logo」', /再点一次 Logo/.test(await page.textContent('#toast')));

    // ---------- 撤销在解锁后照常 ----------
    await page.click('#bUndo'); await page.waitForTimeout(500);
    R.check('解锁后「撤销上一轮」照常生效', await page.evaluate(() => S.winners.length) === 0);

    // ---------- 取消密码 ----------
    await menu(page, '#bSetup'); await page.waitForTimeout(200);
    await page.click('#bPwOff'); await page.waitForTimeout(250);
    R.check('取消密码后本机不再存密码',
            await page.evaluate(() => !localStorage.getItem('lucky-draw.lock')) &&
            /没有设密码/.test(await page.textContent('#lockState')));
    await closeAll(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(900);
    await menu(page, '#bNames'); await page.waitForTimeout(200);
    R.check('取消后重开,点「名单」又直接打开', await on(page, '#vNames') && !(await on(page, '#vLock')));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
