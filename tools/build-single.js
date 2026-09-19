/* =============================================================================
 * 打包成「单个 HTML」——双击就能玩，不用带一堆 js / css
 * -----------------------------------------------------------------------------
 * 用法：
 *   node tools/build-single.js                    打包（不带关卡）
 *   node tools/build-single.js 关卡库.json         打包并内嵌这个关卡包
 *   node tools/build-single.js 关卡库.json -o 我的游戏.html
 *
 * 产出： dist/机关谜题.html  +  dist/device-puzzle.html
 *        （给了关卡包的话，还会多一份 dist/带关卡-<包名>.html）
 *
 * 做的事很简单，没有任何打包器：
 *   1. 读 index.html
 *   2. 把 <link rel="stylesheet" href="css/style.css"> 换成内联 <style>
 *   3. 把每个 <script src="js/xxx.js"></script> 换成内联 <script>
 *   4. 把关卡包塞成 window.MP_SEED（第一次打开时自动装进关卡库）
 *   5. 插一句 window.MP_SINGLE_FILE = true（顶栏会显示「单文件版」）
 * 因为整套代码本来就是「无模块、无 fetch、file:// 直接可用」，所以内联之后行为完全一致。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
/* 不带参数时会自动找这两个文件名（你从编辑器「导出整个关卡库」默认就叫 关卡库.json）。
   示例关卡包不参与自动探测，只能显式传：node tools/build-single.js samples\示例关卡包.json */
const DEFAULT_NAMES = ['关卡库.json', 'levels.json'];

function read(rel) {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error('找不到文件：' + rel);
  return fs.readFileSync(p, 'utf8');
}

/* 内联 <script> 时，万一代码/数据里有 "</script>" 字样要打断它，不然会提前结束脚本块 */
function safeForScriptTag(js) {
  return js.replace(/<\/script>/gi, '<\\/script>');
}

/* 找关卡包：命令行给了就用给的，否则按默认名字找一遍 */
function findBundle(explicit) {
  if (explicit) return { file: explicit, auto: false };
  for (let i = 0; i < DEFAULT_NAMES.length; i++) {
    const p = path.join(ROOT, DEFAULT_NAMES[i]);
    if (fs.existsSync(p)) return { file: p, auto: true };
  }
  return null;
}

function parseArgs(argv) {
  const out = { bundle: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') { out.output = argv[++i]; continue; }
    if (!out.bundle) out.bundle = a;
  }
  return out;
}

function checkBundle(text, file) {
  let b;
  try { b = JSON.parse(text); }
  catch (e) { throw new Error('关卡包不是合法 JSON（' + file + '）：' + e.message); }
  if (Array.isArray(b)) b = b[0];
  if (!b || !b.chapters || !b.levels) throw new Error('关卡包缺少 chapters / levels（' + file + '）');
  let lv = 0;
  b.chapters.forEach(function (c) { lv += (c.levels || []).filter(function (id) { return b.levels[id]; }).length; });
  return { bundle: b, levels: lv, chapters: b.chapters.length };
}

function build(opts) {
  opts = opts || {};
  let html = read('index.html');
  const version = (read('js/core.js').match(/MP\.VERSION\s*=\s*'([^']+)'/) || [])[1] || '?';
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const used = [];

  /* ---- 关卡包（可选） ---- */
  let seed = null, seedInfo = null, seedFile = null;
  const found = findBundle(opts.bundle);
  if (found) {
    const text = read(found.file);
    seedInfo = checkBundle(text, found.file);
    seed = seedInfo.bundle;
    seedFile = path.relative(ROOT, path.isAbsolute(found.file) ? found.file : path.join(ROOT, found.file));
  }

  /* --- 1. 内联 CSS --- */
  html = html.replace(/<link[^>]*href="([^"]+\.css)"[^>]*>/gi, function (m, href) {
    const css = read(href);
    used.push(href);
    return '<style>\n' + css.replace(/<\/style>/gi, '<\\/style>') + '\n</style>';
  });

  /* --- 2. 单文件标记 + 关卡包（都必须在 core.js / app.js 之前） --- */
  const seedScript = seed
    ? '<script>/* 内置关卡包：第一次打开会自动装进关卡库 */\nwindow.MP_SEED = ' +
      safeForScriptTag(JSON.stringify(seed)) + ';</script>\n'
    : '';
  const marker = '<script src="js/core.js"></script>';
  if (html.indexOf(marker) < 0) throw new Error('index.html 里找不到 <script src="js/core.js"></script>');
  html = html.replace(marker, '<script>window.MP_SINGLE_FILE = true;</script>\n' + seedScript + marker);

  /* --- 3. 内联 JS --- */
  html = html.replace(/<script src="([^"]+\.js)"><\/script>/gi, function (m, src) {
    const js = read(src);
    used.push(src);
    return '<script>\n/* ===== ' + src + ' ===== */\n' + safeForScriptTag(js) + '\n</script>';
  });

  /* --- 4. 头尾加点版本信息 --- */
  const title = '机关谜题 · v' + version + (seed ? '（' + (seed.name || '带关卡') + '）' : '') + '（单文件版）';
  html = html.replace(/<title>([^<]*)<\/title>/i,
    '<title>' + title + '</title>\n<!-- 单文件版 v' + version + ' · 生成于 ' + stamp +
    (seed ? ' · 内置关卡包：' + seedFile + '（' + seedInfo.chapters + ' 大关 / ' + seedInfo.levels + ' 关）' : ' · 不含关卡') +
    ' · 源文件：' + used.join(', ') + ' -->');

  if (html.indexOf('src="js/') >= 0 || html.indexOf('href="css/') >= 0) {
    throw new Error('还有没内联成功的引用，检查一下 index.html 的写法');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = [path.join(OUT_DIR, '机关谜题.html'), path.join(OUT_DIR, 'device-puzzle.html')];
  if (seed) {
    const safe = String(seed.name || '带关卡').replace(/[\\/:*?"<>|]/g, '_');
    targets.push(path.join(OUT_DIR, '带关卡-' + safe + '.html'));
  }
  targets.forEach(function (t) { fs.writeFileSync(t, html, 'utf8'); });

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log('✓ 单文件版已生成 v' + version + '（' + kb + ' KB）');
  targets.forEach(function (t) { console.log('   ' + path.relative(ROOT, t)); });
  if (seed) {
    console.log('   内置关卡包：' + seedFile + '　→　' + seedInfo.chapters + ' 个大关 / ' + seedInfo.levels + ' 关' +
      (found.auto ? '（自动找到的，想带自己的关卡就把它换成你导出的「关卡库.json」）' : ''));
  } else {
    console.log('   没有关卡包：打出来的是一份「空游戏」，玩家要自己画关（或者你导出关卡包后再打包一次）');
  }
  console.log('   内联了：' + used.join('、'));
  return { version: version, size: kb, targets: targets, seed: seedInfo ? seedInfo.levels : 0 };
}

if (require.main === module) {
  try { build(parseArgs(process.argv.slice(2))); }
  catch (e) { console.error('✗ 打包失败：' + e.message); process.exit(1); }
}
module.exports = { build: build };
