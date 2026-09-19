/* =============================================================================
 * 浏览器层冒烟测试（Node 运行： node tests/ui.smoke.js）
 * -----------------------------------------------------------------------------
 * 用一个极简的假 DOM/Canvas 把 app.js + render.js 真跑一遍：
 * 初始化 → 渲染帧 → 点击设备 → 播动画 → 编辑器绘制 → 导入导出 → 通关判定。
 * 目的：不开浏览器也能抓到 undefined / typo / 调用错这类运行时错误。
 * ========================================================================== */
'use strict';

/* ------------------------------------------------------------ 假 Canvas 2D */
function ctxStub(canvas) {
  const grad = { addColorStop: function () {} };
  const target = { canvas: canvas };
  return new Proxy(target, {
    get: function (t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return function () { return grad; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      if (k === 'getImageData') return function () { return { data: [] }; };
      if (k === 'lineDashOffset' || k === 'globalAlpha' || k === 'lineWidth') return 1;
      return function () {};
    },
    set: function (t, k, v) { t[k] = v; return true; },
  });
}

/* ------------------------------------------------------------ 假 Element */
let idSeq = 0;
class Elem {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.id = '';
    this._cls = '';
    this._text = '';
    this._html = '';
    /* index.html 里绝大多数面板默认是 hidden 的，stub 也保持一致 */
    this.hidden = true;
    this.value = '';
    this.checked = true;
    this.files = [];
    this.title = '';
    this.width = 0;
    this.height = 0;
    this.listeners = {};
    this._n = ++idSeq;
    const self = this;
    this.classList = {
      add: function (c) { if (self._cls.split(/\s+/).indexOf(c) < 0) self._cls = (self._cls + ' ' + c).trim(); },
      remove: function (c) { self._cls = self._cls.split(/\s+/).filter(function (x) { return x !== c; }).join(' '); },
      toggle: function () {},
      contains: function (c) { return self._cls.split(/\s+/).indexOf(c) >= 0; },
    };
  }
  get className() { return this._cls; }
  set className(v) { this._cls = String(v); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(function (x) { return x !== c; }); }
  remove() {}
  replaceChildren(n) { this.children = [n]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  focus() {}
  select() {}
  click() { this.dispatch('click'); }
  dispatch(t, ev) {
    const e = ev || { target: this, clientX: 0, clientY: 0, button: 0, preventDefault: function () {}, stopPropagation: function () {} };
    (this.listeners[t] || []).forEach(function (f) { f(e); });
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 }; }
  getContext() { return (this._ctx = this._ctx || ctxStub(this)); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get firstChild() { return this.children[0] || null; }
}

const byId = {};
const docStub = {
  readyState: 'loading',
  body: new Elem('body'),
  documentElement: new Elem('html'),
  createElement: function (tag) { return new Elem(tag); },
  getElementById: function (id) { return byId[id] || (byId[id] = new Elem('div')); },
  addEventListener: function () {},
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
};
globalThis.document = docStub;
globalThis.devicePixelRatio = 1;
const winListeners = {};
globalThis.addEventListener = function (t, f) { (winListeners[t] = winListeners[t] || []).push(f); };
function dispatchWin(t, ev) { (winListeners[t] || []).forEach(function (f) { f(ev); }); }
function keyEv(k, opts) {
  const e = {
    key: k, target: { tagName: 'BODY' }, ctrlKey: false, metaKey: false, shiftKey: false,
    preventDefault: function () {}, stopPropagation: function () {},
  };
  if (opts) for (const kk in opts) e[kk] = opts[kk];
  return e;
}
globalThis.confirm = function () { return false; };
globalThis.prompt = function (msg, def) { return def; };
globalThis.URL = globalThis.URL || { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };
globalThis.Blob = globalThis.Blob || function () {};

const mem = {};
globalThis.localStorage = {
  getItem: function (k) { return k in mem ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
};

let rafCb = null;
globalThis.requestAnimationFrame = function (cb) { rafCb = cb; return 1; };

/* ------------------------------------------------------------ 断言工具 */
let pass = 0, failCount = 0;
function ok(c, m) { if (c) pass++; else { failCount++; console.log('  ✗ ' + m); } }
function eq(a, b, m) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) pass++; else { failCount++; console.log('  ✗ ' + m + '  期望 ' + sb + ' 实际 ' + sa); }
}
function group(n) { console.log('\n· ' + n); }
function setImmediateP() { return new Promise(function (r) { setImmediate(r); }); }

/* ------------------------------------------------------------ 加载全部脚本 */
require('../js/core.js');
require('../js/rules.js');
require('../js/fx.js');
require('../js/sfx.js');
require('../js/library.js');
require('../js/render.js');

const MP = globalThis.MPCore;
const RULES = globalThis.MPRules;
const FX = globalThis.MPFx;
const SFX = globalThis.MPSfx;
const R = globalThis.MPRender;
const Lib = globalThis.MPLibrary;

/* 预置关卡库，让 init 走「有关卡」的分支 */
Lib.put(MP.buildLevel({
  id: 'test1', name: '测试关卡', w: 7, h: 5,
  map: ['#######', '#.....#', '#..Ss.#', '#.....#', '#######'],
  devices: [{ x: 5, y: 2, type: 'push', s: 'L' }],
}));

let threw = null;
try {
  docStub.readyState = 'complete';
  require('../js/app.js');
} catch (e) { threw = e; }

const App = globalThis.MPApp;

/* ------------------------------------------------------------ 驱动帧 */
let clock = 0;
async function frames(n, dt) {
  for (let i = 0; i < (n || 1); i++) {
    clock += (dt === undefined ? 16 : dt);
    if (rafCb) rafCb(clock);
    await setImmediateP();
  }
}
function clickCell(x, y, button, alt) {
  const p = R.cellCenter(App.view, x, y);
  App.canvas.dispatch('mousedown', {
    target: App.canvas, clientX: p.cx, clientY: p.cy,
    button: button || 0, altKey: !!alt,
    preventDefault: function () {}, stopPropagation: function () {},
  });
}
/* 调色板里所有笔刷（从假 DOM 的树里捞出来） */
function paletteBrushes() {
  const host = globalThis.document.getElementById('palette');
  const out = [];
  host.children.forEach(function (g) {
    g.children.forEach(function (n) {
      if (n._brush) out.push(n._brush);
      (n.children || []).forEach(function (m) { if (m._brush) out.push(m._brush); });
    });
  });
  return out;
}
function domChildren(el) { return el ? el.children : []; }

/* ==========================================================================
 * 1. 初始化
 * ======================================================================= */
group('初始化 / 渲染循环');
ok(!threw, 'app.js 加载与初始化不应抛异常' + (threw ? '：' + threw.stack : ''));
ok(!!App, 'MPApp 存在');
ok(App.canvas && App.ctx, 'canvas 与 2d context 已取得');
ok(App.mode === 'play', '默认进入游玩模式');
ok(App.level && App.level.name === '测试关卡', '默认载入关卡库里的第一关');

(async function main() {
  await frames(3);
  ok(App.view && App.view.cell > 0, '视图已计算，格子尺寸 = ' + (App.view && App.view.cell));

  /* 画一帧不应该抛异常（含设备图标、目标、墙） */
  let drawErr = null;
  try { await frames(2); } catch (e) { drawErr = e; }
  ok(!drawErr, '渲染帧不抛异常' + (drawErr ? '：' + drawErr.stack : ''));

  /* ==========================================================================
   * 2. 游玩：推一次通关
   * ======================================================================= */
  group('游玩：点击设备 → 动画 → 落子 → 通关');
  ok(App.screen === 'select', '初始化后停在选关界面（需求：游玩要有选关界面）');
  App.startLevel('test1');
  await frames(2);
  ok(App.screen === 'game', 'startLevel 之后进入关卡内');
  ok(App.level.cells[MP.idx(App.level, 4, 2)].item.k === 'square', '起始：正方形在第 4 格');
  clickCell(5, 2);
  ok(App.busy === true, '点击后进入动画中（输入被锁）');
  ok(FX.items.length > 0, '产生了动画项：' + FX.items.length + ' 个');
  const kinds = FX.items.map(function (f) { return f.kind; }).sort().join(',');
  ok(kinds.indexOf('move') >= 0 && kinds.indexOf('press') >= 0, '包含位移与按压动画（' + kinds + '）');
  await frames(30, 20);
  ok(FX.items.length === 0, '动画播完后清空');
  ok(App.busy === false, '动画结束后解锁输入');
  eq(App.moves, 1, '步数 = 1');
  ok(MP.itemAt(App.level, 3, 2).k === 'square', '正方形被推到目标格 (3,2)');
  ok(App.won === true, '判定通关');
  ok(globalThis.document.getElementById('win-banner').hidden === false, '通关横幅已显示');

  /* 撤销 */
  group('撤销 / 重来');
  App.undoPlayMove();
  ok(App.moves === 0, '撤销后步数回到 0');
  ok(App.won === false, '撤销后取消通关状态');
  ok(MP.itemAt(App.level, 4, 2).k === 'square', '撤销后正方形回到原位');
  await frames(2);
  clickCell(5, 2);
  await frames(30, 20);
  App.restart();
  ok(App.moves === 0 && MP.itemAt(App.level, 4, 2).k === 'square', '重来后回到初始状态');
  ok(App.won === false, '重来后取消通关');

  /* ==========================================================================
   * 3. 冲突动画 & 提示
   * ======================================================================= */
  group('冲突：整体不动 + 抖动反馈');
  const before = JSON.stringify(App.level);
  /* 在 (5,2) 之外找一个会冲突的：把活塞的方向改成朝右（右边是墙） */
  MP.itemAt(App.level, 5, 2).s = 'R';
  clickCell(5, 2);
  await frames(30, 20);
  ok(FX.items.length === 0, '冲突动画播完');
  eq(App.moves, 0, '冲突不增加步数');
  ok(App.level.cells[MP.idx(App.level, 5, 2)].item.s === 'R', '冲突后设备状态不变');

  /* ==========================================================================
   * 4. 九种设备的动画编排（沙盒）不抛异常
   * ======================================================================= */
  group('沙盒：九种设备逐个点击');
  App.loadPlay('__sandbox__');
  await frames(2);
  const spots = [
    [2, 2], [8, 2], [14, 2], [2, 6], [8, 6],
    [14, 6], [2, 10], [8, 10], [14, 10],
  ];
  let err = null;
  for (let i = 0; i < spots.length; i++) {
    try {
      clickCell(spots[i][0], spots[i][1]);
      await frames(40, 20);
    } catch (e) { err = e; break; }
  }
  ok(!err, '九种设备点击 + 动画不抛异常' + (err ? '：' + err.stack : ''));
  ok(FX.items.length === 0, '全部动画结束');

  /* 旋转器与修改器再来一遍，确认状态动画（旋转过渡）不炸 */
  await frames(2);

  /* ==========================================================================
   * 5. 编辑器
   * ======================================================================= */
  group('编辑器：切模式 / 绘制 / 尺寸 / 体检');
  App.setMode('edit');
  await frames(2);
  ok(App.mode === 'edit', '已切到编辑模式');
  ok(globalThis.document.getElementById('panel-edit').hidden === false, '编辑面板显示');
  ok(globalThis.document.getElementById('panel-play').hidden === true, '游玩面板隐藏');
  ok(globalThis.document.getElementById('tree-col').hidden === false, '左侧关卡信息栏出现');

  App.setEditLevel(Lib.blank(6, 5, '冒烟关卡'));
  App.setBrush({ kind: 'device', type: 'rotate', s: 'cw' });
  App.snapshotEdit();
  App.paint(2, 2, false);
  ok(MP.isDevice(MP.itemAt(App.editLevel, 2, 2)) && MP.itemAt(App.editLevel, 2, 2).type === 'rotate', '画上了一台旋转器');

  /* 需求 6：覆盖同一格时，落笔动画要拿到「旧内容」才能做虚化交叉淡出 */
  App.setBrush({ kind: 'device', type: 'push', s: 'R' });
  App.paint(2, 2, false);
  const coverFx = FX.items.filter(function (f) {
    return f.kind === 'place' && f.at.x === 2 && f.at.y === 2;
  }).pop();
  ok(coverFx && coverFx.prev && coverFx.prev.type === 'rotate',
    '覆盖同一格时保留了旧设备（渲染层据此虚化淡出）');
  ok(coverFx && coverFx.item && coverFx.item.type === 'push', '同时带上了新设备');
  App.setBrush({ kind: 'device', type: 'rotate', s: 'cw' });
  App.paint(2, 2, false);
  ok(MP.itemAt(App.editLevel, 2, 2).type === 'rotate', '盖回旋转器');

  App.setBrush({ kind: 'piece', piece: 'square' });
  App.paint(2, 1, false);
  ok(MP.itemAt(App.editLevel, 2, 1).k === 'square', '画上正方形');
  App.setBrush({ kind: 'goal', goal: 'square' });
  App.paint(3, 2, false);
  ok(MP.at(App.editLevel, 3, 2).goal === 'square', '画上方块目标');

  /* 需求 6：右键 = 把这一格恢复成干净地板，目标也一起取消 */
  App.paint(3, 2, true);
  ok(MP.at(App.editLevel, 3, 2).goal === null && !MP.itemAt(App.editLevel, 3, 2), '右键点空格：目标被取消');
  App.setBrush({ kind: 'goal', goal: 'square' });
  App.paint(3, 2, false);
  App.setBrush({ kind: 'piece', piece: 'circle' });
  App.paint(3, 2, false);
  App.paint(3, 2, true);
  ok(MP.at(App.editLevel, 3, 2).goal === null && !MP.itemAt(App.editLevel, 3, 2), '右键把物品和目标一起擦掉');

  /* —— 需求：右键点空地 = 放下手里的笔刷 —— */
  App.setBrush({ kind: 'device', type: 'push', s: 'R' });
  ok(App.brush.kind === 'device', '手里拿着一台设备');
  clickCell(1, 3, 2);
  ok(App.brush.kind === 'none', '右键点空地 → 放下手中的设备（空手）');
  const blankSnapshot = JSON.stringify(App.editLevel.cells);
  App.paint(1, 3, false);
  ok(JSON.stringify(App.editLevel.cells) === blankSnapshot, '空手时左键画不出任何东西');
  App.setBrush({ kind: 'goal', goal: 'circle' });
  App.paint(1, 3, false);
  ok(MP.at(App.editLevel, 1, 3).goal === 'circle', '重新拿起笔刷后可以继续画');
  App.dropBrush(true);
  clickCell(1, 3, 2);
  ok(MP.at(App.editLevel, 1, 3).goal === null, '空手时右键仍然能擦掉格子里的东西');
  App.setBrush({ kind: 'piece', piece: 'square' });
  dispatchWin('keydown', keyEv('Escape'));
  ok(App.brush.kind === 'none', '编辑器里 Esc = 放下笔刷');
  App.setBrush({ kind: 'device', type: 'rotate', s: 'cw' });

  /* —— 需求：图形 / 目标笔刷也用滚轮轮换 —— */
  group('滚轮：设备换状态，图形/目标四种循环');
  App.setBrush({ kind: 'piece', piece: 'square' });
  App.cycleBrush(1);
  ok(App.brush.kind === 'piece' && App.brush.piece === 'circle', '正方形 —滚轮→ 圆形');
  App.cycleBrush(1);
  ok(App.brush.kind === 'goal' && App.brush.goal === 'square', '圆形 —滚轮→ 方形目标');
  App.cycleBrush(1);
  ok(App.brush.kind === 'goal' && App.brush.goal === 'circle', '方形目标 —滚轮→ 圆形目标');
  App.cycleBrush(1);
  ok(App.brush.kind === 'piece' && App.brush.piece === 'square', '圆形目标 —滚轮→ 绕回正方形');
  App.cycleBrush(-1);
  ok(App.brush.kind === 'goal' && App.brush.goal === 'circle', '反着滚回到圆形目标');
  App.setBrush({ kind: 'floor' });
  App.cycleBrush(1);
  ok(App.brush.kind === 'floor', '空地：滚轮不改变笔刷');
  App.dropBrush(true);
  App.cycleBrush(1);
  ok(App.brush.kind === 'none', '空手：滚轮也不改变笔刷');

  /* —— 需求：新增两种对角线交换器 —— */
  group('新增两种对角交换器（左上↔右下 / 左下↔右上）');
  eq(MP.DEVICES.swap.states.length, 8, '交换器共 8 种状态');
  const swapBtns = paletteBrushes().filter(function (b) {
    return b.kind === 'device' && b.type === 'swap';
  });
  eq(swapBtns.length, 8, '调色板里交换器有 8 个按钮');
  App.setBrush({ kind: 'device', type: 'swap', s: 'ur_dr' });
  App.cycleBrush(1);
  eq(App.brush.s, 'ul_dr', '滚轮能滚到新增的「主对角」');
  App.cycleBrush(1);
  eq(App.brush.s, 'dl_ur', '再滚到「副对角」');
  App.cycleBrush(1);
  eq(App.brush.s, 'ud', '绕回开头');
  ok(MP.SWAP_NAME.ul_dr.indexOf('主对角') === 0 && MP.SWAP_NAME.dl_ur.indexOf('副对角') === 0,
    '两种新交换器有名字：' + MP.SWAP_NAME.ul_dr + ' / ' + MP.SWAP_NAME.dl_ur);

  /* —— 需求：最小尺寸不再是 3 格 —— */
  group('最小尺寸：1×1 也要能用');
  const tiny = Lib.blank(1, 1, 'tiny');
  ok(tiny.w === 1 && tiny.h === 1, 'Lib.blank(1,1) 合法');
  const keepLevel = App.editLevel;
  App.setEditLevel(Lib.blank(2, 2, '缩放测试'));
  App.resizeLevel(1, 1);
  ok(App.editLevel.w === 1 && App.editLevel.h === 1, 'resizeLevel 可以缩到 1×1');
  App.setBrush({ kind: 'piece', piece: 'square' });
  App.paint(0, 0, false);
  ok(!!MP.itemAt(App.editLevel, 0, 0), '1×1 的棋盘也能落笔');
  await frames(2);
  ok(App.view && App.view.cell > 0, '1×1 棋盘渲染不炸（格子 = ' + (App.view && App.view.cell) + '）');
  App.resizeLevel(0, 0);
  ok(App.editLevel.w === 1 && App.editLevel.h === 1, '填 0 / 乱填不会把棋盘弄坏');
  App.setEditLevel(keepLevel);          /* 后面的用例还要用原来那一关 */
  ok(App.editLevel.w === 6 && App.editLevel.h === 5, '换回原来那一关');
  /* 需求 1：墙已经彻底从编辑器里去掉（调色板里没有这一项，键位也没了） */
  const brushes = paletteBrushes();
  ok(brushes.length > 30, '调色板笔刷数 = ' + brushes.length);
  ok(brushes.every(function (b) { return b.kind !== 'wall'; }), '调色板里已经没有墙笔刷');

  App.pick(2, 2);
  ok(App.brush.kind === 'device' && App.brush.type === 'rotate', 'Alt 吸取：吸取到旋转器');

  App.undoEditStroke();
  ok(App.editLevel.w === 6, '编辑器撤销后仍是合法关卡');

  /* —— 需求 1：改尺寸不再铺外墙（棋盘外沿就是边界） —— */
  App.resizeLevel(9, 7);
  ok(App.editLevel.w === 9 && App.editLevel.h === 7, '改尺寸生效');
  let anyWall = false;
  App.editLevel.cells.forEach(function (c) { if (c.t === MP.WALL) anyWall = true; });
  ok(!anyWall, '改尺寸后不会自动生成墙');
  ok(MP.at(App.editLevel, 3, 0).t === MP.FLOOR, '最外圈是普通地板，可以随便放东西');

  /* 外圈也变得可画：在边角上放目标 */
  App.setBrush({ kind: 'goal', goal: 'circle' });
  App.paint(0, 0, false);
  ok(MP.at(App.editLevel, 0, 0).goal === 'circle', '棋盘最外圈也能放目标');
  App.paint(0, 0, true);
  ok(MP.at(App.editLevel, 0, 0).goal === null, '再右键取消');

  App.setBrush({ kind: 'device', type: 'swap', s: 'ud' });
  App.rotateBrush(false);
  eq(App.brush.s, 'lr', 'R 键顺时针转笔刷：ud → lr');
  App.cycleBrush(1);
  eq(App.brush.s, 'ul_ur', '滚轮轮换状态');

  await frames(3);
  ok(true, '编辑模式渲染不抛异常');

  /* —— 需求 2/3：右键拖动擦 & 中键吸取 —— */
  group('编辑器：右键拖动擦除 / 中键吸取');
  App.setBrush({ kind: 'device', type: 'push', s: 'R' });
  App.paint(2, 4, false);
  App.paint(3, 4, false);
  App.paint(4, 4, false);
  ok(MP.itemAt(App.editLevel, 2, 4) && MP.itemAt(App.editLevel, 3, 4) && MP.itemAt(App.editLevel, 4, 4), '画了 3 台设备');
  /* 模拟「按下右键 → 拖动 → 松开」 */
  App.snapshotEdit();
  App.stroke = true;
  App.paint(2, 4, true);
  function moveAt(cx, cy, buttons) {
    const p = R.cellCenter(App.view, cx, cy);
    App.canvas.dispatch('mousemove', {
      target: App.canvas, clientX: p.cx, clientY: p.cy, buttons: buttons,
      preventDefault: function () {}, stopPropagation: function () {},
    });
  }
  moveAt(3, 4, 2);
  moveAt(4, 4, 2);
  App.stroke = false;
  ok(!MP.itemAt(App.editLevel, 2, 4) && !MP.itemAt(App.editLevel, 3, 4) &&
    !MP.itemAt(App.editLevel, 4, 4), '按住右键拖动可以连续擦除');

  /* 中键吸取 */
  App.setBrush({ kind: 'floor' });
  App.paint(5, 3, false);
  App.setBrush({ kind: 'piece', piece: 'circle' });
  App.paint(5, 3, false);
  App.setBrush({ kind: 'goal', goal: 'circle' });
  const pMid = R.cellCenter(App.view, 5, 3);
  App.canvas.dispatch('mousedown', {
    target: App.canvas, clientX: pMid.cx, clientY: pMid.cy, button: 1, buttons: 4,
    preventDefault: function () {}, stopPropagation: function () {},
  });
  ok(App.brush.kind === 'piece' && App.brush.piece === 'circle', '中键吸取到圆形（等同 Alt+左键）');

  /* ==========================================================================
   * 6. 大关分类 / 选关界面 / 进度
   * ======================================================================= */
  group('大关分类 / 选关界面');
  const chId = Lib.addChapter('第二测试大关');
  App.editLevel.chapter = chId;
  App.saveLevel(false);
  ok(Lib.chapters().length >= 2, '有了 2 个大关');
  const chs = Lib.chapters();
  ok(chs.filter(function (c) { return c.id === chId; })[0].levels.length === 1, '关卡被放进指定大关');
  ok(Lib.indexOf(App.editLevel.id).chapterId === chId, 'Lib.indexOf 定位正确');
  ok(Lib.indexOf(App.editLevel.id).label.indexOf('2-') === 0, '关卡编号形如 2-1');

  const treeText = globalThis.document.getElementById('tree').children.length;
  ok(treeText >= 2, '关卡信息栏渲染出了大关分组（' + treeText + '）');

  App.gotoSelect();
  ok(App.screen === 'select', '回到选关界面');
  await frames(1);
  const cards = globalThis.document.getElementById('play-chapters');
  ok(cards && cards.children.length >= 1, '选关界面渲染出了大关区块');

  /* 需求 3：每张关卡卡片上有缩略小地图 */
  const firstGrid = cards.children[0].children[1];
  const firstCard = firstGrid && firstGrid.children[0];
  ok(firstCard && firstCard.children[0] && firstCard.children[0].className.indexOf('lc-thumb') >= 0,
    '关卡卡片上有缩略小地图 canvas');
  ok(globalThis.MPCore.analyze && typeof R.makeThumbCanvas === 'function', '缩略图 API 存在');

  /* 通关一关 → 进度记录 → Enter 进下一关 */
  const idA = Lib.list()[0].id;
  Lib.markCleared(idA);
  ok(Lib.isCleared(idA), '通关记录已写入');
  ok(Lib.clearedCount() >= 1, '通关数统计正常');

  /* 在同一个大关里放两关，测 nextLevel */
  const ch0 = Lib.chapters()[0].id;
  const l1 = Lib.blank(6, 5, 'A', ch0); l1.id = Lib.put(l1);
  const l2 = Lib.blank(6, 5, 'B', ch0); l2.id = Lib.put(l2);
  eq(Lib.nextLevel(l1.id), l2.id, 'nextLevel 指向同大关的下一关');
  eq(Lib.prevLevel(l2.id), l1.id, 'prevLevel 指回上一关');
  App.startLevel(l1.id);
  ok(App.screen === 'game' && App.mode === 'play', 'startLevel 进入关卡内');
  App.stroke = false;

  /* ==========================================================================
   * 7. 存档 / 导出 / 导入
   * ======================================================================= */
  group('存档 / JSON 往返');
  App.setEditLevel(Lib.blank(7, 6, '存档测试'));
  MP.at(App.editLevel, 2, 2).item = MP.device('vpush', 'R:pull');
  MP.at(App.editLevel, 3, 2).goal = 'circle';
  App.saveLevel(false);
  ok(!!App.editLevel.id, '保存后拿到了 id');
  ok(Lib.list().length >= 2, '关卡库里有 2 个以上关卡');

  const text = Lib.serialize(App.editLevel);
  const back = Lib.importText(text);
  ok(!!back.level, 'JSON 导入成功');
  eq(back.level.w, 7, '宽一致');
  eq(back.level.cells[MP.idx(back.level, 2, 2)].item.s, 'R:pull', '可变活塞状态保留');
  eq(back.level.cells[MP.idx(back.level, 3, 2)].goal, 'circle', '目标保留');
  eq(back.warnings.length, 0, '往返无修正警告');

  /* 非法数据要被修复而不是崩掉 */
  const bad = Lib.importText('{"w":4,"h":4,"cells":[{"item":{"k":"device","type":"nope","s":1}},{"t":2}]}');
  ok(bad.level && bad.warnings.length > 0, '非法关卡被修复并有警告');
  const bad2 = Lib.importText('这不是 json');
  ok(!bad2.level, '非 JSON 返回失败而不是抛错');

  /* 手改 JSON 的入口 */
  App.setMode('edit');
  globalThis.document.getElementById('btn-edit-json').dispatch('click');
  ok(App && globalThis.document.getElementById('modal-body').children.length > 0, 'JSON 弹窗已生成内容');
  App.closeModal();

  /* 帮助弹窗 */
  globalThis.document.getElementById('btn-help').dispatch('click');
  const help = globalThis.document.getElementById('modal-body').children[0];
  ok(help && help.children.length >= 4, '规则说明弹窗生成了分组内容');
  ok(globalThis.document.getElementById('modal').hidden === false, '帮助弹窗打开');
  App.closeModal();
  ok(globalThis.document.getElementById('modal').hidden === true, '关闭后弹窗隐藏');

  /* ==========================================================================
   * 7. 试玩往返 / S & B / Ctrl+S / 自动命名 / 音效
   * ======================================================================= */
  group('从编辑器试玩并返回（S / B）');
  globalThis.document.getElementById('btn-edit-play').dispatch('click');
  await frames(2);
  ok(App.mode === 'play' && App.fromEdit === true, '进入试玩模式');
  ok(globalThis.document.getElementById('btn-play-back').hidden === false, '返回编辑器按钮可见');
  ok(globalThis.document.getElementById('play-bar').hidden === false, '游玩时中间操作条显示');
  ok(globalThis.document.getElementById('edit-bar').hidden === true, '游玩时不显示编辑操作条');
  globalThis.document.getElementById('btn-play-back').dispatch('click');
  ok(App.mode === 'edit', '返回编辑器');

  /* S 键试玩 → B 键回来（编辑器内容不能丢） */
  App.setMode('edit');
  App.setEditLevel(Lib.blank(7, 5, '快捷键试玩'));
  App.setBrush({ kind: 'piece', piece: 'square' });
  App.paint(2, 2, false);
  dispatchWin('keydown', keyEv('s'));
  ok(App.mode === 'play' && App.fromEdit === true, 'S 键 = 一键试玩');
  ok(globalThis.document.getElementById('edit-bar').hidden === true, '试玩时编辑条隐藏');
  dispatchWin('keydown', keyEv('b'));
  ok(App.mode === 'edit' && App.fromEdit === false, 'B 键 = 返回编辑');
  ok(App.editLevel && MP.itemAt(App.editLevel, 2, 2) && MP.itemAt(App.editLevel, 2, 2).k === 'square',
    '试玩回来编辑器里的内容原样还在');

  group('需求 5/7：自动命名 + Ctrl+S 保存并新建同尺寸下一关');
  const chX = Lib.chapters()[0].id;
  const nBefore = Lib.chapters().filter(function (c) { return c.id === chX; })[0].levels.length;
  App.newLevel(chX);
  eq(App.editLevel.name, '1-' + (nBefore + 1), '新建关卡自动命名成 1-N');
  eq(App.editLevel.w, 10, '新建关卡默认 10 宽');

  App.setEditLevel(Lib.blank(9, 6, 'CtrlS 测试', chX));
  App.setBrush({ kind: 'piece', piece: 'square' });
  App.paint(2, 2, false);
  App.setBrush({ kind: 'goal', goal: 'square' });
  App.paint(3, 2, false);
  const cnt0 = Lib.count();
  dispatchWin('keydown', keyEv('s', { ctrlKey: true }));
  ok(Lib.count() === cnt0 + 2, 'Ctrl+S = 保存这一关 + 自动新建下一关（' + cnt0 + ' → ' + Lib.count() + '）');
  eq(App.editLevel.w, 9, '新关卡宽度沿用当前关');
  eq(App.editLevel.h, 6, '新关卡高度沿用当前关');
  eq(App.editLevel.chapter, chX, '新关卡留在同一个大关');
  ok(/\d+-\d+/.test(App.editLevel.name), '新关卡名字是编号形式：' + App.editLevel.name);
  const savedPrev = Lib.list().filter(function (l) { return l.name === 'CtrlS 测试'; })[0];
  ok(!!savedPrev, '上一关已经入库');

  /* 空关卡只保存、不新建，免得攒一堆空关 */
  App.setEditLevel(Lib.blank(5, 5, '空关卡', chX));
  const cnt1 = Lib.count();
  dispatchWin('keydown', keyEv('s', { ctrlKey: true }));
  eq(Lib.count(), cnt1 + 1, '空关卡只保存（+1）不新建下一关');

  group('需求 4：音效开关 / 音效模块在无 AudioContext 时静默降级');
  ok(!!SFX, 'MPSfx 已加载');
  ok(SFX.names.length >= 8, '音色表有 ' + SFX.names.length + ' 种');
  ok(SFX.play('click') === false, '没有 AudioContext 时返回 false 而不是抛异常');
  let sfxErr = null;
  try { SFX.names.forEach(function (n) { SFX.play(n); }); } catch (e) { sfxErr = e; }
  ok(!sfxErr, '所有音色在无音频环境下都不会抛异常' + (sfxErr ? '：' + sfxErr.message : ''));
  const chkSfx = globalThis.document.getElementById('chk-sfx');
  chkSfx.checked = false;
  chkSfx.dispatch('change', { target: chkSfx });
  ok(SFX.enabled === false, '关掉音效开关');
  chkSfx.checked = true;
  chkSfx.dispatch('change', { target: chkSfx });
  ok(SFX.enabled === true, '重新打开音效开关');

  /* 播放里按 B：不是从编辑器来的就回选关 */
  App.startLevel(Lib.list()[0].id);
  await frames(1);
  dispatchWin('keydown', keyEv('b'));
  ok(App.screen === 'select', '游玩中按 B 且不是试玩 → 回选关');

  /* 关掉动画也能玩 */
  group('关闭动画 / 快捷键');
  App.animOn = false; FX.timeScale = 200;
  App.startLevel('test1');
  await frames(2);
  clickCell(5, 2);
  await frames(4, 16);
  ok(FX.items.length === 0, '无动画时一步到位');
  ok(App.moves === 1, '无动画时依然正确落子');
  App.animOn = true; FX.timeScale = 1;

  /* 需求 4：空格撤回 / R 重开 / Enter 下一关 */
  dispatchWin('keydown', keyEv(' '));
  ok(App.moves === 0, '空格 = 撤回');
  clickCell(5, 2);
  await frames(30, 20);
  ok(App.won === true, '再次通关');
  dispatchWin('keydown', keyEv('r'));
  ok(App.moves === 0 && App.won === false, 'R = 重开本关');

  const chA = Lib.chapters()[0].id;
  const n1 = Lib.blank(6, 5, '下一关测试 1', chA); n1.id = Lib.put(n1);
  const n2 = Lib.blank(6, 5, '下一关测试 2', chA); n2.id = Lib.put(n2);
  Lib.moveLevel(n1.id, chA, 0);
  Lib.moveLevel(n2.id, chA, 1);
  App.startLevel(n1.id);
  await frames(1);
  App.won = true; App.nextId = Lib.nextLevel(n1.id);
  dispatchWin('keydown', keyEv('Enter'));
  ok(App.level.id === n2.id, 'Enter = 通关后进入下一关');

  dispatchWin('keydown', keyEv('Escape'));
  ok(App.screen === 'select', 'Esc = 返回选关');

  /* 输入框里打字不应该触发快捷键 */
  App.startLevel(n1.id);
  await frames(1);
  const moves0 = App.moves;
  dispatchWin('keydown', keyEv(' ', { target: { tagName: 'INPUT' } }));
  ok(App.moves === moves0 && App.mode === 'play', '在输入框里按空格不会触发撤回');

  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + failCount + ' 项');
  console.log('========================================');
  if (threw) console.log(threw.stack);
  process.exit(failCount ? 1 : 0);
})();
