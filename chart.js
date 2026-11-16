/* Equity and candle charts on <canvas>, devicePixelRatio aware. No library. */
(function (g) {
  "use strict";
  var GREEN = "#00d35a", GRID = "rgba(84,84,88,0.35)", MUTED = "rgba(235,235,245,0.3)";

  function prep(canvas) {
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 1 || h < 1) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function extent(values, pad) {
    var lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < values.length; i++) {
      if (values[i] == null || !isFinite(values[i])) continue;
      if (values[i] < lo) lo = values[i];
      if (values[i] > hi) hi = values[i];
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    var span = hi - lo;
    return { lo: lo - span * (pad || 0.08), hi: hi + span * (pad || 0.18) };
  }

  function drawEquity(canvas, opt) {
    var g2 = prep(canvas);
    if (!g2) return;
    var ctx = g2.ctx, w = g2.w, h = g2.h;
    var pts = (opt && opt.points) || [];
    var marks = (opt && opt.marks) || [];
    var startLine = opt && opt.startLine;
    var padL = 8, padR = 8, padT = 28, padB = 16;
    var iw = w - padL - padR, ih = h - padT - padB;
    if (pts.length < 1) {
      ctx.fillStyle = MUTED;
      ctx.font = "13px -apple-system, system-ui, sans-serif";
      ctx.fillText("No chart yet", padL, h / 2);
      return;
    }
    var xs = pts.map(function (p) { return +p.ts; });
    var ys = pts.map(function (p) { return +p.value; });
    if (startLine != null && isFinite(startLine)) ys = ys.concat([+startLine]);
    var x0 = xs[0], x1 = xs[xs.length - 1];
    if (x1 === x0) x1 = x0 + 1;
    var yx = extent(ys, 0.1);
    function X(t) { return padL + ((t - x0) / (x1 - x0)) * iw; }
    function Y(v) { return padT + (1 - (v - yx.lo) / (yx.hi - yx.lo)) * ih; }

    if (startLine != null && isFinite(startLine)) {
      ctx.save();
      ctx.strokeStyle = "rgba(235,235,245,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, Y(startLine));
      ctx.lineTo(w - padR, Y(startLine));
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = X(p.ts), y = Y(p.value);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    var last = pts[pts.length - 1];
    ctx.lineTo(X(last.ts), padT + ih);
    ctx.lineTo(X(pts[0].ts), padT + ih);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, "rgba(0,211,90,0.28)");
    grad.addColorStop(1, "rgba(0,211,90,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = X(p.ts), y = Y(p.value);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // Marks above the line; a later mark moves up a row, never overlaps.
    var placed = [];
    var rowH = 16;
    marks.forEach(function (m) {
      if (m.ts == null) return;
      var x = X(m.ts);
      if (x < padL || x > w - padR) return;
      var yLine = Y(m.value != null && isFinite(+m.value) ? +m.value : (last ? last.value : yx.hi));
      if (!(m.value != null && isFinite(+m.value))) {
        // place at the equity value at this ts if we can
        var near = last ? last.value : yx.hi;
        for (var i = 0; i < pts.length; i++) if (pts[i].ts >= m.ts) { near = pts[i].value; break; }
        yLine = Y(near);
      }
      var label = m.label || "";
      ctx.font = "600 11px -apple-system, system-ui, sans-serif";
      var tw = ctx.measureText(label).width;
      var tx = Math.min(Math.max(x - tw / 2, padL), w - padR - tw);
      var ty = yLine - 10;
      placed.forEach(function (p) {
        if (Math.abs(p.x - tx) < (p.w + tw) / 2 + 6 && Math.abs(p.y - ty) < rowH)
          ty = p.y - rowH;
      });
      if (ty < 12) ty = 12;
      placed.push({ x: tx, y: ty, w: tw });
      ctx.fillStyle = m.color || "#64d2ff";
      ctx.fillText(label, tx, ty);
    });
  }

  function drawCandles(canvas, opt) {
    var g2 = prep(canvas);
    if (!g2) return;
    var ctx = g2.ctx, w = g2.w, h = g2.h;
    var raw = (opt && opt.candles) || [];
    var exitLine = opt && opt.exitLine;
    var padL = 8, padR = 8, padT = 8, padB = 8;
    var iw = w - padL - padR, ih = h - padT - padB;
    if (raw.length < 1) {
      ctx.fillStyle = MUTED;
      ctx.font = "13px -apple-system, system-ui, sans-serif";
      ctx.fillText("No candles yet", padL, h / 2);
      return;
    }
    // Prices are irregular ticks; draw as a thin close-line plus stems, 1-minute buckets if we can.
    var prices = raw.map(function (c) { return +c.price; }).filter(isFinite);
    var yx = extent(prices.concat(exitLine != null && isFinite(exitLine) ? [+exitLine] : []), 0.1);
    var x0 = +raw[0].ts, x1 = +raw[raw.length - 1].ts;
    if (x1 === x0) x1 = x0 + 1;
    function X(t) { return padL + ((t - x0) / (x1 - x0)) * iw; }
    function Y(v) { return padT + (1 - (v - yx.lo) / (yx.hi - yx.lo)) * ih; }
    if (exitLine != null && isFinite(exitLine)) {
      ctx.save();
      ctx.strokeStyle = "#ff9f0a";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(padL, Y(exitLine));
      ctx.lineTo(w - padR, Y(exitLine));
      ctx.stroke();
      ctx.restore();
    }
    var bw = Math.max(2, iw / Math.max(raw.length, 1) * 0.7);
    raw.forEach(function (c, i) {
      var px = X(c.ts);
      var py = Y(c.price);
      var prev = i ? raw[i - 1].price : c.price;
      var up = c.price >= prev;
      ctx.strokeStyle = up ? GREEN : "#ff453a";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, Y(prev));
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillRect(px - bw / 2, py - 1, bw, 2);
    });
  }

  g.DeskChart = { drawEquity: drawEquity, drawCandles: drawCandles };
})(window);
