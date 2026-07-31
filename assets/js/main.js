/* =====================================================================
   地上界 — main.js
   スクロール演出 / カウンター / チルト / 隠し要素 など
   ※ .js クラスは各ページの <head> でも付与済み（FOUC 回避）
   ===================================================================== */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ロード時の登場アニメーション
     背面タブでは rAF が発火しないため、タイマーでも必ず表示状態にする */
  function markLoaded() { root.classList.add("is-loaded"); }
  requestAnimationFrame(function () { requestAnimationFrame(markLoaded); });
  setTimeout(markLoaded, 500);

  /* ---------- Header / progress / back-to-top（rAF で1本化） ---------- */
  var header = $(".site-header");
  var prog = document.createElement("div"); prog.className = "scroll-prog"; document.body.appendChild(prog);
  var toTop = $(".to-top");
  var paras = [];      // パララックス対象（deco 生成後に確定）
  var timeline = null; // story.html の航路
  var vh = window.innerHeight || 800;
  var ticking = false;

  function readWrite() {
    var y = window.pageYOffset || root.scrollTop;

    /* ヘッダー・進捗バー・トップ戻り */
    if (header) header.classList.toggle("scrolled", y > 30);
    var h = root.scrollHeight - vh;
    prog.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    if (toTop) toTop.classList.toggle("show", y > 600);

    /* パララックス：ビューポート中心からの相対量（累積しないので画面外に飛ばない） */
    var mid = vh / 2;
    for (var i = 0; i < paras.length; i++) {
      var el = paras[i];
      var host = el.closest(".section, .cta-band, .hero, .page-hero");
      if (!host) continue;
      var r = host.getBoundingClientRect();
      var rel = (r.top + r.height / 2) - mid;
      var sp = parseFloat(el.dataset.parallax) || 0.15;
      var t = Math.max(-48, Math.min(48, -rel * sp));
      el.style.transform = "translate3d(0," + t.toFixed(1) + "px,0)";
    }

    /* タイムラインの航路を伸ばす */
    if (timeline) {
      var tr = timeline.getBoundingClientRect();
      var p = (vh * 0.72 - tr.top) / tr.height;
      timeline.style.setProperty("--p", Math.max(0, Math.min(1, p)).toFixed(3));
      timeline.style.setProperty("--track", (tr.height - 16) + "px");
    }

    /* 深度メーター・背景トーン（定義後に有効化される） */
    if (typeof updateExtras === "function") updateExtras(y);

    ticking = false;
  }
  function onScrollRaf() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(readWrite);
  }
  window.addEventListener("scroll", onScrollRaf, { passive: true });
  window.addEventListener("resize", function () { vh = window.innerHeight || vh; onScrollRaf(); }, { passive: true });

  if (toTop) toTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); });

  /* ---------- Mobile nav ---------- */
  var toggle = $(".nav__toggle"), links = $(".nav__links");
  function closeNav(focusToggle) {
    if (!links || !toggle) return;
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "メニューを開く");
    if (focusToggle) toggle.focus();
  }
  if (toggle && links) {
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
      if (open) { var first = links.querySelector("a"); if (first) first.focus(); }
    });
    $$(".nav__links a").forEach(function (a) { a.addEventListener("click", function () { closeNav(false); }); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && links.classList.contains("open")) closeNav(true);
    });
    document.addEventListener("click", function (e) {
      if (links.classList.contains("open") && !links.contains(e.target) && !toggle.contains(e.target)) closeNav(false);
    });
  }

  /* ---------- Word-by-word reveal（<br> などのタグは保持） ---------- */
  $$(".reveal-words").forEach(function (el) {
    if (el.dataset.split) return; el.dataset.split = "1";
    var label = el.textContent.trim();
    var frag = document.createDocumentFragment(), i = 0;
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        Array.prototype.forEach.call(node.nodeValue, function (ch) {
          var span = document.createElement("span");
          span.textContent = ch;
          span.style.transitionDelay = (i++ * 0.035) + "s";
          frag.appendChild(span);
        });
      } else {
        frag.appendChild(node.cloneNode(true));
      }
    });
    el.textContent = ""; el.appendChild(frag);
    el.setAttribute("aria-label", label); /* 1文字ずつの span で読み上げが分断されないように */
  });

  /* ---------- Reveal on scroll ---------- */
  var revealables = $$("[data-reveal], .reveal-words");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
      });
    }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- Number counters ---------- */
  function animateCount(el) {
    var target = parseFloat(el.dataset.count);
    var dec = (el.dataset.count.split(".")[1] || "").length;
    var dur = 1600, start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = target * eased;
      el.textContent = dec ? val.toFixed(dec) : Math.round(val).toLocaleString("ja-JP");
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = dec ? target.toFixed(dec) : target.toLocaleString("ja-JP");
    }
    requestAnimationFrame(step);
  }
  var counters = $$("[data-count]");
  if ("IntersectionObserver" in window && !reduce) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { animateCount(e.target); cio.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { el.textContent = "0"; cio.observe(el); });
  } else {
    counters.forEach(function (el) {
      var d = parseFloat(el.dataset.count);
      el.textContent = (el.dataset.count.split(".")[1] || "").length ? el.dataset.count : d.toLocaleString("ja-JP");
    });
  }

  /* ---------- Card tilt（rAF でカーソルに即応） ---------- */
  if (!reduce && window.matchMedia("(pointer:fine)").matches) {
    $$(".tilt").forEach(function (card) {
      var rect = null, raf = 0, mx = 0, my = 0;
      card.addEventListener("mouseenter", function () {
        rect = card.getBoundingClientRect();
        card.classList.add("is-tilting");
      });
      card.addEventListener("mousemove", function (e) {
        if (!rect) rect = card.getBoundingClientRect();
        mx = (e.clientX - rect.left) / rect.width - 0.5;
        my = (e.clientY - rect.top) / rect.height - 0.5;
        if (!raf) raf = requestAnimationFrame(function () {
          raf = 0;
          card.style.transform = "perspective(800px) rotateX(" + (-my * 7).toFixed(2) +
                                 "deg) rotateY(" + (mx * 9).toFixed(2) + "deg) translateY(-6px)";
        });
      });
      card.addEventListener("mouseleave", function () {
        card.classList.remove("is-tilting");
        card.style.transform = "";
        rect = null;
      });
    });
  }

  /* ---------- Bubbles（端末に応じて数を調整・1回で挿入） ---------- */
  $$(".bubbles").forEach(function (box) {
    if (reduce) return;
    var n = parseInt(box.dataset.bubbles || "14", 10);
    if (window.matchMedia("(max-width: 720px)").matches) n = Math.ceil(n * 0.5);
    if ((navigator.hardwareConcurrency || 8) <= 4) n = Math.ceil(n * 0.7);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) {
      var b = document.createElement("span");
      b.className = "bubble";
      var size = 6 + Math.random() * 26;
      b.style.width = b.style.height = size + "px";
      b.style.left = (Math.random() * 100) + "%";
      b.style.animationDuration = (7 + Math.random() * 9) + "s";
      b.style.animationDelay = (-Math.random() * 12) + "s";
      b.style.opacity = 0.15 + Math.random() * 0.4;
      frag.appendChild(b);
    }
    box.appendChild(frag);
  });

  /* ---------- Decorative ships & islands（船・島をところどころに） ---------- */
  var DECO_SVG = {
    ship:    '<svg class="deco-svg" viewBox="0 0 120 112" fill="currentColor" aria-hidden="true"><path d="M12 68h96l-12 24a8 8 0 0 1-7 4H31a8 8 0 0 1-7-4z"/><rect x="58" y="8" width="4" height="60"/><path d="M62 14q36 10 30 46l-30 3z"/></svg>',
    island:  '<svg class="deco-svg" viewBox="0 0 132 92" fill="currentColor" aria-hidden="true"><ellipse cx="66" cy="74" rx="56" ry="14"/><rect x="62" y="30" width="6" height="44"/><path d="M65 28q23 2 27 17q-17-7-27-5z"/><path d="M65 28q-23 2-27 17q17-7 27-5z"/></svg>',
    fish:    '<svg class="deco-svg" viewBox="0 0 124 74" fill="currentColor" aria-hidden="true"><path d="M8 37q32-30 74-8q12-13 34-16q-9 24 0 48q-22-3-34-16q-42 22-74-8z"/></svg>',
    compass: '<svg class="deco-svg" viewBox="0 0 112 112" fill="currentColor" aria-hidden="true"><circle cx="56" cy="56" r="50" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="3 7"/><path d="M56 18l9 29 29 9-29 9-9 29-9-29-29-9 29-9z"/></svg>'
  };
  var DECO_PLAN = [
    { m: "island",  c: "bl", p: 0.16, slow: true,  d: "-2.4s" },
    { m: "ship",    c: "tr", p: 0.20, slow: false, d: "-1.1s" },
    { m: "fish",    c: "br", p: 0.14, slow: true,  d: "-4.7s" },
    { m: "ship",    c: "tl", p: 0.12, slow: false, d: "-0.6s" },
    { m: "compass", c: "tr", p: 0.18, slow: true,  d: "-3.2s" },
    { m: "island",  c: "br", p: 0.15, slow: false, d: "-5.5s" }
  ];
  $$(".section, .cta-band").forEach(function (sec, i) {
    if (sec.dataset.deco) return; sec.dataset.deco = "1";
    var plan = DECO_PLAN[i % DECO_PLAN.length];
    var light = sec.classList.contains("section--deep") || sec.classList.contains("cta-band");
    var layer = document.createElement("div");
    layer.className = "deco-layer " + (light ? "deco--light" : "deco--dark");
    var pos = document.createElement("div");
    pos.className = "deco-pos " + plan.c;
    if (!reduce) pos.setAttribute("data-parallax", plan.p);
    var fl = document.createElement("div");
    fl.className = "deco-float" + (plan.slow ? " deco-float--slow" : "");
    fl.style.setProperty("--d", plan.d);
    fl.innerHTML = DECO_SVG[plan.m];
    pos.appendChild(fl); layer.appendChild(pos);
    sec.insertBefore(layer, sec.firstChild);
  });

  /* パララックス対象とタイムラインを確定（初回計算はすべての定義後にまとめて実行） */
  paras = $$("[data-parallax]");
  timeline = $(".timeline");

  /* ---------- 画面外のアニメーションを停止（軽量化） ---------- */
  if ("IntersectionObserver" in window && !reduce) {
    var pio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle("anim-off", !e.isIntersecting); });
    }, { rootMargin: "250px 0px" });
    $$(".bubbles, .deco-layer, .wave-divider, .portrait__ring").forEach(function (el) { pio.observe(el); });
  }

  /* =================================================================
     追加演出（洗練レイヤー）
     ================================================================= */

  /* ---- 見出しの下線・統計をスクロールで発火 ---- */
  if ("IntersectionObserver" in window && !reduce) {
    var tio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); tio.unobserve(e.target); }
      });
    }, { threshold: 0.4 });
    $$(".section-title, .stat").forEach(function (el) { tio.observe(el); });
  } else {
    $$(".section-title, .stat").forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---- ボタンがカーソルに引き寄せられる（マグネティック） ---- */
  if (!reduce && window.matchMedia("(pointer:fine)").matches) {
    $$(".btn").forEach(function (btn) {
      var raf = 0, r = null;
      btn.addEventListener("mouseenter", function () { r = btn.getBoundingClientRect(); btn.classList.add("is-magnetic"); });
      btn.addEventListener("mousemove", function (e) {
        if (!r) r = btn.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) * 0.22;
        var dy = (e.clientY - (r.top + r.height / 2)) * 0.32;
        if (!raf) raf = requestAnimationFrame(function () {
          raf = 0;
          btn.style.setProperty("--mx", dx.toFixed(1) + "px");
          btn.style.setProperty("--my", dy.toFixed(1) + "px");
        });
      });
      btn.addEventListener("mouseleave", function () {
        btn.classList.remove("is-magnetic");
        btn.style.setProperty("--mx", "0px");
        btn.style.setProperty("--my", "0px");
        r = null;
      });
    });
  }

  /* ---- クリックで波紋がひろがる ---- */
  if (!reduce) {
    document.addEventListener("click", function (e) {
      var t = e.target.closest(".btn, .card, .sol, .next-card, .faq-item summary");
      if (!t) return;
      var r = t.getBoundingClientRect();
      var size = Math.max(r.width, r.height) * 1.9;
      var rip = document.createElement("span");
      rip.className = "ripple";
      rip.style.width = rip.style.height = size + "px";
      rip.style.left = (e.clientX - r.left) + "px";
      rip.style.top = (e.clientY - r.top) + "px";
      if (getComputedStyle(t).position === "static") t.style.position = "relative";
      t.appendChild(rip);
      setTimeout(function () { rip.remove(); }, 800);
    }, { passive: true });
  }

  /* ---- ヒーローがマウスに反応して層で動く ---- */
  var hero = $(".hero"), scene = $(".hero__scene svg");
  if (hero && scene && !reduce && window.matchMedia("(pointer:fine)").matches) {
    var hraf = 0;
    hero.addEventListener("mousemove", function (e) {
      hero.classList.add("is-pointing");
      var r = hero.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      if (!hraf) hraf = requestAnimationFrame(function () {
        hraf = 0;
        scene.style.transform = "translate3d(" + (px * 26).toFixed(1) + "px," + (py * 18).toFixed(1) + "px,0) rotate(" + (px * 1.6).toFixed(2) + "deg)";
      });
    });
    hero.addEventListener("mouseleave", function () {
      hero.classList.remove("is-pointing");
      scene.style.transform = "";
    });
  }

  /* ---- 航海の深度メーター（現在地インジケーター） ---- */
  var meterSections = $$("main > section");
  var meter = null, dots = [];
  if (meterSections.length > 2 && !reduce) {
    meter = document.createElement("nav");
    meter.className = "depth-meter";
    meter.setAttribute("aria-label", "ページ内の現在位置");
    meterSections.forEach(function (sec, i) {
      var d = document.createElement("a");
      d.className = "depth-dot";
      if (!sec.id) sec.id = "sec-" + (i + 1);
      d.href = "#" + sec.id;
      var t = sec.querySelector(".section-title, h1, h2");
      d.setAttribute("aria-label", (t ? t.textContent.trim().slice(0, 24) : "セクション " + (i + 1)) + "へ移動");
      meter.appendChild(d);
      dots.push(d);
    });
    document.body.appendChild(meter);
  }

  /* ---- スクロールに応じて背景がわずかに深くなる ---- */
  var TINTS = ["#f2f5f7", "#eef2f5", "#eaeff3", "#e6ecf0"];

  function updateExtras(y) {
    if (meter) {
      meter.classList.toggle("show", y > 500);
      var mid = vh * 0.4, best = 0;
      for (var i = 0; i < meterSections.length; i++) {
        var r = meterSections[i].getBoundingClientRect();
        if (r.top <= mid) best = i;
      }
      for (var j = 0; j < dots.length; j++) dots[j].classList.toggle("is-active", j === best);
    }
    var h = root.scrollHeight - vh;
    var p = h > 0 ? y / h : 0;
    document.body.style.backgroundColor = TINTS[Math.min(TINTS.length - 1, Math.floor(p * TINTS.length))];
  }

  /* すべての定義が揃ったところで初回計算（同期実行で初期値を確定） */
  readWrite();

  /* ---------- Contact form（検証つき・デモ送信） ---------- */
  var form = $("#contactForm");
  if (form) {
    /* ソリューション一覧から来た場合、相談内容を引き継ぐ（?topic=…） */
    (function prefillTopic() {
      var m = /[?&]topic=([^&]+)/.exec(window.location.search);
      if (!m) return;
      var raw = decodeURIComponent(m[1].replace(/\+/g, " "));
      var sel = $("#topic"), msg = $("#message");
      if (!sel) return;
      if (raw === "radio") {
        for (var r = 0; r < sel.options.length; r++) {
          if (/ラジオ/.test(sel.options[r].text)) { sel.selectedIndex = r; return; }
        }
        return;
      }
      /* 案件名は「事業のソリューション」に寄せ、具体名は本文へ */
      for (var i = 0; i < sel.options.length; i++) {
        if (/ソリューション/.test(sel.options[i].text)) { sel.selectedIndex = i; break; }
      }
      if (/キャビア/.test(raw)) {
        for (var c = 0; c < sel.options.length; c++) {
          if (/キャビア/.test(sel.options[c].text)) { sel.selectedIndex = c; break; }
        }
      }
      if (msg && !msg.value) msg.value = "「" + raw + "」について相談したいです。\n\n";
    })();

    var MSG = {
      name: "お名前をご入力ください。",
      email: "メールアドレスをご入力ください。",
      topic: "ご相談の内容をお選びください。",
      message: "メッセージをご入力ください。"
    };
    function clearError(field) {
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
      var err = document.getElementById(field.id + "-err");
      if (err) err.remove();
    }
    function showError(field, msg) {
      clearError(field);
      var p = document.createElement("p");
      p.className = "field__err";
      p.id = field.id + "-err";
      p.setAttribute("role", "alert");
      p.textContent = msg;
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", p.id);
      field.parentNode.appendChild(p);
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      /* ハニーポット（自動投稿対策） */
      var pot = form.querySelector('[name="_gotcha"]');
      if (pot && pot.value) return;

      var invalid = null;
      ["name", "email", "topic", "message"].forEach(function (id) {
        var f = document.getElementById(id);
        if (!f) return;
        var bad = !f.value.trim() || (f.type === "email" && !f.checkValidity());
        if (bad) {
          var msg = (f.type === "email" && f.value.trim()) ? "メールアドレスの形式をご確認ください。" : MSG[id];
          showError(f, msg);
          if (!invalid) invalid = f;
        } else {
          clearError(f);
        }
      });
      if (invalid) { invalid.focus(); return; }

      var ok = $(".form-success", form);
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      form.setAttribute("aria-busy", "true");
      if (ok) {
        ok.classList.add("show");
        ok.setAttribute("tabindex", "-1");
        ok.focus();
        ok.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      }
    });
    /* 入力し直したらエラー表示を消す */
    form.addEventListener("input", function (e) {
      if (e.target.hasAttribute("aria-invalid")) clearError(e.target);
    });
  }

  /* ---------- Footer year ---------- */
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* =================================================================
     隠し要素（イースターエッグ）
     ================================================================= */
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "egg-toast";
    t.setAttribute("role", "status");
    t.innerHTML = '<span aria-hidden="true">🧭</span><span>' + msg + "</span>";
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 600); }, 4200);
  }

  /* ロゴを素早く5回タップで隠しメッセージ */
  var brand = $(".site-header .brand"); var taps = 0, tapTimer = null;
  if (brand) {
    brand.addEventListener("click", function (e) {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () { taps = 0; }, 800);
      if (taps >= 5) {
        e.preventDefault();
        taps = 0;
        toast("ようこそ、航海者へ。知識と知恵の海はどこまでも広い。⚓");
        sailShip();
      }
    });
  }

  /* コナミコマンド（↑↑↓↓←→←→BA）で船が横切る */
  var seq = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
  var pos = 0;
  window.addEventListener("keydown", function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === seq[pos]) {
      pos++;
      if (pos === seq.length) { pos = 0; toast("隠しコマンド発見！ 宝の地図が開かれた。🗺️✨"); sailShip(); }
    } else {
      pos = (k === seq[0]) ? 1 : 0;
    }
  });

  function sailShip() {
    if (reduce) return;
    var ship = document.createElement("div");
    ship.className = "egg-ship";
    ship.setAttribute("aria-hidden", "true");
    ship.innerHTML =
      '<svg viewBox="0 0 160 120" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M20 78 h120 l-14 26 a10 10 0 0 1-9 6 H43 a10 10 0 0 1-9-6 z" fill="#8a5a2b"/>' +
      '<path d="M20 78 h120 l-6 11 H26 z" fill="#a5713a"/>' +
      '<rect x="78" y="8" width="4" height="72" fill="#5c3b1e"/>' +
      '<path d="M82 14 q42 12 34 46 l-34 4 z" fill="#f4c96a"/>' +
      '<path d="M78 14 q-38 12 -30 46 l30 4 z" fill="#fff3d6"/>' +
      '<path d="M82 6 l20 6 -20 6 z" fill="#ff8f6b"/>' +
      "</svg>";
    document.body.appendChild(ship);
    requestAnimationFrame(function () { ship.classList.add("sail"); });
    setTimeout(function () { ship.remove(); }, 7200);
  }

  /* console 署名（隠し） */
  try {
    console.log("%c⚓ 地上界 — 知識と知恵の海へ", "color:#1f93b8;font-size:16px;font-weight:bold;");
    console.log("%cbuilt with care. ロゴを5回タップ or ↑↑↓↓←→←→BA を試してみて。", "color:#6d859a;");
  } catch (_) {}
})();
