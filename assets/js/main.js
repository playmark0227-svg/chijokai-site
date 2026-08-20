/* =====================================================================
   知上会 — main.js
   スクロール演出 / カウンター / チルト / 隠し要素 など
   ※ .js クラスは各ページの <head> でも付与済み（FOUC 回避）
   ===================================================================== */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");
  /* このファイルが動いたことの目印。
     各ページの <head> にある保険（一定時間これが立たなければ js クラスを外す）と対になっている。
     main.js の配信に失敗しても本文が透明のまま消えないようにするため。 */
  window.__chijoukaiReady = true;
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
  var paras = [];      // パララックス対象
  var timeline = null; // story.html の経歴タイムライン
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

    /* 経歴タイムラインの線を伸ばす */
    if (timeline) {
      var tr = timeline.getBoundingClientRect();
      var p = (vh * 0.72 - tr.top) / tr.height;
      timeline.style.setProperty("--p", Math.max(0, Math.min(1, p)).toFixed(3));
      timeline.style.setProperty("--track", (tr.height - 16) + "px");
    }

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

  /* ---------- 見出しの行マスク ----------
     一度そのままのテキストに戻してブラウザに正しく折らせ、
     できあがった「行」を span で包み直す。
     文字単位で割らないので、word-break: auto-phrase（文節改行）も
     line-break: strict（行頭禁則）もそのまま効く。 */
  function bail(el, text) {         /* 計測できないときは素のテキストで見せる */
    el.textContent = text;
    el.classList.add("is-split", "is-visible");
  }

  function splitLines(el) {
    if (el.dataset.raw == null) el.dataset.raw = el.textContent;
    var text = el.dataset.raw;
    if (!text) return;
    el.textContent = text;                       /* 素に戻して自然に折らせる */
    var node = el.firstChild;
    if (!node) return;

    /* まだレイアウトされていない（幅ゼロ・非表示）なら分割しない */
    var box = el.getBoundingClientRect();
    if (!box.width || !box.height) { bail(el, text); return; }

    var range = document.createRange();
    var lines = [], cur = "", top = null;
    for (var i = 0; i < text.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      var r = range.getBoundingClientRect();
      if (!r.height) { bail(el, text); return; }  /* 計測不能 */
      var t = Math.round(r.top);
      if (top !== null && t !== top) { lines.push(cur); cur = ""; }
      cur += text.charAt(i); top = t;
    }
    if (cur) lines.push(cur);

    /* 1文字ずつ別行になるなど、明らかに計測が破綻している場合は諦める。
       見出しが縦に崩れるくらいなら、演出を捨てて正しく組まれた素のテキストを見せる。 */
    var expected = Math.max(1, Math.round(box.height / (parseFloat(getComputedStyle(el).lineHeight) || box.height)));
    if (lines.length > 8 || lines.length > expected + 1 || lines.length >= text.length) {
      bail(el, text); return;
    }

    el.textContent = "";
    lines.forEach(function (ln, idx) {
      var outer = document.createElement("span");
      outer.className = "ln";
      var inner = document.createElement("span");
      inner.textContent = ln;
      inner.style.transitionDelay = (idx * 0.09) + "s";
      outer.appendChild(inner);
      el.appendChild(outer);
    });
    el.setAttribute("aria-label", text);         /* 行分割で読み上げが切れないように */
    el.classList.add("is-split");
  }

  var wordEls = $$(".reveal-words");
  if (reduce) {
    /* 動きを抑える設定では分割しない（素のテキストのまま表示する） */
    wordEls.forEach(function (el) { el.classList.add("is-split", "is-visible"); });
  } else {
    /* 書体が確定してから測る。Web フォント読み込み前に測ると折り位置がずれる */
    var runSplit = function () { wordEls.forEach(splitLines); };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(runSplit);
      setTimeout(runSplit, 1200);      /* fonts.ready が返らない環境の保険 */
    } else {
      runSplit();
    }
    /* 幅が変われば折り位置も変わる。dataset.raw から復元するので何度呼んでも安全 */
    if ("ResizeObserver" in window) {
      var rsTimer = 0;
      var ro = new ResizeObserver(function () {
        clearTimeout(rsTimer);
        rsTimer = setTimeout(function () {
          wordEls.forEach(function (el) {
            var wasVisible = el.classList.contains("is-visible");
            splitLines(el);
            if (wasVisible) el.classList.add("is-visible");
          });
        }, 180);
      });
      wordEls.forEach(function (el) { ro.observe(el); });
    }
  }

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

  /* パララックス対象とタイムラインを確定（初回計算はすべての定義後にまとめて実行） */
  paras = $$("[data-parallax]");
  timeline = $(".timeline");

  /* ---------- 画面外のアニメーションを停止（軽量化） ---------- */
  if ("IntersectionObserver" in window && !reduce) {
    var pio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle("anim-off", !e.isIntersecting); });
    }, { rootMargin: "250px 0px" });
    $$(".footer-boat").forEach(function (el) { pio.observe(el); });
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

  /* ---- ヒーローの背景がマウスに追従して動く（視差） ----
     画像は CSS で scale(1.1) してあるので、その余白のぶんだけ平行移動しても
     縁が見えない。移動はカーソルと逆向きにすると奥行きが出る。
     滑らかさは CSS 側の transition に任せる。 */
  var hero = $(".hero--cinematic");
  var heroImg = hero && $(".hero__layers", hero);
  if (hero && heroImg && !reduce && window.matchMedia("(pointer:fine)").matches) {
    var hraf = 0, hx = 0, hy = 0;
    var AMP_X = 30, AMP_Y = 20; /* 最大移動量(px) */

    function applyHero() {
      hraf = 0;
      heroImg.style.transform =
        "scale(1.1) translate3d(" + hx.toFixed(1) + "px," + hy.toFixed(1) + "px,0)";
    }
    hero.addEventListener("mousemove", function (e) {
      var r = hero.getBoundingClientRect();
      hx = -((e.clientX - r.left) / r.width - 0.5) * 2 * AMP_X;
      hy = -((e.clientY - r.top) / r.height - 0.5) * 2 * AMP_Y;
      if (!hraf) hraf = requestAnimationFrame(applyHero);
    }, { passive: true });
    hero.addEventListener("mouseleave", function () {
      hx = 0; hy = 0;
      if (!hraf) hraf = requestAnimationFrame(applyHero);
    });
    /* rAF が動かない環境（背面タブ等）でも位置がずれたままにならないように */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { hx = 0; hy = 0; applyHero(); }
    });
  }

  /* ---------- 表紙の背景動画 ----------
     既定では読み込まない（preload="none"）。次のすべてを満たしたときだけ
     読み込んで再生し、成功したら静止画の上にフェードインさせる。
       ・動きを抑える設定になっていない
       ・画面が十分に広い（スマートフォンでは通信量と自動再生の制約を避ける）
       ・データ節約モード／低速回線ではない
     どれかを満たさない、または再生が拒否された場合は静止画のまま。 */
  (function heroVideo() {
    var v = hero && $(".hero__video", hero);
    if (!v || reduce) return;
    if (!window.matchMedia("(min-width: 721px)").matches) return;

    var c = navigator.connection || navigator.webkitConnection || {};
    if (c.saveData) return;
    if (/(^|-)(slow-)?2g$/.test(c.effectiveType || "")) return;

    /* 表示の切り替えは play() の戻り値ではなく、実際に再生が始まった
       playing イベントで行う。背面タブで開かれた場合、play() は解決しても
       ブラウザの省電力で即座に止まることがあり、その状態で表示を切り替えると
       「再生していないのに動画が見えている」ことになる。逆に、あとで前面に
       戻って再生が始まったときは確実に切り替わる。 */
    v.addEventListener("playing", function () { hero.classList.add("is-video"); });

    var started = false;
    function start() {
      if (started) return; started = true;
      v.preload = "auto";
      v.load();
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* 拒否されたら静止画のまま */ });
    }
    /* 先頭の描画とLCP画像の取得を邪魔しないよう、読み込み完了後に取りかかる */
    if (document.readyState === "complete") setTimeout(start, 400);
    else window.addEventListener("load", function () { setTimeout(start, 400); });

    /* 表紙が画面から外れているあいだ、そしてタブが背面のあいだは止める */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!started) return;
          if (e.isIntersecting) { v.play().catch(function () {}); }
          else v.pause();
        });
      }, { threshold: 0.05 }).observe(hero);
    }
    document.addEventListener("visibilitychange", function () {
      if (!started) return;
      if (document.hidden) v.pause();
      else if (hero.getBoundingClientRect().bottom > 0) v.play().catch(function () {});
    });
  })();

  /* すべての定義が揃ったところで初回計算（同期実行で初期値を確定） */
  readWrite();

  /* ---------- Contact form（検証つき） ----------
     送信先メールアドレス。
     FORM_ENDPOINT が空のあいだは、入力内容を件名・本文に組み立てて
     利用者のメールソフトを開く方式（mailto）で動作します。
     Formspree / Getform などのフォーム管理サービスを契約したら、
     FORM_ENDPOINT にその POST 先 URL を入れるだけで自動送信に切り替わります。 */
  var MAIL_TO = "info@chijoukai.com";
  var FORM_ENDPOINT = "";

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
      /* 案件名は「法人向けのご紹介」に寄せ、具体名は本文へ */
      for (var i = 0; i < sel.options.length; i++) {
        if (/法人向け/.test(sel.options[i].text)) { sel.selectedIndex = i; break; }
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

      function done() {
        if (btn) btn.disabled = true;
        form.setAttribute("aria-busy", "true");
        if (ok) {
          ok.classList.add("show");
          ok.setAttribute("tabindex", "-1");
          ok.focus();
          ok.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        }
      }

      var val = function (id) { var f = document.getElementById(id); return f ? f.value.trim() : ""; };

      /* フォーム管理サービスが設定済みなら、そちらへ送信 */
      if (FORM_ENDPOINT) {
        var data = new FormData(form);
        if (btn) btn.disabled = true;
        form.setAttribute("aria-busy", "true");
        fetch(FORM_ENDPOINT, { method: "POST", body: data, headers: { Accept: "application/json" } })
          .then(function (res) {
            if (!res.ok) throw new Error("送信に失敗しました");
            done();
          })
          .catch(function () {
            if (btn) btn.disabled = false;
            form.removeAttribute("aria-busy");
            showError(document.getElementById("message"),
              "送信できませんでした。お手数ですが " + MAIL_TO + " へ直接ご連絡ください。");
          });
        return;
      }

      /* 既定：入力内容をメール本文に組み立てて、メールソフトを開く */
      var lines = [
        "お名前：" + val("name"),
        "会社名・屋号：" + (val("company") || "（未記入）"),
        "メールアドレス：" + val("email"),
        "電話番号：" + (val("tel") || "（未記入）"),
        "ご相談の内容：" + val("topic"),
        "",
        "【メッセージ】",
        val("message")
      ].join("\n");
      var href = "mailto:" + MAIL_TO +
        "?subject=" + encodeURIComponent("【お問い合わせ】" + val("topic") + "／" + val("name")) +
        "&body=" + encodeURIComponent(lines);
      window.location.href = href;
      done();
    });
    /* 入力し直したらエラー表示を消す */
    form.addEventListener("input", function (e) {
      if (e.target.hasAttribute("aria-invalid")) clearError(e.target);
    });
  }

  /* ---------- 印刷 ----------
     よくあるご質問は <details> で畳んであるため、そのまま印刷すると
     答えが出ない。印刷前にすべて開き、終わったら元の状態へ戻す。 */
  (function printFriendlyDetails() {
    var opened = [];
    window.addEventListener("beforeprint", function () {
      opened = $$("details:not([open])");
      opened.forEach(function (d) { d.open = true; });
    });
    window.addEventListener("afterprint", function () {
      opened.forEach(function (d) { d.open = false; });
      opened = [];
    });
  })();

  /* ---------- Footer year ---------- */
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* =================================================================
     隠し要素（イースターエッグ）
     ================================================================= */
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "egg-toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
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
        toast("見つけましたね。ここまで読んでいただき、ありがとうございます。");
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
      if (pos === seq.length) { pos = 0; toast("隠しコマンドを発見しました。"); }
    } else {
      pos = (k === seq[0]) ? 1 : 0;
    }
  });


  /* console 署名（隠し） */
  try {
    console.log("%c知上会 — 金融教育・資産形成サポート", "color:#1b4f6b;font-size:15px;font-weight:bold;");
    console.log("%cbuilt with care.", "color:#6b7c8a;");
  } catch (_) {}
})();
