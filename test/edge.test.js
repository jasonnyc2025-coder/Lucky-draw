/* 边角情况。都是现场真可能遇到的:名额填多了、只剩一个人、紧张起来猛点按钮、
   Excel 里同一个人出现两次。 */
'use strict';

const { reporter, chromium } = require('./lib/harness');

module.exports = async function run({ url }) {
  const R = reporter('边角情况 edge');
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const errs = [];

  const fresh = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
    p.on('dialog', d => d.accept());
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForTimeout(600);
    await p.evaluate(() => DB.del().catch(() => {}));
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForTimeout(800);
    return p;
  };
  const paste = async (p, lines) => {
    await p.click('#bNames'); await p.waitForTimeout(220);
    await p.fill('#paste', lines.join('\n'));
    await p.click('#bApplyPaste'); await p.waitForTimeout(400);
  };
  const tiers = (p, list) => p.evaluate(t => {
    S.tiers = t.map((x, i) => ({ id: 't' + i, th: 'T' + i, zh: x.zh, quota: x.quota, per: x.per }));
    S.winners = []; S.history = [];
    syncActive(); renderRail(); resetStage(); updateControls(); autosave();
  }, list);
  const round = async (p, ms = 4500) => {
    await p.click('#bPour'); await p.waitForTimeout(1100);
    await p.click('#bPour'); await p.waitForTimeout(ms);
  };

  try {
    // ---------- 名额比人多 ----------
    let p = await fresh();
    await paste(p, ['甲, A1', '乙, A2', '丙, A3']);
    await tiers(p, [{ zh: '三等奖', quota: 6, per: 5 }]);
    await round(p);
    let st = await p.evaluate(() => ({
      pool: S.pool.length, win: S.winners.length,
      btn: document.querySelector('#bPour').disabled,
      eyebrow: document.querySelector('#eyebrow').textContent.replace(/\s+/g, ' ').trim(),
    }));
    R.check('名额(6)比人(3)多:3 人全中,池子空', st.pool === 0 && st.win === 3, JSON.stringify(st));
    R.check('人抽光但名额没满时按钮禁用,不会卡住', st.btn === true);
    R.check('人抽光但名额没满时界面不是空白', st.eyebrow.length > 0, st.eyebrow.slice(0, 60));
    await p.close();

    // ---------- 只有一个人 ----------
    p = await fresh();
    await paste(p, ['独苗, ONLY']);
    await tiers(p, [{ zh: '一等奖', quota: 1, per: 1 }]);
    await round(p, 5200);
    st = await p.evaluate(() => ({ win: S.winners.length, done: allDone(),
                                   board: !!document.querySelector('.board') }));
    R.check('只有 1 个人也能抽完并出总榜', st.win === 1 && st.done && st.board, JSON.stringify(st));
    await p.close();

    // ---------- 猛点按钮 / 连按空格 ----------
    p = await fresh();
    await paste(p, Array.from({ length: 30 }, (_, i) => `人${i + 1}, P${i + 1}`));
    await tiers(p, [{ zh: '三等奖', quota: 4, per: 2 }]);
    await p.click('#bPour'); await p.click('#bPour'); await p.click('#bPour');
    await p.waitForTimeout(5000);
    st = await p.evaluate(() => ({ win: S.winners.length, pool: S.pool.length }));
    R.check('连点三下开始/停止,2 个名额就开 2 人',
            st.win === 2 && st.pool === 28, JSON.stringify(st));
    for (let i = 0; i < 6; i++) { await p.keyboard.press('Space'); await p.waitForTimeout(120); }
    await p.waitForTimeout(5200);
    st = await p.evaluate(() => ({
      win: S.winners.length,
      dup: new Set(S.winners.map(w => w.name)).size !== S.winners.length,
    }));
    R.check('空格连按不会抽出重复的人', !st.dup);
    R.check('空格连按后中奖数不超过名额', st.win <= 4, 'win=' + st.win);
    await p.close();

    // ---------- 导入去重 ----------
    p = await fresh();
    await paste(p, ['同名, E1', '同名, E1', '同名, E2', '李四, E9']);
    st = await p.evaluate(() => ({
      n: S.pool.length, keys: S.pool.map(x => x.name + '/' + x.sub),
      note: document.querySelector('#poolNote').textContent,
    }));
    R.check('姓名和工号都一样的重复行会被去掉(4 行 → 3 人)',
            st.n === 3 && st.keys.filter(x => x === '同名/E1').length === 1, JSON.stringify(st.keys));
    R.check('同名不同工号是两个人,都留着', st.keys.indexOf('同名/E2') >= 0);
    R.check('界面上说明去掉了几条重复', /去掉 1 条重复/.test(st.note), st.note);
    await p.close();

    p = await fresh();
    await paste(p, ['王伟', '王伟', '陈静', '刘洋']);
    st = await p.evaluate(() => ({ n: S.pool.length,
                                   note: document.querySelector('#poolNote').textContent }));
    R.check('重名但没填工号时两个都保留(可能真是两个人)', st.n === 4, 'n=' + st.n);
    R.check('重名没工号会提醒去核对,而不是悄悄删掉', /重名/.test(st.note), st.note);
    await p.close();

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
