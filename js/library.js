/* =============================================================================
 * 机关谜题 — 关卡库 / 大关分类 / 进度 / 存档 / 导入导出
 * -----------------------------------------------------------------------------
 * 数据结构（v2）：
 *   db = {
 *     chapters: [ { id, name, levels: [levelId, ...] } ],   // 顺序 = 大关顺序
 *     levels:   { levelId: 关卡对象 }                        // 关卡对象带 chapter 字段
 *   }
 * 旧版（只有 levels/order）会自动迁移成一个「第一关」大关。
 * ========================================================================== */
(function (root) {
  'use strict';

  const MP = root.MPCore;
  const Lib = {};
  root.MPLibrary = Lib;

  const KEY = 'mp.library.v1';
  const PKEY = 'mp.progress.v1';

  let db = null;
  let prog = null;
  const memDb = { chapters: [], levels: {} };
  Lib.storageOK = true;

  Lib.uid = function (pre) {
    return (pre || 'L') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  };

  function persist() {
    try { root.localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { Lib.storageOK = false; return false; }
  }

  function migrate(raw) {
    const d = { chapters: [], levels: {} };
    if (raw && raw.levels) {
      const ch = { id: Lib.uid('ch'), name: '第一关', levels: [] };
      const order = raw.order && raw.order.length ? raw.order : Object.keys(raw.levels);
      order.forEach(function (id) {
        const L = raw.levels[id];
        if (!L) return;
        L.chapter = ch.id;
        d.levels[id] = L;
        ch.levels.push(id);
      });
      d.chapters.push(ch);
    }
    return d;
  }

  function loadDb() {
    if (db) return db;
    let raw = null;
    try { raw = root.localStorage ? JSON.parse(root.localStorage.getItem(KEY) || 'null') : null; }
    catch (e) { Lib.storageOK = false; raw = null; }
    if (raw && raw.chapters && raw.levels) db = raw;
    else db = migrate(raw);
    if (!db.chapters || !db.chapters.length) {
      db.chapters = [{ id: Lib.uid('ch'), name: '第一关', levels: [] }];
    }
    if (!db.levels) db.levels = {};
    /* 清理悬空引用 */
    db.chapters.forEach(function (c) {
      if (!Array.isArray(c.levels)) c.levels = [];
      c.levels = c.levels.filter(function (id) { return !!db.levels[id]; });
    });
    return db;
  }

  /* ---------------------------------------------------------------- 读取 */
  Lib.chapters = function () {
    const d = loadDb();
    return d.chapters.map(function (c) {
      return {
        id: c.id,
        name: c.name,
        levels: c.levels.map(function (id) {
          const L = d.levels[id];
          return {
            id: id, name: L.name, w: L.w, h: L.h,
            cleared: Lib.isCleared(id),
            updated: L.updated || 0,
          };
        }),
      };
    });
  };

  Lib.list = function () {
    const out = [];
    Lib.chapters().forEach(function (c) {
      c.levels.forEach(function (L) { out.push(L); });
    });
    return out;
  };

  Lib.get = function (id) {
    const d = loadDb();
    return d.levels[id] ? MP.cloneLevel(d.levels[id]) : null;
  };

  Lib.count = function () { return Object.keys(loadDb().levels).length; };

  /* 关卡在库里的位置：{ chapterIndex, index, chapterId, label:'1-2' } */
  Lib.indexOf = function (id) {
    const d = loadDb();
    for (let i = 0; i < d.chapters.length; i++) {
      const k = d.chapters[i].levels.indexOf(id);
      if (k >= 0) return { chapterIndex: i, index: k, chapterId: d.chapters[i].id, label: (i + 1) + '-' + (k + 1) };
    }
    return null;
  };

  Lib.chapterOf = function (id) {
    const pos = Lib.indexOf(id);
    return pos ? pos.chapterId : (loadDb().chapters[0] || {}).id;
  };

  /* ---------------------------------------------------------------- 写入 */
  Lib.put = function (level) {
    const d = loadDb();
    level = MP.cloneLevel(level);
    if (!level.id) level.id = Lib.uid();
    const old = d.levels[level.id];
    if (old) level.chapter = old.chapter;
    let ch = d.chapters.filter(function (c) { return c.id === level.chapter; })[0];
    if (!ch) { ch = d.chapters[0]; level.chapter = ch.id; }
    level.updated = Date.now();
    if (!old) ch.levels.push(level.id);
    d.levels[level.id] = level;
    persist();
    return level.id;
  };

  Lib.remove = function (id) {
    const d = loadDb();
    delete d.levels[id];
    d.chapters.forEach(function (c) {
      c.levels = c.levels.filter(function (x) { return x !== id; });
    });
    persist();
  };

  /* 新建大关 */
  Lib.addChapter = function (name) {
    const d = loadDb();
    const ch = { id: Lib.uid('ch'), name: name || ('第 ' + (d.chapters.length + 1) + ' 大关'), levels: [] };
    d.chapters.push(ch);
    persist();
    return ch.id;
  };

  Lib.renameChapter = function (id, name) {
    const d = loadDb();
    d.chapters.forEach(function (c) { if (c.id === id) c.name = name; });
    persist();
  };

  /* 删大关：里面的关卡一起删掉 */
  Lib.removeChapter = function (id) {
    const d = loadDb();
    const ch = d.chapters.filter(function (c) { return c.id === id; })[0];
    if (!ch) return 0;
    const n = ch.levels.length;
    ch.levels.forEach(function (lid) { delete d.levels[lid]; });
    d.chapters = d.chapters.filter(function (c) { return c.id !== id; });
    if (!d.chapters.length) d.chapters.push({ id: Lib.uid('ch'), name: '第一关', levels: [] });
    persist();
    return n;
  };

  /* 把关卡挪到别的大关（index 省略则排到最后） */
  Lib.moveLevel = function (levelId, chapterId, index) {
    const d = loadDb();
    const L = d.levels[levelId];
    const ch = d.chapters.filter(function (c) { return c.id === chapterId; })[0];
    if (!L || !ch) return false;
    if (L.chapter === chapterId) {
      const k = ch.levels.indexOf(levelId);
      if (k >= 0) ch.levels.splice(k, 1);
    } else {
      const oldCh = d.chapters.filter(function (c) { return c.id === L.chapter; })[0];
      if (oldCh) oldCh.levels = oldCh.levels.filter(function (x) { return x !== levelId; });
    }
    if (index === undefined || index === null || index < 0 || index > ch.levels.length) ch.levels.push(levelId);
    else ch.levels.splice(index, 0, levelId);
    L.chapter = chapterId;
    persist();
    return true;
  };

  Lib.swapLevels = function (idA, idB) {
    const d = loadDb();
    const pa = Lib.indexOf(idA), pb = Lib.indexOf(idB);
    if (!pa || !pb) return false;
    const ca = d.chapters[pa.chapterIndex], cb = d.chapters[pb.chapterIndex];
    ca.levels[pa.index] = idB;
    cb.levels[pb.index] = idA;
    d.levels[idA].chapter = cb.id;
    d.levels[idB].chapter = ca.id;
    persist();
    return true;
  };

  /* 下一关：先本大关的下一关，再下一个大关的第一关 */
  Lib.nextLevel = function (id) {
    const d = loadDb();
    for (let i = 0; i < d.chapters.length; i++) {
      const ch = d.chapters[i];
      const k = ch.levels.indexOf(id);
      if (k < 0) continue;
      if (k + 1 < ch.levels.length) return ch.levels[k + 1];
      for (let j = i + 1; j < d.chapters.length; j++) {
        if (d.chapters[j].levels.length) return d.chapters[j].levels[0];
      }
      return null;
    }
    return null;
  };

  Lib.prevLevel = function (id) {
    const d = loadDb();
    for (let i = 0; i < d.chapters.length; i++) {
      const ch = d.chapters[i];
      const k = ch.levels.indexOf(id);
      if (k < 0) continue;
      if (k > 0) return ch.levels[k - 1];
      for (let j = i - 1; j >= 0; j--) {
        const p = d.chapters[j].levels;
        if (p.length) return p[p.length - 1];
      }
      return null;
    }
    return null;
  };

  /* ---------------------------------------------------------------- 进度 */
  function loadProg() {
    if (prog) return prog;
    try { prog = JSON.parse(root.localStorage.getItem(PKEY) || 'null') || { cleared: {} }; }
    catch (e) { prog = { cleared: {} }; }
    if (!prog.cleared) prog.cleared = {};
    return prog;
  }
  function saveProg() {
    try { root.localStorage.setItem(PKEY, JSON.stringify(prog)); } catch (e) {}
  }
  Lib.isCleared = function (id) { return !!loadProg().cleared[id]; };
  Lib.markCleared = function (id) { loadProg().cleared[id] = true; saveProg(); };
  Lib.clearedCount = function () { return Object.keys(loadProg().cleared).length; };
  Lib.resetProgress = function () { prog = { cleared: {} }; saveProg(); };

  /* ---------------------------------------------------------------- 空白模板 */
  /* 说明：这一版已经取消「墙」这个概念 —— 所有地图都是矩形，棋盘外圈就是天然边界，
     规则层把「越界」和「墙」当同一件事处理，所以编辑器不需要再铺外墙。
     老关卡 / 导入的 JSON 里如果还有墙，仍然能正常读取和渲染（见 MP.WALL）。 */
  Lib.blank = function (w, h, name, chapterId) {
    w = Math.max(1, w || 10);
    h = Math.max(1, h || 8);
    const L = MP.newLevel(w, h, name || '新关卡');
    L.chapter = chapterId || null;
    return L;
  };

  /* 自动关卡名：形如 "1-3" = 第 1 个大关的第 3 关 */
  Lib.autoName = function (chapterId) {
    const d = loadDb();
    let ci = 0;
    for (let i = 0; i < d.chapters.length; i++) {
      if (d.chapters[i].id === chapterId) { ci = i; break; }
    }
    const ch = d.chapters[ci];
    return (ci + 1) + '-' + ((ch ? ch.levels.length : 0) + 1);
  };

  /* ---------------------------------------------------------------- 机制沙盒 */
  Lib.sandbox = function () {
    const W = 19, H = 13;
    const L = MP.newLevel(W, H, '机制沙盒（自检用，非关卡）');
    L.id = '__sandbox__';
    L.note = '把每种设备都摆了一份，随便点。用来检查规则和动画。';

    const put = function (x, y, item) { MP.at(L, x, y).item = item; };
    const sq = function (x, y) { put(x, y, { k: 'square' }); };
    const ci = function (x, y) { put(x, y, { k: 'circle' }); };
    const dv = function (x, y, type, s) { put(x, y, MP.device(type, s)); };

    dv(2, 2, 'push', 'R'); sq(3, 2);                       /* 推动活塞 */
    dv(8, 2, 'pull', 'R'); ci(10, 2);                      /* 拉动活塞 */
    dv(14, 2, 'spush', 'R'); sq(15, 2);                    /* 强力推动 */
    dv(2, 6, 'spull', 'R'); ci(5, 6);                      /* 强力拉动 */
    dv(8, 6, 'vpush', 'R:push'); ci(9, 6);                 /* 可变活塞 */
    dv(14, 6, 'swap', 'ul_ur'); sq(13, 5); ci(15, 5);      /* 交换器·上斜 */
    dv(2, 10, 'switch', 'h'); dv(3, 10, 'push', 'L');      /* 换向交换器 */
    dv(8, 10, 'rotate', 'cw'); sq(8, 9); ci(9, 10); sq(8, 11); ci(7, 10);
    dv(14, 10, 'modifier', 'R'); dv(15, 10, 'push', 'D');  /* 修改器 */

    return L;
  };

  /* ---------------------------------------------------------------- 序列化 */
  Lib.serialize = function (level) {
    return JSON.stringify({
      name: level.name,
      w: level.w,
      h: level.h,
      note: level.note || '',
      cells: level.cells.map(function (c) {
        const o = {};
        if (c.t === MP.WALL) o.t = 1;
        if (c.goal) o.goal = c.goal;
        if (c.item) {
          if (MP.isDevice(c.item)) o.item = { k: 'device', type: c.item.type, s: c.item.s };
          else o.item = { k: c.item.k };
        }
        return o;
      }),
    }, null, 1);
  };

  Lib.normalize = function (raw) {
    const warn = [];
    if (!raw || typeof raw !== 'object') return { level: null, warnings: ['不是合法的关卡数据'] };
    let w = Math.round(Number(raw.w) || 0), h = Math.round(Number(raw.h) || 0);
    if (!(w > 0) || !(h > 0)) return { level: null, warnings: ['缺少合法的宽高 w / h'] };
    if (w > 60 || h > 60) return { level: null, warnings: ['棋盘太大（上限 60×60）'] };
    const L = MP.newLevel(w, h, String(raw.name || '未命名关卡'));
    L.id = raw.id || null;
    L.chapter = raw.chapter || null;
    L.note = String(raw.note || '');
    if (raw.solution && Array.isArray(raw.solution)) L.solution = raw.solution;

    const cells = Array.isArray(raw.cells) ? raw.cells : [];
    if (cells.length !== w * h) warn.push('cells 数量应为 ' + (w * h) + '，实际 ' + cells.length + '（已按空位补齐 / 截断）');

    for (let i = 0; i < w * h; i++) {
      const src = cells[i];
      const dst = L.cells[i];
      if (!src || typeof src !== 'object') continue;
      dst.t = (src.t === 1 || src.t === '1' || src.t === 'wall') ? MP.WALL : MP.FLOOR;
      const goal = src.goal;
      if (goal === 'square' || goal === 'circle') dst.goal = goal;
      else if (goal) warn.push('第 ' + i + ' 格目标类型非法（' + goal + '），已忽略');

      const it = src.item;
      if (!it) continue;
      if (it.k === 'square' || it.k === 'circle') {
        dst.item = { k: it.k };
      } else if (it.k === 'device') {
        const def = MP.DEVICES[it.type];
        if (!def) { warn.push('第 ' + i + ' 格设备类型未知（' + it.type + '），已忽略'); continue; }
        let s = it.s;
        if (def.states.indexOf(s) < 0) {
          warn.push('第 ' + i + ' 格设备状态非法（' + it.type + ' / ' + s + '），已改为 ' + def.states[0]);
          s = def.states[0];
        }
        dst.item = { k: 'device', type: it.type, s: s };
      } else {
        warn.push('第 ' + i + ' 格物品类型未知（' + it.k + '），已忽略');
        continue;
      }
      if (dst.t === MP.WALL) {
        dst.t = MP.FLOOR;
        warn.push('第 ' + i + ' 格墙上放了东西，已把墙改成地板');
      }
    }
    return { level: L, warnings: warn };
  };

  Lib.importText = function (text) {
    let raw;
    try { raw = JSON.parse(text); }
    catch (e) { return { level: null, warnings: ['JSON 解析失败：' + e.message] }; }
    if (Array.isArray(raw)) raw = raw[0];
    return Lib.normalize(raw);
  };

  Lib.download = function (level, filename) {
    const text = Lib.serialize(level);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (filename || level.name || 'level') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 0);
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
