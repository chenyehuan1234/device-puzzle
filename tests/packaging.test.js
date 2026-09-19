/* =============================================================================
 * 打包 / 脚本卫生检查 —— node tests/packaging.test.js
 * -----------------------------------------------------------------------------
 * 起因：build.cmd / run-tests.cmd 曾经是「LF 换行 + 中文」的批处理，
 * 双击只会闪一下黑窗、什么都不执行（cmd.exe 解析不了）。
 * 这个测试把这条教训钉死：.cmd 必须是 CRLF 且纯 ASCII。
 * 另外顺手检查自检脚本必须用临时 profile（不然会读写用户的真实关卡库）。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, failCount = 0;
function ok(c, m) { if (c) pass++; else { failCount++; console.log('  ✗ ' + m); } }
function group(n) { console.log('\n· ' + n); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

/* ==========================================================================
 * 1. 批处理脚本：CRLF + 纯 ASCII + 不能有多行括号块
 * ======================================================================= */
group('批处理脚本（.cmd）能不能双击跑起来');
['build.cmd', 'run-tests.cmd'].forEach(function (f) {
  ok(exists(f), f + ' 存在');
  if (!exists(f)) return;
  const raw = fs.readFileSync(path.join(ROOT, f));
  const text = raw.toString('utf8');

  const lf = (text.match(/\n/g) || []).length;
  const crlf = (text.match(/\r\n/g) || []).length;
  ok(lf === crlf, f + ' 全部是 CRLF 换行（LF=' + lf + ' CRLF=' + crlf + '）');

  const bad = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch > 126) { bad.push(text[i]); if (bad.length > 5) break; }
  }
  ok(bad.length === 0, f + ' 是纯 ASCII（发现非 ASCII：' + bad.join('') + '）');

  ok(text.indexOf('pause') >= 0, f + ' 结尾有 pause（双击不会一闪而过）');
  ok(!/\r\n\s*\)\s*\r\n/.test(text), f + ' 没有多行括号块（cmd 解析的经典坑）');
});

/* build.cmd 必须把活交给 build.ps1，并且两种 PowerShell 都要能用 */
{
  const t = read('build.cmd');
  ok(t.indexOf('tools\\build.ps1') >= 0, 'build.cmd 调用 tools\\build.ps1');
  ok(t.indexOf('where pwsh') >= 0 && t.indexOf('powershell') >= 0, 'build.cmd 会优先用 pwsh、退回 Windows PowerShell');
  ok(exists('tools/build.ps1'), 'tools/build.ps1 存在');
}

/* ==========================================================================
 * 2. 自检脚本必须隔离浏览器 profile
 * ======================================================================= */
group('自检脚本不会碰你的浏览器数据');
['tests/run-probe.ps1', 'tools/check-single.ps1'].forEach(function (f) {
  const t = read(f);
  ok(t.indexOf('--user-data-dir=') >= 0, f + ' 用了 --user-data-dir（一次性临时 profile）');
  ok(t.indexOf('NewGuid') >= 0, f + ' 每次生成新的临时目录');
  ok(/Remove-Item\s+\$profile/.test(t), f + ' 跑完会把临时目录删掉');
});
{
  const t = read('tools/clean-library-file.js');
  ok(t.indexOf('bak.json') >= 0, 'clean-library-file.js 会先备份再删');
  ok(exists('tools/cleanup-library.html'), 'cleanup-library.html 存在（浏览器里体检用）');
  ok(read('tools/cleanup-library.html').indexOf("'#go'") >= 0, 'cleanup-library.html 默认只体检、加 #go 才删');
}

/* ==========================================================================
 * 3. index.html 的引用都存在
 * ======================================================================= */
group('index.html 引用完整');
{
  const html = read('index.html');
  const css = html.match(/href="([^"]+\.css)"/g) || [];
  const js = html.match(/src="([^"]+\.js)"/g) || [];
  ok(css.length >= 1, '引用了 ' + css.length + ' 个 css');
  ok(js.length >= 6, '引用了 ' + js.length + ' 个 js');
  css.concat(js).forEach(function (m) {
    const p = m.replace(/^(href|src)="/, '').replace(/"$/, '');
    ok(exists(p), '文件存在：' + p);
  });
  /* 顺序：core → rules → fx → sfx → library → render → app */
  const order = (html.match(/js\/[a-z]+\.js/g) || []).join(',');
  ok(order === 'js/core.js,js/rules.js,js/fx.js,js/sfx.js,js/library.js,js/render.js,js/app.js',
    '脚本加载顺序正确：' + order);
}

/* ==========================================================================
 * 4. 打包脚本的关键行为（只查源码，不真的打包，免得动 dist）
 * ======================================================================= */
group('打包脚本');
{
  const t = read('tools/build-single.js');
  ok(t.indexOf('window.MP_SEED') >= 0, '会把关卡包内嵌成 window.MP_SEED');
  ok(t.indexOf('MP_SINGLE_FILE') >= 0, '会写 window.MP_SINGLE_FILE 标记');
  ok(t.indexOf('关卡库.json') >= 0, '会自动找根目录的 关卡库.json');
  ok(t.indexOf('带关卡-') >= 0, '会另存一份「带关卡-xxx.html」');
  ok(t.indexOf("throw new Error('还有没内联成功的引用") >= 0, '打包完会检查有没有漏掉的引用');
  ok(read('.gitignore').indexOf('dist/') >= 0, '.gitignore 忽略了 dist/');
  ok(read('.gitattributes').indexOf('*.cmd text eol=crlf') >= 0, '.gitattributes 规定 .cmd 检出为 CRLF');
}

/* ==========================================================================
 * 5. 关卡包文件（根目录那份是用户自己导出的，有就顺便验一下结构）
 * ======================================================================= */
group('根目录关卡库.json（如果有的话）');
if (exists('关卡库.json')) {
  let b = null;
  try { b = JSON.parse(read('关卡库.json')); } catch (e) { b = null; }
  ok(!!b, '能解析');
  if (b) {
    ok(b.format === 'mp-level-bundle' && b.chapters && b.levels, '结构是关卡包');
    let n = 0, bad = 0;
    b.chapters.forEach(function (c) {
      c.levels.forEach(function (id) { if (b.levels[id]) n++; else bad++; });
    });
    ok(n > 0, '里面有 ' + n + ' 关');
    ok(bad === 0, '没有指向不存在关卡的悬空引用');
    /* 自检残留只警告、不判失败 —— 这份文件是你自己导出的实时数据 */
    const junk = b.chapters.filter(function (c) { return /探针|冒烟|测试关卡/.test(c.name); });
    if (junk.length) {
      console.log('  ⚠ 提醒：这份关卡库里还有自检留下的大关（' +
        junk.map(function (c) { return c.name; }).join('、') + '）——');
      console.log('    在编辑器左边栏点中它 →「删除选中大关」即可，或者跑 node tools/clean-library-file.js');
    } else {
      ok(true, '没有自检留下的测试大关');
    }
  }
} else {
  ok(true, '根目录没有 关卡库.json（打包时会打出空游戏）');
}

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + failCount + ' 项');
console.log('========================================');
process.exit(failCount ? 1 : 0);
