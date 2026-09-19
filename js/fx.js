/* =============================================================================
 * 机关谜题 — 动画/特效调度器
 * -----------------------------------------------------------------------------
 * 极简补间系统：所有动画都是「延迟 + 时长 + 进度 t」，由 requestAnimationFrame
 * 驱动。渲染层每帧读取 items 自行绘制，逻辑层只负责 add / whenIdle。
 * ========================================================================== */
(function (root) {
  'use strict';

  const FX = {};
  root.MPFx = FX;

  FX.items = [];
  FX._idle = null;
  FX.timeScale = 1;

  /* 缓动函数 */
  const E = FX.ease = {
    linear: function (t) { return t; },
    outQuad: function (t) { return 1 - (1 - t) * (1 - t); },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inCubic: function (t) { return t * t * t; },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    outBack: function (t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElasticSoft: function (t) {
      return t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 9);
    },
  };

  /* 加一个动画。o = { delay, dur, t, kind, ... } */
  FX.add = function (o) {
    o.elapsed = 0;
    o.t = 0;
    o.delay = o.delay || 0;
    o.dur = o.dur === undefined ? 0.24 : o.dur;
    FX.items.push(o);
    return o;
  };

  FX.clear = function () { FX.items.length = 0; if (FX._idle) { const r = FX._idle; FX._idle = null; r(); } };

  FX.busy = function () { return FX.items.length > 0; };

  /* 还活着的某类动画（渲染层用） */
  FX.of = function (kind) {
    return FX.items.filter(function (f) { return f.kind === kind && f.t > 0; });
  };

  FX.update = function (dt) {
    dt = dt * FX.timeScale;
    for (let i = FX.items.length - 1; i >= 0; i--) {
      const f = FX.items[i];
      f.elapsed += dt;
      const span = f.dur > 0 ? (f.elapsed - f.delay) / f.dur : 1;
      f.t = span <= 0 ? 0 : (span >= 1 ? 1 : span);
      if (span >= 1) {
        FX.items.splice(i, 1);
        if (f.onDone) f.onDone();
      }
    }
    if (!FX.items.length && FX._idle) {
      const r = FX._idle; FX._idle = null; r();
    }
  };

  /* 等所有动画播完 */
  FX.whenIdle = function () {
    if (!FX.items.length) return Promise.resolve();
    return new Promise(function (res) { FX._idle = res; });
  };

  /* 总时长（用来决定下一次输入何时解禁） */
  FX.remaining = function () {
    let m = 0;
    FX.items.forEach(function (f) { m = Math.max(m, f.delay + f.dur - f.elapsed); });
    return m;
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
