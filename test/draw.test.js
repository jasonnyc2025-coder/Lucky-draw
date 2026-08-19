/* 抽奖全流程:导入名单 → 设置奖项 → 依次开奖 → 看名单 → 导出 → 存档 → 撤销 → 重置 → 恢复 */
'use strict';

const fs = require('fs');
const path = require('path');
const { reporter, chromium } = require('./lib/harness');

module.exports = async function run({ url, fixtures, staffXlsx }) {
  const R = reporter('抽奖全流程 draw');
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  async function closeVeil(id) {
    // 有些操作会让应用自己关掉面板,这里要容错
    if (await page.evaluate(s => document.querySelector(s).classList.contains('on'), id)) {
      await page.click(id + ' [data-close]');
    }
    await page.waitForTimeout(200);
  }

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    // ---------- 1. 导入名单 ----------
    if (staffXlsx) {
      R.check('XLSX 组件加载', await page.evaluate(() => typeof XLSX !== 'undefined'));
      await page.click('#bNames');
      await page.setInputFiles('#file', staffXlsx);
      await page.waitForSelector('#mapWrap', { state: 'visible', timeout: 5000 });
      const opts = await page.evaluate(() =>
        [...document.querySelectorAll('#colName option')].map(o => o.value + '=' + o.textContent));
      R.check('Excel 解析出列选择器', opts.length >= 3, opts.join(' | '));
      await page.selectOption('#colName', '0');   // 姓名
      await page.selectOption('#colSub', '1');    // 工号
      await page.click('#bApplyFile');
    } else {
      // 没装 xlsx 时退回粘贴导入,后面的断言不变
      const lines = Array.from({ length: 60 }, (_, i) =>
        'Tester ' + (i + 1) + ', EMP' + String(i + 1).padStart(3, '0')).join('\n');
      await page.click('#bNames');
      await page.fill('#paste', lines);
      await page.click('#bApplyPaste');
    }
    await page.waitForTimeout(400);

    const imported = await page.evaluate(() => ({
      pool: S.pool.length,
      remain: +document.querySelector('#tRemain').textContent,
      total: +document.querySelector('#tTotal').textContent,
      panelOpen: document.querySelector('#vNames').classList.contains('on'),
      first: S.pool[0],
      emptyName: S.pool.some(p => !p.name),
      emptySub: S.pool.some(p => !p.sub),
      headerLeaked: S.pool.some(p => /^姓名/.test(p.name)),
    }));
    R.check('导入 60 人', imported.pool === 60, 'pool=' + imported.pool);
    R.check('顶栏计数同步', imported.remain === 60 && imported.total === 60,
            imported.remain + '/' + imported.total);
    R.check('导入后自动关闭面板', !imported.panelOpen);
    R.check('姓名无空值', !imported.emptyName);
    R.check('副信息(工号)读到了', !imported.emptySub, JSON.stringify(imported.first));
    R.check('首行标题未被当成人名', !imported.headerLeaked);

    // ---------- 2. 奖项设置 ----------
    await page.click('#bTiers');
    await page.waitForSelector('#vTiers.on');
    const tierCount = await page.evaluate(() => S.tiers.length);
    for (const [row, quota, per] of [[1, 10, 5], [2, 3, 3], [3, 1, 1]]) {
      const ins = await page.$$('#tierRows tr:nth-child(' + row + ') input');
      await ins[2].fill(String(quota));
      await ins[3].fill(String(per));
    }
    await page.click('#bSaveTiers');
    await page.waitForTimeout(300);
    const tiers = await page.evaluate(() => S.tiers.map(t => ({ zh: t.zh, quota: t.quota, per: t.per })));
    R.check('奖项设置保存', tierCount === 3 && tiers[0].quota === 10 && tiers[0].per === 5 &&
            tiers[1].quota === 3 && tiers[2].quota === 1, JSON.stringify(tiers));

    // ---------- 3. 顺序锁定 ----------
    const lock = await page.evaluate(() => {
      const before = S.activeTier;
      document.querySelectorAll('#rail .tier')[2].click();     // 一等奖,此时应锁住
      return { same: before === S.activeTier,
               locked: document.querySelectorAll('#rail .tier')[2].classList.contains('locked') };
    });
    R.check('未抽完时后面的奖项锁住', lock.locked && lock.same);

    // ---------- 4. 依次开奖 ----------
    async function drawRound(picks) {
      await page.click('#bPour');
      await page.waitForTimeout(1400);
      if (!await page.evaluate(() => S.rolling)) throw new Error('没有进入 rolling 状态');
      await page.click('#bPour');
      await page.waitForTimeout(900 + picks * 650 + 900);      // 等揭晓动画走完
    }
    const cum = [];
    for (const picks of [5, 5, 3, 1]) {
      await drawRound(picks);
      cum.push(await page.evaluate(() => S.winners.length));

      if (cum.length === 1) {
        // 回归:手机上地址栏收起/转屏会触发 resize,以前会把刚揭晓的名字冲成「?」
        const shown = () => page.evaluate(() =>
          [...document.querySelectorAll('#slots .nm')].map(n => n.textContent));
        const before = await shown();
        for (const [w, h] of [[900, 700], [1280, 860]]) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(350);
        }
        const after = await shown();
        R.check('改变窗口尺寸后已揭晓的名字还在(不会变成 ?)',
                JSON.stringify(before) === JSON.stringify(after) && !after.includes('?'),
                before.join(',') + ' → ' + after.join(','));
      }
    }

    const st = await page.evaluate(() => ({
      pool: S.pool.length,
      perTier: S.tiers.map(t => ({ zh: t.zh, got: S.winners.filter(w => w.tierId === t.id).length, quota: t.quota })),
      dup: (() => {
        const seen = new Set(), d = [];
        S.winners.forEach(w => { const k = w.name + '|' + w.sub; if (seen.has(k)) d.push(k); seen.add(k); });
        return d;
      })(),
      overlap: S.winners.filter(w => S.pool.some(p => p.name === w.name && p.sub === w.sub)).map(w => w.name),
      eyebrow: document.querySelector('#eyebrow').textContent,
      remain: +document.querySelector('#tRemain').textContent,
      total: +document.querySelector('#tTotal').textContent,
    }));
    R.check('四轮开奖累计人数', JSON.stringify(cum) === JSON.stringify([5, 10, 13, 14]), JSON.stringify(cum));
    R.check('每档抽满且不超额', st.perTier.every(t => t.got === t.quota), JSON.stringify(st.perTier));
    R.check('无重复中奖', st.dup.length === 0, st.dup.join(','));
    R.check('中奖者已移出待抽池', st.overlap.length === 0, st.overlap.join(','));
    R.check('剩余 = 60 - 14', st.pool === 46 && st.remain === 46 && st.total === 60,
            st.pool + ' / ' + st.remain + ' / ' + st.total);
    R.check('全部抽完提示', /全部抽奖完成/.test(st.eyebrow), st.eyebrow);

    // ---------- 5. 中奖名单面板 ----------
    await page.click('#bWinners');
    await page.waitForSelector('#vWinners.on');
    await page.waitForTimeout(300);
    const panel = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#wlist .wrow')];
      return {
        n: rows.length,
        blank: rows.filter(r => !r.querySelector('b') || !r.querySelector('b').textContent.trim()).length,
        groups: [...document.querySelectorAll('#wlist .wgrp-h')].length,
        subs: rows.filter(r => r.querySelector('span')).length,
      };
    });
    R.check('名单渲染 14 行', panel.n === 14, 'rows=' + panel.n);
    R.check('名字不为空(回归:el() 少传参数会整行空白)', panel.blank === 0, 'blank=' + panel.blank);
    R.check('三个奖项分组齐全', panel.groups === 3, 'groups=' + panel.groups);
    R.check('工号一并显示', panel.subs === 14, 'subs=' + panel.subs);

    // ---------- 6. 导出 CSV ----------
    const dl1 = (await Promise.all([page.waitForEvent('download'), page.click('#bExport')]))[0];
    const csvPath = path.join(fixtures, 'winners.csv');
    await dl1.saveAs(csvPath);
    const raw = fs.readFileSync(csvPath);
    const csv = raw.toString('utf8').replace(/^﻿/, '');
    const names = await page.evaluate(() => S.winners.map(w => w.name));
    R.check('CSV 行数 = 表头 + 14', csv.trim().split(/\r?\n/).length === 15,
            'lines=' + csv.trim().split(/\r?\n/).length);
    R.check('CSV 含全部中奖者', names.every(n => csv.includes(n)),
            names.filter(n => !csv.includes(n)).join(','));
    R.check('CSV 带 UTF-8 BOM(Excel 打开不乱码)', raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF);
    await closeVeil('#vWinners');

    // ---------- 7. 保存进度 ----------
    await page.click('#bSetup');
    await page.waitForSelector('#vSetup.on');
    const dl2 = (await Promise.all([page.waitForEvent('download'), page.click('#bSaveProg')]))[0];
    const jsonPath = path.join(fixtures, 'progress.json');
    await dl2.saveAs(jsonPath);
    const prog = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    R.check('进度 JSON 含名单/奖项/中奖',
            prog.pool.length === 46 && prog.winners.length === 14 && prog.tiers.length === 3,
            `pool=${prog.pool.length} winners=${prog.winners.length} tiers=${prog.tiers.length}`);
    await closeVeil('#vSetup');

    // ---------- 8. 撤销 ----------
    const undo = await page.evaluate(() => {
      const b = { w: S.winners.length, p: S.pool.length };
      document.querySelector('#bUndo').click();
      return { b, a: { w: S.winners.length, p: S.pool.length } };
    });
    R.check('撤销上一轮', undo.a.w === undo.b.w - 1 && undo.a.p === undo.b.p + 1, JSON.stringify(undo));

    // ---------- 9. 重置 ----------
    page.on('dialog', d => d.accept());
    await page.click('#bReset');
    await page.waitForTimeout(500);
    const reset = await page.evaluate(() => ({ w: S.winners.length, p: S.pool.length }));
    R.check('重置后中奖清空、人全部回池', reset.w === 0 && reset.p === 60, JSON.stringify(reset));

    // ---------- 10. 从文件恢复进度 ----------
    await page.click('#bSetup');
    await page.waitForSelector('#vSetup.on');
    await page.setInputFiles('#progFile', jsonPath);
    await page.waitForTimeout(700);
    const restored = await page.evaluate(() => ({ w: S.winners.length, p: S.pool.length, t: S.tiers.length }));
    R.check('恢复进度回到 14 中奖 / 46 待抽',
            restored.w === 14 && restored.p === 46 && restored.t === 3, JSON.stringify(restored));
    await closeVeil('#vSetup');

    // ---------- 11. 空格键 ----------
    await page.evaluate(() => {
      S.winners = []; S.history = [];
      syncActive(); renderRail(); resetStage();
      document.querySelectorAll('#rail .tier')[0].click();
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    const rolling = await page.evaluate(() => S.rolling);
    await page.keyboard.press('Space');
    await page.waitForTimeout(3500);
    const stopped = await page.evaluate(() => ({ rolling: S.rolling, w: S.winners.length }));
    R.check('空格键开始/停止', rolling === true && stopped.rolling === false && stopped.w === 5,
            JSON.stringify(stopped));

    // ---------- 12. 粘贴导入 ----------
    await page.click('#bNames');
    await page.waitForSelector('#vNames.on');
    await page.fill('#paste', 'สมชาย ทดสอบ, T001\n测试用户, T002\nTest User, T003');
    await page.click('#bApplyPaste');
    await page.waitForTimeout(400);
    const pasted = await page.evaluate(() => ({ p: S.pool.length, first: S.pool[0], w: S.winners.length }));
    R.check('粘贴导入 3 人并清空旧结果',
            pasted.p === 3 && pasted.first.sub === 'T001' && pasted.w === 0, JSON.stringify(pasted));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
