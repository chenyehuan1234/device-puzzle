/* =============================================================================
 * 关卡包（Bundle）单元测试 —— Node 直接跑：node tests/bundle.test.js
 * -----------------------------------------------------------------------------
 * 覆盖：编辑器导出的关卡包结构、解析、导入（副本 / 整包替换）、内置关卡包（seed）
 * 这些都不需要 DOM，所以这里是纯 Node 测试。
 * ========================================================================== */
'use strict';

/* ------------------------------------------------------------ 极简环境 */
const mem = {};
globalThis.localStorage = {
  getItem: function (k) { return k in mem ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
};

require('../js/core.js');
require('../js/rules.js');
require('../js/library.js');

const MP = globalThis.MPCore;
const RULES = globalThis.MPRules;
const Lib = globalThis.MPLibrary;

let pass = 0, failCount = 0;
function ok(c, m) { if (c) pass++; else { failCount++; console.log('  ✗ ' + m); } }
function eq(a, b, m) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) pass++; else { failCount++; console.log('  ✗ ' + m + '  期望 ' + sb + ' 实际 ' + sa); }
}
function group(n) { console.log('\n· ' + n); }

/* ------------------------------------------------------------ 造一库数据 */
const chA = Lib.addChapter('第一大关');
const chB = Lib.addChapter('第二大关');

const l1 = MP.buildLevel({
  id: 'L1', name: '1-1 推一下', w: 5, h: 3,
  map: ['.....', '..sS.', '.....'],
  devices: [{ x: 1, y: 1, type: 'push', s: 'R' }],
  solution: [[1, 1]],
});
l1.chapter = chA; Lib.put(l1);

const l2 = MP.buildLevel({
  id: 'L2', name: '1-2 转一圈', w: 3, h: 3,
  map: ['.s.', '..S', '...'],
  devices: [{ x: 1, y: 1, type: 'rotate', s: 'cw' }],
  solution: [[1, 1]],
});
l2.chapter = chA; Lib.put(l2);

const l3 = MP.buildLevel({
  id: 'L3', name: '2-1 拐角交换', w: 5, h: 5,
  map: ['.....', '..s..', '...S.', '.....', '.....'],
  devices: [{ x: 2, y: 2, type: 'swap', s: 'u_r' }],
  solution: [[2, 2]],
});
l3.chapter = chB; Lib.put(l3);

/* ==========================================================================
 * 1. 导出
 * ======================================================================= */
group('导出关卡包');
{
  const all = Lib.exportBundle();
  eq(all.format, 'mp-level-bundle', '带 format 标记');
  eq(all.version, 1, '版本号 1');
  eq(all.chapters.length, 2, '两个大关都导出了');
  eq(Object.keys(all.levels).length, 3, '三个关卡都导出了');
  eq(all.levels.L1.solution, [[1, 1]], '关卡自带解法');
  eq(all.levels.L1.cells.length, 15, '格子数据完整（5×3）');

  const only = Lib.exportBundle(chB);
  eq(only.chapters.length, 1, '只导出一个大关时 chapters 只有 1 个');
  eq(only.name, '第二大关', '关卡包名字 = 大关名');
  eq(Object.keys(only.levels).length, 1, '只带这个大关的关卡');
  ok(only.levels.L3 && !only.levels.L1, '别的大关的关卡没被带进来');
}

/* ==========================================================================
 * 2. 解析
 * ======================================================================= */
group('解析关卡包');
{
  const b = Lib.exportBundle();
  const r = Lib.parseBundle(JSON.stringify(b));
  ok(!!r.bundle, '能解析自己导出的包');
  eq(r.warnings, [], '没有警告');

  const one = Lib.parseBundle(Lib.serialize(l1));
  ok(!!one.bundle, '单个关卡的 JSON 也能导入（自动包成一个大关）');
  eq(one.bundle.chapters.length, 1, '包成 1 个大关');
  eq(Object.keys(one.bundle.levels).length, 1, '里面 1 个关卡');

  const bad = Lib.parseBundle('这不是 json');
  ok(!bad.bundle && bad.warnings.length > 0, '非 JSON 返回失败而不是抛错');

  const notBundle = Lib.parseBundle('{"hello":1}');
  ok(!notBundle.bundle && notBundle.warnings.length > 0, '不是关卡包会被拒绝');

  const empty = Lib.parseBundle('{"chapters":[{"id":"x","name":"空的","levels":[]}],"levels":{}}');
  ok(!!empty.bundle, '空关卡包结构上合法');
  ok(empty.warnings.length > 0, '但会提示「没有任何关卡」');
}

/* ==========================================================================
 * 3. 导入（副本 / 替换）
 * ======================================================================= */
group('导入关卡包');
{
  const b = Lib.exportBundle();
  const before = Lib.count();
  const beforeCh = Lib.chapters().length;
  const r = Lib.importBundle(b, { asCopy: true });
  eq(r.chapters, 2, '导入 2 个大关');
  eq(r.levels, 3, '导入 3 个关卡');
  eq(Lib.count(), before + 3, '库里多了 3 关');
  eq(Lib.chapters().length, beforeCh + 2, '大关也多了 2 个');
  const copies = Lib.list().filter(function (l) { return l.name === '1-1 推一下'; });
  eq(copies.length, 2, '原来的那一关还在，同时多了一份副本');
  ok(copies[0].id !== copies[1].id, '副本用的是新 id（不会覆盖）');
  const copy = Lib.get(copies.filter(function (c) { return c.id !== 'L1'; })[0].id);
  eq(copy.solution, [[1, 1]], '副本也带着解法');

  /* replace：整包替换（第一次打开单文件版时走的就是这条路） */
  const r2 = Lib.importBundle(Lib.exportBundle(chA), { replace: true });
  eq(r2.levels, 2, '替换导入：2 关');
  eq(Lib.count(), 2, '库里只剩这 2 关');
  eq(Lib.chapters().length, 1, '大关也只剩 1 个');
  ok(!!Lib.get('L1'), 'id 原样保留（这样通关进度也能对上）');
  ok(!Lib.get('L3'), '别的关卡被清掉了');
}

/* ==========================================================================
 * 4. 内置关卡包（window.MP_SEED）
 * ======================================================================= */
group('内置关卡包（单文件版用）');
{
  ok(Lib.seed() === null, '没有 MP_SEED 时 Lib.seed() 返回 null');
  eq(Lib.seedTag(), '', 'seedTag 也是空的');

  globalThis.MP_SEED = {
    format: 'mp-level-bundle', version: 1, name: '示例关卡包', exportedAt: '2026-09-19',
    chapters: [{ id: 'SCH1', name: '内置大关', levels: ['SL1', 'SL2'] }],
    levels: (function () {
      const m = {};
      m.SL1 = MP.buildLevel({ id: 'SL1', name: '内置 1', w: 5, h: 3, map: ['.....', '..sS.', '.....'] });
      m.SL2 = MP.buildLevel({ id: 'SL2', name: '内置 2', w: 5, h: 3, map: ['.....', '..cC.', '.....'] });
      return m;
    })(),
  };
  ok(!!Lib.seed(), 'Lib.seed() 能读到内置包');
  ok(Lib.seedTag().indexOf('示例关卡包') === 0, 'seedTag 形如 包名@日期：' + Lib.seedTag());

  /* 「第一次打开」：库是空的 → 整包装进去 */
  const r = Lib.importBundle(Lib.seed(), { replace: true });
  eq(r.levels, 2, '第一次打开时装进 2 关');
  eq(Lib.count(), 2, '库里就是内置包那 2 关');
  eq(Lib.chapters()[0].name, '内置大关', '大关名字也是包里的');
  ok(!!Lib.get('SL1'), '关卡 id 原样保留');

  Lib.markSeedDone(Lib.seedTag());
  eq(Lib.seedDone(), Lib.seedTag(), '记下「这一包已经装过了」');

  /* 玩家自己加了关卡之后，再打开同一份文件不应该被覆盖 */
  const mine = Lib.blank(5, 3, '我自己画的');
  mine.id = Lib.put(mine);
  eq(Lib.count(), 3, '玩家自己加了一关');
  ok(Lib.seedDone() === Lib.seedTag(), '下次打开时看到标记就不再重复装');
}

/* ==========================================================================
 * 5. 示例关卡包（samples/示例关卡包.json）必须真的可解
 * ======================================================================= */
group('samples/示例关卡包.json');
{
  const fs = require('fs');
  const path = require('path');
  const file = path.resolve(__dirname, '..', 'samples', '示例关卡包.json');
  ok(fs.existsSync(file), '示例关卡包存在（跑 tools/make-sample-bundle.js 生成）');
  if (fs.existsSync(file)) {
    const parsed = Lib.parseBundle(fs.readFileSync(file, 'utf8'));
    ok(!!parsed.bundle, '示例包能被解析');
    let n = 0, bad = 0;
    parsed.bundle.chapters.forEach(function (c) {
      c.levels.forEach(function (id) {
        const L = parsed.bundle.levels[id];
        if (!L) { bad++; return; }
        n++;
        const T = MP.cloneLevel(L);
        let okSteps = true;
        (L.solution || []).forEach(function (p) {
          const act = RULES.computeAction(T, p[0], p[1]);
          if (!act || !act.ok) { okSteps = false; return; }
          RULES.applyAll(T, act);
        });
        if (!okSteps || !RULES.isWin(T)) { bad++; console.log('    ✗ ' + L.name + ' 的解法不通'); }
      });
    });
    ok(n >= 6, '示例包里有 ' + n + ' 关');
    eq(bad, 0, '示例包里每一关的解法都真的能通关');
  }
}

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + failCount + ' 项');
console.log('========================================');
process.exit(failCount ? 1 : 0);
