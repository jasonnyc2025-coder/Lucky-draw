/* 配色主题和 Logo。
   主题要能切、能存、重开还在,而且三套的对比度都得够投影用;
   Logo 要能一键换、大图自动缩、换名单不会丢。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { reporter, chromium } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');

/* WCAG 相对亮度 / 对比度 */
function lum(hex){
  const h = hex.replace('#','');
  const v = [0,2,4].map(i => parseInt(h.slice(i,i+2),16)/255)
    .map(c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
  return 0.2126*v[0] + 0.7152*v[1] + 0.0722*v[2];
}
function contrast(a, b){
  const [hi, lo] = [lum(a), lum(b)].sort((x,y)=>y-x);
  return (hi + 0.05) / (lo + 0.05);
}

module.exports = async function run({ url }) {
  const R = reporter('配色与 Logo theme');

  // ---------- 静态:三套主题的对比度 ----------
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = html.slice(0, html.indexOf('</style>'));
  const grab = (block) => {
    const m = css.slice(css.indexOf(block));
    const body = m.slice(0, m.indexOf('}'));
    const o = {};
    body.replace(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g, (_, k, v) => { o[k] = v; return ''; });
    return o;
  };
  const THEMES = {
    '暖炭 forge': grab(':root{'),
    '年会红金 gala': grab(':root[data-theme="gala"]{'),
    '墨蓝 ink': grab(':root[data-theme="ink"]{'),
  };
  for (const [name, c] of Object.entries(THEMES)) {
    const pairs = {
      '大标题': [c.bone, c.slag],
      '次级文字': [c.ash, c.slag],
      '强调色': [c.pour, c.slag],
      '中奖卡上的名字': [c.ink, c['steel-lo']],
      '卡片上的字': [c.bone, c.shell],
    };
    const bad = Object.entries(pairs)
      .map(([k, [f, b]]) => [k, contrast(f, b)])
      .filter(([, v]) => v < 7);
    const worst = Math.min(...Object.values(pairs).map(([f, b]) => contrast(f, b)));
    R.check(`${name}:所有正文对比度 ≥ 7:1(投影能看清)`,
            bad.length === 0,
            bad.length ? bad.map(([k, v]) => `${k} ${v.toFixed(1)}:1`).join(', ')
                       : `最低 ${worst.toFixed(1)}:1`);
  }

  // ---------- 运行时 ----------
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
  page.on('dialog', d => d.accept());

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    R.check('默认是暖炭,不带 data-theme 属性',
            await page.evaluate(() => S.theme === 'forge' &&
                                      !document.documentElement.getAttribute('data-theme')));

    await page.click('#bSetup'); await page.waitForTimeout(250);
    await page.click('.theme[data-t="gala"]'); await page.waitForTimeout(400);
    let st = await page.evaluate(() => ({
      theme: S.theme,
      attr: document.documentElement.getAttribute('data-theme'),
      meta: document.querySelector('meta[name="theme-color"]').content,
      bg: getComputedStyle(document.body).backgroundColor,
      on: document.querySelector('.theme[data-t="gala"]').classList.contains('on'),
    }));
    R.check('点「年会红金」后主题、属性、按钮选中态一起变',
            st.theme === 'gala' && st.attr === 'gala' && st.on, JSON.stringify(st));
    R.check('手机状态栏的颜色也跟着换(装成 App 后顶上不会残留旧色)',
            st.meta === '#2B0F10', st.meta);
    R.check('页面底色真的变了', st.bg === 'rgb(43, 15, 16)', st.bg);
    await page.click('#vSetup [data-close]'); await page.waitForTimeout(200);

    // ---------- Logo ----------
    R.check('没传过 Logo 时顶栏是一个可以点的「＋」方块',
            await page.evaluate(() =>
              getComputedStyle(document.querySelector('#logoAdd')).display !== 'none'));

    /* 这个「＋」做大一点点,顶栏就会多折一行,舞台矮 48px,结束总榜的字号
       被挤小一档 —— 真踩过。所以尺寸和窄屏下的隐藏都要盯住。 */
    R.check('「＋」和 Logo 一样是 38px,不会把顶栏撑出一行',
            await page.evaluate(() => {
              const r = document.querySelector('#logoAdd').getBoundingClientRect();
              return Math.round(r.width) === 38 && Math.round(r.height) === 38;
            }),
            await page.evaluate(() => {
              const r = document.querySelector('#logoAdd').getBoundingClientRect();
              return Math.round(r.width) + '×' + Math.round(r.height);
            }));
    {
      const before = await page.evaluate(() =>
        Math.round(document.querySelector('.topbar').getBoundingClientRect().height));
      await page.setViewportSize({ width: 820, height: 640 });
      await page.waitForTimeout(400);
      const narrow = await page.evaluate(() => ({
        h: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
        shown: getComputedStyle(document.querySelector('#logoAdd')).display !== 'none',
      }));
      R.check('窄屏下「＋」自动收起,顶栏不会多折一行',
              !narrow.shown && narrow.h <= before,
              '宽屏 ' + before + 'px → 窄屏 ' + narrow.h + 'px, 显示=' + narrow.shown);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(400);
    }

    await page.setInputFiles('#logoFile', path.join(ROOT, 'icon-512.png'));
    await page.waitForTimeout(1000);
    const lg = await page.evaluate(() => new Promise(res => {
      const im = new Image();
      im.onload = () => res({ w: im.width, h: im.height, len: S.logo.length,
        shown: document.querySelector('#logoImg').classList.contains('on'),
        addHidden: document.querySelector('#logoAdd').style.display === 'none' });
      im.src = S.logo;
    }));
    R.check('512px 的大图自动缩到高 256px 再存(省存档、不用自己压图)',
            lg.h === 256, JSON.stringify(lg));
    R.check('传完之后顶栏显示 Logo,「+ LOGO」收起来',
            lg.shown && lg.addHidden, JSON.stringify(lg));
    R.check('点左上角的 Logo 能直接再开选择器(换公司不用进设置)',
            await page.evaluate(() => {
              let opened = false;
              document.querySelector('#logoFile').click = () => { opened = true; };
              document.querySelector('#logoImg').click();
              return opened;
            }));

    // ---------- 换名单不该动 Logo 和主题 ----------
    await page.click('#bNames'); await page.waitForTimeout(250);
    await page.fill('#paste', ['甲, A1', '乙, A2', '丙, A3'].join('\n'));
    await page.click('#bApplyPaste'); await page.waitForTimeout(400);
    R.check('导入新名单不会动 Logo 和主题',
            await page.evaluate(() => !!S.logo && S.theme === 'gala'));

    // ---------- 关掉页面重开 ----------
    await page.close();
    const p2 = await ctx.newPage();
    p2.on('pageerror', e => errs.push(e.message));
    await p2.goto(url, { waitUntil: 'load' });
    await p2.waitForTimeout(1500);
    st = await p2.evaluate(() => ({
      theme: S.theme, attr: document.documentElement.getAttribute('data-theme'),
      logo: !!S.logo, on: document.querySelector('#logoImg').classList.contains('on'),
      meta: document.querySelector('meta[name="theme-color"]').content,
    }));
    R.check('关掉页面重开,主题和 Logo 都还在',
            st.theme === 'gala' && st.attr === 'gala' && st.logo && st.on, JSON.stringify(st));
    R.check('重开时状态栏颜色也对(head 里那段防闪的代码生效了)',
            st.meta === '#2B0F10', st.meta);

    // ---------- 保存进度的 .json 里要带主题 ----------
    const prog = await p2.evaluate(() => {
      const d = snapshot();
      return { theme: d.theme, hasLogo: !!d.logo };
    });
    R.check('「保存进度」的文件里带着主题和 Logo,换台电脑能原样恢复',
            prog.theme === 'gala' && prog.hasLogo, JSON.stringify(prog));

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
