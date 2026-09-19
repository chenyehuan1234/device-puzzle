/* =============================================================================
 * 规则引擎单元测试（Node 运行： node tests/rules.test.js）
 * 只验证机制，不涉及任何关卡设计。
 * ========================================================================== */
'use strict';
require('../js/core.js');
require('../js/rules.js');

const MP = globalThis.MPCore;
const R = globalThis.MPRules;

let pass = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { failCount++; console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { pass++; }
  else { failCount++; console.log('  ✗ ' + msg + '\n      期望 ' + sb + '\n      实际 ' + sa); }
}
function group(name) { console.log('\n· ' + name); }

/* 便捷：读某一格的物品（用字符表示） */
function ch(L, x, y) {
  const c = MP.at(L, x, y);
  if (!c) return 'X';
  if (c.t === MP.WALL) return '#';
  if (!c.item) return '.';
  if (c.item.k === 'square') return 's';
  if (c.item.k === 'circle') return 'c';
  return c.item.type[0].toUpperCase() + (MP.isPiston(c.item) ? '' : '');
}
function row(L, y) {
  let s = '';
  for (let x = 0; x < L.w; x++) s += ch(L, x, y);
  return s;
}
function board(L) {
  const out = [];
  for (let y = 0; y < L.h; y++) out.push(row(L, y));
  return out;
}
/* 在空地上放一个设备 */
function dev(L, x, y, type, s) {
  const c = MP.at(L, x, y);
  c.t = MP.FLOOR; c.item = MP.device(type, s);
  return L;
}
function click(L, x, y) { return R.activate(L, x, y); }

/* 空白 5x5，内部 3x3 可玩，边界是墙 */
function blank(w, h) {
  const L = MP.newLevel(w || 5, h || 5, 't');
  for (let x = 0; x < L.w; x++) { MP.at(L, x, 0).t = MP.WALL; MP.at(L, x, L.h - 1).t = MP.WALL; }
  for (let y = 0; y < L.h; y++) { MP.at(L, 0, y).t = MP.WALL; MP.at(L, L.w - 1, y).t = MP.WALL; }
  return L;
}
function snapshot(L) { return JSON.stringify(L); }

/* ==========================================================================
 * 1. 推动活塞
 * ======================================================================= */
group('推动活塞');
{
  const L = blank();
  MP.at(L, 2, 2).item = { k: 'square' };
  dev(L, 1, 2, 'push', 'R');
  const a = click(L, 1, 2);
  ok(a.ok, '前方 1 个物品、目标格空 → 成功');
  eq(board(L)[2], '#P.s#', '正方形被推 1 格（P=活塞，s=正方形）');
  eq(L.cells[MP.idx(L, 1, 2)].item.s, 'R', '活塞自身不移动、朝向不变');

  // 只能推一格：前面还有物品 → 整体不动
  const L2 = blank();
  MP.at(L2, 2, 2).item = { k: 'square' };
  MP.at(L2, 3, 2).item = { k: 'circle' };
  dev(L2, 1, 2, 'push', 'R');
  const before = snapshot(L2);
  const b = click(L2, 1, 2);
  ok(!b.ok, '前方有 2 个物品 → 失败');
  eq(snapshot(L2), before, '失败时棋盘一格都不变（全有或全无）');

  // 推到墙上
  const L3 = blank();
  MP.at(L3, 2, 2).item = { k: 'square' };
  MP.at(L3, 3, 2).t = MP.WALL;
  dev(L3, 1, 2, 'push', 'R');
  const b3 = snapshot(L3);
  ok(!click(L3, 1, 2).ok, '目标格是墙 → 失败');
  eq(snapshot(L3), b3, '失败时棋盘不变');

  // 前方是空 → 无效果
  const L4 = blank();
  dev(L4, 1, 2, 'push', 'R');
  ok(!click(L4, 1, 2).ok, '前方为空 → 失败');
  // 设备也能被推
  const L5 = blank();
  dev(L5, 2, 2, 'rotate', 'cw');
  dev(L5, 1, 2, 'push', 'R');
  ok(click(L5, 1, 2).ok, '设备可以被活塞推动');
  eq(MP.itemAt(L5, 3, 2).type, 'rotate', '旋转器被推到第 3 格');
}

/* ==========================================================================
 * 2. 强力推动活塞
 * ======================================================================= */
group('强力推动活塞');
{
  const L = blank(7, 3);
  MP.at(L, 2, 1).item = { k: 'square' };
  dev(L, 3, 1, 'spush', 'L');
  ok(click(L, 3, 1).ok, '强力推动成功');
  eq(MP.idx(L, 1, 1), MP.idx(L, 1, 1), '占位');
  ok(MP.itemAt(L, 1, 1) && MP.itemAt(L, 1, 1).k === 'square', '正方形被推到底（撞墙前一格）');

  // 撞到设备停住（设备是「撞墙/碰到设备」里的那个停止条件）
  const L2 = blank(8, 3);
  dev(L2, 2, 1, 'rotate', 'cw');
  MP.at(L2, 5, 1).item = { k: 'square' };
  dev(L2, 6, 1, 'spush', 'L');
  ok(click(L2, 6, 1).ok, '强力推动（前方有设备当挡板）成功');
  eq(MP.itemAt(L2, 3, 1).k, 'square', '停在设备前一格');

  // 前方还有别的东西 → 停在它前面，那个东西不动
  const L3 = blank(8, 3);
  MP.at(L3, 5, 1).item = { k: 'square' };
  MP.at(L3, 3, 1).item = { k: 'circle' };
  dev(L3, 6, 1, 'spush', 'L');
  ok(click(L3, 6, 1).ok, '前方还有物品 → 照样能推，只是停住');
  eq(MP.itemAt(L3, 4, 1).k, 'square', '正方形停在圆形前面一格');
  ok(MP.itemAt(L3, 3, 1).k === 'circle', '挡住它的圆形一动不动');

  // 一格都推不动 → 无效果
  const L4 = blank(8, 3);
  MP.at(L4, 5, 1).item = { k: 'square' };
  MP.at(L4, 4, 1).item = { k: 'circle' };
  dev(L4, 6, 1, 'spush', 'L');
  const b4 = snapshot(L4);
  ok(!click(L4, 6, 1).ok, '紧贴着另一个物品 → 一格都推不动');
  eq(snapshot(L4), b4, '失败时棋盘不变');
}

/* ==========================================================================
 * 3. 拉动活塞
 * ======================================================================= */
group('拉动活塞');
{
  const L = blank(6, 3);
  MP.at(L, 4, 1).item = { k: 'circle' };
  dev(L, 2, 1, 'pull', 'R');
  ok(click(L, 2, 1).ok, '前方 2 格有物品、紧邻格空 → 成功');
  eq(MP.itemAt(L, 3, 1).k, 'circle', '被拉到紧邻格');

  // 紧邻格被占 → 不能拉
  const L2 = blank(6, 3);
  MP.at(L2, 3, 1).item = { k: 'square' };
  MP.at(L2, 4, 1).item = { k: 'circle' };
  dev(L2, 2, 1, 'pull', 'R');
  const b2 = snapshot(L2);
  ok(!click(L2, 2, 1).ok, '紧邻格被占用 → 失败');
  eq(snapshot(L2), b2, '失败时棋盘不变');

  // 不能推：前方 1 格有东西时不会把它推走
  const L3 = blank(6, 3);
  MP.at(L3, 3, 1).item = { k: 'square' };
  dev(L3, 2, 1, 'pull', 'R');
  const b3 = snapshot(L3);
  ok(!click(L3, 2, 1).ok, '拉动活塞不会推动');
  eq(snapshot(L3), b3, '棋盘不变');
}

/* ==========================================================================
 * 4. 强力拉动活塞
 * ======================================================================= */
group('强力拉动活塞');
{
  const L = blank(9, 3);
  MP.at(L, 7, 1).item = { k: 'circle' };
  dev(L, 1, 1, 'spull', 'R');
  ok(click(L, 1, 1).ok, '任意距离最近的物品被拉过来');
  eq(MP.itemAt(L, 2, 1).k, 'circle', '拉到紧邻格');

  // 中间有墙拉不过来
  const L2 = blank(9, 3);
  MP.at(L2, 7, 1).item = { k: 'circle' };
  MP.at(L2, 4, 1).t = MP.WALL;
  dev(L2, 1, 1, 'spull', 'R');
  ok(!click(L2, 1, 1).ok, '中间隔墙 → 失败');

  // 最近的一个：先拉到近的
  const L3 = blank(9, 3);
  MP.at(L3, 4, 1).item = { k: 'circle' };
  MP.at(L3, 7, 1).item = { k: 'square' };
  dev(L3, 1, 1, 'spull', 'R');
  ok(click(L3, 1, 1).ok, '只拉最近的一个');
  ok(MP.itemAt(L3, 2, 1).k === 'circle' && MP.itemAt(L3, 7, 1).k === 'square', '远的没被拉');
}

/* ==========================================================================
 * 5. 旋转器
 * ======================================================================= */
group('旋转器');
{
  const L = blank();
  dev(L, 2, 2, 'rotate', 'cw');
  MP.at(L, 2, 1).item = { k: 'square' };   // 上
  MP.at(L, 3, 2).item = { k: 'circle' };   // 右
  MP.at(L, 2, 3).item = { k: 'square' };   // 下
  MP.at(L, 1, 2).item = { k: 'circle' };   // 左
  ok(click(L, 2, 2).ok, '顺时针旋转成功');
  eq(MP.itemAt(L, 3, 2).k, 'square', '顺时针：上方 → 右方');
  eq(MP.itemAt(L, 2, 3).k, 'circle', '右方 → 下方');
  eq(MP.itemAt(L, 1, 2).k, 'square', '下方 → 左方');
  eq(MP.itemAt(L, 2, 1).k, 'circle', '左方 → 上方');

  const L2 = blank();
  dev(L2, 2, 2, 'rotate', 'ccw');
  MP.at(L2, 2, 1).item = { k: 'square' };
  ok(click(L2, 2, 2).ok, '逆时针旋转成功');
  eq(MP.itemAt(L2, 1, 2).k, 'square', '逆时针：上方 → 左方');

  // 四格中有墙 → 整体不动
  const L3 = blank();
  dev(L3, 2, 2, 'rotate', 'cw');
  MP.at(L3, 2, 1).item = { k: 'square' };
  MP.at(L3, 3, 2).t = MP.WALL;
  const b3 = snapshot(L3);
  ok(!click(L3, 2, 2).ok, '四格中有墙 → 失败');
  eq(snapshot(L3), b3, '失败时棋盘完全不变');

  // 旋转设备本身（设备是可操作对象）
  const L4 = blank(6, 5);
  dev(L4, 2, 2, 'rotate', 'cw');
  dev(L4, 2, 1, 'push', 'R');
  ok(click(L4, 2, 2).ok, '旋转器可以旋转别的设备');
  eq(MP.itemAt(L4, 3, 2).type, 'push', '活塞被转到右方');
  eq(MP.itemAt(L4, 3, 2).s, 'R', '活塞的朝向不随位置改变（要改朝向得用修改器 / 换向交换器）');

  /* ---- 交换器：被旋转器转过去时，它的「交换轴」跟着一起转 ---- */
  const L5 = blank(5, 5);
  dev(L5, 2, 2, 'rotate', 'cw');
  dev(L5, 2, 1, 'swap', 'ul_ur');           /* 上斜（贴着上边的一对） */
  const a5 = click(L5, 2, 2);
  ok(a5.ok, '顺时针转交换器成功');
  eq(MP.itemAt(L5, 3, 2).type, 'swap', '交换器转到右边');
  eq(MP.itemAt(L5, 3, 2).s, 'ur_dr', '顺时针：上斜 → 右斜（交换轴跟着转 90°）');
  eq(a5.states.length, 1, '产生了一个状态变化');
  eq(a5.states[0].at, MP.idx(L5, 3, 2), '状态变化的落点是交换器的新位置');
  eq(a5.states[0].from, 'ul_ur', '带上了旧状态（动画要用）');

  const L6 = blank(5, 5);
  dev(L6, 2, 2, 'rotate', 'ccw');
  dev(L6, 2, 1, 'swap', 'ul_ur');
  const a6 = click(L6, 2, 2);
  eq(MP.itemAt(L6, 1, 2).s, 'ul_dl', '逆时针：上斜 → 左斜（方向相反）');
  eq(a6.states[0].from, 'ul_ur', '逆时针也带旧状态');

  /* 上下 / 左右这种「正交对」转 90° 变成左右 / 上下 */
  const L7 = blank(5, 5);
  dev(L7, 2, 2, 'rotate', 'cw');
  dev(L7, 1, 2, 'swap', 'ud');
  click(L7, 2, 2);
  eq(MP.itemAt(L7, 2, 1).s, 'lr', '顺时针：上下交换器 → 左右交换器');

  /* 十二种状态挨个转一圈都要转得动，而且转四次回到自己 */
  let spinBad = 0;
  MP.SWAP_ORDER.forEach(function (s) {
    let t = s;
    for (let i = 0; i < 4; i++) t = MP.rotateSwap(t, true);
    if (t !== s) spinBad++;
    if (MP.rotateSwap(s, true) === s && s !== '') spinBad++;      /* 至少要变一次 */
    if (MP.rotateSwap(MP.rotateSwap(s, true), false) !== s) spinBad++;
  });
  eq(spinBad, 0, '12 种交换器顺逆时针互逆、转四次回到自己');

  /* 一个环里放两台交换器：两台都要跟着转 */
  const L8 = blank(5, 5);
  dev(L8, 2, 2, 'rotate', 'cw');
  dev(L8, 2, 1, 'swap', 'ud');
  dev(L8, 2, 3, 'swap', 'lr');
  const a8 = click(L8, 2, 2);
  eq(a8.states.length, 2, '两台交换器都产生了状态变化');
  eq(MP.itemAt(L8, 3, 2).s, 'lr', '上面那台转到右边并换向');
  eq(MP.itemAt(L8, 1, 2).s, 'ud', '下面那台转到左边并换向');

  /* 换向交换器 / 修改器这些「非交换器」不被带动（保持原样） */
  const L9 = blank(6, 5);
  dev(L9, 2, 2, 'rotate', 'cw');
  dev(L9, 2, 1, 'switch', 'v');
  dev(L9, 3, 2, 'modifier', 'U');
  const a9 = click(L9, 2, 2);
  eq(a9.states.length, 0, '换向交换器 / 修改器不产生状态变化');
  eq(MP.itemAt(L9, 3, 2).s, 'v', '换向交换器朝向不变');
  eq(MP.itemAt(L9, 2, 3).s, 'U', '修改器朝向不变');
}

/* ==========================================================================
 * 6. 八种交换器
 * ======================================================================= */
group('八种交换器');
{
  function swapTest(state, ax, ay, bx, by) {
    const L = blank(7, 7);
    dev(L, 3, 3, 'swap', state);
    MP.at(L, ax, ay).item = { k: 'square' };
    MP.at(L, bx, by).item = { k: 'circle' };
    const a = click(L, 3, 3);
    return { a: a, L: L, ax: ax, ay: ay, bx: bx, by: by };
  }
  let r;
  r = swapTest('ud', 3, 2, 3, 4);
  ok(r.a.ok && MP.itemAt(r.L, 3, 4).k === 'square' && MP.itemAt(r.L, 3, 2).k === 'circle', 'ud：上↔下');
  r = swapTest('lr', 2, 3, 4, 3);
  ok(r.a.ok && MP.itemAt(r.L, 4, 3).k === 'square' && MP.itemAt(r.L, 2, 3).k === 'circle', 'lr：左↔右');
  r = swapTest('ul_ur', 2, 2, 4, 2);
  ok(r.a.ok && MP.itemAt(r.L, 4, 2).k === 'square' && MP.itemAt(r.L, 2, 2).k === 'circle', 'ul_ur：左上↔右上');
  r = swapTest('dl_dr', 2, 4, 4, 4);
  ok(r.a.ok && MP.itemAt(r.L, 4, 4).k === 'square' && MP.itemAt(r.L, 2, 4).k === 'circle', 'dl_dr：左下↔右下');
  r = swapTest('ul_dl', 2, 2, 2, 4);
  ok(r.a.ok && MP.itemAt(r.L, 2, 4).k === 'square' && MP.itemAt(r.L, 2, 2).k === 'circle', 'ul_dl：左上↔左下');
  r = swapTest('ur_dr', 4, 2, 4, 4);
  ok(r.a.ok && MP.itemAt(r.L, 4, 4).k === 'square' && MP.itemAt(r.L, 4, 2).k === 'circle', 'ur_dr：右上↔右下');
  /* 新增的两种：两条对角线（X 形） */
  r = swapTest('ul_dr', 2, 2, 4, 4);
  ok(r.a.ok && MP.itemAt(r.L, 4, 4).k === 'square' && MP.itemAt(r.L, 2, 2).k === 'circle', 'ul_dr：左上↔右下（主对角）');
  ok(MP.itemAt(r.L, 4, 2) === null && MP.itemAt(r.L, 2, 4) === null, 'ul_dr 不碰另外两个角（右上 / 左下）');
  r = swapTest('dl_ur', 2, 4, 4, 2);
  ok(r.a.ok && MP.itemAt(r.L, 4, 2).k === 'square' && MP.itemAt(r.L, 2, 4).k === 'circle', 'dl_ur：左下↔右上（副对角）');
  ok(MP.itemAt(r.L, 2, 2) === null && MP.itemAt(r.L, 4, 4) === null, 'dl_ur 不碰另外两个角（左上 / 右下）');
  /* 新增的四种「拐角」：夹住设备某个角的两格（上右 / 上左 / 下左 / 下右） */
  r = swapTest('u_r', 3, 2, 4, 3);
  ok(r.a.ok && MP.itemAt(r.L, 4, 3).k === 'square' && MP.itemAt(r.L, 3, 2).k === 'circle', 'u_r：上↔右');
  ok(MP.itemAt(r.L, 2, 3) === null && MP.itemAt(r.L, 3, 4) === null, 'u_r 不碰左边和下边');
  r = swapTest('u_l', 3, 2, 2, 3);
  ok(r.a.ok && MP.itemAt(r.L, 2, 3).k === 'square' && MP.itemAt(r.L, 3, 2).k === 'circle', 'u_l：上↔左');
  r = swapTest('d_l', 3, 4, 2, 3);
  ok(r.a.ok && MP.itemAt(r.L, 2, 3).k === 'square' && MP.itemAt(r.L, 3, 4).k === 'circle', 'd_l：下↔左');
  r = swapTest('d_r', 3, 4, 4, 3);
  ok(r.a.ok && MP.itemAt(r.L, 4, 3).k === 'square' && MP.itemAt(r.L, 3, 4).k === 'circle', 'd_r：下↔右');

  /* 十二种必须是十二个互不相同的方位对 */
  eq(MP.SWAP_ORDER.length, 12, '交换器共 12 种状态');
  eq(MP.DEVICES.swap.states.length, 12, '设备目录里的状态数也是 12');
  {
    const NEI = {};
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx || dy) NEI[dx + ',' + dy] = 1;
      }
    }
    const seen = {};
    let dup = 0, bad = 0, center = 0, corner = 0, edge = 0, odd = 0;
    MP.SWAP_ORDER.forEach(function (s) {
      const p = MP.SWAP_PAIRS[s];
      if (!p) { bad++; return; }
      const k0 = p[0][0] + ',' + p[0][1], k1 = p[1][0] + ',' + p[1][1];
      if (!NEI[k0] || !NEI[k1]) bad++;                       /* 必须是紧邻格 */
      const key = [k0, k1].sort().join('|');
      if (seen[key]) dup++;
      seen[key] = 1;
      const sx = p[0][0] + p[1][0], sy = p[0][1] + p[1][1];
      if (sx === 0 && sy === 0) center++;                                  /* 关于设备中心对称 */
      else if (Math.abs(sx) === 1 && Math.abs(sy) === 1) corner++;         /* 拐角（上和右这种） */
      else if (Math.abs(sx) === 2 || Math.abs(sy) === 2) edge++;           /* 贴着设备一侧 */
      else odd++;
    });
    ok(bad === 0, '每一对都是设备紧邻的两个格子');
    ok(dup === 0, '12 种方位两两不同');
    eq(center, 4, '4 种关于设备中心对称（上下 / 左右 / 两条对角）');
    eq(corner, 4, '4 种拐角（上右 / 上左 / 下左 / 下右）');
    eq(edge, 4, '4 种贴着设备一侧（上斜 / 下斜 / 左斜 / 右斜）');
    eq(odd, 0, '没有奇怪的方位对');
  }

  // 交换器自己不动
  const L = blank(7, 7);
  dev(L, 3, 3, 'swap', 'ud');
  MP.at(L, 3, 2).item = { k: 'square' };
  click(L, 3, 3);
  ok(MP.itemAt(L, 3, 3) && MP.itemAt(L, 3, 3).type === 'swap', '交换器自身不移动');

  // 一侧是墙 → 整体不动
  const L2 = blank(7, 7);
  dev(L2, 3, 3, 'swap', 'lr');
  MP.at(L2, 2, 3).item = { k: 'square' };
  MP.at(L2, 4, 3).t = MP.WALL;
  const b2 = snapshot(L2);
  ok(!click(L2, 3, 3).ok, '要交换的格是墙 → 失败');
  eq(snapshot(L2), b2, '棋盘不变');

  // 两侧都空
  const L3 = blank(5, 5);
  dev(L3, 2, 2, 'swap', 'lr');
  ok(!click(L3, 2, 2).ok, '两侧都空 → 失败');
}

/* ==========================================================================
 * 7. 换向交换器
 * ======================================================================= */
group('换向交换器');
{
  // 上下型：把活塞换到另一侧并反转朝向
  const L = blank(6, 6);
  dev(L, 2, 2, 'switch', 'v');
  dev(L, 2, 1, 'push', 'D');       // 上面：朝下
  ok(click(L, 2, 2).ok, '换向交换成功');
  const it = MP.itemAt(L, 2, 3);
  ok(it && it.type === 'push', '活塞被换到下方');
  eq(it.s, 'U', '活塞朝向反转（D → U）');

  // 左右型
  const L2 = blank(6, 6);
  dev(L2, 2, 2, 'switch', 'h');
  dev(L2, 3, 2, 'spull', 'R');
  ok(click(L2, 2, 2).ok, '左右换向成功');
  eq(MP.itemAt(L2, 1, 2).s, 'L', '强力拉动活塞朝向反转（R → L）');

  // 可变活塞反转时保留推/拉模式
  const L3 = blank(6, 6);
  dev(L3, 2, 2, 'switch', 'v');
  dev(L3, 2, 1, 'vpush', 'R:pull');
  ok(click(L3, 2, 2).ok, '可变活塞换向成功');
  eq(MP.itemAt(L3, 2, 3).s, 'L:pull', '方向反转、模式保持');

  // 非活塞不受影响
  const L4 = blank(6, 6);
  dev(L4, 2, 2, 'switch', 'v');
  dev(L4, 2, 1, 'rotate', 'cw');
  ok(click(L4, 2, 2).ok, '旋转器可以换位');
  eq(MP.itemAt(L4, 2, 3).s, 'cw', '旋转器朝向不被反转');

  // 交换器（1 号）不反转活塞
  const L5 = blank(6, 6);
  dev(L5, 2, 2, 'swap', 'ud');
  dev(L5, 2, 1, 'push', 'D');
  ok(click(L5, 2, 2).ok, '普通交换器交换成功');
  eq(MP.itemAt(L5, 2, 3).s, 'D', '普通交换器不改变活塞朝向');
}

/* ==========================================================================
 * 8. 可变活塞
 * ======================================================================= */
group('可变活塞');
{
  // 推成功 → 变拉
  const L = blank(6, 3);
  MP.at(L, 3, 1).item = { k: 'square' };
  dev(L, 2, 1, 'vpush', 'R:push');
  ok(click(L, 2, 1).ok, '推模式推动成功');
  eq(MP.itemAt(L, 4, 1).k, 'square', '物品被推 1 格');
  eq(MP.itemAt(L, 2, 1).s, 'R:pull', '成功之后切换成拉模式');

  // 拉成功 → 变推
  ok(click(L, 2, 1).ok, '拉模式拉动成功');
  eq(MP.itemAt(L, 3, 1).k, 'square', '物品被拉回来');
  eq(MP.itemAt(L, 2, 1).s, 'R:push', '又切换回推模式');

  // 推不动 → 不变形
  const L2 = blank(6, 3);
  dev(L2, 2, 1, 'vpush', 'R:push');
  const b2 = snapshot(L2);
  ok(!click(L2, 2, 1).ok, '前方没有物品 → 失败');
  eq(snapshot(L2), b2, '推不动时连模式都不变');

  // 拉不动 → 不变形（紧邻被占）
  const L3 = blank(6, 3);
  MP.at(L3, 3, 1).item = { k: 'square' };
  dev(L3, 2, 1, 'vpush', 'R:pull');
  const b3 = snapshot(L3);
  ok(!click(L3, 2, 1).ok, '紧邻被占 → 拉不动');
  eq(snapshot(L3), b3, '拉不动时模式不变');
  eq(MP.itemAt(L3, 2, 1).s, 'R:pull', '仍然是拉模式');
}

/* ==========================================================================
 * 9. 修改器
 * ======================================================================= */
group('修改器');
{
  // 不论距离，改第一个设备
  const L = blank(8, 3);
  dev(L, 1, 1, 'modifier', 'R');
  dev(L, 5, 1, 'push', 'L');
  const a = click(L, 1, 1);
  ok(a.ok, '修改器隔着空格改到了远处设备');
  eq(MP.itemAt(L, 5, 1).s, 'U', '推动活塞 L 顺时针转一格 → U');
  click(L, 1, 1); click(L, 1, 1); click(L, 1, 1);
  eq(MP.itemAt(L, 5, 1).s, 'L', '转 4 次回到原位（U→R→D→L）');

  // 中间隔着物品 → 无效
  const L2 = blank(8, 3);
  dev(L2, 1, 1, 'modifier', 'R');
  MP.at(L2, 3, 1).item = { k: 'square' };
  dev(L2, 5, 1, 'push', 'L');
  const b2 = snapshot(L2);
  ok(!click(L2, 1, 1).ok, '前方第一个物体是正方形 → 失败');
  eq(snapshot(L2), b2, '棋盘不变');

  // 墙挡住
  const L3 = blank(8, 3);
  dev(L3, 1, 1, 'modifier', 'R');
  MP.at(L3, 3, 1).t = MP.WALL;
  dev(L3, 5, 1, 'push', 'L');
  ok(!click(L3, 1, 1).ok, '前方是墙 → 失败');

  // 修改器可以改修改器
  const L4 = blank(8, 3);
  dev(L4, 1, 1, 'modifier', 'R');
  dev(L4, 4, 1, 'modifier', 'D');
  ok(click(L4, 1, 1).ok, '修改器改修改器');
  eq(MP.itemAt(L4, 4, 1).s, 'L', '方向 D 顺时针 → L');

  // 各种设备的顺时针
  const cases = [
    ['push', 'U', 'R'], ['push', 'L', 'U'],
    ['rotate', 'cw', 'ccw'], ['rotate', 'ccw', 'cw'],
    ['switch', 'v', 'h'], ['switch', 'h', 'v'],
    ['swap', 'ud', 'lr'], ['swap', 'lr', 'ud'],
    ['swap', 'ul_ur', 'ur_dr'], ['swap', 'ur_dr', 'dl_dr'],
    ['swap', 'dl_dr', 'ul_dl'], ['swap', 'ul_dl', 'ul_ur'],
    ['swap', 'ul_dr', 'dl_ur'], ['swap', 'dl_ur', 'ul_dr'],
    ['swap', 'u_r', 'd_r'], ['swap', 'd_r', 'd_l'],
    ['swap', 'd_l', 'u_l'], ['swap', 'u_l', 'u_r'],
    ['vpush', 'R:pull', 'D:pull'],
  ];
  cases.forEach(function (cs) {
    const Lx = blank(8, 3);
    dev(Lx, 1, 1, 'modifier', 'R');
    dev(Lx, 4, 1, cs[0], cs[1]);
    click(Lx, 1, 1);
    eq(MP.itemAt(Lx, 4, 1).s, cs[2], '修改器：' + cs[0] + ' ' + cs[1] + ' → ' + cs[2]);
  });
}

/* ==========================================================================
 * 10. 综合：设备被当作操作对象、通关判定
 * ======================================================================= */
group('综合');
{
  // 用强力活塞把「设备」推到底（设备也是可操作对象）
  const L = blank(7, 3);
  dev(L, 2, 1, 'rotate', 'cw');
  dev(L, 1, 1, 'spush', 'R');
  ok(click(L, 1, 1).ok, '强力活塞把旋转器推到底');
  eq(MP.itemAt(L, 5, 1).type, 'rotate', '旋转器停在最右侧（墙前一格）');

  // 通关判定
  const W = MP.newLevel(3, 3, 'w');
  ok(!R.isWin(W), '没有图形 → 不算通关');
  MP.at(W, 1, 1).item = { k: 'square' };
  ok(!R.isWin(W), '正方形不在目标上 → 未通关');
  MP.at(W, 1, 1).goal = 'circle';
  ok(!R.isWin(W), '正方形在圆形目标上 → 未通关');
  MP.at(W, 1, 1).goal = 'square';
  ok(R.isWin(W), '正方形在方形目标上 → 通关');
  MP.at(W, 2, 2).item = { k: 'circle' };
  ok(!R.isWin(W), '还有一个圆形没归位 → 未通关');
  MP.at(W, 2, 2).goal = 'circle';
  ok(R.isWin(W), '全部归位 → 通关');
}

/* ==========================================================================
 * 11. 边界与异常
 * ======================================================================= */
group('边界');
{
  const L = blank(5, 5);
  ok(R.computeAction(L, 0, 0) === null || !R.computeAction(L, 0, 0).ok, '空格子没有动作');
  ok(R.computeAction(L, 1, 1) === null, '点空地返回 null');

  // 竖直方向也不会崩
  const L2 = blank(5, 5);
  MP.at(L2, 1, 2).item = { k: 'circle' };
  dev(L2, 1, 3, 'push', 'U');
  ok(click(L2, 1, 3).ok, '向上推动正常');
  ok(MP.itemAt(L2, 1, 1).k === 'circle', '圆形被向上推 1 格');

  // 棋盘角上的设备
  const L3 = blank(5, 5);
  dev(L3, 1, 1, 'spush', 'U');
  MP.at(L3, 1, 2).t = MP.WALL;
  ok(!click(L3, 1, 1).ok, '角落活塞不会崩');

  // buildLevel 正常
  const L4 = MP.buildLevel({
    name: 'x', w: 6, h: 3,
    map: ['######', '#s.c.#', '######'],
    devices: [{ x: 4, y: 1, type: 'swap', s: 'lr' }],
  });
  ok(MP.at(L4, 1, 1).item.k === 'square', 'buildLevel: 正方形');
  ok(MP.at(L4, 3, 1).item.k === 'circle', 'buildLevel: 圆形');
  ok(MP.at(L4, 4, 1).item.type === 'swap', 'buildLevel: 设备');
  ok(MP.analyze(L4).warnings.length > 0, 'analyze 会给出体检提示');
}

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + failCount + ' 项');
console.log('========================================');
process.exit(failCount ? 1 : 0);
