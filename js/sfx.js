/* =============================================================================
 * 机关谜题 — 音效（WebAudio 实时合成，不需要任何素材文件）
 * -----------------------------------------------------------------------------
 * 设计原则：
 *   1. 全是短音（30~350ms），不占内存、不联网、不会和动画抢时间。
 *   2. 浏览器要求「用户手势之后」才能出声，所以第一次点击时自动初始化；
 *      初始化失败（老浏览器 / 无声卡）一律静默降级，绝不抛错。
 *   3. 在 Node 里 require 也完全安全：没有 AudioContext 就全部变成空操作。
 *
 * 用法：  MPSfx.play('push')
 * ========================================================================== */
(function (root) {
  'use strict';

  const Sfx = {};
  root.MPSfx = Sfx;

  const KEY = 'mp.sfx.v1';

  Sfx.enabled = true;
  try {
    if (root.localStorage && root.localStorage.getItem(KEY) === '0') Sfx.enabled = false;
  } catch (e) { /* 隐私模式：忽略 */ }

  let ac = null;          /* AudioContext */
  let master = null;      /* 总音量 */
  let noiseBuf = null;    /* 复用同一段白噪声 */
  let broken = false;     /* 初始化失败就再也不要试了 */

  function Ctor() { return root.AudioContext || root.webkitAudioContext; }

  /* 拿到可用的 AudioContext；不可用返回 null */
  function ensure() {
    if (broken || !Sfx.enabled) return null;
    const C = Ctor();
    if (!C) { broken = true; return null; }
    try {
      if (!ac) {
        ac = new C();
        master = ac.createGain();
        master.gain.value = 0.17;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended' && ac.resume) ac.resume();
      return ac;
    } catch (e) { broken = true; return null; }
  }
  Sfx.init = function () { ensure(); };

  Sfx.setEnabled = function (v) {
    Sfx.enabled = !!v;
    try { if (root.localStorage) root.localStorage.setItem(KEY, Sfx.enabled ? '1' : '0'); } catch (e) {}
    if (Sfx.enabled) ensure();
  };
  Sfx.toggle = function () { Sfx.setEnabled(!Sfx.enabled); return Sfx.enabled; };

  function now() { return ac.currentTime; }

  /* 一个带包络的振荡器音 */
  function tone(t0, freq, dur, o) {
    o = o || {};
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to && o.to !== freq && osc.frequency.exponentialRampToValueAtTime) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    }
    const peak = (o.gain === undefined ? 0.6 : o.gain);
    const atk = o.atk === undefined ? 0.006 : o.atk;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(o.dest || master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /* 一小段噪声（撞击感 / 空气感） */
  function noise(t0, dur, o) {
    o = o || {};
    if (!noiseBuf) {
      const n = Math.max(1, Math.floor(ac.sampleRate * 0.4));
      noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 500, t0);
    if (o.to && f.frequency.exponentialRampToValueAtTime) {
      f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + dur);
    }
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain === undefined ? 0.35 : o.gain), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  /* ---------------------------------------------------------------------------
   * 具体音色
   * ------------------------------------------------------------------------ */
  const RECIPES = {
    /* 通用点击：很轻的「嗒」 */
    tick: function (t) { tone(t, 1150, 0.035, { type: 'sine', gain: 0.22, to: 880 }); },

    /* 选中笔刷 / 按钮 */
    click: function (t) {
      tone(t, 720, 0.05, { type: 'triangle', gain: 0.3, to: 560 });
      noise(t, 0.03, { freq: 2600, filter: 'highpass', gain: 0.12 });
    },

    /* 画上一格东西 */
    place: function (t) {
      tone(t, 430, 0.075, { type: 'triangle', gain: 0.34, to: 620 });
      noise(t, 0.035, { freq: 3200, filter: 'highpass', gain: 0.1 });
    },

    /* 擦掉一格 */
    erase: function (t) {
      tone(t, 340, 0.085, { type: 'triangle', gain: 0.3, to: 150 });
      noise(t, 0.05, { freq: 1400, to: 400, gain: 0.16 });
    },

    /* 推动：先「咔」后「咚」，尾声短 */
    push: function (t) {
      noise(t, 0.055, { freq: 1800, to: 500, gain: 0.3 });
      tone(t, 165, 0.13, { type: 'square', gain: 0.4, to: 92 });
      noise(t + 0.02, 0.09, { freq: 320, to: 90, gain: 0.3 });
    },

    /* 拉动：低音往上滑，听起来像「吸回来」 */
    pull: function (t) {
      noise(t, 0.05, { freq: 900, to: 2200, gain: 0.14 });
      tone(t, 120, 0.14, { type: 'square', gain: 0.36, to: 285 });
      tone(t + 0.02, 480, 0.08, { type: 'sine', gain: 0.2, to: 900 });
    },

    /* 旋转：两个短促上行音 */
    rotate: function (t) {
      tone(t, 620, 0.05, { type: 'triangle', gain: 0.3, to: 700 });
      tone(t + 0.055, 840, 0.055, { type: 'triangle', gain: 0.28, to: 980 });
    },

    /* 交换：一声上滑加一声下滑，像东西换了个位 */
    swap: function (t) {
      tone(t, 460, 0.16, { type: 'sine', gain: 0.32, to: 900 });
      tone(t + 0.02, 900, 0.14, { type: 'triangle', gain: 0.18, to: 500 });
      noise(t, 0.06, { freq: 2000, filter: 'highpass', gain: 0.1 });
    },

    /* 修改器：像一道激光 */
    beam: function (t) {
      tone(t, 1500, 0.12, { type: 'sawtooth', gain: 0.16, to: 2600 });
      tone(t + 0.02, 2600, 0.08, { type: 'sine', gain: 0.16, to: 1800 });
    },

    /* 冲突：两声闷闷的下行，明确表示「不行」 */
    reject: function (t) {
      tone(t, 172, 0.1, { type: 'sawtooth', gain: 0.3, to: 140 });
      tone(t + 0.09, 138, 0.14, { type: 'sawtooth', gain: 0.26, to: 108 });
      noise(t, 0.06, { freq: 260, gain: 0.14 });
    },

    /* 通关：C-E-G-C 琶音 + 一层柔和的五度垫音 */
    win: function (t) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (f, i) {
        tone(t + i * 0.085, f, 0.5 - i * 0.05, { type: 'sine', gain: 0.34, atk: 0.012 });
      });
      tone(t, 261.63, 0.75, { type: 'triangle', gain: 0.12, atk: 0.05 });
      tone(t + 0.34, 1567.98, 0.4, { type: 'sine', gain: 0.14, atk: 0.05 });
    },
  };

  Sfx.names = Object.keys(RECIPES);

  /* 播放。名字不认识就悄悄忽略（方便以后加音色） */
  Sfx.play = function (name, delay) {
    if (broken || !Sfx.enabled) return false;
    const recipe = RECIPES[name];
    if (!recipe) return false;
    if (!ensure()) return false;
    try {
      recipe(now() + (delay || 0));
      return true;
    } catch (e) { return false; }
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
