/* =============================================================================
 * 打包成「单个 HTML」——双击就能玩，不用带一堆 js / css
 * -----------------------------------------------------------------------------
 * 用法：  node tools/build-single.js
 * 产出：  dist/机关谜题.html      （另外再放一份 dist/device-puzzle.html，方便命令行/邮件里用）
 *
 * 做的事很简单，没有任何打包器：
 *   1. 读 index.html
 *   2. 把 <link rel="stylesheet" href="css/style.css"> 换成内联 <style>
 *   3. 把每个 <script src="js/xxx.js"></script> 换成内联 <script>
 *   4. 插一句 window.MP_SINGLE_FILE = true（顶栏会显示「单文件版」）
 * 因为整套代码本来就是「无模块、无 fetch、file:// 直接可用」，所以内联之后行为完全一致。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error('找不到文件：' + rel);
  return fs.readFileSync(p, 'utf8');
}

/* 内联 <script> 时，万一代码里有 "</script>" 字样要打断它，不然会提前结束脚本块 */
function safeForScriptTag(js) {
  return js.replace(/<\/script>/gi, '<\\/script>');
}

function build() {
  let html = read('index.html');
  const version = (read('js/core.js').match(/MP\.VERSION\s*=\s*'([^']+)'/) || [])[1] || '?';
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const used = [];

  /* --- 1. 内联 CSS --- */
  html = html.replace(/<link[^>]*href="([^"]+\.css)"[^>]*>/gi, function (m, href) {
    const css = read(href);
    used.push(href);
    return '<style>\n' + css.replace(/<\/style>/gi, '<\\/style>') + '\n</style>';
  });

  /* --- 2. 单文件标记（必须在 app.js 之前） --- */
  html = html.replace(/<script src="js\/core\.js"><\/script>/i,
    '<script>window.MP_SINGLE_FILE = true;</script>\n<script src="js/core.js"></script>');

  /* --- 3. 内联 JS --- */
  html = html.replace(/<script src="([^"]+\.js)"><\/script>/gi, function (m, src) {
    const js = read(src);
    used.push(src);
    return '<script>\n/* ===== ' + src + ' ===== */\n' + safeForScriptTag(js) + '\n</script>';
  });

  /* --- 4. 头尾加点版本信息 --- */
  html = html.replace(/<title>([^<]*)<\/title>/i,
    '<title>$1 · v' + version + '（单文件版）</title>\n<!-- 单文件版 v' + version + ' · 生成于 ' + stamp + ' · 源文件：' + used.join(', ') + ' -->');

  if (html.indexOf('src="js/') >= 0 || html.indexOf('href="css/') >= 0) {
    throw new Error('还有没内联成功的引用，检查一下 index.html 的写法');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = [path.join(OUT_DIR, '机关谜题.html'), path.join(OUT_DIR, 'device-puzzle.html')];
  targets.forEach(function (t) { fs.writeFileSync(t, html, 'utf8'); });

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log('✓ 单文件版已生成 v' + version + '（' + kb + ' KB）');
  targets.forEach(function (t) { console.log('   ' + path.relative(ROOT, t)); });
  console.log('   内联了：' + used.join('、'));
  return { version: version, size: kb, targets: targets };
}

if (require.main === module) {
  try { build(); } catch (e) { console.error('✗ 打包失败：' + e.message); process.exit(1); }
}
module.exports = { build: build };
