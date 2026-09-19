/* =============================================================================
 * 机关谜题 — Canvas 渲染层
 * -----------------------------------------------------------------------------
 * 负责：格子 / 墙 / 目标 / 图形 / 设备图标 / 动画中间帧 / 高亮与冲突反馈。
 * 所有设备图标都是程序化绘制，缩放不失真，编辑器调色板复用同一套代码。
 * ========================================================================== */
(function (root) {
  'use strict';

  const MP = root.MPCore;
  const FX = root.MPFx;
  const R = {};
  root.MPRender = R;

  const TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- 调色板 */
  const T = R.THEME = {
    bg: '#0b0e14',
    boardBg: '#121722',
    floorA: '#1a2130',
    floorB: '#161c29',
    grid: '#222b3d',
    wall: '#2c3446',
    wallEdge: '#3c4660',
    wallHatch: 'rgba(255,255,255,0.045)',
    goalSquare: '#38bdf8',
    goalCircle: '#fbbf24',
    matched: '#4ade80',
    ok: '#34d399',
    bad: '#f87171',
    hover: '#e2e8f0',
    sel: '#f8fafc',
    text: '#e6edf7',
  };

  /* ------------------------------------------------------------ 颜色小工具 */
  function hex2rgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const c = hex2rgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function mix(h1, h2, k) {
    const a = hex2rgb(h1), b = hex2rgb(h2);
    const f = function (i) { return Math.round(a[i] + (b[i] - a[i]) * k); };
    return 'rgb(' + f(0) + ',' + f(1) + ',' + f(2) + ')';
  }

  /* ------------------------------------------------------------ 路径小工具 */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  /* 指向 +x 的三角箭头，tip/back 为 x 坐标，half 为半宽 */
  function tri(ctx, tip, back, half, color, dir) {
    d3(ctx, tip, 0, back, half, color, dir || 1);
  }
  function d3(ctx, tip, tipY, back, half, color, dir) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tip, tipY);
    ctx.lineTo(back, tipY - half);
    ctx.lineTo(back, tipY + half);
    ctx.closePath();
    ctx.fill();
  }
  function sparkle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + r * 0.2, y - r * 0.2, x + r, y);
    ctx.quadraticCurveTo(x + r * 0.2, y + r * 0.2, x, y + r);
    ctx.quadraticCurveTo(x - r * 0.2, y + r * 0.2, x - r, y);
    ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.2, x, y - r);
    ctx.fill();
  }

  /* ---------------------------------------------------------------- 视图 */
  R.computeView = function (L, W, H) {
    const pad = 16;
    const cell = Math.max(16, Math.min(
      Math.floor((W - pad * 2) / L.w),
      Math.floor((H - pad * 2) / L.h),
      86
    ));
    const bw = cell * L.w, bh = cell * L.h;
    return {
      cell: cell, bw: bw, bh: bh,
      ox: Math.round((W - bw) / 2),
      oy: Math.round((H - bh) / 2),
      W: W, H: H,
    };
  };

  R.cellCenter = function (view, fx, fy) {
    return {
      cx: view.ox + (fx + 0.5) * view.cell,
      cy: view.oy + (fy + 0.5) * view.cell,
    };
  };

  R.pixelToCell = function (view, px, py) {
    const x = Math.floor((px - view.ox) / view.cell);
    const y = Math.floor((py - view.oy) / view.cell);
    return { x: x, y: y };
  };

  /* ------------------------------------------------------- 设备图标（核心） */
  /* 以 (cx,cy) 为中心画一台设备。opt.rot 是额外旋转（状态变化的过渡角度）。
     注意：设备没有矩形外壳，图标本身就是设备。 */
  R.drawDeviceGlyph = function (ctx, cx, cy, size, type, s, opt) {
    opt = opt || {};
    const def = MP.DEVICES[type];
    if (!def) return;
    /* 可变活塞：跟着当前模式借用推动(绿)/拉动(红)的颜色 */
    let col = def.color;
    if (def.variable) col = (MP.vpMode(s) === 'push') ? MP.DEVICES.push.color : MP.DEVICES.pull.color;

    ctx.save();
    ctx.translate(cx, cy);
    if (opt.rot) ctx.rotate(opt.rot);
    if (opt.scale && opt.scale !== 1) ctx.scale(opt.scale, opt.scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    /* 深色光晕：保证图标压在任何底色 / 其它格子上都看得清 */
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = size * 0.16;

    const dirBased = (def.glyph === 'push' || def.glyph === 'pull' || def.glyph === 'spush' ||
      def.glyph === 'spull' || def.glyph === 'vpush' || def.glyph === 'modifier');
    if (dirBased) {
      const dir = (def.glyph === 'vpush') ? MP.vpDir(s) : s;
      ctx.save();
      ctx.rotate(MP.DIR_ANGLE[dir]);
      drawDirIcon(ctx, size, def, s, col);
      ctx.restore();
    } else {
      drawDirIcon(ctx, size, def, s, col);
    }

    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;

    /* 徽标 */
    const badge = (def.glyph === 'spush' || def.glyph === 'spull') ? '强'
      : def.glyph === 'vpush' ? '变'
        : def.glyph === 'switch' ? '反' : null;
    if (badge && size > 24) {
      const bw = size * 0.32, bh = size * 0.27;
      const bx = size * 0.5 - bw * 0.80, by = size * 0.5 - bh * 0.78;
      rr(ctx, bx, by, bw, bh, bh * 0.35);
      ctx.fillStyle = rgba(col, 0.98);
      ctx.fill();
      ctx.fillStyle = '#0a0d14';
      ctx.font = '600 ' + Math.round(bh * 0.8) + 'px system-ui, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge, bx + bw / 2, by + bh / 2 + bh * 0.04);
    }
    ctx.restore();
  };

  /* 图标本体：局部坐标系里 +x 是「前方」 */
  function drawDirIcon(ctx, s, def, state, col) {
    const g = def.glyph;
    const light = mix(col, '#ffffff', 0.42);

    /* ---- 活塞家族：推动 / 拉动 / 强力推动 / 强力拉动 / 可变活塞 ----
       外形完全一致、箭头永远指向朝向；推=绿、拉=红；
       强力加一道双箭头，可变加一个回转小标记 + 「变」徽标。 */
    if (g === 'push' || g === 'pull' || g === 'spush' || g === 'spull' || g === 'vpush') {
      const strong = (g === 'spush' || g === 'spull');
      const vari = (g === 'vpush');
      /* 后座 */
      ctx.fillStyle = col;
      rr(ctx, -s * 0.46, -s * 0.27, s * 0.13, s * 0.54, s * 0.05);
      ctx.fill();
      /* 杆 */
      ctx.strokeStyle = col;
      ctx.lineWidth = s * 0.11;
      line(ctx, -s * 0.31, 0, s * 0.00, 0);
      /* 箭头 */
      tri(ctx, s * 0.46, s * 0.16, s * 0.21, light);
      if (strong) tri(ctx, s * 0.20, s * -0.02, s * 0.20, rgba(light, 0.92));
      if (vari) {
        /* 回转小标记 = 这台是可变活塞 */
        ctx.strokeStyle = rgba(light, 0.95);
        ctx.lineWidth = s * 0.055;
        ctx.beginPath();
        ctx.arc(-s * 0.16, -s * 0.30, s * 0.10, Math.PI * 0.15, Math.PI * 1.5, false);
        ctx.stroke();
        ctx.save();
        ctx.translate(-s * 0.16 + s * 0.10, -s * 0.30);
        ctx.rotate(-Math.PI / 2);
        tri(ctx, s * 0.07, -s * 0.05, s * 0.06, rgba(light, 0.95));
        ctx.restore();
      }
      return;
    }

    if (g === 'modifier') {
      ctx.strokeStyle = rgba(light, 0.95);
      ctx.lineWidth = s * 0.075;
      line(ctx, s * 0.12, 0, s * 0.28, 0);
      tri(ctx, s * 0.46, s * 0.30, s * 0.16, light);
      sparkle(ctx, -s * 0.14, 0, s * 0.26, rgba(col, 1));
      sparkle(ctx, -s * 0.14, 0, s * 0.12, '#ffffff');
      return;
    }

    if (g === 'rotate') {
      const cw = (state === 'cw');
      const rad = s * 0.31;
      const a0 = cw ? -Math.PI * 0.80 : Math.PI * 0.80;
      const a1 = cw ? Math.PI * 0.60 : -Math.PI * 0.60;
      ctx.strokeStyle = light;
      ctx.lineWidth = s * 0.10;
      ctx.beginPath();
      ctx.arc(0, 0, rad, a0, a1, !cw);
      ctx.stroke();
      const tipA = a1 + (cw ? Math.PI / 2 : -Math.PI / 2);
      ctx.save();
      ctx.rotate(tipA);
      ctx.translate(rad, 0);
      tri(ctx, s * 0.18, -s * 0.07, s * 0.15, light);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.07, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();
      return;
    }

    if (g === 'swap' || g === 'switch') {
      const pair = (g === 'switch')
        ? (state === 'v' ? MP.SWAP_PAIRS.ud : MP.SWAP_PAIRS.lr)
        : MP.SWAP_PAIRS[state];
      drawSwapIcon(ctx, s, pair, col, light);
    }
  }

  /* 交换器：两条指向「要交换的两格」的线段（斜向就是两条斜线段） */
  function drawSwapIcon(ctx, s, pair, col, light) {
    ctx.strokeStyle = light;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const o = pair[i];
      const len = Math.hypot(o[0], o[1]) || 1;
      const ux = o[0] / len, uy = o[1] / len;
      const x0 = ux * s * 0.09, y0 = uy * s * 0.09;
      const x1 = ux * s * 0.29, y1 = uy * s * 0.29;
      ctx.lineWidth = s * 0.11;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.save();
      ctx.translate(x1, y1);
      ctx.rotate(Math.atan2(uy, ux));
      tri(ctx, s * 0.17, 0, s * 0.15, light);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.07, 0, TAU);
    ctx.fillStyle = col;
    ctx.fill();
  }

  /* ------------------------------------------------------------- 图形/目标 */
  function drawSquarePiece(ctx, cx, cy, s) {
    const w = s * 0.60;
    const g = ctx.createLinearGradient(cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2);
    g.addColorStop(0, '#dbeafe');
    g.addColorStop(1, '#60a5fa');
    rr(ctx, cx - w / 2, cy - w / 2, w, w, w * 0.18);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.stroke();
    rr(ctx, cx - w * 0.30, cy - w * 0.30, w * 0.6, w * 0.18, w * 0.08);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }

  function drawCirclePiece(ctx, cx, cy, s) {
    const r = s * 0.30;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.15, cx, cy, r);
    g.addColorStop(0, '#fef3c7');
    g.addColorStop(1, '#fbbf24');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - r * 0.32, cy - r * 0.34, r * 0.22, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
  }

  function drawGoalMarker(ctx, cx, cy, cell, kind) {
    const col = kind === 'square' ? T.goalSquare : T.goalCircle;
    const s = cell * 0.72;
    ctx.save();
    ctx.setLineDash([cell * 0.13, cell * 0.10]);
    ctx.lineWidth = Math.max(1.5, cell * 0.045);
    ctx.strokeStyle = rgba(col, 0.62);
    if (kind === 'square') {
      rr(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.16);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2, 0, TAU);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = rgba(col, 0.07);
    ctx.fill();
  }

  /* 单个物品（图形或设备） */
  R.drawItem = function (ctx, cx, cy, cell, item, opt) {
    opt = opt || {};
    const size = cell * (opt.shrink || 0.94);
    ctx.save();
    ctx.globalAlpha = opt.alpha === undefined ? 1 : opt.alpha;
    if (opt.rot || opt.scale) {
      ctx.translate(cx, cy);
      if (opt.rot) ctx.rotate(opt.rot);
      if (opt.scale && opt.scale !== 1) ctx.scale(opt.scale, opt.scale);
      ctx.translate(-cx, -cy);
    }
    if (item.k === 'square') drawSquarePiece(ctx, cx, cy, size);
    else if (item.k === 'circle') drawCirclePiece(ctx, cx, cy, size);
    else if (MP.isDevice(item)) R.drawDeviceGlyph(ctx, cx, cy, size, item.type, item.s, {});
    ctx.restore();
  };

  /* 设备图标画成一张小 canvas（编辑器调色板 / 帮助面板用） */
  R.makeGlyphCanvas = function (type, s, px) {
    const cv = document.createElement('canvas');
    const dpr = root.devicePixelRatio || 1;
    cv.width = Math.round(px * dpr);
    cv.height = Math.round(px * dpr);
    cv.style.width = px + 'px';
    cv.style.height = px + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R.drawDeviceGlyph(ctx, px / 2, px / 2, px * 0.88, type, s, {});
    return cv;
  };

  R.makePieceCanvas = function (kind, px) {
    const cv = document.createElement('canvas');
    const dpr = root.devicePixelRatio || 1;
    cv.width = Math.round(px * dpr);
    cv.height = Math.round(px * dpr);
    cv.style.width = px + 'px';
    cv.style.height = px + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (kind === 'square') drawSquarePiece(ctx, px / 2, px / 2, px * 0.9);
    if (kind === 'circle') drawCirclePiece(ctx, px / 2, px / 2, px * 0.9);
    return cv;
  };

  /* --------------------------------------------------- 选关卡片上的缩略小地图 */
  /* 一格只用几个像素，所以不画图标外形，用颜色说话：
       地板 = 棋盘格子、目标 = 对应颜色的点、图形 = 亮蓝/亮黄块、设备 = 设备颜色 */
  R.THUMB = { pad: 5 };
  R.makeThumbCanvas = function (L, px) {
    const cv = document.createElement('canvas');
    const dpr = root.devicePixelRatio || 1;
    cv.width = Math.round(px * dpr);
    cv.height = Math.round(px * dpr);
    cv.style.width = px + 'px';
    cv.style.height = 'auto';
    const ctx = cv.getContext('2d');
    if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = R.THUMB.pad;
    const box = px - pad * 2;
    const cell = Math.max(1, Math.min(10, Math.floor(Math.min(box / L.w, box / L.h))));
    const bw = cell * L.w, bh = cell * L.h;
    const ox = Math.round((px - bw) / 2), oy = Math.round((px - bh) / 2);

    ctx.fillStyle = '#0b101a';
    ctx.fillRect(0, 0, px, px);

    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const c = L.cells[MP.idx(L, x, y)];
        const x0 = ox + x * cell, y0 = oy + y * cell;
        /* 地板底色（交错，让棋盘形状看得出来） */
        ctx.fillStyle = ((x + y) % 2 === 0) ? '#1b2231' : '#171d2a';
        ctx.fillRect(x0, y0, cell, cell);

        if (c.t === MP.WALL) { ctx.fillStyle = '#39404f'; ctx.fillRect(x0, y0, cell, cell); continue; }

        /* 目标：细一圈的色环（格子小的时候退化成实心点） */
        if (c.goal) {
          const col = c.goal === 'square' ? T.goalSquare : T.goalCircle;
          if (cell >= 5) {
            ctx.strokeStyle = rgba(col, 0.85);
            ctx.lineWidth = Math.max(1, Math.round(cell * 0.16));
            ctx.strokeRect(x0 + 1.5, y0 + 1.5, cell - 3, cell - 3);
            ctx.fillStyle = rgba(col, 0.18);
            ctx.fillRect(x0 + 1.5, y0 + 1.5, cell - 3, cell - 3);
          } else {
            ctx.fillStyle = rgba(col, 0.9);
            ctx.fillRect(x0, y0 + Math.floor(cell / 2), cell, 1);
          }
        }

        if (!c.item) continue;
        const in2 = Math.max(0, Math.floor(cell * 0.16));
        if (c.item.k === 'square') ctx.fillStyle = '#93c5fd';
        else if (c.item.k === 'circle') ctx.fillStyle = '#fbbf24';
        else if (MP.isDevice(c.item)) {
          const def = MP.DEVICES[c.item.type];
          ctx.fillStyle = def.variable
            ? (MP.vpMode(c.item.s) === 'push' ? MP.DEVICES.push.color : MP.DEVICES.pull.color)
            : def.color;
        } else continue;
        ctx.fillRect(x0 + in2, y0 + in2, Math.max(1, cell - in2 * 2), Math.max(1, cell - in2 * 2));
      }
    }
    return cv;
  };

  /* =========================================================================
   * 主绘制
   * opts = {
   *   fx: MPFx.items,                 // 动画列表
   *   hover: {x,y}|null,              // 悬停格
   *   preview: {affects:[], ok:bool, note:string}|null,
   *   selected: {x,y}|null,
   *   ghost: {x,y,item,ok}|null,      // 编辑器笔刷预览
   *   editor: bool,
   * }
   * ====================================================================== */
  R.draw = function (ctx, L, view, opts) {
    opts = opts || {};
    const fx = opts.fx || [];
    const cell = view.cell;

    /* 背景 */
    ctx.clearRect(0, 0, view.W, view.H);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, view.W, view.H);

    /* 棋盘底 */
    rr(ctx, view.ox - 6, view.oy - 6, view.bw + 12, view.bh + 12, 12);
    ctx.fillStyle = T.boardBg;
    ctx.fill();

    /* ---- 1. 地板 / 目标 ---- */
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const c = L.cells[MP.idx(L, x, y)];
        const p = R.cellCenter(view, x, y);
        const x0 = view.ox + x * cell, y0 = view.oy + y * cell;
        ctx.fillStyle = ((x + y) % 2 === 0) ? T.floorA : T.floorB;
        ctx.fillRect(x0, y0, cell, cell);
        if (c.goal) {
          drawGoalMarker(ctx, p.cx, p.cy, cell, c.goal);
          /* 归位提示：图形与目标一致时给个绿色光环 */
          if (c.item && c.item.k === c.goal) {
            ctx.beginPath();
            ctx.arc(p.cx, p.cy, cell * 0.40, 0, TAU);
            ctx.strokeStyle = rgba(T.matched, 0.55);
            ctx.lineWidth = Math.max(1, cell * 0.03);
            ctx.stroke();
          }
        }
      }
    }

    /* ---- 2. 高亮（推演预览） ---- */
    const hl = opts.preview && opts.preview.affects ? opts.preview : null;
    if (hl) {
      const okc = opts.preview.ok ? T.ok : T.bad;
      opts.preview.affects.forEach(function (i) {
        const q = MP.xyOf(L, i);
        const x0 = view.ox + q.x * cell, y0 = view.oy + q.y * cell;
        ctx.fillStyle = rgba(okc, 0.16);
        ctx.fillRect(x0 + 1, y0 + 1, cell - 2, cell - 2);
        ctx.strokeStyle = rgba(okc, 0.75);
        ctx.lineWidth = Math.max(1.5, cell * 0.035);
        ctx.strokeRect(x0 + 2, y0 + 2, cell - 4, cell - 4);
      });
    }

    /* ---- 3. 墙 ---- */
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const c = L.cells[MP.idx(L, x, y)];
        if (c.t !== MP.WALL) continue;
        const x0 = view.ox + x * cell, y0 = view.oy + y * cell;
        const g = ctx.createLinearGradient(x0, y0, x0, y0 + cell);
        g.addColorStop(0, T.wallEdge);
        g.addColorStop(1, T.wall);
        ctx.fillStyle = g;
        ctx.fillRect(x0, y0, cell, cell);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, cell, cell);
        ctx.clip();
        ctx.strokeStyle = T.wallHatch;
        ctx.lineWidth = Math.max(1, cell * 0.05);
        for (let k = -cell; k < cell * 2; k += cell * 0.28) {
          line(ctx, x0 + k, y0 + cell, x0 + k + cell, y0);
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, cell - 1, cell - 1);
      }
    }

    /* ---- 4. 动画准备 ---- */
    const stateFx = new Map();
    const flying = new Set();
    const covered = new Set();   /* 被 place/press/reject 特效单独重画的格子，静态层不要再画一遍 */
    fx.forEach(function (f) {
      if (f.kind === 'state') stateFx.set(f.item, f);
      if (f.kind === 'move') flying.add(f.item);
      if ((f.kind === 'place' || f.kind === 'press' || f.kind === 'reject') && f.at) {
        covered.add(f.at.x + ',' + f.at.y);
      }
    });
    function extraFor(item) {
      const f = stateFx.get(item);
      if (!f) return null;
      if (f.modeSwap) {
        return { glyph: f.t >= 0.5 ? f.toS : f.fromS, scale: 1 + 0.14 * Math.sin(Math.PI * f.t) };
      }
      const e = FX.ease.inOutCubic(f.t);
      return { rot: f.delta * (e - 1) };
    }

    /* ---- 5. 静态物品 ---- */
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const c = L.cells[MP.idx(L, x, y)];
        if (!c.item || flying.has(c.item) || covered.has(x + ',' + y)) continue;
        const p = R.cellCenter(view, x, y);
        const ex = extraFor(c.item);
        const opt = { rot: ex && ex.rot, scale: ex && ex.scale };
        if (ex && ex.glyph) opt.glyphOverride = ex.glyph;
        R.drawItem(ctx, p.cx, p.cy, cell, withGlyph(c.item, ex), opt);
      }
    }

    /* ---- 6. 动画中的物品 ---- */
    fx.forEach(function (f) {
      if (f.kind !== 'move' || f.t <= 0) return;
      const e = (f.ease || FX.ease.inOutCubic)(f.t);
      const pos = f.pos(e);
      const p = R.cellCenter(view, pos.x, pos.y);
      const ex = extraFor(f.item);
      const rot = (ex && ex.rot) || (f.rotFn ? f.rotFn(e) : 0);
      const opt = { rot: rot, alpha: 1 };
      const item = withGlyph(f.item, ex);
      if (f.trail) {
        for (let k = 3; k >= 1; k--) {
          const tt = Math.max(0, e - 0.11 * k);
          const q = R.cellCenter(view, f.pos(tt).x, f.pos(tt).y);
          R.drawItem(ctx, q.cx, q.cy, cell, item, { alpha: 0.10 * (4 - k), rot: rot });
        }
      }
      R.drawItem(ctx, p.cx, p.cy, cell, item, opt);
    });

    /* ---- 7. 修改器光束 ---- */
    fx.forEach(function (f) {
      if (f.kind !== 'beam' || f.t <= 0) return;
      const a = R.cellCenter(view, f.from.x, f.from.y);
      const b = R.cellCenter(view, f.to.x, f.to.y);
      const env = Math.sin(Math.PI * Math.min(1, f.t));
      const col = '#e879f9';
      const g = ctx.createLinearGradient(a.cx, a.cy, b.cx, b.cy);
      g.addColorStop(0, rgba(col, 0.15 * env));
      g.addColorStop(0.5, rgba(col, 0.85 * env));
      g.addColorStop(1, rgba('#ffffff', 0.95 * env));
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(2, cell * 0.13 * env);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(b.cx, b.cy);
      ctx.stroke();

      const t = Math.min(1, f.t / 0.6);
      const hx = a.cx + (b.cx - a.cx) * t, hy = a.cy + (b.cy - a.cy) * t;
      ctx.beginPath();
      ctx.arc(hx, hy, cell * 0.13, 0, TAU);
      ctx.fillStyle = rgba('#ffffff', 0.9 * env);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(b.cx, b.cy, cell * (0.30 + 0.22 * f.t), 0, TAU);
      ctx.strokeStyle = rgba(col, 0.7 * (1 - f.t));
      ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.stroke();
    });

    /* ---- 8. 冲突抖动 + 红闪 ---- */
    fx.forEach(function (f) {
      if (f.kind === 'reject' && f.t > 0) {
        const p = R.cellCenter(view, f.at.x, f.at.y);
        const damp = (1 - f.t) * cell * 0.10;
        const dx = Math.sin(f.t * Math.PI * 8) * damp;
        const c = L.cells[MP.idx(L, f.at.x, f.at.y)];
        if (c.item) {
          const ex = extraFor(c.item);
          R.drawItem(ctx, p.cx + dx, p.cy, cell, withGlyph(c.item, ex),
            { rot: Math.sin(f.t * Math.PI * 8) * 0.05 * (1 - f.t) });
        }
        (f.affects || []).forEach(function (i) {
          const q = MP.xyOf(L, i);
          const x0 = view.ox + q.x * cell, y0 = view.oy + q.y * cell;
          ctx.fillStyle = rgba(T.bad, 0.30 * (1 - f.t));
          ctx.fillRect(x0 + 1, y0 + 1, cell - 2, cell - 2);
        });
      }
      if (f.kind === 'press' && f.t > 0) {
        const p = R.cellCenter(view, f.at.x, f.at.y);
        const c = L.cells[MP.idx(L, f.at.x, f.at.y)];
        if (c.item) {
          const k = 1 - 0.10 * Math.sin(Math.PI * f.t);
          /* 按下的同时可能还在转（可变活塞变形 / 修改器改它自己）：把状态过渡一起画上，
             否则静态层被 covered 跳过之后，这一格就丢掉了旋转动画 */
          const ex = extraFor(c.item);
          R.drawItem(ctx, p.cx, p.cy, cell, withGlyph(c.item, ex), { scale: k, rot: ex && ex.rot });
        }
      }
      if (f.kind === 'place' && f.t > 0) {
        /* 编辑器的落笔：旧内容虚化淡出 → 新内容从小放大淡入 → 一圈柔光扩散。
           以前是「旧的瞬间消失、新的硬弹出来」，所以看着很突兀。 */
        const p = R.cellCenter(view, f.at.x, f.at.y);
        const c = L.cells[MP.idx(L, f.at.x, f.at.y)];
        const e = FX.ease.outCubic(f.t);
        const canBlur = ('filter' in ctx);

        if (f.prev) {
          ctx.save();
          if (canBlur) ctx.filter = 'blur(' + (2.6 * (1 - e)).toFixed(2) + 'px)';
          R.drawItem(ctx, p.cx, p.cy, cell, f.prev, { alpha: 0.85 * (1 - e), scale: 1 - 0.12 * e });
          ctx.restore();
        }
        if (c && c.item) {
          const k = 0.88 + 0.12 * FX.ease.outBack(e);
          ctx.save();
          if (canBlur && f.prev) ctx.filter = 'blur(' + (1.8 * (1 - e)).toFixed(2) + 'px)';
          R.drawItem(ctx, p.cx, p.cy, cell, c.item, { scale: k, alpha: Math.min(1, 0.25 + e * 1.6) });
          ctx.restore();
        }
        /* 柔光扩散环 */
        const env = Math.sin(Math.PI * Math.min(1, f.t));
        if (env > 0.01) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(p.cx, p.cy, cell * (0.30 + 0.28 * e), 0, TAU);
          ctx.strokeStyle = rgba(f.prev ? T.bad : T.ok, 0.30 * env);
          ctx.lineWidth = Math.max(1, cell * 0.05 * env);
          ctx.stroke();
          ctx.restore();
        }
      }
    });

    /* ---- 9. 编辑器：笔刷幽灵 / 选中框 / 悬停框 ---- */
    if (opts.ghost) {
      const p = R.cellCenter(view, opts.ghost.x, opts.ghost.y);
      ctx.save();
      ctx.globalAlpha = 0.5;
      if (opts.ghost.item) R.drawItem(ctx, p.cx, p.cy, cell, opts.ghost.item, {});
      ctx.restore();
      const x0 = view.ox + opts.ghost.x * cell, y0 = view.oy + opts.ghost.y * cell;
      ctx.strokeStyle = rgba(T.sel, 0.9);
      ctx.lineWidth = Math.max(1.5, cell * 0.04);
      ctx.strokeRect(x0 + 2, y0 + 2, cell - 4, cell - 4);
    }

    if (opts.selected) {
      const x0 = view.ox + opts.selected.x * cell, y0 = view.oy + opts.selected.y * cell;
      ctx.save();
      ctx.setLineDash([cell * 0.16, cell * 0.12]);
      ctx.strokeStyle = rgba(T.sel, 0.85);
      ctx.lineWidth = Math.max(1.5, cell * 0.04);
      ctx.strokeRect(x0 + 2, y0 + 2, cell - 4, cell - 4);
      ctx.restore();
    }

    if (opts.hover && !opts.ghost) {
      const x0 = view.ox + opts.hover.x * cell, y0 = view.oy + opts.hover.y * cell;
      ctx.strokeStyle = rgba(T.hover, 0.55);
      ctx.lineWidth = Math.max(1, cell * 0.03);
      ctx.strokeRect(x0 + 1.5, y0 + 1.5, cell - 3, cell - 3);
    }
  };

  /* 状态过渡时用另一个状态字符串绘制（可变活塞推↔拉） */
  function withGlyph(item, ex) {
    if (ex && ex.glyph) return { k: 'device', type: item.type, s: ex.glyph };
    return item;
  }

})(typeof globalThis !== 'undefined' ? globalThis : window);
