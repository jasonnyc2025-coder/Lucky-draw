/* 静态资源的一致性检查。没有浏览器,纯读文件 —— 但挡住的都是真出过的事故:

   1. index.html 的 APP_VERSION 和 sw.js 的 VERSION 忘了一起加一,
      用户拿到的是缓存里的旧页面,界面上还显示「已是最新」
   2. 换了图标但 ?r= 没加一,浏览器按 URL 缓存 favicon,标签页上还是旧图
   3. index.html / manifest / sw.js 三处的 ?r= 对不上,SW 缓存的地址
      和页面请求的地址不一样,离线时图标拿不到
   4. maskable 图标和标准图标导出成了同一张(icon.html 的选择器权重问题),
      Android 裁圆角会把图形切掉                                        */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { reporter } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');

module.exports = async function run(){
  const R = reporter('静态资源 assets');

  const html = read('index.html');
  const sw = read('sw.js');
  const mani = read('manifest.webmanifest');

  // ---------- 1. 两个版本号必须一致 ----------
  const appV = (html.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  const swV = (sw.match(/VERSION\s*=\s*'([^']+)'/) || [])[1];
  R.check('index.html 的 APP_VERSION 和 sw.js 的 VERSION 一致',
          !!appV && appV === swV, appV + ' vs ' + swV);

  // ---------- 2. 三处的图标改版号必须一致 ----------
  const revs = {
    'index.html': [...new Set((html.match(/\.png\?r=(\d+)/g) || []).map(s => s.split('=')[1]))],
    'manifest': [...new Set((mani.match(/\.png\?r=(\d+)/g) || []).map(s => s.split('=')[1]))],
    'sw.js': (sw.match(/ICON_REV\s*=\s*'\?r=(\d+)'/) || []).slice(1),
  };
  const all = [].concat(revs['index.html'], revs.manifest, revs['sw.js']);
  R.check('图标 ?r= 改版号三处一致且只有一个值',
          all.length >= 3 && new Set(all).size === 1, JSON.stringify(revs));

  // ---------- 3. 引用到的图标文件都要真的存在 ----------
  const refs = [...new Set(
    [].concat(html.match(/\.\/[\w-]+\.png(\?r=\d+)?/g) || [],
              mani.match(/\.\/[\w-]+\.png(\?r=\d+)?/g) || [])
      .map(u => u.replace(/^\.\//, '').split('?')[0])
  )];
  const missing = refs.filter(f => !fs.existsSync(path.join(ROOT, f)));
  R.check('引用到的 ' + refs.length + ' 个图标文件都在', missing.length === 0,
          missing.join(', ') || refs.join(', '));

  // ---------- 4. sw.js 缓存的地址要和页面请求的地址完全对得上 ----------
  const swRefs = (sw.match(/'\.\/[\w-]+\.png'(?!\s*\+\s*ICON_REV)/g) || []).map(s => s.slice(1, -1));
  R.check('sw.js 里的图标都拼了 ICON_REV,没有漏掉的裸地址',
          swRefs.length === 0, swRefs.join(', '));

  // ---------- 5. maskable 必须和标准图不一样 ----------
  R.check('maskable 图标和标准图标不是同一张(以前导出过一模一样的)',
          md5('icon-512.png') !== md5('icon-maskable-512.png'),
          'std ' + md5('icon-512.png').slice(0, 8) + ' / msk ' + md5('icon-maskable-512.png').slice(0, 8));

  // ---------- 6. 安装时要绕开 HTTP 缓存 ----------
  R.check("SW 安装时用 cache:'reload' 抓资源,不会把旧图标塞进新缓存",
          /cache:\s*'reload'/.test(sw));

  return R;
};
