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

  /* 装飾モチーフ（船・島）は廃止しました */

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

  var meter = null, dots = [], meterSections = [];

  /* ---- スクロールに応じて背景がわずかに深くなる ---- */
  function updateExtras() { /* 背景トーンの変化・深度メーターは廃止 */ }

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
