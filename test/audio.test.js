/* 音效。现场放出来是什么感觉测不了,但能挡住几件具体的事:
   - 又用回 square / sawtooth 这种刺耳的波形
   - 主输出的柔化链(压缩 + 高频衰减)被删掉
   - 抽奖转完没把定时器和振荡器收干净,反复抽几轮越来越吵 */
'use strict';

const fs = require('fs');
const path = require('path');
const { reporter, chromium } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');

module.exports = async function run({ url }) {
  const R = reporter('音效 audio');

  // ---------- 静态:波形和柔化链 ----------
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const audio = html.slice(html.indexOf('var A = { ctx:null'),
                           html.indexOf('/* ---------- helpers ---------- */'));
  const harsh = (audio.match(/type\s*=\s*'(square|sawtooth)'/g) || []);
  R.check('合成器里没有 square / sawtooth(刺耳的根源)',
          harsh.length === 0, harsh.join(', '));
  R.check('主输出串了压缩器,几个音叠一起不会爆',
          /createDynamicsCompressor/.test(audio));
  R.check('主输出把 2-5kHz 那段压下去了(highshelf 负增益)',
          /highshelf/.test(audio) && /tame\.gain\.value\s*=\s*-\d/.test(audio));
  R.check('5kHz 以上切掉,没有嘶声', /air\.type\s*=\s*'lowpass'/.test(audio));

  // ---------- 运行时 ----------
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
  page.on('dialog', d => d.accept());

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    await page.click('#bNames'); await page.waitForTimeout(250);
    await page.fill('#paste', Array.from({ length: 12 },
      (_, i) => `测试${i + 1}, T${i + 1}`).join('\n'));
    await page.click('#bApplyPaste'); await page.waitForTimeout(400);

    R.check('默认开着音效', await page.evaluate(() => A.on === true));

    // 试听按钮
    await page.click('#bSetup'); await page.waitForTimeout(250);
    await page.click('#bTestSnd'); await page.waitForTimeout(400);
    R.check('「试听」能建起 AudioContext',
            await page.evaluate(() => !!A.ctx && A.ctx.state !== 'closed'),
            await page.evaluate(() => A.ctx && A.ctx.state));
    await page.click('#vSetup [data-close]'); await page.waitForTimeout(200);

    // 连抽三轮,每轮都要收干净
    for (let round = 1; round <= 3; round++) {
      await page.click('#bPour'); await page.waitForTimeout(900);
      const mid = await page.evaluate(() => ({
        drones: A.drones ? A.drones.length : 0,
        tick: A.tickTimer != null, beat: A.beatTimer != null,
      }));
      R.check(`第 ${round} 轮:转动时振荡器和定时器都在跑`,
              mid.drones > 0 && mid.tick && mid.beat, JSON.stringify(mid));

      await page.click('#bPour'); await page.waitForTimeout(4200);
      const after = await page.evaluate(() => ({
        drones: A.drones, riser: A.riser,
        tick: A.tickTimer, beat: A.beatTimer,
      }));
      R.check(`第 ${round} 轮:停下后振荡器和定时器全部收干净(不收会越抽越吵)`,
              after.drones === null && after.riser === null &&
              after.tick === null && after.beat === null, JSON.stringify(after));
    }

    // 关掉音效后不应该再起新的声音
    await page.evaluate(() => { A.on = false; });
    await page.click('#bPour'); await page.waitForTimeout(700);
    R.check('关掉音效后转动不再建振荡器',
            await page.evaluate(() => A.drones === null || A.drones === undefined));
    await page.click('#bPour'); await page.waitForTimeout(3600);
    R.check('关着音效也能正常抽完一轮', await page.evaluate(() => S.winners.length > 0));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
