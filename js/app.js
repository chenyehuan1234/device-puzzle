/* =============================================================================
 * 机关谜题 — 主程序
 * -----------------------------------------------------------------------------
 * 职责：
 *   1. 游玩模式：点击设备 → 推演 → 落子 → 播动画 → 判定通关
 *   2. 关卡编辑器：笔刷绘制、尺寸、存档、导入导出、体检、试玩
 *   3. 渲染循环 / 输入 / 悬停推演 / 提示
 * 规则全部来自 MPRules，本文件只负责「表现」与「编排」。
 * ========================================================================== */
(function (root) {
  'use strict';

  const MP = root.MPCore;
  const RULES = root.MPRules;
  const FX = root.MPFx;
  const SFX = root.MPSfx;
  const R = root.MPRender;
  const Lib = root.MPLibrary;
  const doc = root.document;

  /* 音效是可选模块（Node 里也有，但没声卡就全部空操作）。
     画笔类音效做个 55ms 节流：右键快速拖动擦一整排时不会变成一串噪音。 */
  let lastPaintSfx = 0;
  function sound(name) {
    if (!SFX) return;
    const t = Date.now();
    if ((name === 'place' || name === 'erase' || name === 'tick') && t - lastPaintSfx < 55) return;
    if (name === 'place' || name === 'erase' || name === 'tick') lastPaintSfx = t;
    try { SFX.play(name); } catch (e) {}
  }
  /* 触发一次的设备 → 用哪个音色 */
  const DEVICE_SOUND = {
    push: 'push', spush: 'push', pull: 'pull', spull: 'pull', vpush: 'push',
    swap: 'swap', switch: 'swap', rotate: 'rotate', modifier: 'beam',
  };

  function $(id) { return doc.getElementById(id); }
  function mk(tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  const App = root.MPApp = {
    mode: 'play',
    animOn: true,
    previewOn: true,

    level: null,        /* 游玩中的棋盘 */
    base: null,         /* 游玩起始快照 */
    editLevel: null,    /* 编辑中的关卡 */
    fromEdit: false,    /* 是从编辑器来试玩的吗 */

    hover: null,
    brush: { kind: 'device', type: 'push', s: 'R' },
    undoPlay: [],
    undoEdit: [],
    playLog: [],        /* 本次游玩点过的格子序列（= 解法） */
    replay: null,       /* 正在回放解法时的状态 */
    moves: 0,
    won: false,
    busy: false,
    stroke: false,
    lastPaint: null,

    screen: 'select',   /* 游玩页签：'select' 选关界面 / 'game' 关卡内 */
    selChapter: null,   /* 关卡信息栏里选中的大关 */
    collapsed: {},      /* 折叠状态 */
    nextId: null,       /* 通关后的下一关 */
  };

  /* ==========================================================================
   * 一、通用 UI 小件
   * ======================================================================= */
  let toastTimer = null;
  App.toast = function (msg, kind) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    if (toastTimer) root.clearTimeout(toastTimer);
    toastTimer = root.setTimeout(function () { t.hidden = true; }, 2200);
  };

  App.openModal = function (title, node) {
    if (!doc.body) return;
    $('modal-title').textContent = title;
    const body = $('modal-body');
    if (body.replaceChildren) body.replaceChildren(node);
    else { body.innerHTML = ''; body.appendChild(node); }
    $('modal').hidden = false;
  };
  App.closeModal = function () { $('modal').hidden = true; };

  /* ==========================================================================
   * 二、动画编排
   * ======================================================================= */
  /* 状态变化对应的「旋转角度差」；返回 null 表示这不是旋转，而是换贴图 */
  function stateDelta(type, fromS, toS) {
    const def = MP.DEVICES[type];
    if (!def) return Math.PI / 2;
    if (def.variable) {
      if (MP.vpMode(fromS) !== MP.vpMode(toS)) return null;   /* 推 ↔ 拉：换图标 */
      const a = MP.DIR_LIST.indexOf(MP.vpDir(fromS));
      const b = MP.DIR_LIST.indexOf(MP.vpDir(toS));
      return ((b - a + 4) % 4) * Math.PI / 2;
    }
    if (def.key === 'swap' || def.key === 'switch' || def.key === 'rotate') return Math.PI / 2;
    const a = MP.DIR_LIST.indexOf(fromS), b = MP.DIR_LIST.indexOf(toS);
    if (a < 0 || b < 0) return Math.PI / 2;
    return ((b - a + 4) % 4) * Math.PI / 2;
  }

  function buildFx(L, act, x, y) {
    const beam = !!act.beam;

    /* 状态变化（朝向翻转 / 切换模式） */
    (act.states || []).forEach(function (st) {
      const c = L.cells[st.at];
      if (!c || !c.item) return;
      const delta = stateDelta(c.item.type, st.from, st.s);
      FX.add({
        kind: 'state', item: c.item,
        fromS: st.from, toS: st.s, delta: delta,
        modeSwap: delta === null,
        dur: beam ? 0.15 : 0.26, delay: beam ? 0.05 : 0,
      });
    });

    /* 位移 */
    (act.moves || []).forEach(function (m, i) {
      const from = MP.xyOf(L, m.from), to = MP.xyOf(L, m.to);
      const dist = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      let pos, rotFn = null, ease = FX.ease.inOutCubic, dur = 0.24, trail = false;

      if (m.orbit) {
        /* 旋转器：绕中心走 1/4 圆弧。
           注意：这里【不】旋转图标本身 —— 旋转器只搬位置、不改朝向，
           转了再弹回来会抽搐。 */
        const cx = m.orbit.cx, cy = m.orbit.cy;
        const a0 = Math.atan2(from.y - cy, from.x - cx);
        const sweep = m.orbit.cw ? Math.PI / 2 : -Math.PI / 2;
        pos = function (t) { const a = a0 + sweep * t; return { x: cx + Math.cos(a), y: cy + Math.sin(a) }; };
        dur = 0.30;
      } else if (m.arc) {
        /* 交换：两个物品沿对称弧线互相绕过 */
        const sgn = (i % 2 === 0) ? 1 : -1;
        let nx = -(to.y - from.y), ny = (to.x - from.x);
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        const C = {
          x: (from.x + to.x) / 2 + nx * 0.44 * sgn,
          y: (from.y + to.y) / 2 + ny * 0.44 * sgn,
        };
        pos = function (t) {
          const u = 1 - t;
          return {
            x: u * u * from.x + 2 * u * t * C.x + t * t * to.x,
            y: u * u * from.y + 2 * u * t * C.y + t * t * to.y,
          };
        };
        dur = 0.28;
      } else {
        pos = function (t) { return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }; };
        if (dist > 1) {
          dur = Math.min(0.62, 0.22 + 0.06 * dist);
          ease = FX.ease.outCubic;
          trail = true;
        } else {
          dur = 0.22;
          ease = FX.ease.outQuad;
        }
      }

      FX.add({ kind: 'move', item: m.item, pos: pos, rotFn: rotFn, ease: ease, dur: dur, trail: trail });
    });

    /* 修改器光束（要快） */
    if (beam) {
      FX.add({
        kind: 'beam',
        from: MP.xyOf(L, act.beam.from),
        to: MP.xyOf(L, act.beam.to),
        dur: 0.13, delay: 0.01,
      });
    }

    /* 被点击设备的「按一下」反馈 */
    FX.add({ kind: 'press', at: { x: x, y: y }, dur: 0.18 });
  }

  /* 冲突：抖一下 + 作用格红闪 */
  function playReject(act, x, y) {
    FX.add({
      kind: 'reject', at: { x: x, y: y },
      affects: (act && act.affects) || [],
      dur: 0.44,
    });
    if (act && act.reason) App.toast('✕ ' + act.reason, 'bad');
  }

  /* ==========================================================================
   * 三、游玩
   * ======================================================================= */
  App.loadPlay = function (id) {
    let L = null;
    if (id === '__sandbox__') L = Lib.sandbox();
    else if (id) L = Lib.get(id);
    if (!L) L = Lib.blank(10, 8, '新关卡');
    App.base = MP.cloneLevel(L);
    App.level = MP.cloneLevel(L);
    App.undoPlay = [];
    App.playLog = [];
    App.replay = null;
    App.moves = 0;
    App.won = false;
    App.hover = null;
    FX.clear();
    hideWin();
    App.screen = 'game';
    renderScreens();
    updateStats();
    updateTitle();
    if (App.level.id === '__sandbox__') {
      setHint('机制沙盒：每种设备都摆了一份，随便点，看看规则和动画。');
    } else {
      setHint('点击设备触发一次；空格 = 撤回，R = 重开，B = 返回，Esc = 选关。');
    }
  };

  /* 开始玩某一关（选关界面 / 上一关下一关都走这里） */
  App.startLevel = function (id) {
    App.fromEdit = false;
    setMode('play');
    App.loadPlay(id);
  };

  /* 回到选关界面（从编辑器里点也会切到游玩页签） */
  App.gotoSelect = function () {
    App.replay = null;
    App.screen = 'select';
    FX.clear();
    hideWin();
    setMode('play');
    renderScreens();
  };

  /* 上一关 / 下一关 */
  App.gotoLevel = function (dir) {
    const L = App.level;
    const id = L && L.id;
    if (!id || id === '__sandbox__') { App.toast('沙盒没有上一关 / 下一关'); return; }
    const nid = dir > 0 ? Lib.nextLevel(id) : Lib.prevLevel(id);
    if (!nid) { App.toast(dir > 0 ? '已经是最后一关' : '已经是第一关'); return; }
    App.startLevel(nid);
  };
  App.nextLevel = function () { App.gotoLevel(1); };

  /* 试玩当前编辑器里的内容（不落库，改坏了按 B 回去还在）。
     快捷键 S；编辑器中间那条的第一个按钮也是它。 */
  App.playtest = function () {
    const L = App.editLevel;
    if (!L) return;
    App.replay = null;
    App.base = MP.cloneLevel(L);
    App.level = MP.cloneLevel(L);
    App.undoPlay = [];
    App.playLog = [];
    App.moves = 0; App.won = false; App.hover = null;
    FX.clear(); hideWin();
    App.fromEdit = true;
    App.screen = 'game';
    setMode('play');
    renderScreens();
    setHint('这是试玩：按 B（或点下面的「返回编辑」）回到编辑器继续画，改动都还在。');
    updateStats();
    sound('click');
  };

  /* 试玩/游玩里按 B：从编辑器来的回编辑器，否则回选关 */
  App.backFromPlay = function () {
    if (App.fromEdit) {
      App.fromEdit = false;
      setMode('edit');
      App.toast('已回到编辑器，接着画', 'ok');
    } else {
      App.gotoSelect();
    }
  };

  App.activate = function (x, y) {
    const L = App.level;
    if (!L) return;
    if (App.busy) return;
    if (App.won) { App.toast('已经通关啦，点「重来」或「撤销」继续折腾', 'ok'); return; }

    const act = RULES.computeAction(L, x, y);
    if (!act) {
      App.toast('这一格没有设备', 'bad');
      sound('reject');
      return;
    }
    if (!act.ok) {
      playReject(act, x, y);
      setInspect(act, x, y);
      sound('reject');
      return;
    }

    /* 快照 → 落子（状态立即落，动画只是"回放"过渡） */
    App.undoPlay.push(MP.cloneLevel(L));
    if (App.undoPlay.length > 400) App.undoPlay.shift();
    App.playLog.push([x, y]);        /* 记下这一下，通关后就是这一关的解法 */

    RULES.applyMoves(L, act);
    RULES.applyStates(L, act);
    App.moves++;
    if (act.note) App.toast(act.note, 'ok');
    sound(DEVICE_SOUND[MP.itemAt(L, x, y) ? MP.itemAt(L, x, y).type : ''] || 'click');

    buildFx(L, act, x, y);
    App.busy = true;
    updateStats();
    setInspect(act, x, y);

    /* 保险丝：万一动画回调没被触发（后台标签页 / 异常环境），也不能把输入永久锁死 */
    const guard = root.setTimeout(function () {
      if (App.busy && !FX.items.length) {
        App.busy = false;
        if (RULES.isWin(L)) showWin();
        updateStats();
      }
    }, 4000);
    App._guard = guard;

    FX.whenIdle().then(function () {
      if (App._guard) { root.clearTimeout(App._guard); App._guard = null; }
      App.busy = false;
      if (RULES.isWin(L)) showWin();
      updateStats();
    });
  };

  App.undoPlayMove = function () {
    if (App.busy) return;
    if (!App.undoPlay.length) { App.toast('没有可撤销的操作'); return; }
    App.level = App.undoPlay.pop();
    if (App.playLog.length) App.playLog.pop();   /* 解法记录也跟着退一步 */
    App.moves = Math.max(0, App.moves - 1);
    App.won = false;
    hideWin();
    updateStats();
    updateTitle();
    sound('erase');
  };

  App.restart = function () {
    if (!App.base) return;
    App.level = MP.cloneLevel(App.base);
    App.undoPlay = [];
    App.playLog = [];
    App.moves = 0;
    App.won = false;
    FX.clear();
    hideWin();
    updateStats();
    sound('click');
  };

  function showWin() {
    if (App.won) return;
    App.won = true;
    const L = App.level;
    const isReal = !!(L && L.id && L.id !== '__sandbox__');
    /* 回放解法时不记通关进度（那是在验证自己画的关，不是在玩） */
    if (isReal && !App.replay) Lib.markCleared(L.id);
    App.nextId = isReal ? Lib.nextLevel(L.id) : null;
    sound('win');

    const b = $('win-banner');
    if (b) {
      const sub = $('win-sub');
      if (sub) {
        sub.textContent = '用了 ' + App.moves + ' 步' +
          (isReal ? (App.nextId ? '　·　按 Enter 或点下面按钮进入下一关' : '　·　已经是最后一关，厉害！') : '');
      }
      if ($('btn-win-next')) $('btn-win-next').hidden = !App.nextId;
      /* 「记下这个解法」：这一局的点击序列存进关卡，以后可以一键回放验证 */
      const canSave = App.playLog.length > 0 && isReal;
      if ($('btn-win-save-sol')) {
        $('btn-win-save-sol').hidden = !canSave;
        if (canSave) $('btn-win-save-sol').textContent = '💾 记下这个解法（' + App.playLog.length + ' 步）';
      }
      b.hidden = false;
    }
    renderTree();
  }
  function hideWin() {
    const b = $('win-banner');
    if (b) b.hidden = true;
  }

  function updateStats() {
    const L = activeLevel();
    const m = $('stat-moves'), mi = $('stat-misplaced');
    if (m) m.textContent = String(App.moves);
    if (mi) mi.textContent = L ? String(RULES.misplaced(L)) : '0';
    const note = $('play-note');
    if (note) {
      if (!L) note.textContent = '';
      else if (App.mode === 'play' && L.id === '__sandbox__') note.textContent = '当前是机制沙盒，不是关卡。';
      else note.textContent = '';
    }
  }

  /* 编辑器标题上的「未保存」标记：和库里存的版本比一个便宜的指纹 */
  function levelSign(L) {
    let h = L.w * 977 + L.h, n = 0;
    for (let i = 0; i < L.cells.length; i++) {
      const c = L.cells[i];
      if (!c.item && !c.goal && c.t === MP.FLOOR) continue;
      n++;
      let v = i * 7;
      if (c.goal) v += 101;
      if (c.item) v += c.item.k === 'device' ? 200 + c.item.type.length * 13 + c.item.s.length : 300;
      h = (h * 31 + v) % 2147483647;
    }
    return (L.name || '') + '|' + L.w + 'x' + L.h + '|' + h + '|' + n;
  }
  /* 已入库版本指纹的缓存：拖动绘制时每次都要判断「改了没」，不能每次都去克隆库里的关卡 */
  const savedSign = {};
  function dropSavedSign(id) { if (id) delete savedSign[id]; }
  function isDirty() {
    const L = App.editLevel;
    if (!L) return false;
    if (!L.id) return true;
    if (!(L.id in savedSign)) {
      const stored = Lib.get(L.id);
      savedSign[L.id] = stored ? levelSign(stored) : null;
    }
    const s = savedSign[L.id];
    if (s === null) return true;
    return s !== levelSign(L);
  }

  function updateTitle() {
    const L = activeLevel();
    const t = $('level-title'), s = $('board-sub');
    if (!L) return;
    if (t) {
      t.textContent = (L.name || '未命名关卡') +
        ((App.mode === 'edit' && isDirty()) ? '　●未保存' : '');
    }
    if (s) {
      const a = MP.analyze(L);
      const solN = (App.mode === 'edit' && L.solution && L.solution.length) ? '　·　解法 ' + L.solution.length + ' 步' : '';
      s.textContent = L.w + ' × ' + L.h + '　·　正方形 ' + a.squares + ' / 圆形 ' + a.circles +
        '　·　设备 ' + a.devices + solN + (App.mode === 'edit' ? '　·　编辑中' : '');
    }
    const fr = $('foot-right');
    if (fr) fr.textContent = App.mode === 'play'
      ? '点击设备 = 触发一次　·　空格 撤回　·　R 重开　·　B 返回　·　Esc 选关'
      : 'S 试玩　·　Ctrl+S 保存并新建下一关　·　滚轮换朝向/图形　·　右键=擦掉/放下笔刷　·　中键吸取';
  }

  function setHint(txt) {
    const h = $('hint');
    if (h) h.textContent = txt;
  }

  function setInspect(act, x, y) {
    const box = $('inspect');
    if (!box) return;
    const L = activeLevel();
    const item = MP.itemAt(L, x, y);
    const name = MP.itemName(item);
    if (!act) { box.innerHTML = '<b>' + name + '</b>：这一格没有可触发的设备。'; return; }
    if (act.ok) {
      const n = act.moves.length;
      box.innerHTML = '<b>' + name + '</b> → <span class="ok">生效</span>：' +
        (n ? '移动 ' + n + ' 个物品' : '没有物品被移动') +
        (act.note ? '（' + act.note + '）' : '');
    } else {
      box.innerHTML = '<b>' + name + '</b> → <span class="bad">冲突，整体不动</span>：' + act.reason;
    }
  }

  /* ==========================================================================
   * 三·五、解法录制 / 回放
   * --------------------------------------------------------------------------
   * 试玩或游玩时，每一次成功的点击都会记进 App.playLog（撤回会跟着退一格）。
   * 通关后可以把这段序列存进关卡的 solution 字段 —— 以后就能一键回放：
   * 既能确认「我画的这一关确实可解」，也能当作给玩家的提示。
   * ======================================================================= */
  function validSolution(sol) {
    return !!(sol && sol.length && sol[0] && typeof sol[0][0] === 'number');
  }

  /* 把这一局的点击序列存进关卡 */
  App.saveSolution = function () {
    const log = App.playLog;
    if (!log || !log.length) { App.toast('这一局还没点过设备，没有解法可记', 'bad'); return false; }
    const sol = log.map(function (p) { return [p[0], p[1]]; });

    if (App.fromEdit) {
      /* 试玩中：记到编辑器的工作副本上，Ctrl+S 才会真正落库 */
      if (!App.editLevel) return false;
      App.editLevel.solution = sol;
      syncSolutionUI();
      updateCheckup();
      updateTitle();
      App.toast('解法已记到编辑器里（' + sol.length + ' 步），按 B 回去按 Ctrl+S 存进关卡', 'ok');
      return true;
    }

    const L = App.level;
    if (!L || !L.id || L.id === '__sandbox__') { App.toast('沙盒不算关卡，解法没地方放', 'bad'); return false; }
    /* 注意：App.level 是「玩到一半」的棋盘，不能直接存回去，
       要拿库里那一份原始关卡，只把 solution 换上。 */
    const fresh = Lib.get(L.id);
    if (!fresh) return false;
    fresh.solution = sol;
    Lib.put(fresh);
    App.toast('解法已存进「' + fresh.name + '」（' + sol.length + ' 步）', 'ok');
    refreshAll();
    return true;
  };

  App.clearSolution = function () {
    const L = App.editLevel;
    if (!L) return;
    if (!validSolution(L.solution)) { App.toast('这一关还没有记录解法'); return; }
    App.snapshotEdit();
    L.solution = null;
    syncSolutionUI();
    updateCheckup();
    updateTitle();
    App.toast('已清空这一关的解法');
  };

  /* 开局并准备好回放（不自己跑，方便测试逐步驱动） */
  App.startReplay = function (sol) {
    const L = App.editLevel;
    const use = sol || (L && L.solution);
    if (!validSolution(use)) {
      App.toast('这一关还没有记录解法：先试玩通关一次，点通关横幅上的「记下这个解法」', 'bad');
      return false;
    }
    App.playtest();
    App.replay = {
      steps: use.map(function (p) { return [p[0], p[1]]; }),
      i: 0,
      total: use.length,
    };
    setHint('正在回放解法：0 / ' + use.length + '（按 Esc 或 B 可以中断）');
    return true;
  };

  /* 走一步。返回 'ok' / 'wait'（动画没播完）/ 'done' / 'fail' / 'idle' */
  App.replayStep = function () {
    const rep = App.replay;
    if (!rep) return 'idle';
    if (App.busy || FX.busy()) return 'wait';
    if (rep.i >= rep.steps.length) {
      App.replay = null;
      const win = RULES.isWin(App.level);
      App.toast(win ? ('✓ 解法回放完毕（' + rep.total + ' 步），这一关确实可解')
                    : '✗ 回放完了但没通关：这一关可能改过了，解法已过期', win ? 'ok' : 'bad');
      return win ? 'done' : 'fail';
    }
    const p = rep.steps[rep.i];
    const act = RULES.computeAction(App.level, p[0], p[1]);
    if (!act || !act.ok) {
      App.replay = null;
      App.toast('✗ 回放到第 ' + (rep.i + 1) + ' 步就冲突了（' +
        ((act && act.reason) || '这一格没有设备') + '），解法已过期', 'bad');
      return 'fail';
    }
    rep.i++;
    App.activate(p[0], p[1]);
    setHint('正在回放解法：' + rep.i + ' / ' + rep.total + '（按 Esc 或 B 可以中断）');
    return 'ok';
  };

  /* 从「回放解法」按钮走这里：自己按节奏跑完 */
  App.runReplay = function () {
    if (!App.startReplay()) return false;
    const loop = function () {
      if (!App.replay) return;
      const s = App.replayStep();
      if (s === 'done' || s === 'fail' || s === 'idle') return;
      root.setTimeout(loop, s === 'wait' ? 80 : (App.animOn ? 240 : 30));
    };
    loop();
    return true;
  };

  App.replayStop = function (quiet) {
    if (!App.replay) return false;
    App.replay = null;
    if (!quiet) App.toast('已中断回放');
    return true;
  };

  /* ==========================================================================
   * 四、编辑器
   * ======================================================================= */
  function activeLevel() { return App.mode === 'edit' ? App.editLevel : App.level; }



  App.setEditLevel = function (L) {
    App.editLevel = L;
    App.undoEdit = [];
    setMode('edit');
    syncEditFields();
    updateTitle();
    updateCheckup();
  };

  function syncEditFields() {
    const L = App.editLevel;
    if (!L) return;
    if ($('edit-name')) $('edit-name').value = L.name || '';
    if ($('edit-w')) $('edit-w').value = L.w;
    if ($('edit-h')) $('edit-h').value = L.h;
  }

  App.snapshotEdit = function () {
    if (!App.editLevel) return;
    App.undoEdit.push(MP.cloneLevel(App.editLevel));
    if (App.undoEdit.length > 200) App.undoEdit.shift();
  };

  App.undoEditStroke = function () {
    if (!App.undoEdit.length) { App.toast('没有可撤销的操作'); return; }
    App.editLevel = App.undoEdit.pop();
    syncEditFields();
    updateCheckup();
    updateTitle();
  };

  /* 把笔刷落到格子上。
     注意：落笔是「立即改数据 + 播一段过渡动画」，所以这里先把旧内容留一份给动画，
     让渲染层做「旧的虚化淡出、新的淡入」的交叉过渡。 */
  App.paint = function (x, y, erase) {
    const L = App.editLevel;
    if (!L || !MP.inBounds(L, x, y)) return false;
    const c = MP.at(L, x, y);
    const b = App.brush;
    const before = JSON.stringify([c.t, c.goal, c.item]);
    const prev = c.item ? JSON.parse(JSON.stringify(c.item)) : null;

    if (erase) {
      /* 右键 = 把这一格恢复成干净地板：墙（老关卡遗留）/ 目标 / 物品一起清掉 */
      c.t = MP.FLOOR; c.goal = null; c.item = null;
    } else if (b.kind === 'floor') {
      c.t = MP.FLOOR; c.item = null;
    } else if (b.kind === 'goal') {
      c.t = MP.FLOOR;
      c.goal = b.goal || null;
    } else if (b.kind === 'piece') {
      c.t = MP.FLOOR;
      c.item = { k: b.piece };
    } else if (b.kind === 'device') {
      c.t = MP.FLOOR;
      c.item = MP.device(b.type, b.s);
    } else {
      return false;
    }

    const after = JSON.stringify([c.t, c.goal, c.item]);
    if (after === before) return false;
    const nowItem = c.item ? JSON.parse(JSON.stringify(c.item)) : null;
    FX.add({
      kind: 'place', at: { x: x, y: y }, prev: prev, item: nowItem,
      dur: App.animOn ? 0.26 : 0,
    });
    sound(nowItem ? 'place' : 'erase');
    updateCheckup();
    updateTitle();
    return true;
  };

  /* 吸取格子内容作为笔刷 */
  App.pick = function (x, y) {
    const c = MP.at(App.editLevel, x, y);
    if (!c) return;
    if (c.item && MP.isDevice(c.item)) App.setBrush({ kind: 'device', type: c.item.type, s: c.item.s });
    else if (c.item) App.setBrush({ kind: 'piece', piece: c.item.k });
    else if (c.goal) App.setBrush({ kind: 'goal', goal: c.goal });
    else App.setBrush({ kind: 'floor' });
  };

  App.setBrush = function (b, silent) {
    App.brush = b;
    markPalette();
    if (!silent) sound('tick');
  };

  App.rotateBrush = function (ccw) {
    const b = App.brush;
    if (b.kind !== 'device') return;
    const def = MP.DEVICES[b.type];
    if (ccw) {
      /* 逆时针：连按三次顺时针 */
      let s = b.s;
      for (let i = 0; i < 3; i++) s = def.rotate(s);
      b.s = s;
    } else {
      b.s = def.rotate(b.s);
    }
    markPalette();
    sound('tick');
  };

  /* 图形 / 目标这四种笔刷也用滚轮轮换（正方形 → 圆形 → 方形目标 → 圆形目标 → 循环）。
     设备有它自己的状态列表，各滚各的。 */
  const SHAPE_RING = [
    { kind: 'piece', piece: 'square' },
    { kind: 'piece', piece: 'circle' },
    { kind: 'goal', goal: 'square' },
    { kind: 'goal', goal: 'circle' },
  ];
  function ringIndex(b) {
    for (let i = 0; i < SHAPE_RING.length; i++) {
      if (sameBrush(SHAPE_RING[i], b)) return i;
    }
    return -1;
  }

  App.cycleBrush = function (dir) {
    const b = App.brush;
    if (b.kind === 'device') {
      const def = MP.DEVICES[b.type];
      const i = def.states.indexOf(b.s);
      const n = def.states.length;
      b.s = def.states[(i + (dir > 0 ? 1 : n - 1)) % n];
      markPalette();
      sound('tick');
      return;
    }
    const k = ringIndex(b);
    if (k < 0) return;                       /* 空地 / 取消目标 / 空手：滚轮不管 */
    const m = SHAPE_RING.length;
    const next = SHAPE_RING[(k + (dir > 0 ? 1 : m - 1)) % m];
    App.setBrush(JSON.parse(JSON.stringify(next)));
  };

  App.resizeLevel = function (w, h) {
    const L = App.editLevel;
    /* 最小 1×1：墙取消之后棋盘外沿就是边界，没有任何理由再限制最小 3 格 */
    w = Math.max(1, Math.min(60, Math.round(w) || L.w));
    h = Math.max(1, Math.min(60, Math.round(h) || L.h));
    if (w === L.w && h === L.h) return;
    App.snapshotEdit();
    const N = MP.newLevel(w, h, L.name);
    N.id = L.id; N.note = L.note; N.chapter = L.chapter;
    for (let y = 0; y < Math.min(h, L.h); y++) {
      for (let x = 0; x < Math.min(w, L.w); x++) {
        N.cells[MP.idx(N, x, y)] = JSON.parse(JSON.stringify(L.cells[MP.idx(L, x, y)]));
      }
    }
    App.editLevel = N;
    syncEditFields();
    updateCheckup();
    updateTitle();
  };

  App.clearItems = function () {
    App.snapshotEdit();
    App.editLevel.cells.forEach(function (c) { c.item = null; });
    updateCheckup();
    updateTitle();
  };

  App.saveLevel = function (asNew) {
    const L = App.editLevel;
    if (!L) return false;
    if (asNew || !L.id || !Lib.get(L.id)) {
      L.id = null;
      if (asNew) L.name = (L.name || '关卡') + ' 副本';
      L.id = Lib.put(L);
      App.toast('已保存到关卡库：' + L.name, 'ok');
    } else {
      Lib.put(L);
      App.toast('已保存：' + L.name, 'ok');
    }
    dropSavedSign(L.id);
    sound('click');
    syncEditFields();
    refreshAll();
    return true;
  };

  /* Ctrl+S：保存当前关卡 → 立刻新建下一关（尺寸沿用当前关），名字自动 1-3 这种。
     如果当前关完全是空的（没图形也没目标也没设备），就只保存不新建，免得攒一堆空关卡。 */
  App.saveAndNext = function () {
    const L = App.editLevel;
    if (!L) return;
    const hasContent = L.cells.some(function (c) { return !!c.item || !!c.goal; });
    const w = L.w, h = L.h, cid = L.chapter;
    App.saveLevel(false);
    if (!hasContent) {
      App.toast('已保存（这一关还是空的，就先不新建下一关了）');
      return;
    }
    const N = Lib.blank(w, h, Lib.autoName(cid), cid);
    N.id = Lib.put(N);
    App.selChapter = cid;
    App.setEditLevel(N);
    refreshAll();
    App.toast('已保存，继续新建 ' + N.name + '（' + w + '×' + h + '）', 'ok');
  };

  App.deleteLevel = function () {
    const L = App.editLevel;
    if (!L.id || !Lib.get(L.id)) { App.toast('这个关卡还没有保存过'); return; }
    if (!root.confirm('确定删除「' + L.name + '」？')) return;
    Lib.remove(L.id);
    dropSavedSign(L.id);
    L.id = null;
    const list = Lib.list();
    if (list.length) App.openLevelInEditor(list[0].id);
    else { App.editLevel = Lib.blank(10, 8, Lib.autoName(App.selChapter), App.selChapter); syncEditFields(); }
    refreshAll();
    updateTitle();
    updateCheckup();
    App.toast('已删除');
  };

  /* 解法相关的按钮 / 文字状态 */
  function syncSolutionUI() {
    const L = App.editLevel;
    const has = !!(L && L.solution && L.solution.length);
    if ($('btn-sol-replay')) $('btn-sol-replay').disabled = !has;
    if ($('btn-sol-clear')) $('btn-sol-clear').disabled = !has;
    if ($('sol-info')) {
      $('sol-info').textContent = has
        ? ('✓ 已记录 ' + L.solution.length + ' 步解法，可以一键回放验证')
        : '还没记录解法：试玩通关一次，点通关横幅上的「💾 记下这个解法」';
    }
  }
  App.syncSolutionUI = syncSolutionUI;

  function updateCheckup() {
    const box = $('checkup');
    syncSolutionUI();
    if (!box || !App.editLevel) return;
    const a = MP.analyze(App.editLevel);
    const lines = [];
    lines.push('<div>正方形 <b>' + a.squares + '</b> ／ 方形目标 <b>' + a.squareGoals + '</b></div>');
    lines.push('<div>圆形 <b>' + a.circles + '</b> ／ 圆形目标 <b>' + a.circleGoals + '</b></div>');
    lines.push('<div>设备 <b>' + a.devices + '</b> ／ 尺寸 <b>' + App.editLevel.w + ' × ' + App.editLevel.h + '</b></div>');
    if (a.walls) lines.push('<div class="warn">这一关里还有 ' + a.walls + ' 格老式墙体（墙已经不用了，但老关卡仍然能玩）</div>');
    const sol = App.editLevel.solution;
    if (sol && sol.length) {
      lines.push('<div class="good">✓ 已记录解法：<b>' + sol.length + '</b> 步（可回放验证）</div>');
    } else {
      lines.push('<div>解法：未记录</div>');
    }
    if (!a.warnings.length) lines.push('<div class="good">✓ 数量一致，形状与目标配对正常</div>');
    a.warnings.forEach(function (w) { lines.push('<div class="warn">△ ' + w + '</div>'); });
    box.innerHTML = lines.join('');
  }

  /* ==========================================================================
   * 五、调色板 / 帮助
   * ======================================================================= */
  let palButtons = [];
  function buildPalette() {
    const host = $('palette');
    if (!host) return;
    host.innerHTML = '';
    palButtons = [];

    const groups = [
      {
        title: '地形 / 目标 / 图形', items: [
          { lbl: '空地', key: '1', brush: { kind: 'floor' }, draw: function (cv, ctx, px) { drawCellIcon(ctx, px, 'floor'); } },
          { lbl: '正方形', key: '2', brush: { kind: 'piece', piece: 'square' }, draw: function (cv, ctx, px) { drawCellIcon(ctx, px, 'square'); } },
          { lbl: '圆形', key: '3', brush: { kind: 'piece', piece: 'circle' }, draw: function (cv, ctx, px) { drawCellIcon(ctx, px, 'circle'); } },
          { lbl: '方形目标', key: '4', brush: { kind: 'goal', goal: 'square' }, draw: function (cv, ctx, px) { drawCellIcon(ctx, px, 'goalSquare'); } },
          { lbl: '圆形目标', key: '5', brush: { kind: 'goal', goal: 'circle' }, draw: function (cv, ctx, px) { drawCellIcon(ctx, px, 'goalCircle'); } },
          { lbl: '取消目标', key: '0', brush: { kind: 'goal', goal: null }, draw: function (cv, ctx, px) { drawCellIcon(ctx, px, 'goalNone'); } },
        ],
      },
    ];

    MP.DEVICE_ORDER.forEach(function (type) {
      const def = MP.DEVICES[type];
      const items = def.states.map(function (s) {
        return {
          lbl: def.stateName(s),
          brush: { kind: 'device', type: type, s: s },
          glyph: { type: type, s: s },
        };
      });
      groups.push({ title: def.name, tip: def.tip, items: items });
    });

    groups.forEach(function (g) {
      const wrap = mk('div', 'pal-group');
      const t = mk('div', 'pal-title');
      t.appendChild(mk('span', null, g.title));
      if (g.tip) t.appendChild(mk('em', null, ''));
      wrap.appendChild(t);
      const btns = mk('div', 'pal-btns');
      g.items.forEach(function (it) {
        const b = mk('button', 'pal-btn');
        b.type = 'button';
        const px = 40;
        let cv;
        if (it.glyph) {
          cv = R.makeGlyphCanvas(it.glyph.type, it.glyph.s, px);
        } else {
          cv = doc.createElement('canvas');
          const dpr = root.devicePixelRatio || 1;
          cv.width = px * dpr; cv.height = px * dpr;
          cv.style.width = px + 'px'; cv.style.height = px + 'px';
          const c2 = cv.getContext('2d');
          if (c2.setTransform) c2.setTransform(dpr, 0, 0, dpr, 0, 0);
          it.draw(cv, c2, px);
        }
        b.appendChild(cv);
        const lbl = mk('span', 'lbl', it.lbl + (it.key ? ' [' + it.key + ']' : ''));
        b.appendChild(lbl);
        b.title = g.title + ' · ' + it.lbl + (it.key ? '（快捷键 ' + it.key + '）' : '') + (g.tip ? '\n' + g.tip : '');
        b.addEventListener('click', function () { App.setBrush(JSON.parse(JSON.stringify(it.brush))); });
        b._brush = it.brush;
        palButtons.push(b);
        btns.appendChild(b);
      });
      wrap.appendChild(btns);
      host.appendChild(wrap);
    });

    markPalette();
  }

  function markPalette() {
    palButtons.forEach(function (b) {
      const on = sameBrush(b._brush, App.brush);
      if (on) b.classList.add('is-on'); else b.classList.remove('is-on');
    });
  }
  function sameBrush(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'device') return a.type === b.type && a.s === b.s;
    if (a.kind === 'goal') return (a.goal || null) === (b.goal || null);
    if (a.kind === 'piece') return a.piece === b.piece;
    return true;
  }

  /* 调色板上的小图标 */
  function drawCellIcon(ctx, px, kind) {
    const c = px / 2;
    if (kind === 'floor') {
      ctx.fillStyle = '#1a2130';
      ctx.fillRect(1, 1, px - 2, px - 2);
      ctx.strokeStyle = '#2b3648';
      ctx.strokeRect(1.5, 1.5, px - 3, px - 3);
    } else if (kind === 'wall') {
      ctx.fillStyle = '#39404f';
      ctx.fillRect(1, 1, px - 2, px - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      for (let k = -px; k < px; k += 7) {
        ctx.beginPath(); ctx.moveTo(1 + k, px - 1); ctx.lineTo(1 + k + px, 1); ctx.stroke();
      }
    } else if (kind === 'goalSquare' || kind === 'goalCircle' || kind === 'goalNone') {
      ctx.fillStyle = '#1a2130';
      ctx.fillRect(1, 1, px - 2, px - 2);
      if (kind === 'goalNone') {
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(12, 12); ctx.lineTo(px - 12, px - 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px - 12, 12); ctx.lineTo(12, px - 12); ctx.stroke();
        return;
      }
      const col = kind === 'goalSquare' ? '#38bdf8' : '#fbbf24';
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (kind === 'goalSquare') ctx.rect(9, 9, px - 18, px - 18);
      else ctx.arc(c, c, (px - 18) / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (kind === 'square') {
      const g = ctx.createLinearGradient(8, 8, px - 8, px - 8);
      g.addColorStop(0, '#dbeafe'); g.addColorStop(1, '#60a5fa');
      ctx.fillStyle = g;
      ctx.beginPath();
      const r = 4, w = px - 16;
      ctx.moveTo(8 + r, 8);
      ctx.arcTo(8 + w, 8, 8 + w, 8 + w, r);
      ctx.arcTo(8 + w, 8 + w, 8, 8 + w, r);
      ctx.arcTo(8, 8 + w, 8, 8, r);
      ctx.arcTo(8, 8, 8 + w, 8, r);
      ctx.fill();
    } else if (kind === 'circle') {
      const g = ctx.createRadialGradient(c - 4, c - 4, 2, c, c, px / 2 - 7);
      g.addColorStop(0, '#fef3c7'); g.addColorStop(1, '#fbbf24');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c, c, px / 2 - 8, 0, Math.PI * 2); ctx.fill();
    }
  }

  function buildHelp() {
    const box = mk('div');

    const h1 = mk('div', 'help-h', '目标与基本操作');
    box.appendChild(h1);
    const ul = mk('ul', 'help-list');
    [
      '把每个<b>正方形</b>移到方形目标格、每个<b>圆形</b>移到圆形目标格，全部对上就通关（不限步数）。',
      '所有设备都是同一个操作方式：<b>鼠标点一下 = 触发一次</b>。',
      '<b>设备本身也是可操作对象</b>：活塞能推走设备、交换器能换设备、旋转器能转设备、修改器能改设备。',
      '<b>冲突则整体不动</b>：只要有一格越出棋盘 / 被占住 / 推不动，这一次点击就完全没有效果（连可变活塞也不会变形）。',
      '棋盘外沿就是边界：<b>这一版没有墙</b>，越界等同于以前撞墙。',
      '鼠标停在设备上会<b>预演</b>显示它作用到哪些格子（绿=可行，红=冲突）；点错了可以撤销。',
    ].forEach(function (t) { const li = mk('li'); li.innerHTML = t; ul.appendChild(li); });
    box.appendChild(ul);

    const h2 = mk('div', 'help-h', '设备一览');
    box.appendChild(h2);
    const grid = mk('div', 'help-grid');
    MP.DEVICE_ORDER.forEach(function (type) {
      const def = MP.DEVICES[type];
      const card = mk('div', 'help-card');
      card.appendChild(R.makeGlyphCanvas(type, def.states[0], 52));
      const body = mk('div', 'hc-body');
      body.appendChild(mk('div', 'hc-name', def.name));
      body.appendChild(mk('div', 'hc-tip', def.tip));
      const st = def.states.map(function (s) { return def.stateName(s); }).join(' / ');
      body.appendChild(mk('div', 'hc-states', '状态：' + st));
      card.appendChild(body);
      grid.appendChild(card);
    });
    box.appendChild(grid);

    const h3 = mk('div', 'help-h', '游玩操作');
    box.appendChild(h3);
    const ul3 = mk('ul', 'help-list');
    [
      '<b>点设备</b> = 触发一次；鼠标停在设备上会预演作用范围（绿=可行，红=冲突）。',
      '操作按钮都在棋盘<b>正下方那一条</b>，右边的面板只显示状态和推演结果。',
      '<b>空格</b> = 撤回上一步　<b>R</b> = 重开本关　<b>B</b> = 返回（试玩时回编辑器，否则回选关）　<b>Esc</b> = 选关　<b>Enter</b> = 通关后进入下一关。',
      '<b>← →</b> = 上一关 / 下一关。',
      '通关进度会自动记住，选关界面的卡片上有 ✓，还能一眼看到每关的缩略小地图。',
    ].forEach(function (t) { const li = mk('li'); li.innerHTML = t; ul3.appendChild(li); });
    box.appendChild(ul3);

    const h4 = mk('div', 'help-h', '关卡组织 / 编辑器操作');
    box.appendChild(h4);
    const ul2 = mk('ul', 'help-list');
    [
      '编辑器左边是「<b>关卡信息栏</b>」：上面是当前关卡的名字 / 尺寸 / 所属大关，下面是所有大关和关卡，点关卡名就打开编辑。',
      '大关右边的 <b>＋</b> 就在这个大关里新建一关，新关卡名字自动是 <b>1-3</b> 这样的编号；「大关管理」可以新建 / 改名 / 删除大关。',
      '画布操作：<b>左键</b>画、<b>右键</b>点有东西的格子=擦干净（按住可连续擦）、<b>右键点空地 / Esc</b> = <b>放下手中的笔刷</b>（空手状态左键不画东西）、<b>中键</b>（或 Alt+左键）吸取、<b>滚轮</b>换朝向、<b>R</b> 转笔刷。',
      '键盘：<b>1</b> 空地、<b>2</b> 正方形、<b>3</b> 圆形、<b>4</b> 方形目标、<b>5</b> 圆形目标、<b>0</b> 取消目标。',
      '<b>滚轮</b>：拿着设备时换它的朝向 / 状态；拿着<b>正方形 / 圆形 / 方形目标 / 圆形目标</b>时，在这四种之间循环。',
      '<b>S</b> = 一键试玩当前内容（不落库，按 <b>B</b> 回来继续画）。',
      '<b>解法录制</b>：试玩通关后，通关横幅上会多一个「💾 记下这个解法」，点它就把这一局的点击序列存进关卡；' +
        '之后在右栏「解法录制」里点「▶ 回放解法」，会自动重放一遍验证这一关确实可解（中途按 Esc / B 可中断）。',
      '<b>Ctrl+S</b> = 保存这一关并<b>自动新建下一关</b>，尺寸沿用当前关；当前关是空的就只保存不新建。',
      '改尺寸后没有任何外墙要铺：<b>棋盘外沿就是边界</b>。',
      '「导出 / 导入 JSON」「查看 / 编辑 JSON」都挪到了棋盘下面那一条；「关卡体检」会提示图形与目标数量是否配对。',
    ].forEach(function (t) { const li = mk('li'); li.innerHTML = t; ul2.appendChild(li); });
    box.appendChild(ul2);

    return box;
  }

  /* ==========================================================================
   * 六、关卡信息栏（大关 → 关卡）/ 选关界面
   * ======================================================================= */
  function chapterLabel(ci, li) { return (ci + 1) + '-' + (li + 1); }

  function renderTree() {
    const host = $('tree');
    if (!host) return;
    host.innerHTML = '';
    const chapters = Lib.chapters();

    /* 当前正在编辑、但还没保存的关卡也给一行 */
    const cur = App.editLevel;
    if (cur && !cur.id) {
      const item = mk('div', 'tree-item is-on');
      item.appendChild(mk('span', 'num', '未存'));
      item.appendChild(mk('span', 'nm', cur.name || '未命名'));
      host.appendChild(item);
    }

    if (!chapters.length) {
      host.appendChild(mk('div', 'tree-empty', '还没有关卡：点下面「新建大关」，再点大关右边的 ＋'));
      return;
    }

    chapters.forEach(function (ch, ci) {
      const block = mk('div', 'tree-chapter');
      const head = mk('div', 'tree-head' + (App.collapsed[ch.id] ? ' collapsed' : ''));
      head.appendChild(mk('span', 'caret', '▾'));
      head.appendChild(mk('b', null, ch.name));
      head.appendChild(mk('span', 'cnt', ch.levels.length + ' 关'));
      const add = mk('button', 'mini-btn', '＋');
      add.title = '在这个大关里新建一关';
      add.addEventListener('click', function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        App.newLevel(ch.id);
      });
      head.appendChild(add);
      head.addEventListener('click', function () {
        App.selChapter = ch.id;
        App.collapsed[ch.id] = !App.collapsed[ch.id];
        renderTree();
      });
      block.appendChild(head);

      if (!App.collapsed[ch.id]) {
        const list = mk('div', 'tree-levels');
        if (!ch.levels.length) list.appendChild(mk('div', 'tree-empty', '（空）'));
        ch.levels.forEach(function (lv, li) {
          const on = (App.editLevel && App.editLevel.id === lv.id);
          const item = mk('div', 'tree-item' + (on ? ' is-on' : ''));
          item.appendChild(mk('span', 'num', chapterLabel(ci, li)));
          item.appendChild(mk('span', 'nm', lv.name));
          if (lv.cleared) item.appendChild(mk('span', 'ok', '✓'));
          item.addEventListener('click', function () { App.openLevelInEditor(lv.id); });
          list.appendChild(item);
        });
        block.appendChild(list);
      }
      host.appendChild(block);
    });
  }

  App.openLevelInEditor = function (id) {
    const L = Lib.get(id);
    if (!L) { App.toast('打不开这个关卡', 'bad'); return; }
    App.selChapter = L.chapter;
    App.setEditLevel(L);
    App.toast('已打开：' + L.name, 'ok');
  };

  App.newLevel = function (chapterId) {
    let cid = chapterId || App.selChapter;
    const chs = Lib.chapters();
    if (!cid || !chs.filter(function (c) { return c.id === cid; }).length) cid = (chs[0] || {}).id;
    if (!cid) cid = Lib.addChapter('第一大关');
    const L = Lib.blank(10, 8, Lib.autoName(cid), cid);
    L.id = Lib.put(L);            /* 立刻入库，树里马上能看到 */
    App.selChapter = cid;
    App.setEditLevel(L);
    App.toast('已新建关卡 ' + L.name + '，画完按 Ctrl+S 继续下一关', 'ok');
  };

  function refreshChapterSelect() {
    const sel = $('edit-chapter');
    if (!sel) return;
    sel.innerHTML = '';
    Lib.chapters().forEach(function (ch) {
      const op = mk('option', null, ch.name);
      op.value = ch.id;
      sel.appendChild(op);
    });
    if (App.editLevel && App.editLevel.chapter) sel.value = App.editLevel.chapter;
  }

  function renderPlaySelect() {
    const host = $('play-chapters');
    if (!host) return;
    host.innerHTML = '';
    const total = Lib.count(), done = Lib.clearedCount();
    if ($('progress-info')) {
      $('progress-info').textContent = total
        ? ('共 ' + total + ' 关，已通关 ' + done + ' 关')
        : '还没有关卡，去编辑器画一关吧';
    }
    const chapters = Lib.chapters();
    const hasAny = chapters.some(function (c) { return c.levels.length; });
    if (!hasAny) {
      host.appendChild(mk('div', 'hint', '关卡库还是空的：切到「✎ 关卡编辑器」→「新建大关」→ 大关右边的「＋」新建关卡 → 画完保存，这里就会出现。'));
      return;
    }
    chapters.forEach(function (ch, ci) {
      if (!ch.levels.length) return;
      const block = mk('div', 'chapter-block');
      const d = ch.levels.filter(function (l) { return l.cleared; }).length;
      const title = mk('div', 'chapter-title');
      title.appendChild(mk('span', null, ch.name));
      title.appendChild(mk('span', 'hint', d + ' / ' + ch.levels.length + ' 通关'));
      block.appendChild(title);

      const grid = mk('div', 'level-grid');
      ch.levels.forEach(function (lv, li) {
        const card = mk('button', 'level-card' + (lv.cleared ? ' is-cleared' : ''));
        card.type = 'button';
        /* 缩略小地图：一眼看出这一关长什么样（尺寸 / 图形和目标的位置 / 设备分布） */
        const full = Lib.get(lv.id);
        if (full && R.makeThumbCanvas) {
          try {
            const thumb = R.makeThumbCanvas(full, 128);
            thumb.className = 'lc-thumb';
            card.appendChild(thumb);
          } catch (e) { /* 画不出来就只是没有缩略图，不影响选关 */ }
        }
        card.appendChild(mk('span', 'lc-num', chapterLabel(ci, li) + (lv.cleared ? '　✓ 已通关' : '')));
        card.appendChild(mk('span', 'lc-name', lv.name));
        card.appendChild(mk('span', 'lc-size', lv.w + ' × ' + lv.h));
        card.addEventListener('click', function () { App.startLevel(lv.id); });
        grid.appendChild(card);
      });
      block.appendChild(grid);
      host.appendChild(block);
    });
  }

  function renderScreens() {
    const edit = (App.mode === 'edit');
    const select = (!edit && App.screen === 'select');
    if ($('tree-col')) $('tree-col').hidden = !edit;
    if ($('play-select')) $('play-select').hidden = !select;
    if ($('stage')) $('stage').hidden = select;
    /* 中间那条操作按钮：编辑模式和游玩模式各一条，选关时都不显示 */
    if ($('edit-bar')) $('edit-bar').hidden = !edit;
    if ($('play-bar')) $('play-bar').hidden = edit || select;
    /* 舞台重新出现后必须重新量一次尺寸，否则画布还是隐藏时算出来的旧尺寸 */
    if (!select && App.canvas) resizeCanvas();
    if (edit) { renderTree(); refreshChapterSelect(); }
    if (select) renderPlaySelect();
  }

  /* 关卡库有任何变动 → 三处一起刷新 */
  function refreshAll() {
    renderTree();
    refreshChapterSelect();
    renderPlaySelect();
    updateTitle();
  }

  /* ==========================================================================
   * 七、输入 & 渲染循环
   * ======================================================================= */
  function cellFromEvent(ev) {
    const rect = App.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const v = R.pixelToCell(App.view, px, py);
    const L = activeLevel();
    if (!L || !MP.inBounds(L, v.x, v.y)) return null;
    return v;
  }

  /* 这一格是不是「干净空地」（没设备没图形没目标，也不是老关卡的墙） */
  function isBlankCell(L, x, y) {
    const c = MP.at(L, x, y);
    return !!c && !c.item && !c.goal && c.t === MP.FLOOR;
  }

  /* 放下手里的笔刷（空手）——右键点空地 / Esc 都是这个动作 */
  App.dropBrush = function (quiet) {
    if (App.brush && App.brush.kind === 'none') return false;
    App.setBrush({ kind: 'none' });
    if (!quiet) App.toast('已放下手中的笔刷（点任意笔刷或按数字键重新拿起）');
    return true;
  };

  function onDown(ev) {
    const v = cellFromEvent(ev);
    /* 右键：空格子 = 放下手中的笔刷；有东西的格子 = 擦干净（按住拖动可以连续擦） */
    if (ev.button === 2) {
      if (App.mode === 'edit' && v) {
        if (ev.preventDefault) ev.preventDefault();
        if (isBlankCell(App.editLevel, v.x, v.y)) {
          App.dropBrush();
          return;
        }
        App.snapshotEdit();
        App.stroke = true;
        App.paint(v.x, v.y, true);
      }
      return;
    }
    /* 中键：吸取（和 Alt+左键一样） */
    if (ev.button === 1) {
      if (v && App.mode === 'edit') {
        if (ev.preventDefault) ev.preventDefault();
        App.pick(v.x, v.y);
      }
      return;
    }
    if (!v) return;
    if (App.mode === 'play') {
      App.activate(v.x, v.y);
    } else {
      if (ev.altKey) { App.pick(v.x, v.y); return; }
      App.snapshotEdit();
      App.stroke = true;
      App.paint(v.x, v.y, false);
    }
  }

  function onMove(ev) {
    const v = cellFromEvent(ev);
    App.hover = v;
    if (App.mode === 'edit') {
      if (App.stroke && v) {
        const btns = (ev.buttons === undefined) ? 1 : ev.buttons;
        if (btns & 2) App.paint(v.x, v.y, true);        /* 右键拖动 = 擦 */
        else if (btns & 1) App.paint(v.x, v.y, false);  /* 左键拖动 = 画 */
        else App.stroke = false;
      }
      return;
    }
    if (v && App.level) {
      const act = RULES.computeAction(App.level, v.x, v.y);
      if (act) setInspect(act, v.x, v.y);
    }
  }
  function onUp() { App.stroke = false; }

  function onWheel(ev) {
    if (App.mode !== 'edit') return;
    if (ev.preventDefault) ev.preventDefault();
    App.cycleBrush(ev.deltaY > 0 ? 1 : -1);
  }

  function isTyping(ev) {
    const t = ev.target;
    if (!t) return false;
    const tag = String(t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }

  function onKey(ev) {
    const k = String(ev.key || '').toLowerCase();

    /* 回放解法时，Esc / B 先中断回放 */
    if (App.replay && (k === 'escape' || k === 'b')) { App.replayStop(); return; }

    /* Esc：先关弹窗；编辑器里 = 放下笔刷；游玩里 = 返回选关 */
    if (k === 'escape') {
      if ($('modal') && $('modal').hidden === false) { App.closeModal(); return; }
      if (App.mode === 'edit') { App.dropBrush(); return; }
      if (App.mode === 'play') App.gotoSelect();
      return;
    }
    if (k === 'z' && (ev.ctrlKey || ev.metaKey)) {
      if (App.mode === 'edit') App.undoEditStroke(); else App.undoPlayMove();
      if (ev.preventDefault) ev.preventDefault();
      return;
    }
    /* Ctrl+S：保存当前关卡并自动新建下一关（尺寸沿用当前关） */
    if (k === 's' && (ev.ctrlKey || ev.metaKey)) {
      if (ev.preventDefault) ev.preventDefault();
      if (App.mode === 'edit') App.saveAndNext();
      return;
    }
    if (isTyping(ev)) return;

    if (App.mode === 'edit') {
      /* S = 一键试玩，B 留给「从试玩回来」（这条分支里按 B 没意义，直接忽略） */
      if (k === 's') { App.playtest(); if (ev.preventDefault) ev.preventDefault(); }
      else if (k === 'r') { App.rotateBrush(ev.shiftKey); if (ev.preventDefault) ev.preventDefault(); }
      else if (k === 'x' || k === '1') App.setBrush({ kind: 'floor' });
      else if (k === 'q' || k === '2') App.setBrush({ kind: 'piece', piece: 'square' });
      else if (k === 'c' || k === '3') App.setBrush({ kind: 'piece', piece: 'circle' });
      else if (k === '4') App.setBrush({ kind: 'goal', goal: 'square' });
      else if (k === '5') App.setBrush({ kind: 'goal', goal: 'circle' });
      else if (k === '0') App.setBrush({ kind: 'goal', goal: null });
      return;
    }

    /* 游玩 */
    if (k === ' ' || k === 'spacebar') {
      App.undoPlayMove();
      if (ev.preventDefault) ev.preventDefault();
    } else if (k === 'r') {
      App.restart();
    } else if (k === 'b') {
      App.backFromPlay();
    } else if (k === 'enter') {
      if (App.won) App.gotoLevel(1);
    } else if (k === 'arrowleft') {
      App.gotoLevel(-1);
    } else if (k === 'arrowright') {
      App.gotoLevel(1);
    }
  }

  function resizeCanvas() {
    const wrap = $('board-wrap');
    if (!wrap || !App.canvas) return;
    const rect = wrap.getBoundingClientRect();
    const W = Math.max(240, Math.floor(rect.width) - 24);
    const H = Math.max(180, Math.floor(rect.height) - 12);
    const dpr = root.devicePixelRatio || 1;
    App.cssW = W; App.cssH = H;
    App.canvas.width = Math.round(W * dpr);
    App.canvas.height = Math.round(H * dpr);
    App.canvas.style.width = W + 'px';
    App.canvas.style.height = H + 'px';
    if (App.ctx.setTransform) App.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* 一帧：推进动画 + 重绘。抽出来是为了能在没有 rAF 的环境（自动化测试）里手动驱动 */
  function renderFrame(dt) {
    FX.update(dt);
    const L = activeLevel();
    if (!L || !App.canvas) return;
    App.view = R.computeView(L, App.cssW || 900, App.cssH || 640);
    const opts = { fx: FX.items, hover: App.hover, editor: App.mode === 'edit' };
    if (App.previewOn && App.hover && !App.busy) {
      const act = RULES.computeAction(L, App.hover.x, App.hover.y);
      if (act) opts.preview = act;
    }
    if (App.mode === 'edit' && App.hover) {
      opts.ghost = { x: App.hover.x, y: App.hover.y, item: ghostItem() };
    }
    R.draw(App.ctx, L, App.view, opts);
  }
  App.step = function (dt) { renderFrame(dt === undefined ? 1 / 60 : dt); };

  let lastT = 0;
  function loop(now) {
    if (!lastT) lastT = now;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    renderFrame(dt);
    root.requestAnimationFrame(loop);
  }

  function ghostItem() {
    const b = App.brush;
    if (b.kind === 'piece') return { k: b.piece };
    if (b.kind === 'device') return MP.device(b.type, b.s);
    return null;
  }

  /* ==========================================================================
   * 八、模式切换 & 初始化
   * ======================================================================= */
  function setMode(m) {
    App.mode = m;
    if ($('panel-play')) $('panel-play').hidden = (m !== 'play');
    if ($('panel-edit')) $('panel-edit').hidden = (m !== 'edit');
    if ($('tab-play')) $('tab-play').className = 'tab' + (m === 'play' ? ' is-on' : '');
    if ($('tab-edit')) $('tab-edit').className = 'tab' + (m === 'edit' ? ' is-on' : '');
    if ($('btn-play-back')) $('btn-play-back').hidden = !(m === 'play' && App.fromEdit);
    if (m === 'edit') syncEditFields();
    renderScreens();
    updateTitle();
    updateStats();
    updateCheckup();
    App.hover = null;
    FX.clear();
  }
  App.setMode = setMode;

  function bind() {
    const cv = App.canvas;
    if (cv) {
      cv.addEventListener('mousedown', onDown);
      cv.addEventListener('mousemove', onMove);
      cv.addEventListener('mouseleave', function () { App.hover = null; });
      root.addEventListener('mouseup', onUp);
      cv.addEventListener('wheel', onWheel, { passive: false });
      cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      cv.addEventListener('auxclick', function (e) { e.preventDefault(); });
    }
    root.addEventListener('keydown', onKey);
    root.addEventListener('resize', resizeCanvas);

    if ($('tab-play')) $('tab-play').addEventListener('click', function () { setMode('play'); });
    if ($('tab-edit')) $('tab-edit').addEventListener('click', function () { setMode('edit'); });

    if ($('chk-anim')) $('chk-anim').addEventListener('change', function (e) {
      App.animOn = e.target.checked;
      FX.timeScale = App.animOn ? 1 : 200;
      FX.clear();
    });
    if ($('chk-preview')) $('chk-preview').addEventListener('change', function (e) {
      App.previewOn = e.target.checked;
    });
    /* 音效开关：第一次点它也算「用户手势」，AudioContext 就此解锁 */
    if ($('chk-sfx')) {
      $('chk-sfx').checked = !(SFX && SFX.enabled === false);
      $('chk-sfx').addEventListener('change', function (e) {
        if (SFX) SFX.setEnabled(e.target.checked);
        if (e.target.checked) sound('click');
      });
    }
    if ($('btn-help')) $('btn-help').addEventListener('click', function () {
      App.openModal('规则说明 / 编辑器用法', buildHelp());
    });
    if ($('modal-close')) $('modal-close').addEventListener('click', App.closeModal);
    if ($('modal')) $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) App.closeModal(); });

    /* 游玩面板 */
    if ($('btn-play-select')) $('btn-play-select').addEventListener('click', App.gotoSelect);
    if ($('btn-play-sandbox')) $('btn-play-sandbox').addEventListener('click', function () { App.startLevel('__sandbox__'); });
    if ($('btn-play-prev')) $('btn-play-prev').addEventListener('click', function () { App.gotoLevel(-1); });
    if ($('btn-play-next')) $('btn-play-next').addEventListener('click', function () { App.gotoLevel(1); });
    if ($('btn-play-undo')) $('btn-play-undo').addEventListener('click', App.undoPlayMove);
    if ($('btn-play-restart')) $('btn-play-restart').addEventListener('click', App.restart);
    if ($('btn-play-back')) $('btn-play-back').addEventListener('click', App.backFromPlay);
    if ($('btn-win-again')) $('btn-win-again').addEventListener('click', App.restart);
    if ($('btn-win-next')) $('btn-win-next').addEventListener('click', function () { App.gotoLevel(1); });
    if ($('btn-win-select')) $('btn-win-select').addEventListener('click', App.gotoSelect);
    if ($('btn-win-save-sol')) $('btn-win-save-sol').addEventListener('click', function () {
      if (App.saveSolution() && $('btn-win-save-sol')) $('btn-win-save-sol').hidden = true;
    });

    /* 解法录制 */
    if ($('btn-sol-replay')) $('btn-sol-replay').addEventListener('click', function () { App.runReplay(); });
    if ($('btn-sol-clear')) $('btn-sol-clear').addEventListener('click', App.clearSolution);

    /* 大关管理 */
    if ($('btn-chapter-add')) $('btn-chapter-add').addEventListener('click', function () {
      const name = root.prompt('新大关的名字', '第 ' + (Lib.chapters().length + 1) + ' 大关');
      if (name === null) return;
      App.selChapter = Lib.addChapter(String(name || '').trim() || ('第 ' + (Lib.chapters().length + 1) + ' 大关'));
      refreshAll();
      App.toast('已新建大关', 'ok');
    });
    if ($('btn-chapter-rename')) $('btn-chapter-rename').addEventListener('click', function () {
      const chs = Lib.chapters();
      const id = App.selChapter || (chs[0] || {}).id;
      const ch = chs.filter(function (c) { return c.id === id; })[0];
      if (!ch) { App.toast('先在上面点一个大关', 'bad'); return; }
      const name = root.prompt('大关改名', ch.name);
      if (name === null) return;
      Lib.renameChapter(id, String(name).trim() || ch.name);
      refreshAll();
    });
    if ($('btn-chapter-del')) $('btn-chapter-del').addEventListener('click', function () {
      const chs = Lib.chapters();
      const id = App.selChapter;
      const ch = chs.filter(function (c) { return c.id === id; })[0];
      if (!ch) { App.toast('先在上面点一个大关', 'bad'); return; }
      if (!root.confirm('删除大关「' + ch.name + '」？里面的 ' + ch.levels.length + ' 个关卡会一起删掉！')) return;
      Lib.removeChapter(id);
      App.selChapter = (Lib.chapters()[0] || {}).id;
      refreshAll();
      App.toast('已删除大关');
    });
    if ($('btn-progress-reset')) $('btn-progress-reset').addEventListener('click', function () {
      if (!root.confirm('清空所有通关记录？')) return;
      Lib.resetProgress();
      refreshAll();
      App.toast('通关记录已清空');
    });

    /* 关卡包：导出整个库 / 导出选中大关 / 导入 */
    if ($('btn-export-all')) $('btn-export-all').addEventListener('click', function () {
      const b = Lib.downloadBundle(null);
      App.toast('已导出整个关卡库：' + b.chapters.length + ' 个大关 / ' + Object.keys(b.levels).length + ' 关');
    });
    if ($('btn-export-chapter')) $('btn-export-chapter').addEventListener('click', function () {
      const chs = Lib.chapters();
      const id = App.selChapter || (chs[0] || {}).id;
      const ch = chs.filter(function (c) { return c.id === id; })[0];
      if (!ch) { App.toast('先在上面点一个大关', 'bad'); return; }
      const b = Lib.downloadBundle(id);
      App.toast('已导出「' + b.name + '」：' + Object.keys(b.levels).length + ' 关');
    });
    if ($('btn-import-bundle')) $('btn-import-bundle').addEventListener('click', function () {
      if ($('file-bundle')) $('file-bundle').click();
    });
    if ($('file-bundle')) $('file-bundle').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = function () {
        const res = Lib.parseBundle(String(fr.result));
        if (!res.bundle) { App.toast('导入失败：' + res.warnings.join('；'), 'bad'); return; }
        const r = Lib.importBundle(res.bundle, { asCopy: true });
        refreshAll();
        App.toast('已导入 ' + r.chapters + ' 个大关 / ' + r.levels + ' 关（副本，不动原有内容）' +
          (r.warnings.length ? '　注意：' + r.warnings.join('；') : ''), r.levels ? 'ok' : 'bad');
      };
      fr.readAsText(f);
      e.target.value = '';
    });
    /* 单文件版才有的「内置关卡包」：再导入一份副本 */
    if ($('btn-seed-load')) {
      if (!Lib.seed()) $('btn-seed-load').hidden = true;
      $('btn-seed-load').addEventListener('click', function () {
        const s = Lib.seed();
        if (!s) { App.toast('这一份没有内置关卡包', 'bad'); return; }
        if (!root.confirm('把内置关卡包再导入一份？会在你的关卡库里新增一份副本，不会覆盖现有内容。')) return;
        const r = Lib.importBundle(s, { asCopy: true });
        refreshAll();
        App.toast('已导入内置关卡包：' + r.levels + ' 关（副本）', 'ok');
      });
    }

    /* 编辑器面板 */
    if ($('edit-chapter')) $('edit-chapter').addEventListener('change', function (e) {
      const cid = e.target.value;
      if (!App.editLevel || !cid) return;
      App.editLevel.chapter = cid;
      App.selChapter = cid;
      if (App.editLevel.id) { Lib.put(App.editLevel); App.toast('已移动到大关：' + (Lib.chapters().filter(function (c) { return c.id === cid; })[0] || {}).name, 'ok'); }
      refreshAll();
    });
    if ($('btn-edit-new')) $('btn-edit-new').addEventListener('click', function () {
      App.newLevel(App.selChapter);
      setMode('edit');
      refreshAll();
    });
    if ($('btn-edit-undo')) $('btn-edit-undo').addEventListener('click', App.undoEditStroke);
    if ($('btn-edit-clear')) $('btn-edit-clear').addEventListener('click', App.clearItems);
    if ($('btn-edit-save')) $('btn-edit-save').addEventListener('click', function () { App.saveAndNext(); });
    if ($('btn-edit-saveas')) $('btn-edit-saveas').addEventListener('click', function () { App.saveLevel(true); });
    if ($('btn-edit-del')) $('btn-edit-del').addEventListener('click', App.deleteLevel);
    if ($('btn-resize')) $('btn-resize').addEventListener('click', function () {
      App.resizeLevel(Number($('edit-w').value), Number($('edit-h').value));
    });
    if ($('edit-name')) $('edit-name').addEventListener('input', function (e) {
      App.editLevel.name = e.target.value;
      updateTitle();
      renderTree();
    });
    if ($('btn-edit-play')) $('btn-edit-play').addEventListener('click', function () { App.playtest(); });
    if ($('btn-edit-export')) $('btn-edit-export').addEventListener('click', function () {
      Lib.download(App.editLevel);
      App.toast('已导出 JSON 文件');
    });
    if ($('btn-edit-import')) $('btn-edit-import').addEventListener('click', function () { $('file-import').click(); });
    if ($('file-import')) $('file-import').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = function () {
        const res = Lib.importText(String(fr.result));
        if (!res.level) { App.toast('导入失败：' + res.warnings.join('；'), 'bad'); return; }
        res.level.id = null;
        App.setEditLevel(res.level);
        setMode('edit');
        refreshAll();
        App.toast(res.warnings.length ? ('已导入，修正：' + res.warnings.join('；')) : '已导入', res.warnings.length ? 'bad' : 'ok');
      };
      fr.readAsText(f);
      e.target.value = '';
    });
    if ($('btn-edit-json')) $('btn-edit-json').addEventListener('click', function () {
      const ta = mk('textarea');
      ta.value = Lib.serialize(App.editLevel);
      const wrap = mk('div');
      wrap.appendChild(ta);
      const row = mk('div', 'row');
      const b1 = mk('button', 'btn primary', '应用');
      const b2 = mk('button', 'btn', '复制到剪贴板');
      const b3 = mk('button', 'btn', '下载为文件');
      b1.addEventListener('click', function () {
        const res = Lib.importText(ta.value);
        if (!res.level) { App.toast('解析失败：' + res.warnings.join('；'), 'bad'); return; }
        res.level.id = App.editLevel.id;
        App.setEditLevel(res.level);
        setMode('edit');
        refreshAll();
        App.closeModal();
        App.toast('已应用到编辑器' + (res.warnings.length ? '（修正：' + res.warnings.join('；') + '）' : ''), 'ok');
      });
      b2.addEventListener('click', function () {
        if (root.navigator && root.navigator.clipboard) {
          root.navigator.clipboard.writeText(ta.value).then(function () { App.toast('已复制', 'ok'); },
            function () { App.toast('复制失败，请手动全选复制', 'bad'); });
        } else { ta.select(); App.toast('请手动 Ctrl+C'); }
      });
      b3.addEventListener('click', function () { Lib.download(App.editLevel); });
      row.appendChild(b1); row.appendChild(b2); row.appendChild(b3);
      wrap.appendChild(row);
      App.openModal('关卡 JSON', wrap);
    });
  }

  App.init = function () {
    App.canvas = $('board');
    App.ctx = App.canvas.getContext('2d');
    App.cssW = 900; App.cssH = 640;

    /* 顶栏显示版本号，方便确认「发给别人的那一份」是哪个版本 */
    if ($('brand-ver')) $('brand-ver').textContent = 'v' + (MP.VERSION || '?') + (root.MP_SINGLE_FILE ? ' · 单文件版' : '');

    /* 单文件版可能内嵌了关卡包（window.MP_SEED）：
       只在「本机关卡库还是空的、而且没装过这一包」时装进去，绝不动玩家自己的关卡。 */
    App.seedResult = null;
    const seed = Lib.seed();
    if (seed) {
      const tag = Lib.seedTag();
      if (Lib.seedDone() !== tag && Lib.count() === 0) {
        App.seedResult = Lib.importBundle(seed, { replace: true });
        Lib.markSeedDone(tag);
      } else if (Lib.seedDone() !== tag) {
        Lib.markSeedDone(tag);   /* 玩家自己有内容，就不打扰了 */
      }
      if ($('btn-seed-load')) $('btn-seed-load').hidden = false;
    }

    /* 至少有一个大关 */
    if (!Lib.chapters().length) Lib.addChapter('第一大关');

    /* 编辑器起始内容：优先本地关卡库里的第一关 */
    const list = Lib.list();
    App.editLevel = list.length ? Lib.get(list[0].id)
      : Lib.blank(10, 8, Lib.autoName((Lib.chapters()[0] || {}).id), (Lib.chapters()[0] || {}).id);
    App.selChapter = App.editLevel.chapter || (Lib.chapters()[0] || {}).id;

    App.brush = { kind: 'device', type: 'push', s: 'R' };
    buildPalette();
    bind();
    refreshAll();

    /* 游玩页签默认停在选关界面 */
    App.screen = 'select';
    if (list.length) App.loadPlay(list[0].id);
    else App.loadPlay('__sandbox__');
    App.fromEdit = false;
    App.screen = 'select';

    resizeCanvas();
    setMode('play');
    updateCheckup();
    updateTitle();
    if (!Lib.storageOK) setHint('注意：浏览器禁用了本地存储，关卡请用「导出 JSON」保存。');
    if (App.seedResult && App.seedResult.levels) {
      App.toast('已载入内置关卡包：' + App.seedResult.chapters + ' 个大关 / ' +
        App.seedResult.levels + ' 关，去「▶ 游玩」里选关吧', 'ok');
    }
    root.requestAnimationFrame(loop);
  };

  if (doc && doc.readyState && doc.readyState !== 'loading') App.init();
  else if (doc) doc.addEventListener('DOMContentLoaded', App.init);

})(typeof globalThis !== 'undefined' ? globalThis : window);
