/* 名单面板:能不能看到当前名单、改名、删人。
   名单面板原来只是个导入界面,不显示已经导进去的人 —— 看着像空的。 */
'use strict';

const { reporter, chromium } = require('./lib/harness');

module.exports = async function run({ url }) {
  const R = reporter('名单增删改 roster');
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push((e.stack || e.message).split('\n').slice(0, 3).join(' ← ')));

  // prompt 的回答由 promptReply 控制;null = 点取消
  let promptReply = null;
  page.on('dialog', d => {
    if (d.type() === 'prompt') { if (promptReply === null) d.dismiss(); else d.accept(promptReply); }
    else d.accept();
  });

  const state = () => page.evaluate(() => ({
    pool: S.pool.map(x => x.name + '/' + x.sub),
    winners: S.winners.map(x => x.name + '/' + x.sub),
    rows: document.querySelectorAll('#plist .prow').length,
    summary: document.querySelector('#poolSummary').textContent.trim(),
  }));
  const openNames = async () => { await page.click('#bNames'); await page.waitForTimeout(250); };
  const closeNames = async () => { await page.click('#vNames [data-close]'); await page.waitForTimeout(200); };

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    // ---------- 1. 还没导入 ----------
    await openNames();
    R.check('还没导入时说明清楚', /还没有导入名单/.test((await state()).summary), (await state()).summary);

    await page.fill('#paste', ['李伟, EMP001', '王芳, EMP002', 'Vincent, EMP003',
                               '张敏, EMP004', 'Spring, EMP005', 'John, EMP006'].join('\n'));
    await page.click('#bApplyPaste');
    await page.waitForTimeout(400);

    // ---------- 2. 导入后能看到名单 ----------
    await openNames();
    let st = await state();
    R.check('导入后名单面板列出全部 6 人', st.rows === 6, 'rows=' + st.rows);
    R.check('人数统计正确', /共\s*6\s*人/.test(st.summary) && /6 待抽/.test(st.summary), st.summary);

    // ---------- 3. 改名 ----------
    promptReply = '李伟明, EMP001X';
    await page.click('#plist .prow:nth-child(1) .pbtn:not(.del)');
    await page.waitForTimeout(300);
    st = await state();
    R.check('改名生效(姓名和工号都改)', st.pool[0] === '李伟明/EMP001X', st.pool[0]);

    // ---------- 4. 改名点取消 ----------
    promptReply = null;
    await page.click('#plist .prow:nth-child(2) .pbtn:not(.del)');
    await page.waitForTimeout(300);
    R.check('改名点取消什么都不变', (await state()).pool[1] === '王芳/EMP002', (await state()).pool[1]);

    // ---------- 5. 删除 ----------
    await page.click('#plist .prow:nth-child(2) .pbtn.del');
    await page.waitForTimeout(300);
    st = await state();
    R.check('删除后少一人且不在池子里',
            st.pool.length === 5 && !st.pool.some(x => x.startsWith('王芳')), st.pool.join(', '));
    R.check('删除后列表和统计同步', st.rows === 5 && /共\s*5\s*人/.test(st.summary), st.summary);
    await closeNames();

    // ---------- 6. 中奖者:能改名,不能删 ----------
    await page.click('#bPour');
    await page.waitForTimeout(1300);
    await page.click('#bPour');
    await page.waitForTimeout(4200);

    await openNames();
    const wonBefore = await page.evaluate(() => S.winners[0].name);
    const wonRow = await page.evaluate(() => S.pool.length + 1);   // 中奖的排在待抽后面
    promptReply = '改过的名字, ZZZ';
    await page.click(`#plist .prow:nth-child(${wonRow}) .pbtn:not(.del)`);
    await page.waitForTimeout(300);
    R.check('已中奖的也能改名(现场打错字要能救)',
            await page.evaluate(() => S.winners[0].name) === '改过的名字',
            wonBefore + ' → ' + await page.evaluate(() => S.winners[0].name));

    await page.click(`#plist .prow:nth-child(${wonRow}) .pbtn.del`);
    await page.waitForTimeout(300);
    const toast = await page.evaluate(() => document.querySelector('#toast').textContent);
    R.check('已中奖的不能删,并说明该怎么做',
            /不能删/.test(toast) && /撤销|重置/.test(toast) &&
            await page.evaluate(() => S.winners.length) === 5, toast);
    await closeNames();

    // ---------- 7. 改过名的中奖者撤销后,回池子的是新名字 ----------
    await page.click('#bUndo');
    await page.waitForTimeout(400);
    R.check('撤销后回到池子里的是改过的名字,不是旧的',
            (await page.evaluate(() => S.pool.filter(x => x.sub === 'ZZZ').map(x => x.name)))[0] === '改过的名字',
            JSON.stringify(await page.evaluate(() => S.pool.filter(x => x.sub === 'ZZZ').map(x => x.name))));

    // ---------- 8. 改动要存进本机 ----------
    await page.close();
    const p2 = await ctx.newPage();
    p2.on('pageerror', e => errs.push(e.message));
    await p2.goto(url, { waitUntil: 'load' });
    await p2.waitForTimeout(1400);
    const reopened = await p2.evaluate(() => S.pool.map(x => x.name + '/' + x.sub));
    R.check('关掉页面重开,改名和删除都还在',
            reopened.includes('改过的名字/ZZZ') && !reopened.some(x => x.startsWith('王芳')),
            reopened.join(', '));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
