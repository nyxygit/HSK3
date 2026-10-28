/* HSK 3.0 vocabulary map — canvas renderer --------------------------------
   The poster is a 75 × 147 grid of cards; each HSK level owns a rectangle of
   that grid, so reading order (level → pinyin → left-to-right, top-to-bottom)
   matches the original PDF exactly.

   Everything is painted on one canvas: only the cards inside the viewport are
   drawn, and detail is dropped as you zoom out (text only when close, plain
   colour blocks when far away). That keeps zooming smooth.
------------------------------------------------------------------------- */
(function () {
  "use strict";

  var D = window.HSK;
  var COLS = D.cols, ROWS = D.rows, CW = D.cellW, CH = D.cellH;
  var W = COLS * CW, H = ROWS * CH;
  var N = COLS * ROWS;

  var GREY = "#e3ded2";
  var GREEN = "#3d9860";
  var RED = "#cb4a46";
  var INK = "#2a2620";
  var CJK = '"Microsoft YaHei","PingFang SC","Noto Sans SC","Segoe UI",sans-serif';
  var LATIN = '"Segoe UI",system-ui,-apple-system,sans-serif';

  /* detail thresholds (world scale) */
  var ROUND_MIN = 0.28;   // rounded cards + borders
  var TINT_MAX = 0.50;    // unmarked cards pick up their level colour
  var TEXT_MIN = 0.50;    // hanzi
  var PY_MIN = 0.70;      // pinyin
  var HOVER_MIN = 0.42;

  var CARD_W = CW - 4, CARD_H = CH - 4, CARD_R = 9;

  /* --------------------------------------------------------------- dom */
  var stage = document.getElementById("stage");
  var canvas = document.getElementById("world");
  var ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  var mmView = document.getElementById("mm-view");
  var mmWorld = document.getElementById("mm-world");
  var loader = document.getElementById("loader");
  var hint = document.getElementById("hint");
  var progressText = document.getElementById("progress-text");
  var barKnown = document.getElementById("bar-known");
  var barRed = document.getElementById("bar-red");
  var searchInput = document.getElementById("search");
  var searchCount = document.getElementById("search-count");
  var nowDot = document.querySelector("#now .dot");
  var nowText = document.getElementById("now-text");

  var MM_W = 108, MM_H = Math.round((MM_W * H) / W);

  /* ------------------------------------------------------------- model */
  var state = new Uint8Array(N);
  var hz = new Array(N);
  var py = new Array(N);
  var levelOf = new Uint8Array(N);
  var searchText = new Array(N);
  var hitFlag = new Uint8Array(N);
  var hzSize = new Float32Array(N);
  var pySize = new Float32Array(N);
  var hzB = new Uint8Array(N);
  var pyB = new Uint8Array(N);
  var hzFonts = [], pyFonts = [];
  var hzLists = [], pyLists = [];

  var counts = { known: 0, review: 0 };
  var levelCounts = {};

  var showPinyin = true;
  var showLevels = true;

  /* ------------------------------------------------------------- helpers */
  function strip(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function mix(hex, base, t) {
    var a = hexToRgb(hex), b = hexToRgb(base);
    return "rgb(" + Math.round(a[0] * t + b[0] * (1 - t)) + "," +
      Math.round(a[1] * t + b[1] * (1 - t)) + "," +
      Math.round(a[2] * t + b[2] * (1 - t)) + ")";
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  /* ------------------------------------------------------------- build */
  function build() {
    var sizeMap = {}, sizeList = [];
    function bucketOf(size) {
      var key = Math.round(size * 4) / 4;
      if (!(key in sizeMap)) {
        sizeMap[key] = sizeList.length;
        sizeList.push(key);
      }
      return sizeMap[key];
    }

    D.levels.forEach(function (lv) {
      levelCounts[lv.n] = { known: 0, review: 0, total: 0 };
      lv.tint = mix(lv.color, GREY, 0.34);
      lv.bandFill = rgba(lv.color, 0.16);
      lv.bandEdge = rgba(lv.color, 0.92);
      lv.bandEdgeFar = rgba(lv.color, 0.55);
      for (var r = lv.r0; r <= lv.r1; r++) {
        for (var c = lv.c0; c <= lv.c1; c++) levelOf[r * COLS + c] = lv.n;
      }
    });

    for (var r = 0; r < ROWS; r++) {
      var row = D.grid[r];
      for (var c = 0; c < COLS; c++) {
        var cell = row[c];
        if (!cell) continue;
        var bar = cell.indexOf("|");
        var i = r * COLS + c;
        var h = cell.slice(0, bar);
        var p = cell.slice(bar + 1);

        hz[i] = h;
        py[i] = p;
        searchText[i] = h + " " + strip(p);

        var hs = Math.min(19.5, 58 / h.length);
        var ps = Math.min(10, 56 / (0.52 * Math.max(p.length, 4)));
        hzSize[i] = hs;
        pySize[i] = ps;
        hzB[i] = bucketOf(hs);
        pyB[i] = bucketOf(ps);

        levelCounts[levelOf[i]].total++;
      }
    }

    for (var b = 0; b < sizeList.length; b++) {
      hzFonts.push("500 " + sizeList[b] + "px " + CJK);
      pyFonts.push(sizeList[b] + "px " + LATIN);
    }
    for (b = 0; b < sizeList.length; b++) {
      hzLists.push([]);
      pyLists.push([]);
    }

    /* minimap blocks */
    mmWorld.style.height = MM_H + "px";
    mmWorld.innerHTML = D.levels.map(function (lv) {
      return '<div class="mm-band l' + lv.n + '" style="left:' + (lv.c0 * CW / W * 100) +
        "%;top:" + (lv.r0 * CH / H * 100) + "%;width:" + ((lv.c1 - lv.c0 + 1) * CW / W * 100) +
        "%;height:" + ((lv.r1 - lv.r0 + 1) * CH / H * 100) + '%"></div>';
    }).join("");
  }

  /* ------------------------------------------------------------- state */
  var KEY = "hsk3.map.v1";
  var VIEWKEY = "hsk3.view.v1";
  var saveTimer = 0;

  function applyState(i, s) {
    var prev = state[i];
    if (prev === s) return;
    state[i] = s;
    var lc = levelCounts[levelOf[i]];
    if (prev === 1) { counts.known--; lc.known--; }
    else if (prev === 2) { counts.review--; lc.review--; }
    if (s === 1) { counts.known++; lc.known++; }
    else if (s === 2) { counts.review++; lc.review++; }
    updateStats();
    scheduleSave();
    requestDraw();
  }

  function cycle(i) { applyState(i, (state[i] + 1) % 3); }

  function updateStats() {
    progressText.textContent = fmt(counts.known) + " / " + fmt(D.total);
    barKnown.style.width = (counts.known / D.total) * 100 + "%";
    barRed.style.width = (counts.review / D.total) * 100 + "%";

    D.levels.forEach(function (lv) {
      var chip = document.querySelector('.chip[data-lv="' + lv.n + '"]');
      if (!chip) return;
      var lc = levelCounts[lv.n];
      chip.querySelector(".mini i").style.width =
        ((lc.known + lc.review) / lc.total) * 100 + "%";
      chip.querySelector(".num").textContent = fmt(lc.known) + "/" + fmt(lc.total);
      chip.title = "Level " + lv.label + " · " + fmt(lc.known) + " known · " +
        fmt(lc.review) + " to review · " + fmt(lc.total - lc.known - lc.review) + " new";
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  function save() {
    var out = {};
    for (var i = 0; i < N; i++) if (state[i]) out[i] = state[i];
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
  }

  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    for (var k in data) {
      var i = +k, s = data[k];
      if (!(i >= 0 && i < N) || !(s === 1 || s === 2) || !hz[i]) continue;
      state[i] = s;
      var lc = levelCounts[levelOf[i]];
      if (s === 1) { counts.known++; lc.known++; }
      else { counts.review++; lc.review++; }
    }
  }

  /* ------------------------------------------------------------- camera */
  var scale = 1, tx = 0, ty = 0;
  var minScale = 0.06, maxScale = 3;
  var dpr = 1;
  var rafId = 0;
  var hover = -1;
  var flash = -1;
  var flashTimer = 0;
  var lastNow = -99;

  function viewport() {
    return { w: stage.clientWidth, h: stage.clientHeight };
  }

  function resize() {
    var v = viewport();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(v.w * dpr));
    canvas.height = Math.max(1, Math.round(v.h * dpr));
    canvas.style.width = v.w + "px";
    canvas.style.height = v.h + "px";
    requestDraw();
  }

  function requestDraw() {
    if (!rafId) rafId = requestAnimationFrame(draw);
  }

  function clampView() {
    var v = viewport();
    var w = W * scale, h = H * scale;
    var mx = 90, my = 90;
    if (w <= v.w) tx = (v.w - w) / 2;
    else tx = Math.min(mx, Math.max(v.w - w - mx, tx));
    if (h <= v.h) ty = (v.h - h) / 2;
    else ty = Math.min(my, Math.max(v.h - h - my, ty));
  }

  function roundRectPath(x, y, w, h, r) {
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.rect(x, y, w, h);
  }

  function draw() {
    rafId = 0;
    var v = viewport();
    if (!v.w || !v.h) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);

    var x0 = -tx / scale, y0 = -ty / scale;
    var x1 = x0 + v.w / scale, y1 = y0 + v.h / scale;

    var c0 = Math.max(0, Math.floor(x0 / CW) - 1);
    var c1 = Math.min(COLS - 1, Math.floor(x1 / CW) + 1);
    var r0 = Math.max(0, Math.floor(y0 / CH) - 1);
    var r1 = Math.min(ROWS - 1, Math.floor(y1 / CH) + 1);
    if (c0 > c1 || r0 > r1) return;

    var far = scale < TINT_MAX;
    var round = scale >= ROUND_MIN;
    var text = scale >= TEXT_MIN;
    var pinyin = showPinyin && scale >= PY_MIN;

    /* ---- level bands (fill only; edges are stroked above the cards) ---- */
    if (showLevels) {
      for (var i = 0; i < D.levels.length; i++) {
        var lv = D.levels[i];
        var bx = lv.c0 * CW, by = lv.r0 * CH;
        var bw = (lv.c1 - lv.c0 + 1) * CW, bh = (lv.r1 - lv.r0 + 1) * CH;
        if (bx + bw < x0 || by + bh < y0 || bx > x1 || by > y1) continue;
        ctx.fillStyle = lv.bandFill;
        ctx.beginPath();
        roundRectPath(bx, by, bw, bh, 18);
        ctx.fill();
      }
    }

    /* ---- cards ---- */
    for (i = 0; i < D.levels.length; i++) {
      lv = D.levels[i];
      var ca = Math.max(c0, lv.c0), cb = Math.min(c1, lv.c1);
      var ra = Math.max(r0, lv.r0), rb = Math.min(r1, lv.r1);
      if (ca > cb || ra > rb) continue;

      var lc = levelCounts[lv.n];

      drawPass(ca, cb, ra, rb, 0, far ? lv.tint : GREY, round, lc.known + lc.review === lc.total);
      if (lc.known) drawPass(ca, cb, ra, rb, 1, GREEN, round, false);
      if (lc.review) drawPass(ca, cb, ra, rb, 2, RED, round, false);
    }

    /* ---- level borders, drawn over the cards so they stay crisp ---- */
    if (showLevels) {
      var near = scale >= 0.32;
      var lw = (near ? 2.4 : 1.6) / scale;      /* constant width on screen */
      ctx.lineWidth = lw;
      for (i = 0; i < D.levels.length; i++) {
        lv = D.levels[i];
        bx = lv.c0 * CW;
        by = lv.r0 * CH;
        bw = (lv.c1 - lv.c0 + 1) * CW;
        bh = (lv.r1 - lv.r0 + 1) * CH;
        if (bx + bw < x0 || by + bh < y0 || bx > x1 || by > y1) continue;
        ctx.strokeStyle = near ? lv.bandEdge : lv.bandEdgeFar;
        ctx.beginPath();
        roundRectPath(bx + lw / 2, by + lw / 2, bw - lw, bh - lw, 16);
        ctx.stroke();
      }
    }

    /* ---- text ---- */
    if (text) {
      var b, k, list, idx, row, col, cx, cy;

      for (b = 0; b < hzLists.length; b++) hzLists[b].length = 0;
      if (pinyin) for (b = 0; b < pyLists.length; b++) pyLists[b].length = 0;

      for (row = r0; row <= r1; row++) {
        var off = row * COLS;
        for (col = c0; col <= c1; col++) {
          idx = off + col;
          if (!hz[idx]) continue;
          hzLists[hzB[idx]].push(idx);
          if (pinyin) pyLists[pyB[idx]].push(idx);
        }
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (b = 0; b < hzLists.length; b++) {
        list = hzLists[b];
        if (!list.length) continue;
        ctx.font = hzFonts[b];
        var offset = pinyin ? -5.5 : 0;
        for (k = 0; k < list.length; k++) {
          idx = list[k];
          row = (idx / COLS) | 0;
          col = idx - row * COLS;
          ctx.fillStyle = state[idx] ? "#fff" : INK;
          ctx.fillText(hz[idx], col * CW + CW / 2, row * CH + CH / 2 + offset);
        }
      }

      if (pinyin) {
        for (b = 0; b < pyLists.length; b++) {
          list = pyLists[b];
          if (!list.length) continue;
          ctx.font = pyFonts[b];
          for (k = 0; k < list.length; k++) {
            idx = list[k];
            row = (idx / COLS) | 0;
            col = idx - row * COLS;
            ctx.fillStyle = state[idx] ? "rgba(255,255,255,.88)" : "rgba(42,38,32,.66)";
            ctx.fillText(py[idx], col * CW + CW / 2, row * CH + CH / 2 + 11.5);
          }
        }
      }
    }

    /* ---- search hits ---- */
    if (hits.length && scale >= 0.22) {
      ctx.beginPath();
      for (row = r0; row <= r1; row++) {
        var o = row * COLS;
        for (col = c0; col <= c1; col++) {
          idx = o + col;
          if (hitFlag[idx]) roundRectPath(col * CW + 3.5, row * CH + 3.5, CARD_W - 3, CARD_H - 3, CARD_R);
        }
      }
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = "rgba(28,24,18,.75)";
      ctx.stroke();
    }

    /* ---- flash ---- */
    if (flash >= 0) {
      row = (flash / COLS) | 0;
      col = flash - row * COLS;
      ctx.beginPath();
      roundRectPath(col * CW + 1, row * CH + 1, CARD_W + 2, CARD_H + 2, CARD_R + 1);
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = "#1b1710";
      ctx.stroke();
      ctx.beginPath();
      roundRectPath(col * CW, row * CH, CW, CH, CARD_R + 2);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.stroke();
    }

    /* ---- hover ---- */
    if (hover >= 0 && scale >= HOVER_MIN) {
      row = (hover / COLS) | 0;
      col = hover - row * COLS;
      ctx.beginPath();
      roundRectPath(col * CW + 2, row * CH + 2, CARD_W, CARD_H, CARD_R);
      ctx.lineWidth = 1.6 / scale;
      ctx.strokeStyle = "rgba(28,24,18,.55)";
      ctx.stroke();
    }

    updateBreadcrumb();
    updateMinimap(v);
  }

  function drawPass(ca, cb, ra, rb, wanted, color, round, skip) {
    if (skip) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var r = ra; r <= rb; r++) {
      var off = r * COLS;
      var y = r * CH + 2;
      for (var c = ca; c <= cb; c++) {
        var i = off + c;
        if (!hz[i] || state[i] !== wanted) continue;
        if (round) roundRectPath(c * CW + 2, y, CARD_W, CARD_H, CARD_R);
        else ctx.rect(c * CW + 2, y, CARD_W, CARD_H);
      }
    }
    ctx.fill();
  }

  function updateBreadcrumb() {
    var v = viewport();
    var col = Math.floor((v.w / 2 - tx) / scale / CW);
    var row = Math.floor((v.h / 2 - ty) / scale / CH);
    var lvNum = (col >= 0 && col < COLS && row >= 0 && row < ROWS) ? levelOf[row * COLS + col] : 0;
    if (v.h / scale > H * 0.55) lvNum = 0;
    if (lvNum === lastNow) return;
    lastNow = lvNum;
    var lvObj = lvNum ? D.levels.filter(function (l) { return l.n === lvNum; })[0] : null;
    if (lvObj) {
      nowDot.style.background = lvObj.color;
      nowText.innerHTML = "Level " + lvObj.label + ' <span class="zh">' + lvObj.zh + "</span>";
    } else {
      nowDot.style.background = "#b9b3a6";
      nowText.textContent = "Whole map";
    }
  }

  function updateMinimap(v) {
    var x0 = -tx / scale, y0 = -ty / scale;
    var vw = v.w / scale, vh = v.h / scale;
    var sx = MM_W / W, sy = MM_H / H;
    var l = Math.max(0, x0 * sx), t = Math.max(0, y0 * sy);
    var r = Math.min(MM_W, (x0 + vw) * sx), b = Math.min(MM_H, (y0 + vh) * sy);
    mmView.style.left = (l + 5) + "px";
    mmView.style.top = (t + 5) + "px";
    mmView.style.width = Math.max(4, r - l) + "px";
    mmView.style.height = Math.max(4, b - t) + "px";
  }

  /* ------------------------------------------------------------- view ops */
  function setView(s, x, y) {
    scale = s;
    tx = x;
    ty = y;
    clampView();
    requestDraw();
    scheduleViewSave();
  }

  function zoomAt(clientX, clientY, factor) {
    var rect = stage.getBoundingClientRect();
    var sx = clientX - rect.left, sy = clientY - rect.top;
    var wx = (sx - tx) / scale, wy = (sy - ty) / scale;
    var next = Math.min(maxScale, Math.max(minScale, scale * factor));
    if (next === scale) return;
    scale = next;
    tx = sx - wx * scale;
    ty = sy - wy * scale;
    clampView();
    requestDraw();
    scheduleViewSave();
  }

  function centerOnWorld(wx, wy, s) {
    if (s) scale = Math.min(maxScale, Math.max(minScale, s));
    var v = viewport();
    tx = v.w / 2 - wx * scale;
    ty = v.h / 2 - wy * scale;
    clampView();
    requestDraw();
    scheduleViewSave();
  }

  function fit() {
    var v = viewport();
    var s = Math.min((v.w - 90) / W, (v.h - 110) / H);
    minScale = Math.min(s * 0.85, 0.09);
    centerOnWorld(W / 2, H / 2, s);
  }

  function cellCenter(i) {
    var r = (i / COLS) | 0, c = i - r * COLS;
    return { x: c * CW + CW / 2, y: r * CH + CH / 2 };
  }

  function zoomToLevel(lv) {
    var v = viewport();
    var bw = (lv.c1 - lv.c0 + 1) * CW, bh = (lv.r1 - lv.r0 + 1) * CH;
    var s = Math.min((v.w - 120) / bw, (v.h - 130) / bh);
    s = Math.min(1.2, Math.max(0.12, s));
    centerOnWorld(lv.c0 * CW + bw / 2, lv.r0 * CH + bh / 2, s);
  }

  var viewSaveTimer = 0;
  function scheduleViewSave() {
    clearTimeout(viewSaveTimer);
    viewSaveTimer = setTimeout(function () {
      try {
        localStorage.setItem(VIEWKEY, JSON.stringify({ s: scale, x: tx, y: ty }));
      } catch (e) { /* ignore */ }
    }, 600);
  }

  /* ------------------------------------------------------------- hit test */
  function cellAt(clientX, clientY) {
    var rect = stage.getBoundingClientRect();
    var wx = (clientX - rect.left - tx) / scale;
    var wy = (clientY - rect.top - ty) / scale;
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) return -1;
    var c = (wx / CW) | 0, r = (wy / CH) | 0;
    var i = r * COLS + c;
    return hz[i] ? i : -1;
  }

  /* ------------------------------------------------------------- gestures */
  var pan = null;
  var pinch = null;
  var pointers = new Map();

  stage.addEventListener("pointerdown", function (e) {
    if (focusOpen) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;   /* right/middle: no pan */
    if (e.target.closest(".hud, .minimap")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      pan = null;
      var pts = Array.from(pointers.values());
      pinch = {
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        s: scale,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      };
      return;
    }
    if (pointers.size > 2) return;
    pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, tx: tx, ty: ty, moved: false, time: Date.now() };
    stage.classList.add("dragging");

    if (e.pointerType === "touch") {
      longStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
      longFired = false;
      clearTimeout(longTimer);
      longTimer = setTimeout(function () {
        if (!longStart) return;
        var i = cellAt(longStart.x, longStart.y);
        if (i < 0) return;
        longFired = true;
        if (pan) pan.moved = true;
        stage.classList.remove("dragging");
        cycle(i);                     /* touch equivalent of right-click */
      }, 520);
    }
  });

  window.addEventListener("pointermove", function (e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinch.d > 10) {
        var target = Math.min(maxScale, Math.max(minScale, pinch.s * (d / pinch.d)));
        zoomAt(pinch.cx, pinch.cy, target / scale);
      }
      return;
    }

    if (!pan || e.pointerId !== pan.id) {
      if (scale >= HOVER_MIN) updateHover(e.clientX, e.clientY);
      else if (hover !== -1) { hover = -1; requestDraw(); }
      return;
    }

    var dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
    if (!pan.moved && Math.hypot(dx, dy) > 4) {
      pan.moved = true;
      cancelLong();
      if (hover !== -1) { hover = -1; }
    }
    if (pan.moved) {
      tx = pan.tx + dx;
      ty = pan.ty + dy;
      clampView();
      requestDraw();
    }
  });

  function endPan(e) {
    cancelLong();
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pan && e.pointerId === pan.id) {
      var tap = !pan.moved && !longFired && Date.now() - pan.time < 500;
      longFired = false;
      stage.classList.remove("dragging");
      pan = null;
      if (tap) {
        var i = cellAt(e.clientX, e.clientY);
        if (i >= 0) openFocus(i);     /* left click opens, never marks */
      }
    }
    scheduleViewSave();
  }

  window.addEventListener("pointerup", endPan);
  window.addEventListener("pointercancel", function (e) {
    pointers.delete(e.pointerId);
    if (pan && e.pointerId === pan.id) { pan = null; stage.classList.remove("dragging"); }
    if (pointers.size < 2) pinch = null;
  });

  stage.addEventListener("wheel", function (e) {
    if (focusOpen) return;
    e.preventDefault();
    if (e.shiftKey) {
      tx -= e.deltaY;
      clampView();
      requestDraw();
      scheduleViewSave();
      return;
    }
    var delta = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
    var factor = Math.exp(-delta * (e.ctrlKey ? 0.008 : 0.0022));
    factor = Math.min(1.6, Math.max(0.6, factor));
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  /* ------------------------------------------------------------- hover ring */
  function updateHover(cx, cy) {
    var i = cellAt(cx, cy);
    if (i === hover) return;
    hover = i;
    stage.classList.toggle("over-card", i >= 0);
    requestDraw();
  }

  stage.addEventListener("pointerleave", function () {
    stage.classList.remove("over-card");
    if (hover !== -1) { hover = -1; requestDraw(); }
  });

  /* ------------------------------------------------------------- focus card */
  var focus = document.getElementById("focus");
  var focusCard = focus.querySelector(".focus-card");
  var focusHz = document.getElementById("focus-hz");
  var focusPy = document.getElementById("focus-py");
  var focusDef = document.getElementById("focus-def");
  var focusLevel = document.getElementById("focus-level");
  var focusLevelText = document.getElementById("focus-level-text");
  var focusPos = document.getElementById("focus-pos");
  var focusIndex = -1;
  var focusOpen = false;

  function refreshFocus() {
    if (focusIndex < 0) return;
    var s = state[focusIndex];
    focusCard.dataset.s = s;
    var btns = focus.querySelectorAll("[data-mark]");
    for (var k = 0; k < btns.length; k++) {
      btns[k].classList.toggle("on", +btns[k].dataset.mark === s);
    }
  }

  function openFocus(i) {
    if (i < 0) return;
    focusIndex = i;
    focusOpen = true;

    var row = (i / COLS) | 0, col = i - row * COLS;
    var lvNum = levelOf[i];
    var lvObj = D.levels.filter(function (l) { return l.n === lvNum; })[0];

    focusLevel.className = "focus-level l" + lvNum;
    focusLevelText.textContent = "Level " + lvObj.label + " · " + lvObj.zh;
    focusHz.textContent = hz[i];
    focusHz.classList.toggle("long", hz[i].length > 3);
    focusPy.textContent = py[i];

    var def = "";
    if (window.HSK_DEFS && window.HSK_DEFS[row]) def = window.HSK_DEFS[row][col] || "";
    focusDef.textContent = def || "No definition available in the source data.";
    focusDef.classList.toggle("empty", !def);

    var pos = 0, total = 0;
    for (var rr = lvObj.r0; rr <= lvObj.r1; rr++) {
      for (var cc = lvObj.c0; cc <= lvObj.c1; cc++) {
        var k = rr * COLS + cc;
        if (!hz[k]) continue;
        total++;
        if (k === i) pos = total;
      }
    }
    focusPos.textContent = "#" + fmt(pos) + " of " + fmt(total) + " in this level";

    refreshFocus();
    focus.hidden = false;
    requestAnimationFrame(function () { focusCard.focus(); });
  }

  function closeFocus() {
    if (!focusOpen) return;
    focusOpen = false;
    focus.hidden = true;
    focusIndex = -1;
  }

  /* right-click a card: cycle grey -> green -> red -> grey */
  stage.addEventListener("contextmenu", function (e) {
    if (focusOpen) return;
    var i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    cycle(i);
  });

  /* touch: long press does the same as right-click */
  var longTimer = 0, longFired = false, longStart = null;

  function cancelLong() {
    clearTimeout(longTimer);
    longTimer = 0;
    longStart = null;
  }

  focus.addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) { closeFocus(); return; }
    var btn = e.target.closest("[data-mark]");
    if (btn) {
      applyState(focusIndex, +btn.dataset.mark);
      closeFocus();                    /* mark it, then get out of the way */
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!focusOpen) return;
    if (e.key === "Escape") { closeFocus(); e.preventDefault(); }
    else if (e.key === "1") { applyState(focusIndex, 1); closeFocus(); e.preventDefault(); }
    else if (e.key === "2") { applyState(focusIndex, 2); closeFocus(); e.preventDefault(); }
  });

  /* ------------------------------------------------------------- UI wiring */
  var swPinyin = document.getElementById("sw-pinyin");
  swPinyin.addEventListener("change", function () {
    showPinyin = swPinyin.checked;
    requestDraw();
    try { localStorage.setItem("hsk3.pinyin", showPinyin ? "1" : "0"); } catch (e) {}
  });

  var swLevels = document.getElementById("sw-levels");
  swLevels.addEventListener("change", function () {
    showLevels = swLevels.checked;
    requestDraw();
    try { localStorage.setItem("hsk3.levels", showLevels ? "1" : "0"); } catch (e) {}
  });

  document.querySelector(".zoombox").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-zoom]");
    if (!btn) return;
    var rect = stage.getBoundingClientRect();
    var action = btn.dataset.zoom;
    if (action === "fit") fit();
    else zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2,
                action === "in" ? 1.5 : 1 / 1.5);
  });

  var legend = document.getElementById("legend");
  legend.innerHTML = D.levels.map(function (lv) {
    return '<button class="chip l' + lv.n + '" data-lv="' + lv.n + '" title="Level ' + lv.label + '">' +
      '<span class="dot"></span>' + lv.label +
      '<span class="mini"><i></i></span>' +
      '<span class="num">0/' + fmt(lv.count) + "</span></button>";
  }).join("");

  legend.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    var lv = D.levels.filter(function (l) { return l.n === +chip.dataset.lv; })[0];
    if (lv) zoomToLevel(lv);
  });

  document.getElementById("minimap").addEventListener("click", function (e) {
    var r = mmWorld.getBoundingClientRect();
    var fx = (e.clientX - r.left) / r.width;
    var fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    centerOnWorld(fx * W, fy * H, Math.max(scale, 0.3));
  });

  document.getElementById("reset").addEventListener("click", function () {
    if (!counts.known && !counts.review) return;
    if (!window.confirm("Clear all colour marks? This cannot be undone.")) return;
    state.fill(0);
    counts.known = 0;
    counts.review = 0;
    Object.keys(levelCounts).forEach(function (k) {
      levelCounts[k].known = 0;
      levelCounts[k].review = 0;
    });
    updateStats();
    requestDraw();
    save();
  });

  /* ------------------------------------------------------------- search */
  var hits = [];
  var hitAt = 0;

  function clearHits() {
    if (!hits.length) return;
    for (var k = 0; k < hits.length; k++) hitFlag[hits[k]] = 0;
    hits = [];
    requestDraw();
  }

  function runSearch(q) {
    clearHits();
    hitAt = 0;
    if (!q) { searchCount.textContent = ""; return; }
    var needle = strip(q);
    var found = [];
    for (var i = 0; i < N; i++) {
      if (!searchText[i]) continue;
      if (searchText[i].indexOf(needle) !== -1) {
        found.push(i);
        if (found.length > 3000) break;
      }
    }
    hits = found;
    for (var k = 0; k < found.length; k++) hitFlag[found[k]] = 1;
    searchCount.textContent = found.length ? fmt(found.length) : "—";
    requestDraw();
    if (found.length) focusMatch(0);
  }

  function focusMatch(k) {
    if (!hits.length) return;
    hitAt = k % hits.length;
    var i = hits[hitAt];
    var p = cellCenter(i);
    centerOnWorld(p.x, p.y, Math.max(scale, 0.85));
    flash = i;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flash = -1; requestDraw(); }, 2000);
    requestDraw();
  }

  searchInput.addEventListener("input", function () {
    runSearch(searchInput.value.trim().toLowerCase());
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!hits.length) runSearch(searchInput.value.trim().toLowerCase());
      else focusMatch(hitAt + 1);
    } else if (e.key === "Escape") {
      searchInput.value = "";
      clearHits();
      searchCount.textContent = "";
      searchInput.blur();
    }
  });

  /* ------------------------------------------------------------- misc */
  window.addEventListener("resize", function () {
    var v = viewport();
    var fs = Math.min((v.w - 90) / W, (v.h - 110) / H);
    minScale = Math.min(fs * 0.85, 0.09);
    if (scale < minScale) scale = minScale;
    clampView();
    resize();
  });

  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") return;
    var rect = stage.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    if (e.key === "+" || e.key === "=") { zoomAt(cx, cy, 1.4); e.preventDefault(); }
    else if (e.key === "-") { zoomAt(cx, cy, 1 / 1.4); e.preventDefault(); }
    else if (e.key === "0") { fit(); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { tx += 90; clampView(); requestDraw(); }
    else if (e.key === "ArrowRight") { tx -= 90; clampView(); requestDraw(); }
    else if (e.key === "ArrowUp") { ty += 90; clampView(); requestDraw(); }
    else if (e.key === "ArrowDown") { ty -= 90; clampView(); requestDraw(); }
  });

  setTimeout(function () { hint.classList.add("gone"); }, 7000);

  /* ------------------------------------------------------------- deep links */
  function applyHash() {
    var h = location.hash.replace(/^#/, "");
    var m;
    if ((m = /^l=(\d+)$/.exec(h))) {
      var lv = D.levels.filter(function (l) { return l.n === +m[1]; })[0];
      if (lv) { zoomToLevel(lv); return true; }
    }
    if ((m = /^w=(\d+),(\d+)$/.exec(h))) {
      var r = +m[1], c = +m[2];
      if (r < ROWS && c < COLS && hz[r * COLS + c]) {
        var p = cellCenter(r * COLS + c);
        centerOnWorld(p.x, p.y, 1);
        return true;
      }
    }
    return false;
  }
  window.addEventListener("hashchange", applyHash);

  /* ------------------------------------------------------------- boot */
  function boot() {
    build();
    load();
    updateStats();
    resize();

    try {
      if (localStorage.getItem("hsk3.pinyin") === "0") {
        swPinyin.checked = false;
        showPinyin = false;
      }
      if (localStorage.getItem("hsk3.levels") === "0") {
        swLevels.checked = false;
        showLevels = false;
      }
    } catch (e) {}

    var savedView = null;
    try { savedView = JSON.parse(localStorage.getItem(VIEWKEY) || "null"); } catch (e) {}

    var v = viewport();
    var fitScale = Math.min((v.w - 90) / W, (v.h - 110) / H);
    minScale = Math.min(fitScale * 0.85, 0.09);

    if (applyHash()) {
      /* view set by the URL */
    } else if (savedView && savedView.s > 0) {
      scale = Math.max(minScale, Math.min(maxScale, savedView.s));
      tx = savedView.x;
      ty = savedView.y;
      clampView();
    } else {
      var lv1 = D.levels[0];
      var bw = (lv1.c1 - lv1.c0 + 1) * CW, bh = (lv1.r1 - lv1.r0 + 1) * CH;
      var s = Math.min((v.w - 140) / bw, (v.h - 160) / bh, 0.95);
      scale = Math.max(minScale, s);
      tx = v.w / 2 - (lv1.c0 * CW + bw / 2) * scale;
      ty = v.h / 2 - (lv1.r0 * CH + bh / 2) * scale;
      clampView();
    }

    requestDraw();
    requestAnimationFrame(function () {
      loader.classList.add("gone");
      setTimeout(function () { loader.style.display = "none"; }, 400);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
