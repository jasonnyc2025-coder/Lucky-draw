/* 名单面板:能不能看到当前名单、改名、删人。
   名单面板原来只是个导入界面,不显示已经导进去的人 —— 看着像空的。 */
'use strict';

const { reporter, chromium, menu, openImport } = require('./lib/harness');

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
  const openNames = async () => { await menu(page, '#bNames'); await page.waitForTimeout(250); };
  const closeNames = async () => { await page.click('#vNames [data-close]'); await page.waitForTimeout(200); };

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    // ---------- 1. 还没导入 ----------
    await openNames();
    R.check('还没导入时说明清楚', /还没有导入名单/.test((await state()).summary), (await state()).summary);

    await openImport(page); await page.fill('#paste', ['李伟, EMP001', '王芳, EMP002', 'Vincent, EMP003',
                               '张敏, EMP004', 'Spring, EMP005', 'John, EMP006'].join('\n'));
    await openImport(page); await page.click('#bApplyPaste');
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

    // ---------- 5.5 添加一人 ----------
    await openNames();
    promptReply = '临时来的, EMP999';
    await page.click('#bAddPerson');
    await page.waitForTimeout(300);
    st = await state();
    R.check('添加一人进池子并出现在列表里',
            st.pool.length === 6 && st.pool.includes('临时来的/EMP999') && st.rows === 6,
            st.pool.join(', '));

    promptReply = '   ';                      // 空名字
    await page.click('#bAddPerson');
    await page.waitForTimeout(300);
    R.check('空名字加不进去',
            (await state()).pool.length === 6,
            await page.evaluate(() => document.querySelector('#toast').textContent));

    promptReply = null;                       // 点取消
    await page.click('#bAddPerson');
    await page.waitForTimeout(300);
    R.check('添加点取消什么都不加', (await state()).pool.length === 6);

    // 同名同工号要先问一句;这里的 dialog 处理器一律 accept,所以会加进去
    promptReply = '临时来的, EMP999';
    await page.click('#bAddPerson');
    await page.waitForTimeout(300);
    R.check('同名同工号会先确认,确认后才加',
            (await state()).pool.filter(x => x === '临时来的/EMP999').length === 2,
            (await state()).pool.join(', '));

    // 加进去的人要能被抽到,先删掉这两个免得影响后面的计数
    await page.evaluate(() => {
      S.pool = S.pool.filter(x => x.sub !== 'EMP999');
      autosave(); renderPoolList(); renderRail(); updateControls();
    });
    await page.waitForTimeout(200);
    R.check('清理后回到 5 人', (await state()).pool.length === 5);
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
    await menu(page, '#bUndo');
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

    // ---------- 8.5 搜索 ----------
    const p9 = await ctx.newPage();
    p9.on('pageerror', e => errs.push(e.message));
    let reply9 = null;
    p9.on('dialog', d => {
      if (d.type() === 'prompt' && reply9 !== null) d.accept(reply9); else d.accept();
    });
    await p9.goto(url, { waitUntil: 'load' });
    await p9.waitForTimeout(1400);

    /* 塞一份比「只画前 300 条」更长的名单,验证搜索是在全部人里找 */
    await p9.evaluate(() => {
      S.pool = []; S.winners = []; S.history = [];
      for (let i = 0; i < 320; i++) S.pool.push({ name: '路人' + i, sub: 'Z' + i });
      S.pool.push({ name: 'สมชาย ใจดี', sub: '01049' });
      S.pool.push({ name: '末尾的人', sub: 'LAST9' });
      syncActive(); renderPoolList(); renderRail(); updateControls(); autosave();
    });
    await menu(p9, '#bNames'); await p9.waitForTimeout(300);

    const probe = async (q) => {
      await p9.fill('#poolSearch', q);
      await p9.waitForTimeout(250);
      return p9.evaluate(() => ({
        rows: document.querySelectorAll('#plist .prow').length,
        sum: document.querySelector('#poolSummary').textContent.trim(),
        empty: document.querySelector('#poolEmpty').style.display !== 'none',
        marks: [...document.querySelectorAll('#plist mark')].map(m => m.textContent),
      }));
    };

    let r9 = await probe('');
    R.check('不搜索时最多画 300 条(名单很大也不卡)',
            r9.rows === 300 && /共\s*322\s*人/.test(r9.sum), r9.sum);

    r9 = await probe('01049');
    R.check('按工号能搜到', r9.rows === 1 && /找到 1 人/.test(r9.sum), r9.sum);
    R.check('命中的那几个字会标出来', r9.marks.indexOf('01049') >= 0, JSON.stringify(r9.marks));

    r9 = await probe('สมชาย');
    R.check('按姓名能搜到(泰文)', r9.rows === 1, r9.sum);

    r9 = await probe('LAST9');
    R.check('排在 300 条之后的人也搜得到(搜索不受列表上限限制)',
            r9.rows === 1 && /找到 1 人/.test(r9.sum), r9.sum);

    r9 = await probe('zzzzzz');
    R.check('搜不到时说清楚,而不是一片空白',
            r9.rows === 0 && r9.empty, r9.sum);

    /* 关键回归:搜索把列表过滤掉了,改名/删除必须作用在搜到的那个人身上。
       原来的 idx 是靠「它排在列表第几位」倒推的,一过滤就会改到别人头上。 */
    await probe('LAST9');
    reply9 = '改对了, LAST9';
    await p9.click('#plist .prow:nth-child(1) .pbtn:not(.del)');
    await p9.waitForTimeout(350);
    const edited = await p9.evaluate(() => ({
      target: (S.pool.filter(x => x.sub === 'LAST9')[0] || {}).name,
      first: S.pool[0].name,
    }));
    R.check('搜索状态下改名,改的是搜到的那个人,不是列表第一个',
            edited.target === '改对了' && edited.first === '路人0', JSON.stringify(edited));

    await p9.click('#bClearSearch'); await p9.waitForTimeout(250);
    R.check('点 × 清空搜索,列表回到全部',
            await p9.evaluate(() => document.querySelector('#plist .prow').textContent.indexOf('路人0') >= 0 &&
                                    document.querySelector('#poolSearch').value === ''));
    await p9.close();

    // ---------- 9. 一键清空名单 ----------
    const p3 = await ctx.newPage();
    p3.on('pageerror', e => errs.push(e.message));
    let dlg3 = [], accept3 = true;
    p3.on('dialog', d => { dlg3.push(d.message()); accept3 ? d.accept() : d.dismiss(); });
    await p3.goto(url, { waitUntil: 'load' });
    await p3.waitForTimeout(1400);
    const before9 = await p3.evaluate(() => ({ pool: S.pool.length, winners: S.winners.length,
                                               tiers: S.tiers.length }));
    R.check('清空前有数据可清', before9.pool + before9.winners > 0, JSON.stringify(before9));

    await menu(p3, '#bNames'); await p3.waitForTimeout(250);

    // 先点取消
    accept3 = false; dlg3 = [];
    await p3.click('#bClearPool'); await p3.waitForTimeout(300);
    const cancelled9 = await p3.evaluate(() => S.pool.length + S.winners.length);
    R.check('清空会弹确认框,只有一句话(用户要求去掉中间那段说明)',
            dlg3.length === 1 && /清空整份名单/.test(dlg3[0]) && dlg3[0].split('\n').length === 1,
            (dlg3[0] || '').replace(/\n+/g, ' | '));
    R.check('点取消一个人都不少',
            cancelled9 === before9.pool + before9.winners, 'still ' + cancelled9);

    // 再确认
    accept3 = true;
    await p3.click('#bClearPool'); await p3.waitForTimeout(400);
    const after9 = await p3.evaluate(() => ({
      pool: S.pool.length, winners: S.winners.length, history: S.history.length,
      tiers: S.tiers.length, rows: document.querySelectorAll('#plist .prow').length,
      summary: document.querySelector('#poolSummary').textContent.trim(),
      eyebrow: document.querySelector('#eyebrow').textContent,
    }));
    R.check('确认后人和中奖结果全清',
            after9.pool === 0 && after9.winners === 0 && after9.history === 0 && after9.rows === 0,
            JSON.stringify(after9));
    R.check('奖项设置保留下来', after9.tiers === before9.tiers,
            before9.tiers + ' → ' + after9.tiers);
    R.check('界面回到「请先导入名单」',
            /还没有导入名单/.test(after9.summary) && /请先导入名单/.test(after9.eyebrow),
            after9.summary);

    // 清空要写进本机存档
    await p3.close();
    const p4 = await ctx.newPage();
    p4.on('pageerror', e => errs.push(e.message));
    await p4.goto(url, { waitUntil: 'load' });
    await p4.waitForTimeout(1400);
    R.check('清空后重开页面,名单确实是空的',
            await p4.evaluate(() => S.pool.length === 0 && S.winners.length === 0));

    // ---------- 面板不乱:没名单只显示导入;有名单时导入折起来,说明默认收起 ----------
    {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const pg = await c.newPage();
      pg.on('pageerror', e => errs.push(e.message));
      pg.on('dialog', d => d.accept());
      await pg.goto(url, { waitUntil: 'load' });
      await pg.waitForTimeout(900);
      await pg.evaluate(() => { S.pool = []; S.winners = []; S.history = []; syncActive(); renderRail(); resetStage(); });
      const look = () => pg.evaluate(() => {
        const vis = s => { const e = document.querySelector(s); return !!(e && (e.checkVisibility ? e.checkVisibility() : e.offsetParent)); };
        const imp = document.querySelector('#secImport');
        return { pool: vis('#secPool'), importOpen: imp.open, pasteVis: vis('#paste'),
                 importTop: Math.round(imp.getBoundingClientRect().top),
                 helpOpen: document.querySelector('.howto').open,
                 actH: [...document.querySelectorAll('#secPool .act')].map(b => Math.round(b.getBoundingClientRect().height)) };
      });
      await pg.click('#bNames'); await pg.waitForTimeout(250);
      const e0 = await look();
      R.check('还没有名单:只显示「导入名单」,而且直接展开', !e0.pool && e0.importOpen && e0.pasteVis, JSON.stringify(e0));
      await pg.fill('#paste', 'สมชาย,01001\nมาลี,01002\nอุดม,01003');
      await pg.click('#bApplyPaste'); await pg.waitForTimeout(400);
      await pg.click('#bNames'); await pg.waitForTimeout(250);
      const e1 = await look();
      R.check('导入后:当前名单在上面,「导入名单」折起来', e1.pool && !e1.importOpen && !e1.pasteVis, JSON.stringify(e1));
      R.check('按钮说明默认收起,不占地方', !e1.helpOpen);
      R.check('手机上「添加一人」「清空名单」两个按钮一样高(文字没有折成两行)',
              e1.actH.length === 2 && Math.abs(e1.actH[0] - e1.actH[1]) <= 2, JSON.stringify(e1.actH));
      await pg.click('#secImport > summary'); await pg.waitForTimeout(200);
      R.check('点「导入名单」能展开,换一份名单', (await look()).pasteVis);
      await pg.click('#bClearPool'); await pg.waitForTimeout(400);
      const e2 = await look();
      R.check('清空名单后又回到「只显示导入」', !e2.pool && e2.importOpen, JSON.stringify(e2));
      await c.close();
    }

    // ---------- 自己画的确认 / 输入框:按钮是泰文 + 中文(手机自带的只会写「取消」「好」) ----------
    {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, appDialogs: true });
      const pg = await c.newPage();
      pg.on('pageerror', e => errs.push(e.message));
      let native = 0;
      pg.on('dialog', d => { native++; d.dismiss(); });
      await pg.goto(url, { waitUntil: 'load' });
      await pg.waitForTimeout(900);
      await pg.evaluate(() => {
        S.pool = ['สมชาย', 'มาลี', 'อุดม'].map(n => ({ name: n, sub: '' }));
        S.winners = []; S.history = []; syncActive(); renderRail(); resetStage();
      });
      await pg.click('#bNames'); await pg.waitForTimeout(250);

      const hint = await pg.textContent('#secImport .sub:nth-of-type(2) .sub-h em').catch(() => '');
      R.check('「直接粘贴」下面那行有泰文', /บรรทัดละ/.test(hint) && /一行一人/.test(hint), hint);

      await pg.click('#bClearPool'); await pg.waitForTimeout(250);
      const box = await pg.evaluate(() => ({
        on: document.querySelector('#vAsk').classList.contains('on'),
        msg: document.querySelector('#askMsg').textContent,
        no: document.querySelector('#askNo').textContent, yes: document.querySelector('#askYes').textContent,
      }));
      R.check('清空名单弹的是 App 自己的框,按钮写「ยกเลิก 取消」「ตกลง 确定」',
              box.on && box.no === 'ยกเลิก 取消' && box.yes === 'ตกลง 确定' && native === 0, JSON.stringify(box));
      R.check('框里只有一句「清空整份名单?」,中间那段说明没有了',
              /清空整份名单/.test(box.msg) && box.msg.split('\n').length === 1, box.msg);
      await pg.click('#askNo'); await pg.waitForTimeout(200);
      R.check('点「ยกเลิก 取消」:框关掉,名单一个不少,名单面板还开着',
              await pg.evaluate(() => S.pool.length === 3 && !document.querySelector('#vAsk').classList.contains('on') &&
                                      document.querySelector('#vNames').classList.contains('on')));

      await pg.click('#bAddPerson'); await pg.waitForTimeout(250);
      const form = await pg.evaluate(() => ({
        title: document.querySelector('#askMsg').textContent,
        labels: [...document.querySelectorAll('#askForm .ask-fld > span')].map(s => s.textContent.trim()),
      }));
      R.check('「添加一人」:标题一句话,姓名、工号分成两个有标签的框(不用记逗号格式)',
              form.title === 'เพิ่มคน · 添加一人' && form.labels.length === 2 &&
              /姓名/.test(form.labels[0]) && /工号/.test(form.labels[1]), JSON.stringify(form));
      await pg.click('#askYes'); await pg.waitForTimeout(200);
      R.check('姓名没填就点确定:框不关,提示「请填写姓名」',
              await pg.evaluate(() => document.querySelector('#vAsk').classList.contains('on') &&
                                      /请填写姓名/.test(document.querySelector('#askErr').textContent)));
      await pg.fill('#askName', 'สมใจ');
      await pg.press('#askName', 'Enter');                       // 回车跳到工号框
      await pg.keyboard.type('09999');
      await pg.keyboard.press('Enter'); await pg.waitForTimeout(250);
      R.check('填姓名 → 回车 → 填工号 → 回车,就加进去了',
              await pg.evaluate(() => S.pool.some(p => p.name === 'สมใจ' && p.sub === '09999')) && native === 0);

      await pg.click('#bAddPerson'); await pg.waitForTimeout(250);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      R.check('按 Esc 只关掉这个框,后面的名单面板不受影响',
              await pg.evaluate(() => !document.querySelector('#vAsk').classList.contains('on') &&
                                      document.querySelector('#vNames').classList.contains('on') && S.pool.length === 4));

      await pg.click('#bClearPool'); await pg.waitForTimeout(250);
      await pg.click('#askYes'); await pg.waitForTimeout(300);
      R.check('点「ตกลง 确定」才真的清空', await pg.evaluate(() => S.pool.length + S.winners.length) === 0);
      await c.close();
    }

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
