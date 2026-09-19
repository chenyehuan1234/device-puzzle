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
/* 先按习惯名字找；找不到就扫目录里所有 json，谁的内容是关卡包就用谁
   （这样你导出的文件叫「我的关卡库.json」「关卡库 (1).json」都认得出来） */
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

/* 这个 json 是不是关卡包？是就返回摘要，不是返回 null */
function asBundle(file) {
  let b;
  try { b = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return null; }
  if (Array.isArray(b)) b = b[0];
  if (!b || b.format !== 'mp-level-bundle' || !b.chapters || !b.levels) {
    /* 宽容一点：结构对也算（手写的关卡包可能没写 format） */
    if (!b || !b.chapters || !b.levels) return null;
  }
  let lv = 0;
  b.chapters.forEach(function (c) { lv += ((c && c.levels) || []).filter(function (id) { return b.levels[id]; }).length; });
  if (!lv) return null;
  return { bundle: b, levels: lv, chapters: b.chapters.length };
}

/* 找关卡包：命令行给了就用给的；
   否则扫项目根目录（再退一步：上一级目录）里所有 .json，按「内容」认出关卡包 —— 文件叫什么名字都行。
   有多个的话：先看习惯名字，再看哪个关卡多，最后看谁最新。 */
function findBundle(explicit) {
  if (explicit) {
    const info = asBundle(path.isAbsolute(explicit) ? explicit : path.join(ROOT, explicit));
    return { file: explicit, auto: false, scanned: [], others: [], info: info, byName: false };
  }

  const scanned = [];
  const cands = [];
  const dirs = [ROOT, path.dirname(ROOT)];
  for (let d = 0; d < dirs.length; d++) {
    let names = [];
    try { names = fs.readdirSync(dirs[d]); } catch (e) { continue; }
    const jsons = names.filter(function (f) { return /\.json$/i.test(f); }).sort();
    for (let i = 0; i < jsons.length; i++) {
      const p = path.join(dirs[d], jsons[i]);
      let st = null, info = null;
      try { st = fs.statSync(p); if (st.isFile()) info = asBundle(p); } catch (e) { info = null; }
      if (d === 0) scanned.push({ name: jsons[i], ok: !!info, levels: info ? info.levels : 0 });
      if (info) cands.push({ file: p, name: jsons[i], info: info, mtime: st ? st.mtimeMs : 0, dir: d });
    }
    if (cands.length) break;   /* 项目根目录里找到了就不去上一级 */
  }

  if (!cands.length) return { file: null, auto: true, scanned: scanned, others: [], byName: false, info: null };

  let pick = null;
  for (let i = 0; i < DEFAULT_NAMES.length && !pick; i++) {
    pick = cands.filter(function (c) { return c.name === DEFAULT_NAMES[i]; })[0] || null;
  }
  let byName = !!pick;
  if (!pick) {
    cands.sort(function (a, b) {
      if (b.info.levels !== a.info.levels) return b.info.levels - a.info.levels;
      return b.mtime - a.mtime;
    });
    pick = cands[0];
  }
  const others = cands.filter(function (c) { return c.file !== pick.file; });
  return { file: pick.file, auto: true, scanned: scanned, others: others, info: pick.info, byName: byName, dir: pick.dir };
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
  let seed = null, seedInfo = null, seedFile = null, found = null;
  found = findBundle(opts.bundle);
  if (found && found.file) {
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
      (!found.byName ? '（按文件内容认出来的，文件名叫什么都行）' : ''));
    if (found.dir === 1) console.log('   （注意：是从上一级目录找到的，建议挪到 ' + path.basename(ROOT) + '\\ 目录下）');
    if (found.others && found.others.length) {
      console.log('   ⚠ 这个目录里还有 ' + found.others.length + ' 个关卡包，这次没用它们：' +
        found.others.map(function (o) { return o.name + '（' + o.info.levels + ' 关）'; }).join('、'));
      console.log('     建议只留一个，免得以后搞不清用的是哪个（或者打包时直接指定文件名）');
    }
    /* 关卡包里如果混着自检留下的测试大关，提醒一句 */
    const junk = seed.chapters.filter(function (c) {
      return /探针|冒烟|测试关卡|CtrlS/.test(c.name || '');
    });
    if (junk.length) {
      console.log('   ⚠ 这个关卡包里有看着像自检留下的测试大关：' + junk.map(function (c) { return c.name; }).join('、'));
      console.log('     在编辑器左边栏点中它 →「删除选中大关」，再重新导出一次就干净了');
    }
  } else {
    console.log('   没有关卡包：打出来的是一份「空游戏」，玩家要自己画关');
    console.log('   想做成「一份带关卡的完整游戏」：编辑器左栏「关卡包」→「导出整个关卡库」，');
    console.log('   把导出的 json 放到 ' + path.basename(ROOT) + '\\ 目录下（文件名叫什么都行），再打包一次。');
    if (found && found.scanned && found.scanned.length) {
      console.log('   （这次看过的 json：' + found.scanned.map(function (s) {
        return s.name + (s.ok ? '[是关卡包]' : '[不是]');
      }).join('、') + '）');
    } else if (found) {
      console.log('   （' + path.basename(ROOT) + '\\ 和上一级目录里都没有 .json 文件）');
    }
  }
  console.log('   内联了：' + used.join('、'));
  return { version: version, size: kb, targets: targets, seed: seedInfo ? seedInfo.levels : 0 };
}

if (require.main === module) {
  try { build(parseArgs(process.argv.slice(2))); }
  catch (e) { console.error('✗ 打包失败：' + e.message); process.exit(1); }
}
module.exports = { build: build, findBundle: findBundle, asBundle: asBundle };
