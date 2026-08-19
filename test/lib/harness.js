/* 测试脚手架:把仓库文件拷到临时目录、起一个静态服务器、生成测试用的 Excel。
   应用本身是纯静态的,测试不改动仓库里的任何文件。 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const CDN_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const CDN_PDF  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const CDN_PDFW = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* 页面从 cdnjs 加载 xlsx。测试环境未必能出网,装了 devDependency 就换成本地那份,
   保证 Excel 导入这条路径每次都测得到。 */
function localFile(spec) {
  try {
    return require.resolve(spec, { paths: [ROOT] });
  } catch (e) {
    return null;
  }
}

/** 把仓库拷到临时目录,返回 {dir, usedLocalXlsx}。 */
function buildHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-draw-test-'));
  for (const f of fs.readdirSync(ROOT)) {
    const src = path.join(ROOT, f);
    if (!fs.statSync(src).isFile()) continue;
    if (f === 'README.md') continue;
    fs.copyFileSync(src, path.join(dir, f));
  }

  const idx = path.join(dir, 'index.html');
  let html = fs.readFileSync(idx, 'utf8');

  // 页面正常从 cdnjs 取这两个库。测试环境未必能出网,装了依赖就换成本地那份。
  const swap = (spec, out, url) => {
    const lib = localFile(spec);
    if (!lib) return false;
    fs.copyFileSync(lib, path.join(dir, out));
    html = html.split(url).join('./' + out);
    return true;
  };
  const usedLocalXlsx = swap('xlsx/dist/xlsx.full.min.js', 'xlsx.full.min.js', CDN_XLSX);
  const usedLocalPdf  = swap('pdfjs-dist/build/pdf.min.js', 'pdf.min.js', CDN_PDF) &&
                        swap('pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js', CDN_PDFW);

  fs.writeFileSync(idx, html);
  return { dir, usedLocalXlsx, usedLocalPdf };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.csv': 'text/csv; charset=utf-8',
};

/** 起一个只读静态服务器,返回 {url, close()}。 */
function startServer(dir) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port + '/index.html',
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

/** 60 人的测试名单(泰/中/英各 20),三列:姓名、工号、部门。 */
function staffRows() {
  const th = ['สมชาย ใจดี', 'กมลรัตน์ ศรีสุข', 'ธนวัฒน์ พงษ์ไทย', 'ณัฐพล ทองดี', 'ปิยะนุช แก้วมณี',
              'อรทัย บุญมา', 'วิชัย รักชาติ', 'สุดารัตน์ จันทร์เพ็ญ', 'ภาณุพงศ์ เกษมสุข', 'นภาพร ดวงแก้ว'];
  const zh = ['李伟', '王芳', '张敏', '刘洋', '陈静', '杨帆', '赵磊', '黄丽', '周杰', '吴倩'];
  const en = ['Spring', 'Vincent', 'John', 'Anna Wong', 'Michael Tan',
              'Grace Lim', 'Peter Ng', 'Sarah Koh', 'David Lee', 'Emily Chan'];

  const rows = [['姓名 ชื่อ', '工号 รหัส', '部门 แผนก']];
  let n = 0;
  for (let r = 0; r < 2; r++) {
    for (const list of [th, zh, en]) {
      for (const name of list) {
        n++;
        rows.push([name, 'EMP' + String(n).padStart(3, '0'), ['Sales', 'IT', 'HR', 'Ops'][n % 4]]);
      }
    }
  }
  return rows;
}

/** 把上面的名单写成 .xlsx。 */
function makeStaffXlsx(dir) {
  let XLSX;
  try {
    XLSX = require(require.resolve('xlsx', { paths: [ROOT] }));
  } catch (e) {
    return null;
  }
  const rows = staffRows();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Staff');
  const file = path.join(dir, 'staff.xlsx');
  XLSX.writeFile(wb, file);
  return file;
}

/** 用无头浏览器把一张 HTML 表格打印成真正的文字版 PDF(60 人,三列)。 */
async function makeStaffPdf(dir) {
  const rows = staffRows();
  /* 容器里通常没装泰文字体,不嵌一个的话打印出来的 PDF 里泰文声调符号会整个丢掉,
     测出来的就不是解析器的问题而是环境的问题。 */
  const thai = localFile('@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff');
  const face = thai
    ? `@font-face{font-family:NT;src:url(data:font/woff;base64,${fs.readFileSync(thai).toString('base64')}) format('woff')}`
    : '';
  const html = `<style>
      ${face}
      body{font:14px ${thai ? 'NT,' : ''}"DejaVu Sans",sans-serif;padding:24px}
      table{border-collapse:collapse;width:100%}
      td,th{padding:5px 10px;text-align:left}
      th{font-weight:700}
    </style>
    <table><thead><tr>${rows[0].map(c => '<th>' + c + '</th>').join('')}</tr></thead>
    <tbody>${rows.slice(1).map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('')}</tbody>
    </table>`;
  const b = await chromium().launch();
  const p = await b.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  const file = path.join(dir, 'staff.pdf');
  await p.pdf({ path: file, format: 'A4', printBackground: true });
  await b.close();
  return file;
}

/** 一张没有任何文字的 PDF(模拟扫描件),用来验证错误提示。 */
async function makeBlankPdf(dir) {
  const b = await chromium().launch();
  const p = await b.newPage();
  await p.setContent('<div style="width:200px;height:200px;background:#ccc"></div>', { waitUntil: 'load' });
  const file = path.join(dir, 'blank.pdf');
  await p.pdf({ path: file, format: 'A4', printBackground: true });
  await b.close();
  return file;
}

/** 一个测试套件的结果收集器。 */
function reporter(suite) {
  const rows = [];
  let failed = 0;
  return {
    check(name, ok, detail) {
      rows.push({ ok: !!ok, name, detail: detail == null ? '' : String(detail) });
      if (!ok) failed++;
    },
    get failed() { return failed; },
    get rows() { return rows; },
    print() {
      console.log('\n── ' + suite + ' ' + '─'.repeat(Math.max(0, 52 - suite.length)));
      for (const r of rows) {
        console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''));
      }
    },
  };
}

function chromium() {
  // playwright 可能装在仓库里,也可能是全局的
  try { return require(require.resolve('playwright', { paths: [ROOT] })).chromium; } catch (e) {}
  return require('playwright').chromium;
}

module.exports = { ROOT, buildHarness, startServer, makeStaffXlsx, makeStaffPdf, makeBlankPdf,
                   staffRows, reporter, chromium };
