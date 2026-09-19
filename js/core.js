/* =============================================================================
 * 机关谜题 (Device Puzzle) — 核心数据模型 / 设备目录
 * -----------------------------------------------------------------------------
 * 本文件只有数据与工具函数，不依赖 DOM，可直接在 Node 中 require 做单元测试。
 * 所有对外接口挂在 globalThis.MPCore 上（浏览器里即 window.MPCore）。
 * ========================================================================== */
(function (root) {
  'use strict';

  const MP = {};
  root.MPCore = MP;

  MP.VERSION = '0.4.0';

  /* ---------------------------------------------------------------------------
   * 1. 基础常量
   * ------------------------------------------------------------------------ */
  MP.FLOOR = 0;
  MP.WALL = 1;

  /* 方向：屏幕坐标系，y 向下 */
  MP.DIRS = {
    U: { x: 0, y: -1 },
    R: { x: 1, y: 0 },
    D: { x: 0, y: 1 },
    L: { x: -1, y: 0 },
  };
  MP.DIR_LIST = ['U', 'R', 'D', 'L'];
  MP.DIR_NAME = { U: '上', R: '右', D: '下', L: '左' };
  MP.OPPOSITE = { U: 'D', D: 'U', L: 'R', R: 'L' };
  /* 朝向对应的图标角度（弧度，0 = 指向右） */
  MP.DIR_ANGLE = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };

  MP.nextDirCW = function (d) { return MP.DIR_LIST[(MP.DIR_LIST.indexOf(d) + 1) % 4]; };
  MP.nextDirCCW = function (d) { return MP.DIR_LIST[(MP.DIR_LIST.indexOf(d) + 3) % 4]; };

  /* ---------------------------------------------------------------------------
   * 2. 交换器的 12 种情形
   *    每个交换器交换「相对自己中心对称的两格」，设备自身不动。
   *    ── 穿过设备中心（对称）──
   *    ud    : 上 ↔ 下
   *    lr    : 左 ↔ 右
   *    ul_dr : 左上 ↔ 右下      （主对角线，X 形）
   *    dl_ur : 左下 ↔ 右上      （副对角线，X 形）
   *    ── 拐角（夹住设备某个角的两格）──
   *    u_r   : 上 ↔ 右          （夹住右上角）
   *    u_l   : 上 ↔ 左          （夹住左上角）
   *    d_l   : 下 ↔ 左          （夹住左下角）
   *    d_r   : 下 ↔ 右          （夹住右下角）
   *    ── 贴着设备某条边（同一侧的两个角）──
   *    ul_ur : 左上 ↔ 右上
   *    dl_dr : 左下 ↔ 右下
   *    ul_dl : 左上 ↔ 左下
   *    ur_dr : 右上 ↔ 右下
   * ------------------------------------------------------------------------ */
  MP.SWAP_PAIRS = {
    ud:    [[0, -1], [0, 1]],
    lr:    [[-1, 0], [1, 0]],
    u_r:   [[0, -1], [1, 0]],
    u_l:   [[0, -1], [-1, 0]],
    d_l:   [[0, 1], [-1, 0]],
    d_r:   [[0, 1], [1, 0]],
    ul_ur: [[-1, -1], [1, -1]],
    dl_dr: [[-1, 1], [1, 1]],
    ul_dl: [[-1, -1], [-1, 1]],
    ur_dr: [[1, -1], [1, 1]],
    ul_dr: [[-1, -1], [1, 1]],
    dl_ur: [[-1, 1], [1, -1]],
  };
  MP.SWAP_ORDER = [
    'ud', 'lr',                                  /* 上下 / 左右 */
    'u_r', 'u_l', 'd_l', 'd_r',                  /* 四个拐角 */
    'ul_ur', 'dl_dr', 'ul_dl', 'ur_dr',          /* 贴着四条边 */
    'ul_dr', 'dl_ur',                            /* 两条对角线 */
  ];
  MP.SWAP_NAME = {
    ud: '上下交换',
    lr: '左右交换',
    u_r: '上右（上↔右）',
    u_l: '上左（上↔左）',
    d_l: '下左（下↔左）',
    d_r: '下右（下↔右）',
    ul_ur: '上斜（左上↔右上）',
    dl_dr: '下斜（左下↔右下）',
    ul_dl: '左斜（左上↔左下）',
    ur_dr: '右斜（右上↔右下）',
    ul_dr: '主对角（左上↔右下）',
    dl_ur: '副对角（左下↔右上）',
  };
  /* 顺时针转 90° 后变成哪种交换器（修改器用）——是真实的几何旋转 */
  MP.SWAP_CW = {
    ud: 'lr', lr: 'ud',
    u_r: 'd_r', d_r: 'd_l', d_l: 'u_l', u_l: 'u_r',
    ul_ur: 'ur_dr', ur_dr: 'dl_dr', dl_dr: 'ul_dl', ul_dl: 'ul_ur',
    ul_dr: 'dl_ur', dl_ur: 'ul_dr',
  };

  /* 可变活塞状态字符串："方向:模式"，例如 "R:push" / "U:pull" */
  MP.vpDir = function (s) { return String(s).split(':')[0]; };
  MP.vpMode = function (s) { return String(s).split(':')[1]; };
  MP.vpMake = function (d, m) { return d + ':' + m; };

  /* ---------------------------------------------------------------------------
   * 3. 设备目录（新增设备只需要在这里加一条 + rules.js 里加一个分支）
   * ------------------------------------------------------------------------ */
  const D = {};
  MP.DEVICES = D;

  D.push = {
    key: 'push', name: '推动活塞', color: '#34d399', glyph: 'push', piston: true,
    tip: '把正前方 1 格的物品向前推 1 格。前方第 2 格被占用或是墙 → 整体不动（一次只能推一个物品）。',
    states: MP.DIR_LIST.slice(),
    stateName: function (s) { return MP.DIR_NAME[s]; },
    rotate: MP.nextDirCW,
  };

  D.pull = {
    key: 'pull', name: '拉动活塞', color: '#ef4444', glyph: 'pull', piston: true,
    tip: '把正前方 2 格的物品拉到正前方 1 格。紧邻格被占用则整体不动。它不能推动任何东西。',
    states: MP.DIR_LIST.slice(),
    stateName: function (s) { return MP.DIR_NAME[s]; },
    rotate: MP.nextDirCW,
  };

  D.spush = {
    key: 'spush', name: '强力推动活塞', color: '#22c55e', glyph: 'spush', piston: true, strong: true,
    tip: '把正前方 1 格的物品一直推，撞到任何东西（墙 / 设备 / 图形 / 边界）就停在它前面；一路上别的东西都不动。',
    states: MP.DIR_LIST.slice(),
    stateName: function (s) { return MP.DIR_NAME[s]; },
    rotate: MP.nextDirCW,
  };

  D.spull = {
    key: 'spull', name: '强力拉动活塞', color: '#dc2626', glyph: 'spull', piston: true, strong: true,
    tip: '把正前方任意距离上最近的物品直接拉到正前方 1 格。中间隔着墙则整体不动。',
    states: MP.DIR_LIST.slice(),
    stateName: function (s) { return MP.DIR_NAME[s]; },
    rotate: MP.nextDirCW,
  };

  D.vpush = {
    key: 'vpush', name: '可变活塞', color: '#f472b6', glyph: 'vpush', piston: true, variable: true,
    tip: '推模式时等同推动活塞，拉模式时等同拉动活塞。只有当前动作能成功时才切换模式：推不动 / 拉不动时点击它不会有任何变化。',
    states: MP.DIR_LIST.reduce(function (a, d) { return a.concat([d + ':push', d + ':pull']); }, []),
    stateName: function (s) { return MP.DIR_NAME[MP.vpDir(s)] + (MP.vpMode(s) === 'push' ? '·推' : '·拉'); },
    rotate: function (s) { return MP.nextDirCW(MP.vpDir(s)) + ':' + MP.vpMode(s); },
  };

  D.swap = {
    key: 'swap', name: '交换器', color: '#38bdf8', glyph: 'swap',
    tip: '交换两侧那两格里的物品，自身不动。共 12 种：上下 / 左右 / 四个拐角（上右·上左·下左·下右）/ 贴四条边 / 两条对角线。',
    states: MP.SWAP_ORDER.slice(),
    stateName: function (s) { return MP.SWAP_NAME[s]; },
    rotate: function (s) { return MP.SWAP_CW[s]; },
  };

  D.switch = {
    key: 'switch', name: '换向交换器', color: '#a78bfa', glyph: 'switch', flips: true,
    tip: '和交换器一样交换上下（或左右）两格，但被换位置的活塞家族设备朝向会反转。',
    states: ['v', 'h'],
    stateName: function (s) { return s === 'v' ? '上下' : '左右'; },
    rotate: function (s) { return s === 'v' ? 'h' : 'v'; },
  };

  D.rotate = {
    key: 'rotate', name: '旋转器', color: '#fbbf24', glyph: 'rotate',
    tip: '把上下左右四格的内容整体转一格（顺时针 / 逆时针）。四格中有墙或越界 → 整体不动。',
    states: ['cw', 'ccw'],
    stateName: function (s) { return s === 'cw' ? '顺时针' : '逆时针'; },
    rotate: function (s) { return s === 'cw' ? 'ccw' : 'cw'; },
  };

  D.modifier = {
    key: 'modifier', name: '修改器', color: '#e879f9', glyph: 'modifier',
    tip: '沿朝向一直找第一个物体：如果它是设备，就顺时针把它转一格；如果是墙 / 正方形 / 圆形则点击无效。修改器也能改修改器。',
    states: MP.DIR_LIST.slice(),
    stateName: function (s) { return MP.DIR_NAME[s]; },
    rotate: MP.nextDirCW,
  };

  /* 编辑器里的设备排列顺序 */
  MP.DEVICE_ORDER = ['push', 'pull', 'spush', 'spull', 'vpush', 'swap', 'switch', 'rotate', 'modifier'];

  MP.device = function (type, s) {
    if (s === undefined || s === null) s = D[type].states[0];
    return { k: 'device', type: type, s: s };
  };

  MP.isDevice = function (item) { return !!item && item.k === 'device'; };
  MP.isPiece = function (item) { return !!item && (item.k === 'square' || item.k === 'circle'); };
  MP.isPiston = function (item) { return MP.isDevice(item) && !!D[item.type].piston; };
  MP.deviceDef = function (item) { return MP.isDevice(item) ? D[item.type] : null; };

  /* 换向交换器让活塞家族反向 */
  MP.reverseState = function (item) {
    const def = D[item.type];
    if (!def || !def.piston) return item.s;
    if (def.variable) return MP.vpMake(MP.OPPOSITE[MP.vpDir(item.s)], MP.vpMode(item.s));
    return MP.OPPOSITE[item.s];
  };

  /* 修改器把设备顺时针转一格 */
  MP.rotateState = function (type, s) { return D[type].rotate(s); };

  /* ---------------------------------------------------------------------------
   * 4. 关卡数据结构
   *    {
   *      id, name, w, h,
   *      cells: [ { t:0|1, goal:null|'square'|'circle', item:null|{...} }, ... ]  // 行优先
   *      note, solution
   *    }
   * ------------------------------------------------------------------------ */
  MP.newLevel = function (w, h, name) {
    const cells = [];
    for (let i = 0; i < w * h; i++) cells.push({ t: MP.FLOOR, goal: null, item: null });
    return { id: null, name: name || '未命名关卡', w: w, h: h, note: '', cells: cells, solution: null };
  };

  MP.cloneLevel = function (L) { return JSON.parse(JSON.stringify(L)); };

  MP.inBounds = function (L, x, y) { return x >= 0 && y >= 0 && x < L.w && y < L.h; };
  MP.idx = function (L, x, y) { return y * L.w + x; };
  MP.at = function (L, x, y) { return MP.inBounds(L, x, y) ? L.cells[y * L.w + x] : null; };
  MP.itemAt = function (L, x, y) { const c = MP.at(L, x, y); return c ? c.item : null; };
  MP.xyOf = function (L, i) { return { x: i % L.w, y: Math.floor(i / L.w) }; };

  /* 由 ASCII 地图 + 设备列表构建关卡
   *   '#'=墙  '.'/' '=空地  's'=正方形  'c'=圆形  'S'=方形目标  'C'=圆形目标
   *   devices: [{x, y, type, s}]
   */
  MP.buildLevel = function (spec) {
    const L = MP.newLevel(spec.w, spec.h, spec.name);
    L.id = spec.id || null;
    L.note = spec.note || '';
    L.solution = spec.solution ? spec.solution.map(function (p) { return p.slice(); }) : null;
    for (let y = 0; y < L.h; y++) {
      const row = (spec.map && spec.map[y]) || '';
      for (let x = 0; x < L.w; x++) {
        const ch = row[x] || '.';
        const c = L.cells[MP.idx(L, x, y)];
        if (ch === '#') c.t = MP.WALL;
        else if (ch === 's') c.item = { k: 'square' };
        else if (ch === 'c') c.item = { k: 'circle' };
        else if (ch === 'S') c.goal = 'square';
        else if (ch === 'C') c.goal = 'circle';
      }
    }
    (spec.devices || []).forEach(function (d) {
      const c = L.cells[MP.idx(L, d.x, d.y)];
      c.t = MP.FLOOR;
      c.item = MP.device(d.type, d.s);
    });
    return L;
  };

  /* 统计信息 + 关卡体检（编辑器用） */
  MP.analyze = function (L) {
    let squares = 0, circles = 0, squareGoals = 0, circleGoals = 0, devices = 0, walls = 0;
    L.cells.forEach(function (c) {
      if (c.t === MP.WALL) walls++;
      if (c.goal === 'square') squareGoals++;
      if (c.goal === 'circle') circleGoals++;
      if (c.item && c.item.k === 'square') squares++;
      if (c.item && c.item.k === 'circle') circles++;
      if (MP.isDevice(c.item)) devices++;
    });
    const warnings = [];
    if (squares !== squareGoals) warnings.push('正方形 ' + squares + ' 个，方形目标 ' + squareGoals + ' 个（数量不一致）');
    if (circles !== circleGoals) warnings.push('圆形 ' + circles + ' 个，圆形目标 ' + circleGoals + ' 个（数量不一致）');
    if (squares + circles === 0) warnings.push('没有放置任何正方形 / 圆形，无法通关');
    if (devices === 0) warnings.push('没有放置任何设备');
    return {
      squares: squares, circles: circles,
      squareGoals: squareGoals, circleGoals: circleGoals,
      devices: devices, walls: walls,
      warnings: warnings,
    };
  };

  MP.itemName = function (item) {
    if (!item) return '空';
    if (item.k === 'square') return '正方形';
    if (item.k === 'circle') return '圆形';
    const def = D[item.type];
    return def ? def.name + '·' + def.stateName(item.s) : '设备';
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
