/* 测试脚手架:把仓库文件拷到临时目录、起一个静态服务器、生成测试用的 Excel。
   应用本身是纯静态的,测试不改动仓库里的任何文件。 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const CDN_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

/* 页面从 cdnjs 加载 xlsx。测试环境未必能出网,装了 devDependency 就换成本地那份,
   保证 Excel 导入这条路径每次都测得到。 */
function localXlsx() {
  try {
    return require.resolve('xlsx/dist/xlsx.full.min.js', { paths: [ROOT] });
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

  let usedLocalXlsx = false;
  const lib = localXlsx();
  if (lib) {
    fs.copyFileSync(lib, path.join(dir, 'xlsx.full.min.js'));
    const idx = path.join(dir, 'index.html');
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').split(CDN_XLSX).join('./xlsx.full.min.js'));
    usedLocalXlsx = true;
  }
  return { dir, usedLocalXlsx };
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

/** 生成 60 人的测试名单(泰/中/英各 20),三列:姓名、工号、部门。 */
function makeStaffXlsx(dir) {
  let XLSX;
  try {
    XLSX = require(require.resolve('xlsx', { paths: [ROOT] }));
  } catch (e) {
    return null;
  }
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
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Staff');
  const file = path.join(dir, 'staff.xlsx');
  XLSX.writeFile(wb, file);
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

module.exports = { ROOT, buildHarness, startServer, makeStaffXlsx, reporter, chromium };
