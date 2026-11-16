/* FOMO Desk iPhone app. Plan B: decrypt files under d/{DATA_PATH}/ with the key from the URL hash.
   The hash is kept (including standalone). No start_url in the manifest. Secrets never logged. */
(function () {
  "use strict";
  var POLL_S = 15;
  var LS_D = "desk.d", LS_K = "desk.k";
  var BOTS = ["scanner", "analyst", "brain", "executor", "risk"];
  var COLORS = { scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a" };
  var NAMES = { scanner: "Scanner", analyst: "Analyst", brain: "Brain", executor: "Executor", risk: "Risk" };
  var LAYERS = ["token program", "mint/freeze", "dev", "lp lock", "holders", "fresh", "insiders", "bundles"];
  var SETTING_GROUPS = [
    ["Scanner", "scanner."],
    ["Analyst", "analyst."],
    ["Social", "social."],
    ["Brain", "brain."],
    ["Executor", "executor."],
    ["Risk", "risk."],
    ["Desk", ""]
  ];

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cryptoKey = null, dataPath = null, keyB64 = null;
  var state = null, chart = null, activity = null, orders = null, account = null, settings = null;
  var decisions = {};
  var lastTs = null, lastGood = {}, timer = null, countdown = null, retryIn = POLL_S;
  var screenUrl = null, screenFlip = false, screenAt = 0, seenActivity = 0;
  var range = "LIVE", tab = "home", screenView = null, currentMint = null, sellPct = 100;
  var lastBal = null;

  /* ---------- hash / secrets: keep d&k in the hash, including standalone ---------- */
  function hashParams() {
    try { return new URLSearchParams(location.hash.replace(/^#/, "")); }
    catch (e) { return new URLSearchParams(); }
  }
  function readSecrets() {
    var p = hashParams();
    var d = p.get("d"), k = p.get("k");
    if (d && k) {
      try { localStorage.setItem(LS_D, d); localStorage.setItem(LS_K, k); } catch (e) {}
      return { d: d, k: k };
    }
    try { return { d: localStorage.getItem(LS_D), k: localStorage.getItem(LS_K) }; }
    catch (e) { return { d: null, k: null }; }
  }
  function writeHash(extra) {
    // Always keep d & k in the hash (Safari A2HS + standalone). Never strip them.
    if (!dataPath || !keyB64) return;
    var p = hashParams();
    p.set("d", dataPath);
    p.set("k", keyB64);
    extra = extra || {};
    ["tab", "screen", "mint"].forEach(function (key) {
      if (extra[key] == null || extra[key] === "") p.delete(key);
      else p.set(key, extra[key]);
    });
    var next = "#" + p.toString();
    if (location.hash !== next) history.replaceState(null, "", location.pathname + location.search + next);
  }
  function nav(nextTab, nextScreen, mint) {
    tab = nextTab || "home";
    screenView = nextScreen || null;
    currentMint = mint || currentMint;
    writeHash({ tab: tab, screen: screenView, mint: currentMint });
    paintChrome();
    if (screenView === "coin" && currentMint) loadCoin(currentMint);
    if (screenView === "audit" && currentMint) loadAudit(currentMint);
  }

  var secrets = readSecrets();
  dataPath = secrets.d; keyB64 = secrets.k;

  function b64u(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function getKey() {
    if (cryptoKey) return Promise.resolve(cryptoKey);
    return crypto.subtle.importKey("raw", b64u(keyB64), { name: "AES-GCM" }, false, ["decrypt"])
      .then(function (k) { cryptoKey = k; return k; });
  }
  function fetchDec(stem) {
    var url = "d/" + encodeURIComponent(dataPath) + "/" + stem + ".enc?t=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      var b = new Uint8Array(buf);
      return getKey().then(function (k) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, k, b.slice(12));
      });
    });
  }
  function fetchJson(stem) {
    return fetchDec(stem).then(function (buf) {
      return JSON.parse(new TextDecoder().decode(buf));
    });
  }

  /* ---------- formatters ---------- */
  function fmtMoney(n, d) {
    if (n == null || !isFinite(+n)) return "—";
    d = d == null ? 2 : d;
    return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtPct(n, sign) {
    if (n == null || !isFinite(+n)) return "—";
    var s = (sign && n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
    return s;
  }
  function fmtMult(n) {
    if (n == null || !isFinite(+n)) return "—";
    var d = Math.abs(n - 1) < 0.05 ? 4 : 2;
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) + "×";
  }
  function fmtTime(ts) {
    if (!ts) return "never";
    return new Date((ts < 1e12 ? ts * 1000 : ts)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function fmtAge(min) {
    if (min == null || !isFinite(+min)) return null;
    min = +min;
    if (min < 60) return Math.round(min) + "m old";
    if (min < 60 * 24) return (min / 60).toFixed(min < 600 ? 1 : 0).replace(/\.0$/, "") + "h old";
    return (min / (60 * 24)).toFixed(1).replace(/\.0$/, "") + "d old";
  }
  function fmtCompact(n) {
    if (n == null || !isFinite(+n)) return "—";
    n = +n;
    var a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return fmtMoney(n);
  }
  function checkClass(v) {
    v = String(v == null ? "n/a" : v).toLowerCase();
    if (v === "true" || v === "paper" || v === "ok") return "ok";
    if (v === "false") return "false";
    return "na";
  }

  /* ---------- odometer ---------- */
  function setOdometer(el, value) {
    var text = (value == null || !isFinite(+value)) ? "—" : fmtMoney(value);
    if (reduceMotion || lastBal == null || text === "—") {
      el.textContent = text;
      lastBal = value;
      return;
    }
    // Roll changed digits, 600ms ease-out, 30ms stagger.
    var next = text.split(""), prev = (el.getAttribute("data-txt") || "").split("");
    el.setAttribute("data-txt", text);
    el.textContent = "";
    next.forEach(function (ch, i) {
      var span = document.createElement("span");
      span.className = "d";
      span.textContent = ch;
      if (prev[i] !== ch && /[\d.]/.test(ch)) {
        span.style.display = "inline-block";
        span.style.transition = "transform 600ms ease-out, opacity 600ms ease-out";
        span.style.transitionDelay = (i * 30) + "ms";
        span.style.transform = "translateY(0.4em)";
        span.style.opacity = "0.3";
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            span.style.transform = "translateY(0)";
            span.style.opacity = "1";
          });
        });
      }
      el.appendChild(span);
    });
    lastBal = value;
  }

  /* ---------- error / loading ---------- */
  function showError() {
    var n = retryIn;
    clearInterval(countdown);
    function paint() {
      $("err").hidden = false;
      $("err").textContent = "Desk offline · retrying in " + n + "s · last update " + fmtTime(lastTs);
      if (n > 0) n--;
    }
    paint();
    countdown = setInterval(paint, 1000);
  }
  function clearError() { clearInterval(countdown); $("err").hidden = true; }

  /* ---------- chrome / tabs ---------- */
  function paintChrome() {
    var sub = screenView === "coin" || screenView === "audit" || screenView === "live";
    $("app").classList.toggle("subscreen", !!sub);
    ["home", "bots", "activity", "account", "coin", "audit", "live"].forEach(function (name) {
      var el = $("view-" + name);
      if (!el) return;
      var on = sub ? (name === screenView) : (name === tab);
      el.classList.toggle("on", on);
    });
    document.querySelectorAll("#tabbar button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-tab") === tab && !sub);
    });
    var mode = ((state && state.mode) || (account && account.mode) || "PAPER").toUpperCase();
    document.querySelectorAll(".paper-pill").forEach(function (el) {
      el.hidden = mode !== "PAPER";
    });
  }

  /* ---------- renderers ---------- */
  function markLabel(m) {
    var kind = (m.kind || "").toLowerCase();
    if (kind === "bought") return m.label || ("Bought " + (m.subtitle || ""));
    if (kind === "sold") {
      var v = m.value != null ? "+" + fmtMoney(Math.abs(+m.value)).replace("$", "$") : (m.label || "Sold");
      return m.label && m.label.indexOf("+$") >= 0 ? m.label : (m.label || ("+$" + (m.value || "")));
    }
    if (kind === "stopped") return m.label || ("-25% · -" + (m.value || ""));
    return m.label || kind;
  }
  function markColor(m) {
    var kind = (m.kind || "").toLowerCase();
    if (m.color) return m.color;
    if (kind === "bought") return "#64d2ff";
    if (kind === "sold") return "#00d35a";
    if (kind === "stopped") return "#ff453a";
    return "#8e8e93";
  }

  function renderHome() {
    if (!state) return;
    setOdometer($("balance"), state.balance);
    var tp = state.todayPct;
    var today = $("today");
    today.textContent = fmtPct(tp, true);
    today.className = "today" + (tp > 0 ? " up" : (tp < 0 ? " down" : ""));
    $("mult").textContent = fmtMult(state.multiplier);
    $("home-avatar").textContent = ((account && account.handle) || "G").slice(0, 1).toUpperCase();

    var pack = (chart && (chart[range] || chart[range.toUpperCase()])) || { points: [], marks: [], startLine: null };
    var marks = (pack.marks || []).map(function (m) {
      return { ts: m.ts, label: markLabel(m), color: markColor(m), value: null };
    });
    if (window.DeskChart) DeskChart.drawEquity($("equity"), {
      points: pack.points || [], marks: marks, startLine: pack.startLine, range: range
    });

    renderLiveCard();
    var running = (state.bots || []).filter(function (b) { return b.status === "running"; }).length;
    $("bots-head").textContent = "Bots · " + running + " running";
    $("bot-carousel").innerHTML = (state.bots || []).map(miniBot).join("");
    $("home-activity").innerHTML = renderActivityList((activity && activity.rows) || [], 5, true);
  }

  function captureMs(t) {
    if (!t) return 0;
    return t < 1e12 ? t * 1000 : t;
  }

  function frameCapturedAt() {
    var fromState = state && state.screenAt;
    return captureMs(fromState) || screenAt || 0;
  }

  function renderLiveCard() {
    var cap = frameCapturedAt();
    var ageMs = cap ? (Date.now() - cap) : Infinity;
    var live = ageMs < 5000;
    $("live-dot").className = "live-dot" + (live ? " hot" : "");
    $("live-age").textContent = live ? "Live · Bot's computer" : ("Last frame " + (cap ? fmtTime(cap / 1000) : "never"));
    var lane = laneStatus();
    $("live-lane").textContent = lane.text;
    $("live-lane").style.color = lane.color || "#fff";
    var last = lastOrder();
    var fomo = $("live-fomo");
    if (fomo) {
      var mint = last && last.mint;
      if (mint && window.FOMO_LINKS) {
        fomo.href = FOMO_LINKS.coin_url(mint);
        fomo.hidden = false;
      } else {
        fomo.removeAttribute("href");
        fomo.hidden = true;
      }
    }
    if (!last) {
      $("live-order").textContent = "No order yet";
      $("live-checks").innerHTML = "";
      return;
    }
    var verb = last.status === "done" ? (last.side === "sell" ? "Sold" : "Bought") : (last.status || "Order");
    var verified = last.status === "done" ? " · verified" : (last.status === "unverified" ? " · unverified" : "");
    $("live-order").textContent = verb + " " + shortSym(last) + " · " + fmtMoney(last.fill_usd != null ? last.fill_usd : last.usd) + verified;
    var ch = last.checks || { screen: last.screen_ok, api: last.api_ok, chain: last.chain_ok };
    $("live-checks").innerHTML = ["screen", "api", "chain"].map(function (k) {
      return "<span><i class=\"chk " + checkClass(ch[k]) + "\"></i>" + k + "</span>";
    }).join("");
  }
  function lastOrder() {
    var rows = (orders && orders.rows) || [];
    return rows[0] || null;
  }
  function laneStatus() {
    var rows = (orders && orders.rows) || [];
    var inflight = rows.filter(function (o) { return /queued|clicking|verifying/.test(o.status || ""); })[0];
    if (inflight) {
      var bot = inflight.bot || "executor";
      var act = inflight.status === "clicking" ? (inflight.side === "sell" ? "selling" : "buying") : inflight.status;
      return { text: NAMES[bot] + " · " + act, color: COLORS[bot] || "#fff" };
    }
    return { text: "Idle", color: "#fff" };
  }
  function shortSym(row) {
    return (row && (row.symbol || (row.mint || "").slice(0, 4))) || "X";
  }

  function miniBot(b) {
    var name = b.name, color = b.color || COLORS[name];
    return '<div class="bot-mini" data-bot="' + name + '">' +
      '<div class="bot-head"><span class="status-dot ' + (b.status || "") + '"></span>' +
      '<span class="bot-name" style="color:' + color + '">' + (NAMES[name] || name) + '</span></div>' +
      '<div class="bot-title">' + esc(b.title || "") + '</div>' +
      '<div class="bot-sub">' + botSubtitle(b) + '</div>' +
      botExtras(b, true) +
      '</div>';
  }
  function botSubtitle(b) {
    if (b.name === "scanner" && /kill/i.test(b.subtitle || ""))
      return '<span class="kill">' + esc(b.title) + '</span><span class="kill-reason">' + esc(b.subtitle) + '</span>';
    return esc(b.subtitle || "");
  }
  function settingVal(key, fallback) {
    var s = settings && settings.settings && settings.settings[key];
    return s && s.value != null ? s.value : fallback;
  }
  function botExtras(b, compact) {
    if (b.name === "analyst") {
      return compact ? "" : '<div class="strips">' + LAYERS.map(function (n) {
        return '<div class="strip">' + n + '</div>';
      }).join("") + '</div>';
    }
    if (b.name === "brain") {
      var rule = Number(settingVal("brain.full_size_score", 80)) + "+ = full size";
      return '<div class="bot-sub">' + esc(rule) + ' / under ' + settingVal("brain.full_size_score", 80) + ' = half size</div>';
    }
    if (b.name === "executor") {
      var dip = settingVal("executor.dip_pct", 15);
      var bar = b.subtitle && /click/i.test(b.subtitle) ? "Clicking Buy..." :
        (b.subtitle && /bought|done/i.test(b.subtitle) ? "✓ Bought · verified" :
          "Waiting for a dip -" + dip + "%");
      return '<div class="bot-sub">' + esc(bar) + '</div><div class="bar"><i style="background:' + COLORS.executor + '"></i></div>';
    }
    if (b.name === "risk") {
      var stop = settingVal("risk.stop_pct", 25);
      var trail = settingVal("executor.trail_pct", 40);
      return '<div class="pills"><span class="pill red">stop -' + stop + '%</span><span class="pill green">trail ' + trail + '%</span></div>';
    }
    return "";
  }

  function renderBots() {
    $("bots-list").innerHTML = (state && state.bots || BOTS.map(function (n) { return { name: n, color: COLORS[n] }; }))
      .map(function (b) {
        var rows = (decisions[b.name] && decisions[b.name].rows) || [];
        var locked = b.name === "risk" && state && (state.positions || []).length > 0;
        var pause = '<div class="switch-row"><span>Pause</span>' +
          '<span class="via">' + (locked ? "Locked · position open · via Telegram" : "via Telegram") + "</span>" +
          '<div class="switch' + (b.paused ? " on" : "") + (locked ? " locked" : "") + '"><i></i></div></div>';
        var dec = '<ul class="decisions">' + rows.slice(0, 20).map(function (r) {
          var short = r.mint ? r.mint.slice(0, 4) + "…" + r.mint.slice(-4) : "";
          var label = (r.verdict || r.status || r.title || r.reason || short || "decision");
          if (short && String(label).indexOf(short) < 0) label = label + " · " + short;
          var href = r.link || (r.mint && window.FOMO_LINKS ? FOMO_LINKS.coin_url(r.mint) : "");
          return '<li><a href="' + (href || "#") + '" target="_blank" rel="noopener">' + esc(String(label)) + "</a>" +
            '<span class="sub">' + fmtTime(r.ts) + "</span></li>";
        }).join("") + (rows.length ? "" : '<li class="sub">No decisions yet</li>') + "</ul>";
        return '<article class="bot-full" id="bot-' + b.name + '">' +
          '<div class="bot-head"><span class="status-dot ' + (b.status || "") + '"></span>' +
          '<span class="bot-name" style="color:' + (b.color || COLORS[b.name]) + '">' + (NAMES[b.name] || b.name) + "</span>" +
          '<span class="bot-sub" style="margin-left:auto">' + (b.count != null ? b.count : "") + "</span></div>" +
          '<div class="bot-title">' + esc(b.title || "") + "</div>" +
          '<div class="bot-sub">' + botSubtitle(b) + "</div>" +
          botExtras(b, false) + pause + dec +
          '<button class="shortcut" data-settings="' + b.name + '">Settings</button>' +
          "</article>";
      }).join("");
  }

  function renderActivityList(rows, limit, emptyHome) {
    if (!rows || !rows.length) {
      return '<div class="empty">' + (emptyHome ? "Waiting for the first trade" : "Nothing yet tonight") + "</div>";
    }
    return rows.slice(0, limit || rows.length).map(activityRow).join("");
  }
  function activityRow(r) {
    var kind = (r.kind || "").toLowerCase();
    var title = r.title || kind;
    var sub = r.subtitle || "";
    var val = r.value, cls = "";
    if (kind === "sold") { cls = "up"; if (val != null && String(val).indexOf("+") < 0) val = fmtMoney(val); }
    if (kind === "stopped") { cls = "down"; }
    if (kind === "bought" && val != null && String(val).indexOf("$") < 0) val = fmtMoney(val);
    if (kind === "rejected") val = val || "Skipped";
    return '<button class="row" data-kind="' + kind + '" data-mint="' + esc(r.mint || "") + '">' +
      '<div class="mid"><div class="title">' + esc(title) + '</div><div class="sub">' + esc(sub) +
      (r.ts ? " · " + fmtTime(r.ts) : "") + '</div></div>' +
      '<div class="val ' + cls + '">' + esc(String(val == null ? "" : val)) + "</div></button>";
  }
  function renderActivity() {
    $("activity-list").innerHTML = renderActivityList((activity && activity.rows) || [], 30, false);
  }

  function renderAccount() {
    var mode = ((account && account.mode) || (state && state.mode) || "PAPER").toUpperCase();
    document.querySelectorAll("#mode-seg button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-mode") === mode);
    });
    $("acct-cash").textContent = fmtMoney(state && state.balance);
    var sched = (account && account.schedule) || "24/7";
    var gate = account && account.liveGate;
    var via = $("mode-via");
    if (via) {
      via.textContent = sched === "24/7"
        ? "24/7 · limits roll at 22:00 ET. Mode is changed on Telegram."
        : "Night schedule (lock 06:30). Mode is changed on Telegram.";
    }
    var handle = account && account.handle;
    $("btn-profile").onclick = function () {
      if (handle && window.FOMO_LINKS) location.href = FOMO_LINKS.profile_url(handle);
    };
    var items = (settings && settings.settings) || {};
    var html = "";
    SETTING_GROUPS.forEach(function (g) {
      var prefix = g[1], title = g[0];
      var keys = Object.keys(items).filter(function (k) {
        if (prefix) return k.indexOf(prefix) === 0;
        return k.indexOf(".") < 0 && ["mode"].indexOf(k) < 0;
      });
      if (!keys.length) return;
      html += '<div class="group-title" id="settings-' + title.toLowerCase() + '">' + title + "</div>";
      keys.forEach(function (k) {
        var it = items[k];
        var lab = k.indexOf(".") >= 0 ? k.slice(k.indexOf(".") + 1).replace(/_/g, " ") : k.replace(/_/g, " ");
        var ctrl = "";
        if (it.min != null && it.max != null) {
          ctrl = '<div class="vals"><span>' + it.min + "</span><span class=\"num\">" + it.value + "</span><span>" + it.max + "</span></div>" +
            '<input type="range" min="' + it.min + '" max="' + it.max + '" value="' + it.value + '" disabled>';
        } else {
          ctrl = '<div class="vals"><span class="num">' + (it.value == null ? "—" : it.value) + "</span></div>";
        }
        html += '<div class="setting"><div class="lab">' + esc(lab) + "</div>" + ctrl +
          '<div class="via-note">via Telegram</div></div>';
      });
    });
    $("settings-groups").innerHTML = html;
  }

  function renderCoin(c, aud) {
    var name = c.name || c.symbol || c.mint.slice(0, 6);
    $("coin-name").textContent = name;
    var bits = [];
    if (c.symbol) bits.push(c.symbol);
    bits.push("Solana");
    var age = fmtAge(c.ageMin);
    if (age) bits.push(age);
    $("coin-meta").textContent = bits.join(" · ");
    $("coin-price").textContent = c.price != null ? Number(c.price).toPrecision(6) : "—";
    var pos = c.position;
    var since = $("coin-since");
    if (pos && pos.entryPrice && c.price != null) {
      var pct = (c.price - pos.entryPrice) / pos.entryPrice * 100;
      since.textContent = (pct >= 0 ? "▲ " : "▼ ") + fmtPct(pct, false) + " since entry";
      since.className = "since " + (pct >= 0 ? "up" : "down");
    } else { since.textContent = ""; since.className = "since"; }
    $("coin-mcap").textContent = c.marketCap != null ? fmtCompact(c.marketCap) : "—";
    $("coin-liq").textContent = c.liquidityUsd != null ? fmtCompact(c.liquidityUsd) : "—";
    $("coin-holders").textContent = c.holders != null ? Number(c.holders).toLocaleString() : "—";
    var sh = $("coin-shield");
    if (aud && aud.layers) {
      var ok = aud.layers.filter(function (l) { return l.pass === true; }).length;
      sh.textContent = ok + "/8";
      sh.hidden = false;
    } else { sh.textContent = ""; }
    var pc = $("coin-pos");
    if (pos) {
      pc.hidden = false;
      pc.textContent = "Your position · " + fmtMoney(pos.sizeUsd) + " in · Executor";
    } else pc.hidden = true;
    var link = c.link || (window.FOMO_LINKS ? FOMO_LINKS.coin_url(c.mint) : "#");
    $("coin-fomo").href = link;
    var exit = pos && pos.stopPrice;
    if (window.DeskChart) DeskChart.drawCandles($("candles"), { candles: c.candles || [], exitLine: exit });
    $("sell-sheet").hidden = true;
  }

  function renderAudit(a) {
    $("audit-title").textContent = (a.mint || "Audit").slice(0, 8) + "…";
    $("audit-meta").textContent = "8 layers";
    var layers = a.layers || [];
    $("audit-discs").innerHTML = layers.map(function (l, i) {
      var cls = l.pass === true ? "pass" : (l.pass === false ? "fail" : "");
      return '<div class="disc ' + cls + (i === 0 ? " beam" : "") + '">' + (l.pass === true ? "✓" : (l.pass === false ? "✕" : (i + 1))) + "</div>";
    }).join("");
    $("audit-layers").innerHTML = layers.map(function (l) {
      var mark = l.pass === true ? "✓" : (l.pass === false ? "✕" : "·");
      var val = l.valueText || "—";
      return "<li><span>" + mark + " " + esc(l.name || "") + "</span><span class=\"num\">" + esc(String(val)) + "</span></li>";
    }).join("");
    var sc = a.score || {};
    var socialOff = sc.social == null && (sc.social_pts == null);
    if (socialOff || sc.social === 0 || sc.reason && /social: off/i.test(sc.reason || ""))
      $("audit-social").textContent = "Social: off";
    else
      $("audit-social").textContent = "Social +" + (sc.social_pts != null ? sc.social_pts : (sc.social || "0"));
    $("audit-fomo").href = a.link || (window.FOMO_LINKS ? FOMO_LINKS.coin_url(a.mint) : "#");
    // cyan beam walks the discs once
    if (!reduceMotion) {
      var discs = $("audit-discs").children, i = 0;
      var t = setInterval(function () {
        for (var j = 0; j < discs.length; j++) discs[j].classList.toggle("beam", j === i);
        i++;
        if (i >= discs.length) clearInterval(t);
      }, 220);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  /* ---------- data load ---------- */
  function loadScreen() {
    return fetchDec("screen").then(function (buf) {
      var url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      var a = $("screen-a"), b = $("screen-b");
      var next = screenFlip ? a : b, prev = screenFlip ? b : a;
      next.onload = function () {
        next.classList.add("show");
        prev.classList.remove("show");
        if (screenUrl) URL.revokeObjectURL(screenUrl);
        screenUrl = url;
        screenFlip = !screenFlip;
      };
      next.src = url;
      $("live-fs-img").src = url;
      // Prefer the capture timestamp from state.json so a stale jpeg
      // shows its real age, not the time this fetch finished.
      var cap = state && state.screenAt;
      screenAt = cap ? captureMs(cap) : Date.now();
    }).catch(function () { /* optional */ });
  }

  function tick() {
    clearTimeout(timer);
    var jobs = [
      fetchJson("state"),
      fetchJson("chart"),
      fetchJson("activity"),
      fetchJson("orders"),
      fetchJson("account"),
      fetchJson("settings")
    ].concat(BOTS.map(function (n) { return fetchJson("bots/" + n + "/decisions").catch(function () { return { bot: n, rows: [] }; }); }));
    Promise.all(jobs).then(function (xs) {
      state = xs[0]; chart = xs[1]; activity = xs[2]; orders = xs[3]; account = xs[4]; settings = xs[5];
      BOTS.forEach(function (n, i) { decisions[n] = xs[6 + i]; });
      lastTs = state && state.ts;
      lastGood = { state: state, chart: chart, activity: activity };
      var rows = (activity && activity.rows) || [];
      if (rows.length && rows[0].ts && rows[0].ts !== seenActivity && tab !== "activity") $("bell-dot").hidden = false;
      clearError();
      renderAll();
      return loadScreen().then(function () { renderLiveCard(); });
    }).catch(function () {
      showError();
    }).then(function () {
      timer = setTimeout(tick, POLL_S * 1000);
    });
  }
  function renderAll() {
    paintChrome();
    if (state) renderHome();
    renderBots();
    renderActivity();
    renderAccount();
  }

  function loadCoin(mint) {
    Promise.all([
      fetchJson("coin/" + mint).catch(function () { return { mint: mint, link: FOMO_LINKS.coin_url(mint), candles: [] }; }),
      fetchJson("audit/" + mint).catch(function () { return null; })
    ]).then(function (xs) { renderCoin(xs[0], xs[1]); });
  }
  function loadAudit(mint) {
    fetchJson("audit/" + mint).then(renderAudit).catch(function () {
      renderAudit({ mint: mint, layers: LAYERS.map(function (n, i) { return { layer: i + 1, name: n, pass: null, valueText: null }; }), link: FOMO_LINKS.coin_url(mint) });
    });
  }

  /* ---------- events ---------- */
  document.querySelectorAll("#tabbar button").forEach(function (b) {
    b.addEventListener("click", function () { nav(b.getAttribute("data-tab"), null, null); });
  });
  $("home-avatar").addEventListener("click", function () { nav("account"); });
  $("see-all").addEventListener("click", function () { nav("activity"); });
  $("btn-search").addEventListener("click", function () {
    var w = $("search-wrap");
    w.hidden = !w.hidden;
    if (!w.hidden) $("search-q").focus();
  });
  $("search-q").addEventListener("input", function () {
    var q = this.value.trim().toLowerCase();
    var box = $("search-results");
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    var found = {};
    function add(mint, label) {
      if (!mint || found[mint]) return;
      if ((mint + " " + (label || "")).toLowerCase().indexOf(q) < 0) return;
      found[mint] = label || mint;
    }
    ((activity && activity.rows) || []).forEach(function (r) { add(r.mint, r.title); });
    ((state && state.positions) || []).forEach(function (p) { add(p.mint, p.symbol || p.name); });
    BOTS.forEach(function (n) {
      ((decisions[n] && decisions[n].rows) || []).forEach(function (r) { add(r.mint, r.reason || r.title); });
    });
    var keys = Object.keys(found).slice(0, 20);
    box.hidden = !keys.length;
    box.innerHTML = keys.map(function (m) {
      return '<button data-mint="' + esc(m) + '"><div>' + esc(found[m]) + '</div><div class="sub">' + esc(m.slice(0, 8) + "…" + m.slice(-6)) + "</div></button>";
    }).join("");
  });
  $("search-results").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    $("search-wrap").hidden = true;
    nav(tab, "coin", b.getAttribute("data-mint"));
  });
  $("btn-bell").addEventListener("click", function () {
    $("bell-dot").hidden = true;
    var rows = (activity && activity.rows) || [];
    if (rows[0]) seenActivity = rows[0].ts;
    nav("activity");
  });
  $("ranges").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    range = b.getAttribute("data-range");
    document.querySelectorAll("#ranges button").forEach(function (x) { x.classList.toggle("on", x === b); });
    renderHome();
  });
  $("live-card").addEventListener("click", function () { nav(tab, "live", currentMint); });
  $("live-back").addEventListener("click", function () { nav(tab, null); });
  $("coin-back").addEventListener("click", function () { nav(tab, null); });
  $("audit-back").addEventListener("click", function () { nav(tab, null); });
  $("home-activity").addEventListener("click", onActivityTap);
  $("activity-list").addEventListener("click", onActivityTap);
  function onActivityTap(e) {
    var b = e.target.closest(".row");
    if (!b) return;
    var mint = b.getAttribute("data-mint");
    var kind = b.getAttribute("data-kind");
    if (!mint) return;
    nav(tab, kind === "rejected" ? "audit" : "coin", mint);
  }
  $("bots-list").addEventListener("click", function (e) {
    var s = e.target.closest("[data-settings]");
    if (s) {
      nav("account");
      setTimeout(function () {
        var el = document.querySelector("#settings-" + s.getAttribute("data-settings"));
        if (el) el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }, 50);
    }
    var a = e.target.closest("a[href]");
    // links already open FOMO
  });
  $("bot-carousel").addEventListener("click", function () { nav("bots"); });
  $("coin-sell").addEventListener("click", function () {
    $("sell-sheet").hidden = false;
  });
  $("sell-sheet").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pct]");
    if (b) {
      sellPct = +b.getAttribute("data-pct");
      document.querySelectorAll("#sell-sheet [data-pct]").forEach(function (x) { x.classList.toggle("on", x === b); });
    }
  });
  $("confirm-sell").addEventListener("click", function (e) {
    e.preventDefault();
    // Plan B: no POST. Telegram until STEP 11.
  });
  $("btn-invite").addEventListener("click", function () {
    var url = window.FOMO_LINKS ? FOMO_LINKS.SIGNUP_URL : "";
    if (navigator.share) {
      navigator.share({ title: "FOMO", url: url }).catch(function () { copyLink(url); });
    } else copyLink(url);
  });
  function copyLink(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast("Link copied"); });
    } else toast("Link copied");
  }
  function toast(msg) {
    $("mode-via").textContent = msg;
    setTimeout(function () { $("mode-via").textContent = "Mode is changed on Telegram."; }, 2000);
  }
  $("mode-seg").addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-mode]") : null;
    var want = btn && btn.getAttribute("data-mode");
    var gate = account && account.liveGate;
    if (want === "LIVE") {
      var reason = (gate && !gate.ready && gate.reason)
        ? gate.reason
        : "LIVE needs 1 full PAPER night, STEP 15 passed, and you typing LIVE on Telegram.";
      $("mode-via").textContent = reason + " Mode stays PAPER until then.";
      return;
    }
    $("mode-via").textContent = "Switch PAPER / LIVE on Telegram. LIVE needs a confirm.";
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });

  // Restore tab from hash (d&k already applied).
  (function restore() {
    var p = hashParams();
    if (p.get("tab")) tab = p.get("tab");
    if (p.get("screen")) screenView = p.get("screen");
    if (p.get("mint")) currentMint = p.get("mint");
  })();

  if (!dataPath || !keyB64 || !window.crypto || !crypto.subtle) {
    $("locked").hidden = false;
    $("app").hidden = true;
    return;
  }
  $("locked").hidden = true;
  $("app").hidden = false;
  writeHash({ tab: tab, screen: screenView, mint: currentMint });
  tick();
  // Hash restore does not go through nav(), so Coin/Audit must load here.
  if (screenView === "coin" && currentMint) loadCoin(currentMint);
  if (screenView === "audit" && currentMint) loadAudit(currentMint);
})();
