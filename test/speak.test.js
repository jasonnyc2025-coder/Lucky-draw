/* 语音播报。容器里一个系统语音都没有,所以注入一套假的 speechSynthesis,
   声音名字照着 Windows / macOS 真实的来 —— 这样「自动挑女声」才测得出对错。
   真实发声只能在接投影的那台机器上试,这里保证的是:念什么、用哪个声音、
   什么时候念、什么时候掐断。 */
'use strict';

const { reporter, chromium } = require('./lib/harness');

const MOCK = () => {
  const list = [
    { name: 'Microsoft Pattara - Thai (Thailand)', lang: 'th-TH', localService: true },
    { name: 'Microsoft Premwadee - Thai (Thailand)', lang: 'th-TH', localService: true },
    { name: 'Google ไทย', lang: 'th-TH', localService: false },
    { name: 'Microsoft Kangkang - Chinese (Simplified, PRC)', lang: 'zh-CN', localService: true },
    { name: 'Microsoft Huihui - Chinese (Simplified, PRC)', lang: 'zh-CN', localService: true },
    { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
  ];
  window.__said = [];
  window.__cancels = 0;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: {
    getVoices: () => list,
    speak: (u) => window.__said.push({ text: u.text, voice: u.voice && u.voice.name,
                                       lang: u.lang, rate: u.rate }),
    cancel: () => { window.__cancels++; },
    onvoiceschanged: null,
  }});
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true,
    value: function (t) { this.text = t; this.rate = 1; this.pitch = 1; this.lang = ''; this.voice = null; } });
};

/* 要够抽三轮(每轮 3 人),所以 9 个人;混着泰文名和中文名,
   正好验「跟着名字的文字换语言」。 */
const THAI = [['แพรวา', 'ไวยาประโคน'], ['ณรงค์ศักดิ์', 'บรรดาศักดิ์'], ['สิงหา', 'ผิวผา'],
              ['อารดา', 'อภัยภักดิ์'], ['จรัญ', 'ปัญญาทิพย์'], ['วิรุต', 'แตงเพ็ชร']];
const ROWS = [['รหัสพนักงาน', 'คำนำหน้า', 'ชื่อ(ไทย)', 'นามสกุล(ไทย)', 'แผนก']]
  .concat(THAI.map((n, i) => [String(1005 + i).padStart(5, '0'),
                              i % 2 ? 'นางสาว' : 'นาย', n[0], n[1], 'ตะกั่วอัลลอย']))
  .concat([['02001', '', '李明华', '', '中文部'],
           ['02002', '', '王小美', '', '中文部'],
           ['02003', '', '陈建国', '', '中文部']]);

module.exports = async function run({ url }) {
  const R = reporter('语音播报 speak');
  const browser = await chromium().launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push((e.stack || e.message).split('\n')[0]));
  page.on('dialog', d => d.accept());

  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    R.check('读到设备上的语音列表', await page.evaluate(() => TTS.voices.length) === 6);

    // ---------- 挑女声 ----------
    R.check('泰语挑的是女声 Premwadee,不是男声 Pattara',
            await page.evaluate(() => pickVoice('th').name) === 'Microsoft Premwadee - Thai (Thailand)',
            await page.evaluate(() => pickVoice('th').name));
    R.check('中文挑的是女声 Huihui,不是男声 Kangkang',
            await page.evaluate(() => pickVoice('zh').name) === 'Microsoft Huihui - Chinese (Simplified, PRC)',
            await page.evaluate(() => pickVoice('zh').name));

    // ---------- 句子 ----------
    const th = await page.evaluate(() =>
      phraseFor('แพรวา ไวยาประโคน', { th: 'รางวัลที่ 3', zh: '三等奖' }, 'th'));
    const zh = await page.evaluate(() =>
      phraseFor('李明华', { th: 'รางวัลที่ 3', zh: '三等奖' }, 'zh'));
    R.check('泰文句子是「恭喜 + 名字 + 得了第几等奖」',
            th === 'ขอแสดงความยินดี คุณ แพรวา ไวยาประโคน ได้รับรางวัลที่ 3', th);
    R.check('中文句子是「恭喜 + 名字 + 获得几等奖」', zh === '恭喜 李明华 获得三等奖', zh);
    const titled = await page.evaluate(() =>
      phraseFor('นาย แพรวา ไวยาประโคน', { th: 'รางวัลที่ 3' }, 'th'));
    R.check('名字自带 นาย/นางสาว 时不再多加一个 คุณ(不然念成「先生先生」)',
            titled.indexOf('คุณ') < 0 && titled.indexOf('นาย แพรวา') > 0, titled);

    // ---------- 跟着名字的文字选语言 ----------
    R.check('看名字是泰文还是中文(中文声音念不出泰文名字)',
            JSON.stringify(await page.evaluate(() =>
              [langOfName('แพรวา'), langOfName('李明华'), langOfName('John')])) ===
            '["th","zh",null]');

    // ---------- 真抽一轮 ----------
    await page.click('#bSetup'); await page.waitForTimeout(200);
    await page.check('#ttsOn'); await page.waitForTimeout(200);
    await page.click('#vSetup [data-close]'); await page.waitForTimeout(200);
    await page.click('#bNames'); await page.waitForTimeout(200);
    await page.evaluate(r => { S.fromPdf = false; loadRows(r); }, ROWS);
    await page.waitForTimeout(250);
    await page.click('#bApplyFile'); await page.waitForTimeout(350);
    await page.evaluate(() => {
      S.tiers = [{ id: 't1', th: 'รางวัลที่ 3', zh: '三等奖', quota: 9, per: 3 }];
      S.winners = []; S.history = [];
      syncActive(); renderRail(); resetStage(); updateControls();
      window.__said = [];
    });
    await page.click('#bPour'); await page.waitForTimeout(1000);
    await page.click('#bPour'); await page.waitForTimeout(6000);

    const said = await page.evaluate(() => window.__said);
    R.check('三位中奖者各念一句', said.length === 3, JSON.stringify(said.map(x => x.text)));
    R.check('念的名字就是中奖的那三位',
            await page.evaluate(() => S.winners.every(w =>
              window.__said.some(s => s.text.indexOf(w.name) >= 0))),
            JSON.stringify(said.map(x => x.text)));
    R.check('泰文名字用泰语女声念,中文名字用中文女声念',
            said.every(x => (/[฀-๿]/.test(x.text) ? x.voice.indexOf('Premwadee') >= 0
                                                            : x.voice.indexOf('Huihui') >= 0)),
            JSON.stringify(said.map(x => x.voice)));
    R.check('每句都带上了是第几等奖',
            said.every(x => /รางวัลที่ 3|三等奖/.test(x.text)));
    R.check('语速用的是设置里的值', said.every(x => x.rate === 0.95), said[0] && said[0].rate);

    // ---------- 掐断 ----------
    await page.evaluate(() => { window.__cancels = 0; });
    await page.click('#bPour'); await page.waitForTimeout(700);
    R.check('开下一轮时把上一轮没念完的掐掉(不然会压着新一轮)',
            await page.evaluate(() => window.__cancels) > 0,
            'cancel ×' + await page.evaluate(() => window.__cancels));
    await page.click('#bPour'); await page.waitForTimeout(5200);

    // ---------- 关掉就不念 ----------
    await page.click('#bSetup'); await page.waitForTimeout(200);
    await page.uncheck('#ttsOn'); await page.waitForTimeout(200);
    await page.click('#vSetup [data-close]'); await page.waitForTimeout(200);
    await page.evaluate(() => {
      S.winners = []; S.history = []; syncActive(); renderRail(); resetStage();
      updateControls(); window.__said = [];
    });
    await page.click('#bPour'); await page.waitForTimeout(1000);
    await page.click('#bPour'); await page.waitForTimeout(5500);
    R.check('关掉之后一句都不念',
            await page.evaluate(() => window.__said.length) === 0,
            JSON.stringify(await page.evaluate(() => window.__said)));

    // ---------- 设置记在本机 ----------
    await page.click('#bSetup'); await page.waitForTimeout(200);
    await page.check('#ttsOn');
    await page.selectOption('#ttsLang', 'zh');
    await page.fill('#ttsRate', '110');
    await page.dispatchEvent('#ttsRate', 'input');
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const kept = await page.evaluate(() => ({
      on: TTS.on, lang: TTS.lang, rate: TTS.rate,
      box: document.querySelector('#ttsOn').checked,
      sel: document.querySelector('#ttsLang').value,
    }));
    R.check('开关、语言、语速关掉重开还记得',
            kept.on && kept.lang === 'zh' && Math.abs(kept.rate - 1.1) < 0.01 &&
            kept.box && kept.sel === 'zh', JSON.stringify(kept));

    // ---------- 设备上没有对应语言的语音时要说清楚 ----------
    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await ctx2.addInitScript(() => {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: {
        getVoices: () => [], speak: () => {}, cancel: () => {}, onvoiceschanged: null } });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true,
        value: function (t) { this.text = t; } });
    });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => errs.push(e.message));
    await p2.goto(url, { waitUntil: 'load' });
    await p2.waitForTimeout(1200);
    await p2.click('#bSetup'); await p2.waitForTimeout(300);
    const note = await p2.evaluate(() => document.querySelector('#ttsNote').textContent);
    R.check('设备上一个语音都没装时,直接告诉用户去哪儿装',
            /一个语音都没装好/.test(note) && /Windows/.test(note), note.slice(0, 60));
    await ctx2.close();

    // ---------- 弹出框背后不能闪(v39 引入的死循环) ----------
    /* 有些 Android 版 Chrome 在 voiceschanged 里调 getVoices() 会再触发一次
       voiceschanged。v39 每次都重建声音下拉框 → 每秒几百次 DOM 变化,
       加上弹出框背后的毛玻璃,整个背景一直闪。这里原样模拟那个行为。 */
    const ctx3 = await browser.newContext({ viewport: { width: 1000, height: 750 },
                                            deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx3.addInitScript(() => {
      const list = [{ name: 'th-th-x-thd-local', lang: 'th-TH', localService: true },
                    { name: 'cmn-cn-x-ccc-local', lang: 'zh-CN', localService: true }];
      window.__gv = 0;
      const ss = { onvoiceschanged: null, speak() {}, cancel() {},
        getVoices() {
          window.__gv++;
          setTimeout(() => { if (ss.onvoiceschanged) ss.onvoiceschanged(); }, 30);
          return list.map(v => Object.assign({}, v));   // 每次都是新对象,跟真机一样
        } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: ss });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true,
        value: function (t) { this.text = t; } });
    });
    const p3 = await ctx3.newPage();
    p3.on('pageerror', e => errs.push(e.message));
    await p3.goto(url, { waitUntil: 'load' });
    await p3.waitForTimeout(1500);
    await p3.click('#bNames'); await p3.waitForTimeout(500);
    const quiet = await p3.evaluate(() => new Promise(res => {
      let n = 0; const gv0 = window.__gv;
      const mo = new MutationObserver(l => { n += l.length; });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      setTimeout(() => { mo.disconnect(); res({ dom: n, getVoices: window.__gv - gv0 }); }, 3000);
    }));
    R.check('打开名单面板后,后面的页面 3 秒内基本不变(原来 800 多次)',
            quiet.dom <= 3, JSON.stringify(quiet));
    R.check('语音列表稳定后不再反复读取(死循环断掉了)',
            quiet.getVoices <= 2, JSON.stringify(quiet));
    R.check('平板 / 手机等触屏设备上,弹出框背后不用毛玻璃(GPU 吃不消会闪)',
            await p3.evaluate(() => {
              const bf = getComputedStyle(document.querySelector('#vNames')).backdropFilter;
              return !bf || bf === 'none';
            }),
            await p3.evaluate(() => getComputedStyle(document.querySelector('#vNames')).backdropFilter));
    R.check('弹出框的标题栏正常显示',
            await p3.evaluate(() =>
              document.querySelector('#vNames .panel-h').getBoundingClientRect().height > 40 &&
              /参与名单/.test(document.querySelector('#vNames .panel-h').textContent)));
    await ctx3.close();

    R.check('全程无 JS 报错', errs.length === 0, errs.join(' || '));
  } finally {
    await browser.close();
  }
  return R;
};
