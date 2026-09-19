/* =============================================================================
 * 清理「关卡库.json」里被自检脚本混进去的测试大关
 * -----------------------------------------------------------------------------
 *   node tools/clean-library-file.js 关卡库.json
 *   node tools/clean-library-file.js 关卡库.json 探针大关 别的名字
 *
 * 会先备份成 <文件名>.bak.json，再只删掉指定名字的大关（以及它们的关卡），
 * 别的数据一个字节都不动。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULTS = ['探针大关', '冒烟关卡', 'CtrlS 测试', '空关卡', '缩放测试'];

const args = process.argv.slice(2);
const file = args[0] ? path.resolve(process.cwd(), args[0]) : path.join(ROOT, '关卡库.json');
const junkNames = args.length > 1 ? args.slice(1) : DEFAULTS;

if (!fs.existsSync(file)) { console.error('找不到文件：' + file); process.exit(1); }

const raw = fs.readFileSync(file, 'utf8');
let b;
try { b = JSON.parse(raw); }
catch (e) { console.error('不是合法 JSON：' + e.message); process.exit(1); }
if (!b.chapters || !b.levels) { console.error('这不像是关卡包（缺少 chapters / levels）'); process.exit(1); }

const before = { ch: b.chapters.length, lv: Object.keys(b.levels).length };
const hit = b.chapters.filter(function (c) { return junkNames.indexOf(c.name) >= 0; });
if (!hit.length) {
  console.log('没有找到需要删除的大关（' + junkNames.join('、') + '），什么都没改。');
  process.exit(0);
}

/* 备份 */
const bak = file.replace(/\.json$/i, '') + '.bak.json';
fs.writeFileSync(bak, raw, 'utf8');

/* 只删命中名字的大关 */
const junkIds = {};
hit.forEach(function (c) {
  junkIds[c.id] = 1;
  c.levels.forEach(function (id) { delete b.levels[id]; });
});
b.chapters = b.chapters.filter(function (c) { return !junkIds[c.id]; });

/* 顺手清掉没有任何大关引用的孤儿关卡 */
const keep = {};
b.chapters.forEach(function (c) { c.levels.forEach(function (id) { keep[id] = 1; }); });
const orphans = Object.keys(b.levels).filter(function (id) { return !keep[id]; });
orphans.forEach(function (id) { delete b.levels[id]; });

fs.writeFileSync(file, JSON.stringify(b, null, 1), 'utf8');

console.log('✓ 已清理：' + path.relative(ROOT, file));
hit.forEach(function (c) { console.log('   删掉大关「' + c.name + '」（' + c.levels.length + ' 关）'); });
if (orphans.length) console.log('   另外删掉 ' + orphans.length + ' 个孤儿关卡');
console.log('   ' + before.ch + ' 大关 / ' + before.lv + ' 关  →  ' + b.chapters.length + ' 大关 / ' + Object.keys(b.levels).length + ' 关');
console.log('   备份留在：' + path.relative(ROOT, bak));
