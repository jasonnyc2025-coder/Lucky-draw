/* 自动更新。真的在临时目录里改 sw.js 造出一个「新版本」,
   然后看页面会不会自己换过去 —— 不是查代码里有没有写,是真跑一遍。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { reporter, chromium } = require('./lib/harness');

module.exports = async function run({ url, fixtures }) {
  const R = reporter('自动更新 update');
  const swPath = path.join(fixtures, 'sw.js');
  const htmlPath = path.join(fixtures, 'index.html');
  const original = fs.readFileSync(swPath, 'utf8');
  const originalHtml = fs.readFileSync(htmlPath, 'utf8');
  const curVer = (original.match(/VERSION = '([^']+)'/) || [])[1];

  /* 两个版本号本来就必须一起加一(assets 套件在盯这条),
     所以这里也一起改,不然「设置 → 版本」会显示不一致,测出来的是假问题。 */
  const bump = (v) => {
    fs.writeFileSync(swPath,
      original.replace(/const VERSION = '[^']+'/, "const VERSION = '" + v + "'"));
    fs.writeFileSync(htmlPath,
      originalHtml.replace(/var APP_VERSION = '[^']+'/, "var APP_VERSION = '" + v + "'"));
  };

  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const errs = [];

  /* 等到 SW 真正接管这个页面 */
  const controlled = (p) => p.waitForFunction(
    () => !!navigator.serviceWorker.controller, null, { timeout: 20000 });

  /* 自动更新过程中页面会重新加载,这期间 evaluate 会抛「XXX is not defined」。
     读状态一律走这个,拿不到就返回兜底值,不要让它把整个跑崩掉。 */
  const peek = async (p, fn, dflt) => {
    for (let i = 0; i < 3; i++) {
      try { return await p.evaluate(fn); }
      catch (e) { await p.waitForTimeout(500); }
    }
    return dflt;
  };
  /* 等某个条件成立;一律用 window.xxx,避免页面刷新那一刻报 ReferenceError */
  const until = async (p, fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await p.evaluate(fn)) return true; } catch (e) {}
      await p.waitForTimeout(300);
    }
    return false;
  };

  try {
    // ================= 1. 打开后自动更新 =================
    let page = await ctx.newPage();
    page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
    page.on('dialog', d => d.accept());

    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => { window.__firstLoadMark = 1; });  // 页面要是刷新了,这个标记就没了
    await controlled(page);
    await page.waitForTimeout(1200);
    await until(page, () => window.swVersion !== null, 15000);
    const first = await peek(page, () => window.swVersion, null);
    R.check('第一次打开,Service Worker 接管并报出版本号',
            first === curVer, first + ' (期望 ' + curVer + ')');
    /* 回归:第一次装 SW 时 clients.claim() 会让 controller 当场非空,
       曾经被误判成「有新版本」,页面白白自己刷一次。 */
    R.check('第一次打开不会无缘无故自己刷新一下',
            await peek(page, () => !!window.__firstLoadMark, false));

    // 造一个新版本
    bump('v-next');
    await page.reload({ waitUntil: 'load' });
    await controlled(page);

    // 自动更新会再刷新一次,等它跑完
    const got = await until(page, () => window.swVersion === 'v-next', 30000);
    R.check('打开后自动更新到新版本,全程不用点任何按钮', got,
            got ? 'v-next' : '停在 ' + await peek(page, () => window.swVersion, '?'));

    await page.waitForTimeout(1400);
    const toastTxt = await peek(page, () => document.querySelector('#toast').textContent, '');
    R.check('更新完有提示,用户知道刚才屏幕闪了一下是在干嘛',
            /已更新到/.test(toastTxt), toastTxt);
    R.check('更新完「有新版本」按钮收起来了',
            await peek(page, () => document.querySelector('#bUpdate').style.display === 'none', false),
            await peek(page, () => document.querySelector('#bUpdate').style.display, '?'));

    const ver = await peek(page, () => document.querySelector('#verNote').textContent, '');
    R.check('设置里的版本行显示缓存已是最新', /已是最新/.test(ver), ver.trim());
    await page.close();

    // ================= 2. 活动当中不许自己刷新 =================
    /* 注意:开新页面之前不能先 bump —— 那样页面一打开就会走自动更新把自己刷掉,
       和这一节要验的东西撞上。让它先和磁盘上的版本保持一致地稳定下来。 */
    page = await ctx.newPage();
    page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
    page.on('dialog', d => d.accept());
    await page.goto(url, { waitUntil: 'load' });
    await controlled(page);
    await page.waitForTimeout(1800);

    // 打开名单面板 = 可能正在粘名单,这时候绝不能刷新
    await page.click('#bNames'); await page.waitForTimeout(300);
    await page.fill('#paste', '正在输入的名单, X1');
    await page.evaluate(() => { window.__alive = Date.now(); });

    bump('v-next-2');
    await page.evaluate(() => navigator.serviceWorker.getRegistration()
      .then(r => r && r.update()).catch(() => {}));
    await page.waitForTimeout(6000);

    const held = await peek(page, () => ({
      alive: !!window.__alive,                       // 页面没被刷掉
      paste: document.querySelector('#paste').value, // 输入的内容还在
      btn: document.querySelector('#bUpdate').style.display !== 'none',
      ver: window.swVersion,
    }), {});
    R.check('面板开着、粘贴框有内容时,绝不自动刷新(不然输入的名单会没)',
            held.alive && held.paste === '正在输入的名单, X1', JSON.stringify(held));
    R.check('这时候只把「有新版本」按钮亮出来,等用户自己点',
            held.btn, 'btn=' + held.btn);

    // 关掉面板、清空输入,点那个按钮应该真的能更新(原来这里有 bug:按钮亮着但点了没反应)
    if (await page.isVisible('#paste')) await page.fill('#paste', '');
    if (await page.isVisible('#vNames [data-close]')){
      await page.click('#vNames [data-close]'); await page.waitForTimeout(300);
    }
    await page.click('#bSetup'); await page.waitForTimeout(250);
    await page.click('#bUpdate');
    const manual = await until(page, () => window.swVersion === 'v-next-2', 30000);
    R.check('手动点「有新版本」确实能更新(回归:以前按钮亮着点了没反应)', manual,
            manual ? 'v-next-2' : '停在 ' + await peek(page, () => window.swVersion, '?'));
    await page.close();

    // ================= 3. 抽奖滚动中更不能刷新 =================
    page = await ctx.newPage();
    page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
    page.on('dialog', d => d.accept());
    await page.goto(url, { waitUntil: 'load' });
    await controlled(page);
    await page.waitForTimeout(1800);

    await page.click('#bNames'); await page.waitForTimeout(250);
    await page.fill('#paste', Array.from({ length: 20 }, (_, i) => `人${i + 1}, P${i + 1}`).join('\n'));
    await page.click('#bApplyPaste'); await page.waitForTimeout(400);
    await page.click('#bPour'); await page.waitForTimeout(600);
    await page.evaluate(() => { window.__alive2 = 1; });

    bump('v-next-3');
    await page.evaluate(() => navigator.serviceWorker.getRegistration()
      .then(r => r && r.update()).catch(() => {}));
    await page.waitForTimeout(6000);
    const rolling = await peek(page, () => ({ alive: !!window.__alive2, rolling: S.rolling }), {});
    R.check('抽奖滚动过程中绝不自动刷新',
            rolling.alive && rolling.rolling, JSON.stringify(rolling));
    await page.click('#bPour'); await page.waitForTimeout(4000);
    await page.close();

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    fs.writeFileSync(swPath, original);          // 把临时副本恢复原样
    fs.writeFileSync(htmlPath, originalHtml);
    await browser.close();
  }
  return R;
};
