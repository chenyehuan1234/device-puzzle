/* =============================================================================
 * 机关谜题 — 规则引擎
 * -----------------------------------------------------------------------------
 * 核心原则：所有点击都是「全有或全无」。
 *   computeAction() 只做推演，不修改棋盘；只要有任何冲突就返回 ok:false，
 *   调用方在 ok 时用 applyMoves()/applyStates() 落到棋盘上。
 *   —— 这样「动画层」可以先用 move 列表放动画，动画播完再落状态。
 * ========================================================================== */
(function (root) {
  'use strict';

  const MP = root.MPCore;
  const R = {};
  root.MPRules = R;

  const FLOOR = MP.FLOOR;
  const WALL = MP.WALL;
  const DIRS = MP.DIRS;
  const DEVICES = MP.DEVICES;

  /* --------------------------------------------------------------------------
   * 工具
   * ----------------------------------------------------------------------- */
  function fail(reason, affects) {
    return { ok: false, reason: reason, moves: [], states: [], affects: affects || [] };
  }
  function ok(o) {
    const r = { ok: true, reason: '', moves: [], states: [], affects: [], note: '' };
    if (o) for (const k in o) r[k] = o[k];
    return r;
  }
  /* 沿方向走 k 格 */
  function walk(L, x, y, dir, k) {
    const d = DIRS[dir];
    return MP.at(L, x + d.x * k, y + d.y * k);
  }
  function walkIdx(L, x, y, dir, k) {
    const d = DIRS[dir];
    return MP.idx(L, x + d.x * k, y + d.y * k);
  }

  /* --------------------------------------------------------------------------
   * 推 / 拉 的共用推演
   * ----------------------------------------------------------------------- */
  function computePush(L, x, y, dir, strong) {
    const i1 = walkIdx(L, x, y, dir, 1);
    const c1 = walk(L, x, y, dir, 1);
    const affects = [i1];

    if (!c1) return fail('前方越出棋盘', affects);
    if (c1.t === WALL) return fail('前方是墙', affects);
    if (!c1.item) return fail('前方没有可推动的物品', affects);

    if (!strong) {
      const i2 = walkIdx(L, x, y, dir, 2);
      const c2 = walk(L, x, y, dir, 2);
      affects.push(i2);
      if (!c2) return fail('前方第 2 格越出棋盘', affects);
      if (c2.t === WALL) return fail('前方第 2 格是墙', affects);
      if (c2.item) return fail('前方有 2 个以上物品，普通活塞一次只能推 1 个', affects);
      const moves = [{ from: i1, to: i2, item: c1.item, dist: 1 }];
      return ok({ moves: moves, affects: affects });
    }

    /* 强力推动：把正前方 1 格的物品一直往前推，直到「撞墙 / 碰到任何东西 / 到边界」，
       也就是把它推到能到达的最深处。一路上别的东西都不动。 */
    let k = 2, dest = -1;
    for (;;) {
      const c = walk(L, x, y, dir, k);
      if (!c) { dest = k - 1; break; }
      if (c.t === WALL) { dest = k - 1; break; }
      if (c.item) { dest = k - 1; break; }
      affects.push(walkIdx(L, x, y, dir, k));
      k++;
    }
    if (dest < 2) return fail('前方被挡住，推不动', affects);
    const di = walkIdx(L, x, y, dir, dest);
    return ok({
      moves: [{ from: i1, to: di, item: c1.item, dist: dest - 1, strong: true }],
      affects: affects,
    });
  }

  function computePull(L, x, y, dir, strong) {
    const i1 = walkIdx(L, x, y, dir, 1);
    const c1 = walk(L, x, y, dir, 1);
    const affects = [i1];

    if (!c1) return fail('前方越出棋盘', affects);
    if (c1.t === WALL) return fail('前方是墙', affects);
    if (c1.item) return fail('紧邻的一格被占用，拉不过来', affects);

    if (!strong) {
      const i2 = walkIdx(L, x, y, dir, 2);
      const c2 = walk(L, x, y, dir, 2);
      affects.push(i2);
      if (!c2) return fail('前方第 2 格越出棋盘', affects);
      if (c2.t === WALL) return fail('前方第 2 格是墙', affects);
      if (!c2.item) return fail('前方第 2 格没有物品', affects);
      return ok({ moves: [{ from: i2, to: i1, item: c2.item, dist: 1 }], affects: affects });
    }

    /* 强力拉动：找正前方最近的物品，直接拉到前方 1 格 */
    let k = 2;
    for (;;) {
      const c = walk(L, x, y, dir, k);
      if (!c) return fail('前方没有可拉动的物品', affects);
      if (c.t === WALL) return fail('前方被墙挡住，拉不过来', affects);
      if (c.item) {
        const ik = walkIdx(L, x, y, dir, k);
        affects.push(ik);
        return ok({
          moves: [{ from: ik, to: i1, item: c.item, dist: k - 1, strong: true }],
          affects: affects,
        });
      }
      affects.push(walkIdx(L, x, y, dir, k));
      k++;
    }
  }

  /* --------------------------------------------------------------------------
   * computeAction —— 点击 (x,y) 会发生什么（纯推演）
   * 返回 null 表示这一格没有设备。
   * ----------------------------------------------------------------------- */
  R.computeAction = function (L, x, y) {
    const cell = MP.at(L, x, y);
    if (!cell || !MP.isDevice(cell.item)) return null;
    const me = cell.item;
    const type = me.type;
    const s = me.s;

    switch (type) {

      /* ---------------- 交换器：交换两侧对称的两格（自己不动） ---------------- */
      case 'swap': {
        const pair = MP.SWAP_PAIRS[s];
        const ax = x + pair[0][0], ay = y + pair[0][1];
        const bx = x + pair[1][0], by = y + pair[1][1];
        const A = MP.at(L, ax, ay), B = MP.at(L, bx, by);
        const ia = MP.idx(L, ax, ay), ib = MP.idx(L, bx, by);
        const affects = [ia, ib];
        if (!A || !B) return fail('要交换的两格有一格越出棋盘', affects);
        if (A.t === WALL || B.t === WALL) return fail('要交换的两格有一格是墙', affects);
        if (!A.item && !B.item) return fail('两侧都是空的，没有可交换的东西', affects);
        const moves = [];
        if (A.item) moves.push({ from: ia, to: ib, item: A.item, arc: true });
        if (B.item) moves.push({ from: ib, to: ia, item: B.item, arc: true });
        return ok({ moves: moves, affects: affects });
      }

      /* ---------------- 换向交换器：交换 + 活塞家族反向 ---------------- */
      case 'switch': {
        const pair = s === 'v' ? MP.SWAP_PAIRS.ud : MP.SWAP_PAIRS.lr;
        const ax = x + pair[0][0], ay = y + pair[0][1];
        const bx = x + pair[1][0], by = y + pair[1][1];
        const A = MP.at(L, ax, ay), B = MP.at(L, bx, by);
        const ia = MP.idx(L, ax, ay), ib = MP.idx(L, bx, by);
        const affects = [ia, ib];
        if (!A || !B) return fail('要交换的两格有一格越出棋盘', affects);
        if (A.t === WALL || B.t === WALL) return fail('要交换的两格有一格是墙', affects);
        if (!A.item && !B.item) return fail('两侧都是空的，没有可交换的东西', affects);

        const moves = [];
        const states = [];
        if (A.item) {
          moves.push({ from: ia, to: ib, item: A.item, arc: true });
          if (MP.isPiston(A.item)) states.push({ at: ib, s: MP.reverseState(A.item), from: A.item.s });
        }
        if (B.item) {
          moves.push({ from: ib, to: ia, item: B.item, arc: true });
          if (MP.isPiston(B.item)) states.push({ at: ia, s: MP.reverseState(B.item), from: B.item.s });
        }
        return ok({ moves: moves, states: states, affects: affects });
      }

      /* ---------------- 旋转器：四格整体转一格 ---------------- */
      case 'rotate': {
        const ring = [DIRS.U, DIRS.R, DIRS.D, DIRS.L];
        const idxs = ring.map(function (d) { return MP.idx(L, x + d.x, y + d.y); });
        const cells = ring.map(function (d) { return MP.at(L, x + d.x, y + d.y); });
        if (cells.some(function (c) { return !c; })) return fail('周围四格有一格越出棋盘', idxs);
        if (cells.some(function (c) { return c.t === WALL; })) return fail('周围四格有一格是墙', idxs);

        const moves = [];
        for (let i = 0; i < 4; i++) {
          const src = cells[i];
          if (!src.item) continue;
          const j = (s === 'cw') ? (i + 1) % 4 : (i + 3) % 4;
          moves.push({
            from: idxs[i], to: idxs[j], item: src.item,
            orbit: { cx: x, cy: y, from: i, cw: s === 'cw' },
          });
        }
        return ok({ moves: moves, affects: idxs });
      }

      /* ---------------- 活塞家族 ---------------- */
      case 'push':  return computePush(L, x, y, s, false);
      case 'pull':  return computePull(L, x, y, s, false);
      case 'spush': return computePush(L, x, y, s, true);
      case 'spull': return computePull(L, x, y, s, true);

      case 'vpush': {
        const dir = MP.vpDir(s), mode = MP.vpMode(s);
        const act = (mode === 'push') ? computePush(L, x, y, dir, false)
                                      : computePull(L, x, y, dir, false);
        if (!act.ok) return act;   /* 推不动 / 拉不动 → 不变形 */
        act.states.push({ at: MP.idx(L, x, y), s: MP.vpMake(dir, mode === 'push' ? 'pull' : 'push'), from: s, self: true });
        act.note = '动作成功，切换为' + (mode === 'push' ? '拉' : '推') + '模式';
        return act;
      }

      /* ---------------- 修改器 ---------------- */
      case 'modifier': {
        const d = DIRS[s];
        const affects = [];
        let k = 1, target = null, ti = -1;
        for (;;) {
          const c = walk(L, x, y, s, k);
          if (!c) return fail('前方没有设备', affects);
          const ci = walkIdx(L, x, y, s, k);
          affects.push(ci);
          if (c.t === WALL) return fail('前方被墙挡住', affects);
          if (c.item) { target = c.item; ti = ci; break; }
          k++;
        }
        if (!MP.isDevice(target)) return fail('前方第一个物体不是设备（是' + MP.itemName(target) + '）', affects);
        const def = DEVICES[target.type];
        if (!def || !def.rotate) return fail('该设备无法被旋转', affects);
        return ok({
          states: [{ at: ti, s: def.rotate(target.s), from: target.s, item: target }],
          affects: affects,
          beam: { from: MP.idx(L, x, y), to: ti },
          note: def.name + '：' + def.stateName(target.s) + ' → ' + def.stateName(def.rotate(target.s)),
        });
      }

      default:
        return fail('未知设备：' + type);
    }
  };

  /* --------------------------------------------------------------------------
   * 落子：moves 与 states 分开，方便动画
   * ----------------------------------------------------------------------- */
  R.applyMoves = function (L, act) {
    if (!act || !act.ok) return false;
    (act.moves || []).forEach(function (m) { L.cells[m.from].item = null; });
    (act.moves || []).forEach(function (m) { L.cells[m.to].item = m.item; });
    return true;
  };

  R.applyStates = function (L, act) {
    if (!act) return false;
    (act.states || []).forEach(function (st) {
      const c = L.cells[st.at];
      if (c && c.item) c.item.s = st.s;
    });
    return true;
  };

  R.applyAll = function (L, act) {
    R.applyMoves(L, act);
    R.applyStates(L, act);
    return true;
  };

  /* 点一下：推演 + 落子（无动画时使用） */
  R.activate = function (L, x, y) {
    const act = R.computeAction(L, x, y);
    if (!act) return { ok: false, reason: '这一格没有设备', moves: [], states: [], affects: [] };
    if (act.ok) R.applyAll(L, act);
    return act;
  };

  /* --------------------------------------------------------------------------
   * 通关判定：所有正方形 / 圆形都停在同形状的目标格上
   * ----------------------------------------------------------------------- */
  R.isWin = function (L) {
    let pieces = 0;
    for (let i = 0; i < L.cells.length; i++) {
      const c = L.cells[i];
      if (!c.item) continue;
      if (c.item.k === 'square') { pieces++; if (c.goal !== 'square') return false; }
      else if (c.item.k === 'circle') { pieces++; if (c.goal !== 'circle') return false; }
    }
    return pieces > 0;
  };

  R.misplaced = function (L) {
    return L.cells.filter(function (c) {
      return MP.isPiece(c.item) && c.goal !== c.item.k;
    }).length;
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
