#!/usr/bin/env node
/* =============================================================================
 * 关卡库体检
 *   跑一遍关卡库里的每一关，把「数学上不可能通关」的关挑出来。
 *
 *   用法：
 *     node tools/check-levels.js                  体检项目根目录的 关卡库.json
 *     node tools/check-levels.js 我的关卡.json      体检指定文件
 *
 *   判定依据（不需要跑搜索，数一数就能证死）：
 *     通关条件 = 每个正方形 / 圆形都停在同形状的目标格上。
 *     所以「正方形数 != 方形目标数」或「圆形数 != 圆形目标数」= 永远解不开。
 *
 *   退出码：全绿 0，有问题 1（可以拿去当发布前的闸门）。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'js', 'core.js'));
const MP = globalThis.MPCore;

/* ------------------------------------------------------------------ 读文件 */
const arg = process.argv[2];
let file = arg ? path.resolve(arg) : null;
if (!file) {
  const guess = ['关卡库.json', '我的关卡库.json'].map(n => path.join(ROOT, n)).filter(fs.existsSync);
  file = guess[0] || null;
}
if (!file || !fs.existsSync(file)) {
  console.error('找不到关卡库文件。用法：node tools/check-levels.js [关卡库.json]');
  process.exit(2);
}

let bundle;
try {
  bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('解析失败：' + e.message);
  process.exit(2);
}

if (!bundle || !bundle.chapters || !bundle.levels) {
  console.error('这不是一份关卡包（缺 chapters / levels）。');
  process.exit(2);
}

/* ------------------------------------------------------------------ 体检 */
const problems = [];   // { level, reason }
const notes = [];
const seen = {};       // 内容签名 -> 关卡名（查重）
let total = 0, withSol = 0;

console.log('');
console.log('关卡库：' + path.relative(ROOT, file) + '  （' + (bundle.format || '?') + '，' +
  (bundle.chapters.length) + ' 大关）');
console.log('='.repeat(72));

bundle.chapters.forEach(function (ch) {
  let refs = 0;
  const lines = [];
  (ch.levels || []).forEach(function (id, i) {
    const L = bundle.levels[id];
    if (!L) {
      problems.push({ level: id, reason: '章节引用了它，但 levels 表里没有这份数据（悬空引用）' });
      lines.push('  ' + pad(i + 1, 2) + '. ' + id + '  ← 数据缺失');
      return;
    }
    refs++; total++;
    if (L.solution) withSol++;

    const a = MP.analyze(L);
    const flags = [];

    if (a.squares !== a.squareGoals) flags.push('正方形 ' + a.squares + ' / 方形目标 ' + a.squareGoals);
    if (a.circles !== a.circleGoals) flags.push('圆形 ' + a.circles + ' / 圆形目标 ' + a.circleGoals);
    if (a.squares + a.circles === 0) flags.push('一个图形都没有');
    if (a.devices === 0) flags.push('一个设备都没有');

    // 同名（同一关重复出现）
    const nameKey = L.name;
    if (seen['name:' + nameKey]) flags.push('关卡名和 ' + seen['name:' + nameKey] + ' 重名');
    else seen['name:' + nameKey] = ch.name + ' 第 ' + (i + 1) + ' 关';

    // 内容完全相同（换汤不换药）
    const sig = JSON.stringify([
      L.w, L.h,
      L.cells.map(c => [c.t, c.goal, c.item ? (c.item.k + '|' + (c.item.type || '') + '|' + (c.item.s || '')) : ''])
    ]);
    if (seen['sig:' + sig]) flags.push('内容和 ' + seen['sig:' + sig] + ' 一模一样');
    else seen['sig:' + sig] = ch.name + ' 第 ' + (i + 1) + ' 关';

    const hard = flags.some(f => /正方形 \d+ \/ 方形目标|圆形 \d+ \/ 圆形目标|一个图形都没有/.test(f));
    if (hard) problems.push({ level: L.name + '（' + id + '）', reason: flags.join('；') });

    lines.push('  ' + pad(i + 1, 2) + '. ' + padRight(L.name, 6) + ' [' + L.w + 'x' + L.h + ']  ' +
      '方 ' + a.squares + '/' + a.squareGoals + ' 圆 ' + a.circles + '/' + a.circleGoals +
      ' 设备 ' + pad(a.devices, 2) + (L.solution ? '  已录解法' : '        ') +
      (flags.length ? '   ← ' + flags.join('；') : ''));
  });

  const dangling = (ch.levels || []).length - refs;
  console.log('');
  console.log('【' + ch.name + '】' + refs + ' 关' + (dangling ? '（另有 ' + dangling + ' 个引用缺数据）' : ''));
  lines.forEach(l => console.log(l));
});

/* 表里有、但没有被任何大关引用的「孤儿关」 */
const refed = {};
bundle.chapters.forEach(c => (c.levels || []).forEach(id => { refed[id] = true; }));
const orphans = Object.keys(bundle.levels).filter(id => !refed[id]);
if (orphans.length) {
  console.log('');
  console.log('【孤儿关】有数据但没被任何大关引用：' + orphans.map(id => (bundle.levels[id].name || id)).join('、'));
  notes.push('存在孤儿关 ' + orphans.length + ' 个');
}

/* ------------------------------------------------------------------ 汇总 */
console.log('');
console.log('='.repeat(72));
console.log('合计 ' + total + ' 关；带解法记录 ' + withSol + ' 关 / 没录 ' + (total - withSol) + ' 关');

if (problems.length) {
  console.log('');
  console.log('❌ 有 ' + problems.length + ' 关数学上不可能通关：');
  problems.forEach(p => console.log('   · ' + p.level + ' —— ' + p.reason));
  console.log('');
  console.log('修法（任选其一，改完重新导出关卡库）：');
  console.log('   · 少图形 → 在空地上补同形状的目标格');
  console.log('   · 多图形 → 删掉多余的图形，或把它的形状换成目标够用的那种');
  console.log('');
  process.exit(1);
}

console.log('✅ 全部关卡数量配平，没有发现结构性死局。');
if (notes.length) notes.forEach(n => console.log('   （提醒：' + n + '）'));
console.log('');
process.exit(0);

/* ------------------------------------------------------------------ 小工具 */
function pad(n, w) { n = String(n); while (n.length < w) n = ' ' + n; return n; }
/** 中文字符按 2 列宽算，让表格对齐 */
function padRight(s, w) {
  s = String(s);
  let len = 0;
  for (const ch of s) len += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  while (len < w) { s += ' '; len++; }
  return s;
}
