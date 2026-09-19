/* =============================================================================
 * 生成示例关卡包 samples/示例关卡包.json
 * -----------------------------------------------------------------------------
 *   node tools/make-sample-bundle.js
 *
 * 两个作用：
 *   1. 给你一份「关卡包长什么样」的参考（结构 = 编辑器「导出整个关卡库」出来的那份）
 *   2. 打包单文件版时可以直接拿它试： build.cmd samples\示例关卡包.json
 *
 * 生成时会**真的把每一关的解法跑一遍**，跑不通就直接报错 —— 保证示例关卡都是可解的。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'js/core.js'));
require(path.join(ROOT, 'js/rules.js'));

const MP = globalThis.MPCore;
const RULES = globalThis.MPRules;

/* map 字符：'#'=墙 '.'=空地 's'=正方形 'c'=圆形 'S'=方形目标 'C'=圆形目标 */
function level(id, name, w, h, map, devices, solution, note) {
  const L = MP.buildLevel({
    id: id, name: name, w: w, h: h, map: map, devices: devices || [],
    solution: solution || [], note: note || '',
  });
  L.chapter = null;
  return L;
}

const LEVELS = [
  /* ---------------- 第一大关：入门 ---------------- */
  level('S1-1', '1-1 推一下', 5, 3, [
    '.....',
    '..sS.',
    '.....',
  ], [{ x: 1, y: 1, type: 'push', s: 'R' }], [[1, 1]], '点一下活塞，把正方形推到右边那一格。'),

  level('S1-2', '1-2 拉过来', 5, 3, [
    '.....',
    '..Cc.',
    '.....',
  ], [{ x: 1, y: 1, type: 'pull', s: 'R' }], [[1, 1]], '拉动活塞隔一格把圆形拉过来。'),

  level('S1-3', '1-3 转一圈', 3, 3, [
    '.s.',
    '..S',
    '...',
  ], [{ x: 1, y: 1, type: 'rotate', s: 'cw' }], [[1, 1]], '旋转器把上面那格转到右边。'),

  level('S1-4', '1-4 左右交换', 5, 3, [
    '.....',
    '.s.S.',
    '.....',
  ], [{ x: 2, y: 1, type: 'swap', s: 'lr' }], [[2, 1]], '交换器把左边的正方形换到右边的目标上。'),

  /* ---------------- 第二大关：机关 ---------------- */
  level('S2-1', '2-1 拐角交换', 5, 5, [
    '.....',
    '..s..',
    '...S.',
    '.....',
    '.....',
  ], [{ x: 2, y: 2, type: 'swap', s: 'u_r' }], [[2, 2]], '上右交换器：把上格的图形换到右格。'),

  level('S2-2', '2-2 对角交换', 5, 5, [
    '.....',
    '.s...',
    '.....',
    '...S.',
    '.....',
  ], [{ x: 2, y: 2, type: 'swap', s: 'ul_dr' }], [[2, 2]], '主对角交换器：左上角换到右下角。'),

  level('S2-3', '2-3 推到底', 6, 3, [
    '......',
    '..s..S',
    '......',
  ], [{ x: 1, y: 1, type: 'spush', s: 'R' }], [[1, 1]], '强力推动活塞：一口气把正方形推到最里面那一格。'),

  level('S2-4', '2-4 转两圈', 4, 3, [
    '.s..',
    '....',
    '.S..',
  ], [{ x: 1, y: 1, type: 'rotate', s: 'cw' }], [[1, 1], [1, 1]], '转两次，正方形会从上格转到下格。'),

  level('S2-5', '2-5 修改器转设备', 6, 3, [
    '......',
    '....sS',
    '......',
  ], [{ x: 1, y: 1, type: 'modifier', s: 'R' }, { x: 3, y: 1, type: 'push', s: 'U' }],
    [[1, 1], [3, 1]], '修改器把右边的活塞从「朝上」转成「朝右」，再点活塞把正方形推上目标。'),

  level('S2-6', '2-6 旋转器换向', 5, 5, [
    '.....',
    '..C..',
    '.....',
    '.....',
    '.....',
  ], [{ x: 2, y: 2, type: 'rotate', s: 'cw' }], [[2, 2]],
    '旋转器会把交换器的交换轴一起转过去：左边那台交换器转上去之后会变成「右斜」。'),
];

/* 2-6：上格放一台交换器、左格放一个圆形（转过去正好落到目标上） */
LEVELS[LEVELS.length - 1].cells[MP.idx(LEVELS[LEVELS.length - 1], 2, 1)].item = MP.device('swap', 'ul_ur');
LEVELS[LEVELS.length - 1].cells[MP.idx(LEVELS[LEVELS.length - 1], 1, 2)].item = { k: 'circle' };

const CHAPTERS = [
  { id: 'SCH1', name: '第一大关 · 入门', levels: ['S1-1', 'S1-2', 'S1-3', 'S1-4'] },
  { id: 'SCH2', name: '第二大关 · 机关', levels: ['S2-1', 'S2-2', 'S2-3', 'S2-4', 'S2-5', 'S2-6'] },
];

/* ---------------------------------------------------------------- 自校验 */
let bad = 0;
const levels = {};
CHAPTERS.forEach(function (ch) {
  ch.levels.forEach(function (id) {
    const L = LEVELS.filter(function (x) { return x.id === id; })[0];
    if (!L) { console.log('✗ 找不到关卡 ' + id); bad++; return; }
    L.chapter = ch.id;
    levels[id] = L;

    /* 把解法跑一遍，必须真的通关 */
    const T = MP.cloneLevel(L);
    let ok = true, why = '';
    (L.solution || []).forEach(function (p, i) {
      const act = RULES.computeAction(T, p[0], p[1]);
      if (!act || !act.ok) { ok = false; why = '第 ' + (i + 1) + ' 步冲突：' + ((act && act.reason) || '这一格没有设备'); return; }
      RULES.applyAll(T, act);
    });
    const win = ok && RULES.isWin(T);
    if (!win) bad++;
    console.log((win ? '✓' : '✗') + ' ' + L.name + '　解法 ' + (L.solution || []).length + ' 步' + (win ? '' : '　' + why));
  });
});

if (bad) { console.error('\n✗ 有 ' + bad + ' 关不可解，示例包没有生成'); process.exit(1); }

const bundle = {
  format: 'mp-level-bundle',
  version: 1,
  name: '示例关卡包',
  exportedAt: new Date().toISOString().slice(0, 10),
  note: '由 tools/make-sample-bundle.js 生成：9 个示例关卡，每一关都自带解法（编辑器里可以一键回放验证）。',
  chapters: CHAPTERS,
  levels: levels,
};

const outDir = path.join(ROOT, 'samples');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, '示例关卡包.json');
fs.writeFileSync(out, JSON.stringify(bundle, null, 1), 'utf8');
console.log('\n✓ 已生成 ' + path.relative(ROOT, out) + '：' + CHAPTERS.length + ' 个大关 / ' + Object.keys(levels).length + ' 关，共 ' +
  (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
