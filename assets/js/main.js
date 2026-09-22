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
  var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduce = mqReduce.matches;
  if (mqReduce.addEventListener) mqReduce.addEventListener("change", function (e) {
    reduce = e.matches;
    if (reduce) { var hv = document.querySelector(".hero__video"); if (hv) hv.pause(); }
  });
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

    /* 経歴タイムラインの線を伸ばす（動きを抑える設定では初期化時に全表示済み） */
    if (timeline && !reduce) {
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
    if (focusToggle) toggle.focus();
  }
  if (toggle && links) {
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { var first = links.querySelector("a"); if (first) first.focus(); }
    });
    $$(".nav__links a").forEach(function (a) { a.addEventListener("click", function () { closeNav(false); }); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && links.classList.contains("open")) closeNav(true);
    });
    document.addEventListener("click", function (e) {
      if (links.classList.contains("open") && !links.contains(e.target) && !toggle.contains(e.target)) closeNav(false);
    });
    /* Tab でパネルの外に抜けたら閉じる（背後のコンテンツに隠れフォーカスが残らないように） */
    links.addEventListener("focusout", function (e) {
      if (!links.classList.contains("open")) return;
      var to = e.relatedTarget;
      if (to && !links.contains(to) && !toggle.contains(to)) closeNav(false);
    });
  }

  /* ---------- 改行の見張り ----------
     「変な改行」をこう決めて、描画された行を測って直す。

       1. 早すぎる改行（いちばん困る）
          行の右にすき間が残っているのに、次の行へ送られている状態。
          和文は一文字ごとに折り返せるので、すき間が空くのは
          「折り返さない塊」（人名・語尾のまとまり・見出しの文節）が
          まるごと押し出されたとき。文字が左に固まって見える。
       2. 泣き別れ
          最後の行に一〜二文字しか残らない状態。
       3. 行頭・行末の禁則は CSS（line-break: strict）に任せる。

     直し方は「もとの組み方をできるだけ残したまま、必要な要素だけ
     折り返しをひと段階ずつ許す」。段階は次の5つ。

       0 そのまま
       1 語尾のまとまり（文末3文字の接着）だけ外す
       2 接着（人名などの見えない継ぎ目）を全部外す
       3 見出しの「文節で折る」指定を外し、nowrap の語は空白で区切る
       4 nowrap と &nbsp; を完全に解く
       5 メールアドレスや URL のような長い英数字も途中で折る

     実際に描かれた行を測ってから決めるので、画面の幅・比率・
     文字サイズ・書体の読み込み具合が変わっても、その場に合わせて効く。 */
  var lineGuard = (function () {
    var HEAD = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, SUMMARY: 1, DT: 1 };
    var INLINE = {
      A: 1, ABBR: 1, B: 1, BDI: 1, BR: 1, CITE: 1, CODE: 1, EM: 1, I: 1, MARK: 1,
      Q: 1, S: 1, SMALL: 1, SPAN: 1, STRONG: 1, SUB: 1, SUP: 1, TIME: 1, U: 1, WBR: 1
    };
    var WJ = /⁠/g;
    var MAX = 5;
    var memo = (typeof WeakMap === "function") ? new WeakMap() : null;

    function state(el) {
      if (memo) {
        var s = memo.get(el);
        if (!s) { s = { html: el.innerHTML, level: 0 }; memo.set(el, s); }
        return s;
      }
      if (el.dataset.lbRaw == null) { el.dataset.lbRaw = el.innerHTML; el.dataset.lbLevel = "0"; }
      return { html: el.dataset.lbRaw, level: +el.dataset.lbLevel || 0 };
    }
    function remember(el, level) {
      if (memo) { var s = memo.get(el); if (s) s.level = level; }
      else el.dataset.lbLevel = String(level);
    }

    /* 中身が文字と行内要素だけか。
       中に「行を切る要素」（display が block の <small> など）が入っていると、
       そこで行が終わるのは当たり前なので、見張りの対象から外す。 */
    function inlineOnly(el) {
      for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        if (!INLINE[c.tagName]) return false;
        if (c.tagName !== "BR" && c.tagName !== "WBR") {
          var disp = getComputedStyle(c).display;
          if (disp !== "contents" && disp !== "ruby" && disp.indexOf("inline") !== 0) return false;
        }
        if (!inlineOnly(c)) return false;
      }
      return true;
    }

    function targets(root) {
      var list = (root || document).querySelectorAll(
        "p, li, dd, dt, figcaption, blockquote, h1, h2, h3, h4, h5, h6, summary, .eyebrow"
      );
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el.classList.contains("reveal-words")) continue;   /* 行マスク側で面倒を見る */
        if (el.closest(".honeypot")) continue;
        if (!el.firstChild || !el.textContent.trim()) continue;
        if (!inlineOnly(el)) continue;
        out.push(el);
      }
      return out;
    }

    /* 描画された行を取り出す。
       Range の矩形は「行ごと」ではなく「中の要素ごと」にまとまって返るので、
       <strong> などが入っていると順番が前後する。上端が近いものを
       集めてから並べ直さないと、同じ行を別の行と数えてしまう。 */
    function lines(el, cs) {
      var rg = document.createRange();
      rg.selectNodeContents(el);
      var rects = rg.getClientRects(), out = [], i, j, r, hit;
      var lh = parseFloat(cs.lineHeight);
      if (!lh) lh = (parseFloat(cs.fontSize) || 16) * 1.6;
      for (i = 0; i < rects.length; i++) {
        r = rects[i];
        if (!r.height || !r.width) continue;
        hit = null;
        for (j = 0; j < out.length; j++) {
          if (Math.abs(r.top - out[j].top) < lh * 0.55) { hit = out[j]; break; }
        }
        if (hit) {
          if (r.right > hit.right) hit.right = r.right;
          if (r.left < hit.left) hit.left = r.left;
        } else {
          out.push({ top: r.top, left: r.left, right: r.right });
        }
      }
      out.sort(function (a, b) { return a.top - b.top; });
      return out;
    }

    /* 悪さの点数。0 なら文句なし。数字は「文字いくつ分おかしいか」に近い。 */
    function score(el) {
      var cs = getComputedStyle(el);
      var ta = cs.textAlign;
      /* 中央揃え・右揃えは「左に固まる」が起きない。
         text-wrap: balance / pretty はブラウザが行の長さを均すので触らない。 */
      if (ta === "center" || ta === "right" || ta === "end") return null;
      if (/balance|pretty/.test(cs.textWrap || cs.textWrapStyle || "")) return null;
      if (/^pre/.test(cs.whiteSpace) || cs.whiteSpace === "nowrap") return null;
      var box = el.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      /* 登場演出の拡大・縮小（transform: scale）が掛かっている最中でも
         正しく測れるよう、実寸との比で目盛りを合わせる。 */
      var sc = el.offsetWidth ? box.width / el.offsetWidth : 1;
      if (!sc || !isFinite(sc)) sc = 1;
      var em = (parseFloat(cs.fontSize) || 16) * sc;
      var right = box.right - (parseFloat(cs.paddingRight) || 0) * sc - (parseFloat(cs.borderRightWidth) || 0) * sc;
      var left = box.left + (parseFloat(cs.paddingLeft) || 0) * sc + (parseFloat(cs.borderLeftWidth) || 0) * sc;
      var L = lines(el, cs);
      if (L.length < 2) return { bad: 0, lines: L.length };
      var width = right - left;
      if (width <= 0) return null;
      /* 見出しと短いラベルは文節の切れ目で折る設計なので、
         ある程度のすき間は「わざと」。本文は一文字ごとに折り返せるので、
         一文字分を超えて空いていれば不自然。 */
      /* 文節でしか折らない組み方（word-break: keep-all）の見出し・ラベルは、
         文節ひとつ分のすき間は「わざと」なので、ゆるめに見る。 */
      var head = HEAD[el.tagName] === 1 || el.classList.contains("eyebrow") || cs.wordBreak === "keep-all";
      /* 和文は禁則処理のぶん、一〜二文字ぶんのすき間はどうしても出る。
         そこを超えたぶんだけを「変」と数え、大きく空くほど強く嫌う。 */
      var tol = head ? Math.max(2.5, width * 0.18 / em) : Math.max(1.4, width * 0.04 / em);
      /* 書き手が入れた <br> の行は、そこで改行するのが意図なので数えない */
      var lh = parseFloat(cs.lineHeight) || em * 1.6;
      var brs = el.getElementsByTagName("br"), forced = [], bi, br;
      for (bi = 0; bi < brs.length; bi++) {
        br = brs[bi].getBoundingClientRect();
        if (br.height || br.top) forced.push(br.top);
      }
      var bad = 0, i, gap, last, fi, skip;
      for (i = 0; i < L.length - 1; i++) {
        skip = false;
        for (fi = 0; fi < forced.length; fi++) {
          if (Math.abs(forced[fi] - L[i].top) < lh * 0.55) { skip = true; break; }
        }
        if (skip) continue;
        gap = (right - L[i].right) / em;
        if (gap > tol) bad += Math.pow(gap - tol, 1.5);
      }
      /* 泣き別れ。一文字だけ残るのは避けたいが、
         「左に大きく固まる」よりは軽い扱いにする。 */
      last = (L[L.length - 1].right - L[L.length - 1].left) / em;
      if (last < 1.6) bad += 1.0;
      else if (last < 2.4) bad += 0.4;
      return { bad: bad, lines: L.length };
    }

    function textNodes(el) {
      var out = [];
      (function walk(n) {
        for (var c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) out.push(c);
          else if (c.nodeType === 1) walk(c);
        }
      })(el);
      return out;
    }

    /* level の段階ぶんだけ折り返しを許して組み直す */
    function relax(el, level) {
      var s = state(el), i, j;
      /* 逃がし弁は要素側の指定で付ける（CSS の指定に確実に勝たせるため）。
         中の要素に付けたぶんは innerHTML を戻せば一緒に消える。 */
      el.style.wordBreak = "";
      el.style.overflowWrap = "";
      el.innerHTML = s.html;                 /* いつも「もとの組み方」から始める */
      if (!level) return;
      var nodes = textNodes(el);
      if (level === 1) {
        /* 文末3文字を離さないための接着だけを外す（12文字ぶんを見る） */
        var budget = 12;
        for (i = nodes.length - 1; i >= 0 && budget > 0; i--) {
          var v = nodes[i].nodeValue, take = Math.min(budget, v.length);
          nodes[i].nodeValue = v.slice(0, v.length - take) + v.slice(v.length - take).replace(WJ, "");
          budget -= take;
        }
      } else {
        for (i = 0; i < nodes.length; i++) {
          if (nodes[i].nodeValue.indexOf("⁠") >= 0) nodes[i].nodeValue = nodes[i].nodeValue.replace(WJ, "");
        }
      }
      if (level >= 3) {
        /* 文節でしか折らない指定（word-break: keep-all）を外す */
        if (getComputedStyle(el).wordBreak === "keep-all") el.style.wordBreak = "normal";
        var fixed = el.querySelectorAll(".nw, .vision__q");
        for (i = 0; i < fixed.length; i++) {
          var f = fixed[i];
          /* .nw は「ここでは絶対に切らない」という書き手の指定なので、
             どの段階でも中身は割らない（空白のところで分けるだけ）。 */
          if (level >= 4 && !f.classList.contains("nw")) { f.style.whiteSpace = "normal"; continue; }
          /* 「代表取締役 堀之内 渉」のような並びは、語のまとまりは保ったまま
             空白のところだけ折れるようにする */
          var parts = f.textContent.split(/(\s+)/);
          if (parts.length < 3) continue;
          var frag = document.createDocumentFragment();
          for (j = 0; j < parts.length; j++) {
            if (!parts[j]) continue;
            if (/^\s+$/.test(parts[j])) frag.appendChild(document.createTextNode(" "));
            else {
              var sp = document.createElement("span");
              sp.className = f.className;
              sp.textContent = parts[j];
              frag.appendChild(sp);
            }
          }
          f.parentNode.replaceChild(frag, f);
        }
        if (level >= 4) {
          /* CSS で nowrap が掛かっている語も、ここまで来たら解く */
          var all = el.getElementsByTagName("*");
          for (i = 0; i < all.length; i++) {
            var acs = getComputedStyle(all[i]);
            if (acs.whiteSpace === "nowrap" && !all[i].classList.contains("nw")) all[i].style.whiteSpace = "normal";
            /* inline-flex などの「かたまりの箱」は途中で折れないので、
               中身が文字だけのものに限って、ふつうの行内要素に戻す */
            if (!all[i].children.length && acs.display.indexOf("inline") === 0 && acs.display !== "inline") {
              all[i].style.display = "inline";
            }
          }
          /* 切りたくない場所に入れた空白（&nbsp;）も、ここまで来たら普通の空白にする */
          nodes = textNodes(el);
          for (i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeValue.indexOf(" ") >= 0) nodes[i].nodeValue = nodes[i].nodeValue.replace(/ /g, " ");
          }
        }
        /* メールアドレスや URL のような長い英数字も、最後の手段として途中で折る。
           CSS の overflow-wrap では「次の行に入るなら送る」ままなので、
           区切りのよい位置（@ . - / の直後）に折り返し候補を入れて行を埋める。 */
        if (level >= 5) {
          el.style.overflowWrap = "anywhere";
          nodes = textNodes(el);
          var LONG = /[A-Za-z0-9][A-Za-z0-9@._\-\/:+]{7,}/g;
          for (i = 0; i < nodes.length; i++) {
            var v = nodes[i].nodeValue;
            LONG.lastIndex = 0;
            if (!LONG.test(v)) continue;
            LONG.lastIndex = 0;
            var frag2 = document.createDocumentFragment(), m, pos = 0, piece, k;
            while ((m = LONG.exec(v))) {
              if (m.index > pos) frag2.appendChild(document.createTextNode(v.slice(pos, m.index)));
              piece = "";
              for (k = 0; k < m[0].length; k++) {
                piece += m[0].charAt(k);
                if ((/[@._\-\/:+]/.test(m[0].charAt(k)) && piece.length >= 3) || piece.length >= 8) {
                  frag2.appendChild(document.createTextNode(piece));
                  frag2.appendChild(document.createElement("wbr"));
                  piece = "";
                }
              }
              if (piece) frag2.appendChild(document.createTextNode(piece));
              pos = m.index + m[0].length;
            }
            if (pos < v.length) frag2.appendChild(document.createTextNode(v.slice(pos)));
            nodes[i].parentNode.replaceChild(frag2, nodes[i]);
          }
        }
      }
    }

    /* 見張りを止めて素の組み方を確かめたいときは URL に ?lb=off を付ける（確認用） */
    var OFF = /[?&]lb=off(&|$)/.test(location.search);

    /* 要素ひとつを見て、いちばん素直に収まる段階に組み替える */
    function fix(el) {
      if (OFF) return 0;
      var s = state(el);
      if (s.level) relax(el, 0);             /* 前回ゆるめていたら、まず戻す */
      var base = score(el);
      if (!base) { remember(el, 0); return 0; }
      if (base.bad <= 0.01) { remember(el, 0); return 0; }
      /* 直せる余地（接着・nowrap・文節指定）が無ければ、これ以上は触らない */
      if (el.textContent.indexOf("⁠") < 0 && !el.querySelector(".nw, .vision__q") &&
          !(HEAD[el.tagName] === 1 || el.classList.contains("eyebrow"))) { remember(el, 0); return 0; }
      var bestScore = base.bad, best = 0, lv, cur;
      for (lv = 1; lv <= MAX; lv++) {
        relax(el, lv);
        cur = score(el);
        if (!cur) break;
        /* もとの組み方から離れるほど、わずかに不利にする。
           同じくらいの見た目なら、書き手の意図どおりの組み方を選ぶ。 */
        var v = cur.bad + lv * 0.12;
        if (v < bestScore - 0.01) { bestScore = v; best = lv; }
        if (cur.bad <= 0.01) break;
      }
      relax(el, best);
      remember(el, best);
      return best;
    }

    var list = null, timer = 0, lastW = -1;
    function runAll() {
      if (!list) list = targets();
      lastW = document.documentElement.clientWidth;
      for (var i = 0; i < list.length; i++) {
        if (!list[i].isConnected) continue;
        try { fix(list[i]); } catch (e) { /* 1要素の失敗で全体を止めない */ }
      }
    }
    /* 幅が変わったときだけ測り直す（スマホでアドレスバーが伸び縮みしても走らせない） */
    function schedule() {
      if (document.documentElement.clientWidth === lastW) return;
      clearTimeout(timer);
      timer = setTimeout(function () { list = null; runAll(); }, 160);
    }

    return { fix: fix, runAll: runAll, schedule: schedule };
  })();

  /* 書体が確定してから一度測り、あとは幅が変わるたびに測り直す */
  (function () {
    var run = function () { lineGuard.runAll(); };
    if (document.fonts && document.fonts.ready) {
      var t = setTimeout(run, 1200);      /* fonts.ready が返らない環境の保険 */
      document.fonts.ready.then(function () { clearTimeout(t); run(); });
    } else {
      run();
    }
    window.addEventListener("resize", lineGuard.schedule, { passive: true });
    window.addEventListener("orientationchange", lineGuard.schedule);
  })();

  /* ---------- 見出しの行マスク ----------
     一度そのままのテキストに戻してブラウザに正しく折らせ、
     できあがった「行」を span で包み直す。
     文字単位で割らないので、word-break: auto-phrase（文節改行）も
     line-break: strict（行頭禁則）もそのまま効く。 */
  function bail(el, text) {         /* 計測できないときは素のテキストで見せる */
    el.textContent = text;
    el.classList.add("is-split", "is-visible");
  }

  /* 中身がテキストと単純な span だけか（<br> や入れ子の要素が無いか）を見る。
     span だけなら、折り返しを決めているのは中の nowrap 指定なので、
     それを活かしたまま行に割ることができる。 */
  function simpleInline(el) {
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      /* <wbr> は折り返し候補の目印。中身を持たないので分割の邪魔にならない */
      if (c.tagName === "WBR") continue;
      if (c.tagName !== "SPAN") return false;
      /* span の中に span（.accent > .nw など）が入っている程度なら許容する */
      for (var j = 0; j < c.children.length; j++) {
        var g = c.children[j];
        if (g.tagName !== "WBR" && g.tagName !== "SPAN") return false;
        if (g.children.length) return false;
      }
    }
    return true;
  }

  function splitLines(el) {
    /* <br> や入れ子の要素が入っている見出しは、マークアップを壊さないよう分割しない */
    if (el.children.length && !el.querySelector(".ln") && !simpleInline(el)) {
      el.classList.add("is-split", "is-visible"); return;
    }
    /* 初回に「素のHTML」を控えておく。中の <span class="nw"> は
       改行してほしくない語のまとまりなので、復元して折り位置に反映させる。 */
    if (el.dataset.rawHtml == null && !el.querySelector(".ln")) el.dataset.rawHtml = el.innerHTML;
    if (el.dataset.raw == null) el.dataset.raw = el.textContent.replace(/\s+/g, " ").trim();
    var text = el.dataset.raw;
    if (!text) return;
    /* 素に戻して、ブラウザに自然に折らせる（nowrap の塊はそのまま維持される） */
    if (el.dataset.rawHtml != null) el.innerHTML = el.dataset.rawHtml;
    else el.textContent = text;
    /* 行に割る前に、この幅で変な改行にならないところまでゆるめておく */
    try { lineGuard.fix(el); } catch (e) {}

    /* まだレイアウトされていない（幅ゼロ・非表示）なら分割しない */
    var box = el.getBoundingClientRect();
    if (!box.width || !box.height) { bail(el, text); return; }

    /* テキストノードを順に集め、通し位置と対応づける */
    var chunks = [];
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) chunks.push(c);
        else if (c.nodeType === 1) walk(c);
      }
    })(el);
    if (!chunks.length) { bail(el, text); return; }

    var range = document.createRange();
    var lines = [], cur = "", top = null;
    /* サロゲートペア（絵文字など）を跨いで Range を切らないよう、コードポイント単位で進める */
    for (var ci = 0; ci < chunks.length; ci++) {
      var node = chunks[ci], s = node.nodeValue;
      for (var i = 0; i < s.length;) {
        var cp = s.codePointAt(i);
        var len = cp > 0xFFFF ? 2 : 1;
        range.setStart(node, i); range.setEnd(node, i + len);
        var r = range.getBoundingClientRect();
        if (!r.height) { bail(el, text); return; }  /* 計測不能 */
        var t = Math.round(r.top);
        if (top !== null && t !== top) { lines.push(cur); cur = ""; }
        cur += s.substr(i, len); top = t;
        i += len;
      }
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
      var fontsTimer = setTimeout(runSplit, 1200);   /* fonts.ready が返らない環境の保険 */
      document.fonts.ready.then(function () { clearTimeout(fontsTimer); runSplit(); });
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
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        /* data-reveal-delay="1〜5" は 80ms 刻みの時差。CSS の transition-delay は
           transition ショートハンドに打ち消されるため、ここで待ってから表示する */
        var d = +(e.target.dataset.revealDelay || 0) * 80;
        if (d) setTimeout(function () { e.target.classList.add("is-visible"); }, d);
        else e.target.classList.add("is-visible");
      });
    }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* タイムラインを確定（初回計算はすべての定義後にまとめて実行） */
  timeline = $(".timeline");
  /* 動きを抑える設定では、航路の線は最初からすべて表示する */
  if (timeline && reduce) {
    timeline.style.setProperty("--p", "1");
    timeline.style.setProperty("--track", (timeline.getBoundingClientRect().height - 16) + "px");
  }

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
    /* JS 検証が使えるときだけブラウザ標準の検証を切る。
       main.js が届かない環境では、標準検証が空送信を防いでくれる。 */
    form.setAttribute("novalidate", "");
    /* ソリューション一覧から来た場合、相談内容を引き継ぐ（?topic=…） */
    (function prefillTopic() {
      var m = /[?&]topic=([^&]+)/.exec(window.location.search);
      if (!m) return;
      var raw;
      try { raw = decodeURIComponent(m[1].replace(/\+/g, " ")); }
      catch (_) { return; }   /* 不正な %エンコードは黙って無視 */
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
        form.removeAttribute("aria-busy");
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
            /* 成功メッセージは mailto 用の文言なので、自動送信の場合は差し替える */
            var okText = ok && ok.querySelector("span");
            if (okText) okText.textContent = "送信しました。内容を確認のうえ、折り返しご連絡いたします。";
            done();
          })
          .catch(function () {
            if (btn) btn.disabled = false;
            form.removeAttribute("aria-busy");
            /* 通信エラーは入力欄の誤りではないので、フォーム全体の通知として出す */
            var fail = form.querySelector(".form-fail");
            if (!fail) {
              fail = document.createElement("p");
              fail.className = "field__err form-fail";
              fail.setAttribute("role", "alert");
              form.appendChild(fail);
            }
            fail.textContent = "送信できませんでした。お手数ですが " + MAIL_TO + " へ直接ご連絡ください。";
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
      if (taps >= 2) e.preventDefault();   /* 連打中はページ遷移でカウンタが消えないように */
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


  /* ---------- 表紙の写真を数枚、ゆっくり切り替える ---------- */
  (function () {
    var box = document.querySelector(".photo-bg--slides");
    if (!box) return;
    var slides = [].slice.call(box.querySelectorAll(".slide"));
    if (slides.length < 2 || reduce) return;          // 動きを抑える設定では1枚目のまま
    function load(s) {
      [].forEach.call(s.querySelectorAll("[data-srcset]"), function (e) { e.srcset = e.getAttribute("data-srcset"); e.removeAttribute("data-srcset"); });
      [].forEach.call(s.querySelectorAll("img[data-src]"), function (e) { e.src = e.getAttribute("data-src"); e.removeAttribute("data-src"); });
    }
    function ready(s) { var im = s.querySelector("img"); return im && im.complete && im.naturalWidth > 0; }
    var cur = 0, timer = 0, inView = true;
    function schedule(ms) {
      clearTimeout(timer);
      if (inView && !document.hidden) timer = setTimeout(next, ms || 6500);
    }
    function next() {
      var n = (cur + 1) % slides.length;
      if (!ready(slides[n])) { load(slides[n]); schedule(800); return; }   // まだ読み込み中なら少し待つ
      slides[n].classList.add("is-on", "is-zoom");
      slides[cur].classList.remove("is-on");
      var prev = slides[cur];
      setTimeout(function () { prev.classList.remove("is-zoom"); }, 1900);  // 消えきってから元の大きさへ
      cur = n;
      load(slides[(cur + 1) % slides.length]);                              // 次の1枚を先に読んでおく
      schedule();
    }
    requestAnimationFrame(function () { slides[0].classList.add("is-zoom"); });
    window.addEventListener("load", function () { setTimeout(function () { load(slides[1]); }, 600); });
    document.addEventListener("visibilitychange", function () { schedule(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { inView = es[0].isIntersecting; schedule(); }).observe(box);
    }
    schedule(7000);                                                          // 1枚目は見出しが出そろうまで少し長め
  })();

  /* console 署名（隠し） */
  try {
    console.log("%c知上会 — 金融教育・資産形成サポート", "color:#1b4f6b;font-size:15px;font-weight:bold;");
    console.log("%cbuilt with care.", "color:#6b7c8a;");
  } catch (_) {}
})();
