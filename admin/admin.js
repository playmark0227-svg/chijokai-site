/* =====================================================================
   知上会 — 管理画面（法人の方へ「取り扱っている案件」）

   しくみ
     ・案件の中身は data/solutions.json にだけ持つ。
     ・この画面で JSON を読み、編集して、JSON と新しい画像を「1回のコミット」でリポジトリに書き込む。
       書き込み方は2通り。
         Google でログイン（ふだん使う）… 中継（worker/ の Cloudflare Worker）が Google のログインを確かめ、
             許可したアカウントのときだけ、中継が預かっている GitHub の鍵で書き込む。
         合言葉でログイン（制作担当の予備）… GitHub のトークンで、この画面から直接 GitHub の API に書き込む。
     ・その push をきっかけに GitHub Actions が tools/build-solutions.py を実行し、
       solutions.html を書き出して公開する（1〜2分）。
     ・公開されたページの data-rev（JSON の SHA-256 先頭12桁）を見て、反映を確かめる。

   守っていること
     ・Google のパスワードはこの画面には一切来ない（Google の画面で入れる）。
     ・ログインのしるし（中継が発行・8時間）と合言葉は、ページのどこにも保存しない（メモリだけ）。
       このページは他の案件サイトと同じオリジンにあり、保存すると読まれうるため。
       合言葉の記憶はブラウザのパスワード保存機能に任せる（ログイン欄をそのための形にしてある）。
     ・書き込む直前に「土台にするコミットでの JSON」が読み込んだときと同じか確かめ、
       違えば上書きせずに止める（ref の更新は fast-forward のみ。中継も同じ手順）。
     ・下書き（localStorage）は他のページからも書けるので、復元前に確認し、
       画像名・画像の中身・タグの色を検査してから使う。

   カードの見た目は tools/build-solutions.py の card() と同じ HTML で作る。
   片方を変えたら、もう片方もそろえること。点検の規則（validate）も同じ。
   ===================================================================== */
(function () {
  "use strict";

  var CONFIG = {
    owner: "playmark0227-svg",
    repo: "chijokai-site",
    branch: "main",
    dataPath: "data/solutions.json",
    imgDir: "assets/img/",
    site: "https://playmark0227-svg.github.io/chijokai-site/",
    maxImageWidth: 1200,          // 画像はこの幅まで縮めて JPEG で書き込む（WebP は公開時に作られる）
    jpegQuality: 0.86,
    maxFileBytes: 25 * 1024 * 1024,
    limits: { title: 60, label: 40, alt: 160, body: 1200, topic: 60, tag: 24, tags: 6 },
    deployTimeoutMs: 8 * 60 * 1000,
    deployPollMs: 8000,
    /* Google でログイン。値は tools/admin-google.py で入れる（手で直すなら index.html の CSP もそろえる）。
       どちらかが空のあいだは、合言葉でのログインだけになる。 */
    googleClientId: "",
    relay: "",
    loginHint: "info@chijoukai.com",
    maxPublishBytes: 9 * 1024 * 1024      /* 中継に1回で送れる大きさ（画像込み）。中継側の上限より少し小さく */
  };
  var GOOGLE_ON = !!(CONFIG.googleClientId && /^https:\/\/|^http:\/\/localhost[:/]/.test(CONFIG.relay));
  var RELAY = CONFIG.relay.replace(/\/+$/, "");
  var LEGACY_TOKEN_KEY = "chijoukai-admin-token";   /* 以前の版が保存していた場所（起動時に消す） */
  var DRAFT_KEY = "chijoukai-admin-draft:" + CONFIG.owner + "/" + CONFIG.repo;
  var FIELDS = ["id", "visible", "title", "label", "image", "alt", "body", "tags", "topic"];
  var TAG_COLORS = [["", "標準"], ["gold", "金"], ["coral", "赤茶"]];
  var TAG_OK = { "": 1, gold: 1, coral: 1 };
  var ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
  var IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(jpg|jpeg|png)$/;
  var ADMIN_IMAGE_RE = /^sol-[a-z][a-z0-9-]{0,39}-\d{8}-\d{6}\.jpg$/;   /* この画面が作る画像名 */
  var RESERVED_IDS = ["main", "faq", "top", "about", "company", "contact", "lineup", "content", "header", "footer", "nav", "menu", "navlinks", "navtoggle"];
  var NAMES = { title: "案件名", label: "英字の小見出し", image: "画像", alt: "画像の説明", body: "説明文", topic: "お問い合わせに引き継ぐ名前", id: "ページ内リンク名", tags: "タグ" };

  var S = {
    mode: null,        // "google"（中継経由）| "github"（合言葉で直接）| "demo"（お試し：書き込まない）
    token: null,       // 合言葉。メモリにだけ持つ
    session: null,     // 中継が発行したログインのしるし。メモリにだけ持つ
    email: "",         // Google でログインしたアカウント
    base: null,        // { doc, items, raw, sha } 最後に読み込んだ／公開した時点の内容
    items: [],         // 編集中の内容（各要素に内部用の _key を持たせる）
    images: {},        // この画面で選んだ画像 name -> { bytes, url, w, h, note, committed }
    selected: null,    // 選択中の _key
    busy: false,       // 公開の処理中
    watch: { gen: 0, timer: 0, check: null },
    previewWidth: 390,
    lastDeleted: null
  };

  /* ---------- 小さな道具 ---------- */
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var keySeq = 0;
  function newKey() { keySeq += 1; return "k" + keySeq; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function trim(s) { return String(s == null ? "" : s).replace(/[⁠​]/g, "").trim(); }
  function esc(s) {
    return trim(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function fromUtf8(b) { return new TextDecoder("utf-8").decode(b); }
  function toB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, "")), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function sha256hex(bytes) { return crypto.subtle.digest("SHA-256", bytes).then(hex); }
  /* Git が付ける blob の名前（SHA-1）。書き込みが実は届いていたかを確かめるのに使う */
  function gitBlobSha(bytes) {
    var head = utf8("blob " + bytes.length + "\0");
    var all = new Uint8Array(head.length + bytes.length);
    all.set(head, 0); all.set(bytes, head.length);
    return crypto.subtle.digest("SHA-1", all).then(hex);
  }
  function stamp() {
    var d = new Date(), p = function (n) { return ("0" + n).slice(-2); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function debounce(fn, ms) {
    var t = 0;
    return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function autoTopic(title) { return trim(title).replace(/\s*[｜|]\s*(.+)$/, "（$1）"); }
  function imgSrc(name) {
    if (!name) return "";
    return S.images[name] ? S.images[name].url : "../" + CONFIG.imgDir + encodeURIComponent(name);
  }
  function isJpeg(bytes) { return bytes && bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF; }

  /* ---------- 表示まわり ---------- */
  var toastTimer = 0;
  function toast(msg, tone, action) {
    var t = $("#toast"), btn = $("#toast-action");
    $("#toast-text").textContent = msg;
    t.dataset.tone = tone || "";
    btn.hidden = !action;
    btn.onclick = null;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = function () { t.hidden = true; action.run(); };
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, tone === "error" ? 15000 : action ? 10000 : 5000);
  }
  function setStatus(msg, tone) {
    var s = $("#status");
    s.textContent = msg;
    s.dataset.tone = tone || "";
  }
  /* ダイアログは、フォーム送信（method="dialog"）に頼らずボタンから直接閉じる。
     CSP で form-action を禁じているため、送信経由だと close が届かない環境がある。 */
  function ask(d, okBtn, cancelBtn) {
    return new Promise(function (resolve) {
      function done(v) {
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        d.removeEventListener("cancel", onEsc);
        if (d.open) d.close();
        resolve(v);
      }
      function onOk() { done(true); }
      function onCancel() { done(false); }
      function onEsc(e) { e.preventDefault(); done(false); }
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      d.addEventListener("cancel", onEsc);
      d.showModal();
    });
  }
  function confirmDialog(title, body, okLabel, danger, cancelLabel) {
    $("#dlg-confirm-title").textContent = title;
    $("#dlg-confirm-body").textContent = body;
    var ok = $("#dlg-confirm-ok"), cancel = $("#dlg-confirm-cancel");
    ok.textContent = okLabel || "OK";
    ok.className = "btn " + (danger ? "btn--danger" : "btn--primary");
    cancel.textContent = cancelLabel || "やめる";
    var p = ask($("#dlg-confirm"), ok, cancel);
    cancel.focus();
    return p;
  }

  /* =================================================================
     GitHub API
     ================================================================= */
  function ghMessage(status, data) {
    var m = data && data.message ? String(data.message) : "";
    if (status === 401) return "合言葉が正しくないか、有効期限が切れています。制作担当に新しい合言葉をご依頼ください。";
    if (status === 403 && /rate limit/i.test(m)) return "GitHub の利用回数の上限に達しました。1時間ほど待ってからやり直してください。";
    if (status === 403) return "この合言葉には書き込みの権限がありません。制作担当に「書き込みできる合言葉」をご依頼ください。";
    if (status === 404) return "サイトのデータが見つかりません。合言葉の対象が chijokai-site になっているか、制作担当にご確認ください。";
    if (status === 409 || status === 422) return "書き込みの途中で内容がぶつかりました。もう一度「公開する」を押してください。";
    return "GitHub との通信でエラーが起きました（" + status + (m ? "：" + m : "") + "）。";
  }
  function gh(path, opts) {
    opts = opts || {};
    var headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + S.token,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch("https://api.github.com" + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      referrerPolicy: "no-referrer",
      credentials: "omit"
    }).catch(function () {
      var e = new Error("インターネットにつながっていないか、GitHub に接続できません。通信のよい場所でもう一度お試しください。");
      e.status = 0;
      throw e;
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error(ghMessage(res.status, data));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }
  var R = function () { return "/repos/" + CONFIG.owner + "/" + CONFIG.repo; };

  function fetchDataFile(ref) {
    return gh(R() + "/contents/" + CONFIG.dataPath + "?ref=" + encodeURIComponent(ref || CONFIG.branch)).then(function (f) {
      return { raw: fromUtf8(fromB64(f.content)), sha: f.sha };
    });
  }

  /* JSON と画像を「1回のコミット」で書き込む。
     土台にする最新コミットでの JSON が、読み込んだときの版（baseSha）と同じときだけ積む。
     ref の更新は fast-forward だけなので、その間に他の更新が入れば 422 で止まり、やり直しになる。 */
  function commitOnce(files, message, baseSha, mySha) {
    var head;
    return gh(R() + "/git/ref/heads/" + CONFIG.branch).then(function (ref) {
      head = ref.object.sha;
      return gh(R() + "/contents/" + CONFIG.dataPath + "?ref=" + head);
    }).then(function (cur) {
      if (cur.sha === mySha) return { already: true };          /* 前回の書き込みが実は届いていた */
      if (cur.sha !== baseSha) { var e = new Error("conflict"); e.conflict = true; throw e; }
      var baseTree;
      return gh(R() + "/git/commits/" + head).then(function (c) {
        baseTree = c.tree.sha;
        return Promise.all(files.map(function (f) {
          return gh(R() + "/git/blobs", { method: "POST", body: { content: toB64(f.bytes), encoding: "base64" } });
        }));
      }).then(function (blobs) {
        return gh(R() + "/git/trees", {
          method: "POST",
          body: { base_tree: baseTree, tree: files.map(function (f, i) { return { path: f.path, mode: "100644", type: "blob", sha: blobs[i].sha }; }) }
        });
      }).then(function (tree) {
        return gh(R() + "/git/commits", { method: "POST", body: { message: message, tree: tree.sha, parents: [head] } });
      }).then(function (commit) {
        return gh(R() + "/git/refs/heads/" + CONFIG.branch, { method: "PATCH", body: { sha: commit.sha, force: false } })
          .then(function () { return { commit: commit }; });
      });
    });
  }
  function commitWithRetry(files, message, baseSha, mySha) {
    var attempt = 0;
    function run() {
      attempt += 1;
      return commitOnce(files, message, baseSha, mySha).catch(function (e) {
        /* 公開の仕組みが HTML を書き戻した直後（422）や、通信の途切れ（0）は、やり直す。
           やり直しのたびに土台の JSON を確かめ直すので、他人の更新を上書きすることはない。 */
        if ((e.status === 422 || e.status === 409 || e.status === 0 || e.status >= 500) && attempt < 5) {
          return wait(1500 * attempt).then(run);
        }
        throw e;
      });
    }
    return run();
  }

  /* =================================================================
     中継（Google でログインしたとき）
     ================================================================= */
  function relay(path, opts) {
    opts = opts || {};
    var headers = {};
    if (S.session && !opts.noAuth) headers.Authorization = "Bearer " + S.session;
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(RELAY + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body || undefined,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    }).catch(function () {
      var e = new Error("インターネットにつながっていないか、管理画面の中継に接続できません。通信のよい場所でもう一度お試しください。");
      e.status = 0;
      throw e;
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var code = data && data.error || "";
          var err = new Error(data && data.message || "中継でエラーが起きました（" + res.status + "）。少し待ってからやり直してください。");
          err.status = res.status;
          err.code = code;
          err.session = res.status === 401;                   /* ログインし直せば続けられる */
          err.conflict = code === "conflict";
          throw err;
        }
        return data;
      });
    });
  }
  function startSession(credential) {
    return relay("/api/session", { method: "POST", body: JSON.stringify({ credential: credential }), noAuth: true }).then(function (r) {
      if (!r || !r.session) throw new Error("ログインできませんでした。もう一度お試しください。");
      S.session = r.session;
      S.email = r.email || "";
    });
  }
  /* 公開：JSON と新しい画像を中継に渡す。中継が土台の JSON を確かめてから1回のコミットで書く。
     返事が来ないまま切れても、送り直せば中継が「もう届いている」と答えるので二重にはならない。 */
  function publishViaRelay(json, images, message) {
    var body = JSON.stringify({
      baseSha: S.base.sha,
      json: json,
      message: message,
      images: images.map(function (n) { return { name: n, b64: toB64(S.images[n].bytes) }; })
    });
    if (body.length > CONFIG.maxPublishBytes) {
      return Promise.reject(new Error("新しい画像が多すぎて、一度に公開できません。画像を入れた案件のうち、いくつかを「サイトに出す」をオフにして先に公開し、残りをあとから公開してください。"));
    }
    var attempt = 0;
    function run() {
      attempt += 1;
      return relay("/api/publish", { method: "POST", body: body }).catch(function (e) {
        var passing = e.status === 0 || ((e.status === 502 || e.status === 503 || e.status === 504) && (!e.code || e.code === "github_error"));
        if (passing && attempt < 4) return wait(1500 * attempt).then(run);
        throw e;
      });
    }
    return run();
  }

  /* ---------- Google のログイン部品（accounts.google.com/gsi/client） ---------- */
  var gis = { ready: null, waiter: null, busy: false };
  function loadGis() {
    if (gis.ready) return gis.ready;
    gis.ready = new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.id) { resolve(); return; }
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Google のログイン部品を読み込めませんでした。通信を確かめて、ページを再読み込みしてください。")); };
      document.head.appendChild(s);
    }).then(function () {
      window.google.accounts.id.initialize({
        client_id: CONFIG.googleClientId,
        callback: function (res) { if (gis.waiter && res && res.credential) gis.waiter(res.credential); },
        auto_select: false,
        cancel_on_tap_outside: true,
        context: "signin",
        ux_mode: "popup",
        itp_support: true,
        login_hint: CONFIG.loginHint || undefined
      });
    }).catch(function (e) { gis.ready = null; throw e; });
    return gis.ready;
  }
  function renderGoogleButton(el) {
    el.textContent = "";
    window.google.accounts.id.renderButton(el, {
      type: "standard", theme: "outline", size: "large", text: "signin_with", shape: "pill",
      logo_alignment: "left", locale: "ja", width: Math.max(200, Math.min(320, el.clientWidth || 320))
    });
  }
  function setGoogleStatus(msg) {
    var p = $("#google-status");
    p.textContent = msg || ""; p.hidden = !msg;
  }
  /* ログイン画面の「Google でログイン」 */
  function googleLogin(credential) {
    if (S.mode || gis.busy) return;          /* 続けて押されても1回だけ */
    gis.busy = true;
    showLoginError("");
    setGoogleStatus("ログインを確かめています…");
    startSession(credential).then(function () {
      S.mode = "google";
      setGoogleStatus("案件の一覧を読み込んでいます…");
      return load();
    }).catch(function (err) {
      S.session = null; S.email = ""; S.mode = null;
      $("#app").hidden = true; $("#bar-actions").hidden = true; $("#login").hidden = false;
      showLoginError(err.message);
      setStatus("", "");
    }).then(function () { gis.busy = false; setGoogleStatus(""); });
  }
  /* ログインの期限が切れたとき、編集内容を消さずにログインし直してもらう */
  function reauthGoogle(msg) {
    var d = $("#dlg-google"), cancel = $("#dlg-google-cancel"), errP = $("#dlg-google-error");
    $("#dlg-google-body").textContent = (msg ? msg + " " : "") + "編集した内容はそのまま残っています。ログインし直すと、続けて進めます。";
    errP.hidden = true;
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        gis.waiter = googleLogin;
        cancel.removeEventListener("click", onCancel);
        d.removeEventListener("cancel", onEsc);
        if (d.open) d.close();
        resolve(v);
      }
      function onCancel() { finish(false); }
      function onEsc(e) { e.preventDefault(); finish(false); }
      gis.waiter = function (credential) {
        errP.hidden = true;
        var before = S.email;
        startSession(credential).then(function () {
          if (before && S.email !== before) toast("別のアカウント（" + S.email + "）でログインし直しました。");
          finish(true);
        }).catch(function (e) { errP.textContent = e.message; errP.hidden = false; });
      };
      cancel.addEventListener("click", onCancel);
      d.addEventListener("cancel", onEsc);
      d.showModal();
      loadGis().then(function () { renderGoogleButton($("#dlg-google-btn")); })
        .catch(function (e) { errP.textContent = e.message; errP.hidden = false; });
    });
  }
  /* 中継への問い合わせを、ログインが切れていたらログインし直してから、もう一度だけ行う */
  function withSession(fn) {
    return fn().catch(function (e) {
      if (S.mode !== "google" || !e.session) throw e;
      return reauthGoogle(e.message).then(function (ok) {
        if (!ok) { var c = new Error("ログインし直すまで、この操作はできません。"); c.cancelled = true; throw c; }
        return fn();
      });
    });
  }

  /* =================================================================
     データ
     ================================================================= */
  function normalizeItem(it) {
    it = it && typeof it === "object" ? it : {};
    var extra = {};
    Object.keys(it).forEach(function (k) { if (FIELDS.indexOf(k) < 0 && k.charAt(0) !== "_") extra[k] = it[k]; });
    return {
      _key: newKey(),
      _extra: extra,      /* 知らない項目も、書き戻すときに消さない */
      id: trim(it.id),
      visible: it.visible !== false,
      title: trim(it.title),
      label: trim(it.label),
      image: trim(it.image),
      alt: trim(it.alt),
      body: String(it.body == null ? "" : it.body).replace(/[⁠​]/g, "").replace(/\r\n?/g, "\n").trim(),
      tags: (Array.isArray(it.tags) ? it.tags : []).map(function (t) {
        var text = typeof t === "string" ? t : t && t.text, color = t && typeof t === "object" ? t.color : "";
        return { text: trim(text), color: TAG_OK[color || ""] ? color || "" : "" };
      }),
      topic: trim(it.topic)
    };
  }
  function plainItem(it) {
    var o = {};
    FIELDS.forEach(function (f) {
      if (f === "tags") o.tags = it.tags.filter(function (t) { return trim(t.text); }).map(function (t) { return { text: trim(t.text), color: TAG_OK[t.color || ""] ? t.color || "" : "" }; });
      else if (f === "visible") o.visible = !!it.visible;
      else if (f === "body") o.body = String(it.body || "").replace(/\r\n?/g, "\n").trim();
      else o[f] = trim(it[f]);
    });
    Object.keys(it._extra || {}).forEach(function (k) { if (!(k in o)) o[k] = it._extra[k]; });
    return o;
  }
  function serialize(items) {
    var doc = clone(S.base.doc);
    doc.items = items.map(plainItem);
    return JSON.stringify(doc, null, 2) + "\n";
  }
  function parseDoc(raw) {
    var doc;
    try { doc = JSON.parse(raw); } catch (e) { throw new Error("案件のデータ（data/solutions.json）の書式が壊れていて読み込めません。制作担当にご連絡ください。"); }
    if (!doc || !Array.isArray(doc.items)) throw new Error("案件のデータ（data/solutions.json）に一覧がありません。制作担当にご連絡ください。");
    return doc;
  }
  function setBase(raw, sha) {
    var doc = parseDoc(raw);
    var items = doc.items.map(normalizeItem);
    S.base = { doc: doc, raw: raw, sha: sha, items: items };
    S.items = items.map(clone);
  }
  function itemByKey(k) { for (var i = 0; i < S.items.length; i++) if (S.items[i]._key === k) return S.items[i]; return null; }
  function baseByKey(k) { for (var i = 0; i < S.base.items.length; i++) if (S.base.items[i]._key === k) return S.base.items[i]; return null; }
  function sameItem(a, b) { return JSON.stringify(plainItem(a)) === JSON.stringify(plainItem(b)); }
  function uniqueId(prefix) {
    prefix = String(prefix || "").toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 30) || "case";
    var used = {};
    S.items.forEach(function (it) { used[it.id] = 1; });
    RESERVED_IDS.forEach(function (r) { used[r] = 1; });
    for (var n = 0; n < 50; n++) {
      var id = prefix + "-" + Math.random().toString(36).slice(2, 7);
      if (!used[id] && ID_RE.test(id)) return id;
    }
    return "case-" + Date.now().toString(36);
  }
  function busyGuard() {
    if (!S.busy) return false;
    toast("公開の処理中です。終わるまで少しお待ちください。");
    return true;
  }

  /* 変更点のまとめ（公開前の確認と、一覧のバッジに使う） */
  function changes() {
    var out = { added: [], removed: [], changed: [], shown: [], hidden: [], reordered: false, images: [] };
    if (!S.base) { out.count = 0; return out; }
    var baseKeys = S.base.items.map(function (it) { return it._key; });
    var curKeys = S.items.map(function (it) { return it._key; });
    S.items.forEach(function (it) {
      var b = baseByKey(it._key);
      if (!b) { out.added.push(it); return; }
      if (b.visible !== it.visible) (it.visible ? out.shown : out.hidden).push(it);
      var bb = clone(b), ii = clone(it);
      bb.visible = ii.visible = true;
      if (!sameItem(bb, ii)) out.changed.push(it);
    });
    S.base.items.forEach(function (b) { if (curKeys.indexOf(b._key) < 0) out.removed.push(b); });
    var common = curKeys.filter(function (k) { return baseKeys.indexOf(k) >= 0; });
    var baseCommon = baseKeys.filter(function (k) { return curKeys.indexOf(k) >= 0; });
    out.reordered = common.join() !== baseCommon.join();
    out.images = pendingImages();
    out.count = out.added.length + out.removed.length + out.changed.length + out.shown.length + out.hidden.length + (out.reordered ? 1 : 0);
    return out;
  }
  function isDirty() { return !!S.base && changes().count > 0; }
  /* 書き込む必要のある画像：いま使われていて、まだ書き込んでいない、この画面が作った名前のもの */
  function pendingImages() {
    var used = {}, baseNames = {};
    S.items.forEach(function (it) { if (it.image) used[it.image] = 1; });
    S.base.items.forEach(function (it) { if (it.image) baseNames[it.image] = 1; });
    return Object.keys(S.images).filter(function (n) {
      return used[n] && !S.images[n].committed && ADMIN_IMAGE_RE.test(n) && !baseNames[n];
    });
  }

  /* ---------- 点検（tools/build-solutions.py の validate() と同じ規則） ---------- */
  function validateItem(it, all) {
    var e = {}, L = CONFIG.limits;
    if (!ID_RE.test(it.id)) e.id = "半角の小文字・数字・ハイフンで、先頭は英字にしてください。";
    else if (RESERVED_IDS.indexOf(it.id) >= 0) e.id = "「" + it.id + "」はページのほかの場所で使っている名前です。別の名前にしてください。";
    else if (all.filter(function (o) { return o.id === it.id; }).length > 1) e.id = "ほかの案件と同じ名前です。別の名前にしてください。";
    if (it.visible) {
      ["title", "image", "alt", "body"].forEach(function (f) { if (!trim(it[f])) e[f] = NAMES[f] + "を入れてください。"; });
    }
    ["title", "label", "alt", "body", "topic"].forEach(function (f) {
      var n = f === "body" ? String(it.body || "").trim().length : trim(it[f]).length;
      if (n > L[f]) e[f] = NAMES[f] + "が長すぎます（" + L[f] + "字まで）。";
    });
    if (it.image && !IMAGE_RE.test(it.image)) e.image = "画像のファイル名が正しくありません。画像を選び直してください。";
    else if (it.image && ADMIN_IMAGE_RE.test(it.image) && !S.images[it.image] && !S.base.items.some(function (b) { return b.image === it.image; })) {
      e.image = "画像のデータが見つかりません。画像を選び直してください。";
    }
    var tags = it.tags.filter(function (t) { return trim(t.text); });
    if (tags.length > L.tags) e.tags = "タグは" + L.tags + "個までです。";
    tags.forEach(function (t) { if (trim(t.text).length > L.tag) e.tags = "「" + trim(t.text).slice(0, 10) + "…」が長すぎます（" + L.tag + "字まで）。"; });
    return e;
  }
  function validateAll() {
    var bad = [];
    S.items.forEach(function (it) { var e = validateItem(it, S.items); if (Object.keys(e).length) bad.push({ item: it, errors: e }); });
    return bad;
  }

  /* ---------- 下書きの自動保存（うっかり閉じても消えないように） ---------- */
  function writes() { return S.mode === "google" || S.mode === "github"; }   /* 本当に公開するモード（お試しでない） */
  function draftItem(it) {
    var p = plainItem(it), b = baseByKey(it._key);
    p._baseId = b ? b.id : null;    /* 読み込み直したときに、元のどの案件かを突き合わせる */
    return p;
  }
  function saveDraft() {
    if (!S.base || !writes()) return;
    try {
      if (!isDirty()) { localStorage.removeItem(DRAFT_KEY); return; }
      var draft = { v: 2, baseSha: S.base.sha, savedAt: Date.now(), items: S.items.map(draftItem), images: {} };
      var total = 0;
      pendingImages().forEach(function (name) {
        var im = S.images[name];
        total += im.bytes.length;
        if (total < 2.5 * 1024 * 1024) draft.images[name] = { b64: toB64(im.bytes), w: im.w, h: im.h };
      });
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
      try {   /* 画像が大きすぎて入らないときは、文字だけ残す */
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 2, baseSha: S.base.sha, savedAt: Date.now(), items: S.items.map(draftItem), images: {} }));
      } catch (e2) { /* 保存できない環境（プライベートブラウズなど）では諦める */ }
    }
  }
  var saveDraftSoon = debounce(saveDraft, 600);
  function takeDraft() {
    try { var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); return d && Array.isArray(d.items) ? d : null; }
    catch (e) { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  /* 下書きは同じオリジンの他のページからも書けるので、確認してから・検査してから使う */
  function restoreDraft() {
    var d = takeDraft();
    if (!d || !writes()) return Promise.resolve();
    var when = new Date(+d.savedAt || Date.now());
    var whenText = (when.getMonth() + 1) + "月" + when.getDate() + "日 " + when.getHours() + ":" + ("0" + when.getMinutes()).slice(-2);
    if (d.baseSha !== S.base.sha) {
      return confirmDialog("前回の編集途中の内容があります",
        whenText + " に編集していた内容がありますが、その後、別の端末かパソコンから一覧が公開されたため、そのままでは使えません。念のため、内容をファイルに書き出して残しますか？",
        "ファイルに書き出す", false, "捨てる").then(function (ok) {
        if (ok) {
          var doc = clone(S.base.doc);
          doc.items = d.items.map(function (p) { var q = clone(p); delete q._baseId; return q; });
          download("編集途中の内容-" + stamp() + ".json", utf8(JSON.stringify(doc, null, 2) + "\n"), "application/json");
        }
        clearDraft();
      });
    }
    var n = d.items.length;
    return confirmDialog("前回の編集途中の内容があります",
      whenText + " に編集していて、まだ公開していない内容があります（案件 " + n + " 件分）。続きから編集しますか？",
      "続きから編集する", false, "捨てて最新から始める").then(function (ok) {
      if (!ok) { clearDraft(); return; }
      var byId = {}, baseImages = {};
      S.base.items.forEach(function (b) { byId[b.id] = b; if (b.image) baseImages[b.image] = 1; });
      S.items = d.items.map(function (p) {
        var it = normalizeItem(p);
        if (p && p._baseId && byId[p._baseId]) it._key = byId[p._baseId]._key;
        return it;
      });
      Object.keys(d.images || {}).forEach(function (name) {
        var im = d.images[name];
        if (!ADMIN_IMAGE_RE.test(name) || baseImages[name] || !im || typeof im.b64 !== "string" || im.b64.length > 4 * 1024 * 1024) return;
        var bytes;
        try { bytes = fromB64(im.b64); } catch (e) { return; }
        if (!isJpeg(bytes)) return;
        S.images[name] = { bytes: bytes, w: +im.w || 0, h: +im.h || 0, url: URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })) };
      });
      var lost = 0;
      S.items.forEach(function (it) {
        if (!it.image || S.images[it.image] || baseImages[it.image]) return;
        var b = baseByKey(it._key);
        it.image = b ? b.image : "";
        lost += 1;
      });
      toast("前回の続きを開きました。" + (lost ? "（画像 " + lost + " 枚は選び直してください）" : ""));
    });
  }

  /* =================================================================
     一覧
     ================================================================= */
  function renderList() {
    var list = $("#list");
    var ch = changes();
    var bad = {};
    validateAll().forEach(function (b) { bad[b.item._key] = 1; });
    list.textContent = "";
    S.items.forEach(function (it, i) {
      var li = document.createElement("li");
      li.className = "item" + (it.visible ? "" : " is-hidden");
      li.dataset.key = it._key;
      li.tabIndex = 0;
      li.draggable = !S.busy;
      li.setAttribute("aria-current", it._key === S.selected ? "true" : "false");

      var grip = document.createElement("span");
      grip.className = "item__grip"; grip.textContent = "⋮⋮"; grip.setAttribute("aria-hidden", "true");

      var thumb = document.createElement("img");
      thumb.className = "item__thumb"; thumb.alt = ""; thumb.loading = "lazy";
      if (it.image) thumb.src = imgSrc(it.image);

      var text = document.createElement("div");
      text.className = "item__text";
      var t = document.createElement("div");
      t.className = "item__title";
      t.textContent = it.title || "（案件名が未入力）";
      var meta = document.createElement("div");
      meta.className = "item__meta";
      var badge = function (cls, label) { var b = document.createElement("span"); b.className = "badge badge--" + cls; b.textContent = label; meta.appendChild(b); };
      if (!it.visible) badge("hidden", "サイトに出さない");
      if (ch.added.indexOf(it) >= 0) badge("new", "新規");
      else if (ch.changed.indexOf(it) >= 0 || ch.shown.indexOf(it) >= 0 || ch.hidden.indexOf(it) >= 0) badge("changed", "変更あり");
      if (bad[it._key]) badge("error", "要確認");
      text.appendChild(t); text.appendChild(meta);

      var move = document.createElement("div");
      move.className = "item__move";
      var up = document.createElement("button");
      up.type = "button"; up.textContent = "▲"; up.disabled = i === 0 || S.busy;
      up.setAttribute("aria-label", "「" + (it.title || "この案件") + "」を1つ上へ");
      up.addEventListener("click", function (e) { e.stopPropagation(); moveItem(i, i - 1); });
      var dn = document.createElement("button");
      dn.type = "button"; dn.textContent = "▼"; dn.disabled = i === S.items.length - 1 || S.busy;
      dn.setAttribute("aria-label", "「" + (it.title || "この案件") + "」を1つ下へ");
      dn.addEventListener("click", function (e) { e.stopPropagation(); moveItem(i, i + 1); });
      move.appendChild(up); move.appendChild(dn);

      li.appendChild(grip); li.appendChild(thumb); li.appendChild(text); li.appendChild(move);
      li.addEventListener("click", function () {
        select(it._key);
        /* 1列表示（スマホ）では編集欄が下にあるので、そこまで移動する */
        if (window.matchMedia("(max-width: 760px)").matches) $(".pane--editor").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      li.addEventListener("keydown", function (e) {
        if (e.target !== li) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(it._key); }
        if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); moveItem(i, i - 1); }
        if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); moveItem(i, i + 1); }
      });
      bindDrag(li);
      list.appendChild(li);
    });
    var shown = S.items.filter(function (it) { return it.visible; }).length;
    $("#count").textContent = "全" + S.items.length + "件（うちサイトに出す " + shown + "件）";
  }

  var dragKey = null;
  function bindDrag(li) {
    li.addEventListener("dragstart", function (e) {
      if (S.busy) { e.preventDefault(); return; }
      dragKey = li.dataset.key;
      li.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragKey); } catch (err) {}
    });
    li.addEventListener("dragend", function () {
      dragKey = null;
      $$(".item").forEach(function (x) { x.classList.remove("is-dragging", "is-over"); });
    });
    li.addEventListener("dragover", function (e) {
      if (!dragKey || dragKey === li.dataset.key) return;
      e.preventDefault();
      $$(".item.is-over").forEach(function (x) { x.classList.remove("is-over"); });
      li.classList.add("is-over");
    });
    li.addEventListener("drop", function (e) {
      if (!dragKey) return;
      e.preventDefault();
      var from = S.items.indexOf(itemByKey(dragKey)), to = S.items.indexOf(itemByKey(li.dataset.key));
      if (from >= 0 && to >= 0 && from !== to) moveItem(from, to);
    });
  }

  function moveItem(from, to) {
    if (busyGuard()) return;
    if (to < 0 || to >= S.items.length || from === to) return;
    var it = S.items.splice(from, 1)[0];
    S.items.splice(to, 0, it);
    changed();
  }

  /* =================================================================
     編集欄
     ================================================================= */
  function current() { return S.selected ? itemByKey(S.selected) : null; }

  function select(key) {
    S.selected = key;
    $$(".item").forEach(function (li) { li.setAttribute("aria-current", li.dataset.key === key ? "true" : "false"); });
    fillEditor();
    updatePreview();
    scrollPreviewTo(key);
  }

  function fillEditor() {
    var it = current();
    $("#editor").hidden = !it;
    $("#editor-empty").hidden = !!it;
    $("#btn-duplicate").disabled = $("#btn-delete").disabled = !it || S.busy;
    if (!it) return;
    $("#f-visible").checked = it.visible;
    $("#f-title").value = it.title;
    $("#f-label").value = it.label;
    $("#f-alt").value = it.alt;
    $("#f-body").value = it.body;
    $("#f-topic").value = it.topic;
    $("#f-topic").placeholder = autoTopic(it.title) || "案件名から自動で作ります";
    $("#f-id").value = it.id;
    $("#id-example").textContent = it.id || "…";
    showImage(it);
    renderTags(it);
    updateCounters();
    showErrors();
  }

  function showImage(it) {
    var img = $("#drop-img"), empty = $("#drop-empty"), drop = $("#drop");
    if (it.image) {
      img.src = imgSrc(it.image);
      img.hidden = false; empty.hidden = true; drop.classList.add("has-img");
    } else {
      img.removeAttribute("src");
      img.hidden = true; empty.hidden = false; drop.classList.remove("has-img");
    }
    var warn = $("#image-warn"), info = S.images[it.image];
    warn.hidden = true;
    if (info && info.note) { warn.textContent = info.note; warn.hidden = false; }
  }

  function renderTags(it) {
    var ul = $("#tags");
    ul.textContent = "";
    it.tags.forEach(function (t, i) {
      var li = document.createElement("li");
      li.className = "tagrow";
      var input = document.createElement("input");
      input.type = "text"; input.value = t.text; input.maxLength = CONFIG.limits.tag;
      input.setAttribute("aria-label", (i + 1) + "つ目のタグ");
      input.addEventListener("input", function () { t.text = input.value; changed(); });
      var sel = document.createElement("select");
      sel.setAttribute("aria-label", (i + 1) + "つ目のタグの色");
      TAG_COLORS.forEach(function (c) { var o = document.createElement("option"); o.value = c[0]; o.textContent = c[1]; sel.appendChild(o); });
      sel.value = t.color || "";
      sel.addEventListener("change", function () { t.color = sel.value; changed(); });
      var up = document.createElement("button");
      up.type = "button"; up.textContent = "↑"; up.disabled = i === 0; up.setAttribute("aria-label", (i + 1) + "つ目のタグを前へ");
      up.addEventListener("click", function () { if (busyGuard()) return; it.tags.splice(i - 1, 0, it.tags.splice(i, 1)[0]); renderTags(it); changed(); });
      var del = document.createElement("button");
      del.type = "button"; del.textContent = "×"; del.className = "tagrow__del"; del.setAttribute("aria-label", (i + 1) + "つ目のタグを消す");
      del.addEventListener("click", function () { if (busyGuard()) return; it.tags.splice(i, 1); renderTags(it); changed(); });
      li.appendChild(input); li.appendChild(sel); li.appendChild(up); li.appendChild(del);
      ul.appendChild(li);
    });
    var full = it.tags.length >= CONFIG.limits.tags;
    $("#btn-tag-add").disabled = full || S.busy;
    $("#tag-new").disabled = full || S.busy;
  }

  function addTag() {
    var it = current(), input = $("#tag-new"), text = trim(input.value);
    if (busyGuard()) return;
    if (!it || !text) { input.focus(); return; }
    if (it.tags.length >= CONFIG.limits.tags) { toast("タグは" + CONFIG.limits.tags + "個までです。", "error"); return; }
    it.tags.push({ text: text.slice(0, CONFIG.limits.tag), color: "" });
    input.value = "";
    renderTags(it);
    changed();
    input.focus();
  }

  function updateCounters() {
    $$("[data-count]").forEach(function (el) {
      var label = $('label[for="' + el.id + '"]');
      if (!label) return;
      var c = label.querySelector(".counter");
      if (!c) { c = document.createElement("span"); c.className = "counter"; label.appendChild(c); }
      var n = el.value.trim().length, rec = +el.dataset.count;
      c.textContent = n + "字" + (n > rec ? "（長め）" : "");
      c.classList.toggle("is-over", n > rec);
    });
  }

  function showErrors() {
    var it = current();
    var e = it ? validateItem(it, S.items) : {};
    $$("[data-error]").forEach(function (p) { p.textContent = e[p.dataset.error] || ""; });
    [["title", "#f-title"], ["alt", "#f-alt"], ["body", "#f-body"], ["id", "#f-id"], ["image", "#drop"]].forEach(function (x) {
      $(x[1]).setAttribute("aria-invalid", e[x[0]] ? "true" : "false");
    });
    /* 「くわしい設定」の中に直すところがあれば、開いておく */
    if (e.id || e.topic) $(".more").open = true;
    return e;
  }

  function bindEditor() {
    var map = { "#f-title": "title", "#f-label": "label", "#f-alt": "alt", "#f-body": "body", "#f-topic": "topic", "#f-id": "id" };
    Object.keys(map).forEach(function (sel) {
      $(sel).addEventListener("input", function () {
        var it = current(); if (!it) return;
        var v = $(sel).value;
        if (map[sel] === "id") { v = v.toLowerCase().replace(/[^a-z0-9-]/g, ""); if (v !== $(sel).value) $(sel).value = v; $("#id-example").textContent = v || "…"; }
        it[map[sel]] = v;
        if (map[sel] === "title") $("#f-topic").placeholder = autoTopic(v) || "案件名から自動で作ります";
        updateCounters();
        changed();
      });
    });
    $("#f-visible").addEventListener("change", function () {
      var it = current(); if (!it) return;
      it.visible = $("#f-visible").checked;
      changed();
    });
    $("#btn-tag-add").addEventListener("click", addTag);
    /* 日本語入力の「変換を確定する Enter」ではタグを追加しない */
    $("#tag-new").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      addTag();
    });
    $("#editor").addEventListener("submit", function (e) { e.preventDefault(); });

    /* 画像：クリック・キーボード・ドラッグ・貼り付けのどれでも選べる */
    var drop = $("#drop"), file = $("#f-file");
    drop.addEventListener("click", function () { if (current() && !busyGuard()) file.click(); });
    drop.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (!busyGuard()) file.click();
    });
    file.addEventListener("change", function () { if (file.files[0]) takeImage(file.files[0]); file.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { if (hasFiles(e)) { e.preventDefault(); drop.classList.add("is-over"); } });
    });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      takeImage(e.dataTransfer.files[0]);
    });
    document.addEventListener("paste", function (e) {
      if (!current() || !e.clipboardData || $("#app").hidden) return;
      var f = Array.prototype.filter.call(e.clipboardData.files || [], function (x) { return /^image\//.test(x.type); })[0];
      if (f) { e.preventDefault(); takeImage(f); }
    });
  }
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }

  /* 画像を読み、幅 1200px までに縮めて JPEG にする。
     <img> 経由で描くと、スマホ写真の向き（EXIF）もブラウザが正しく直してくれる。 */
  function processImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
        reject(new Error("画像ファイルを選んでください（JPEG・PNG など）。")); return;
      }
      if (file.size > CONFIG.maxFileBytes) { reject(new Error("画像が大きすぎます（25MB まで）。")); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, CONFIG.maxImageWidth / w);
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch);   /* 透過 PNG は白地に */
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          if (!blob) { reject(new Error("画像の変換に失敗しました。別の画像でお試しください。")); return; }
          blob.arrayBuffer().then(function (buf) {
            var bytes = new Uint8Array(buf);
            if (!isJpeg(bytes)) { reject(new Error("画像の変換に失敗しました。別の画像でお試しください。")); return; }
            var notes = [];
            if (w < 800) notes.push("画像が小さめです（幅 " + w + "px）。サイトでは少しぼやけて見えるかもしれません。");
            var ratio = w / h;
            if (ratio < 1.3) notes.push("縦長に近い画像です。サイトでは上下が大きく切れて表示されます。プレビューで確かめてください。");
            else if (ratio > 2.4) notes.push("とても横長の画像です。サイトでは左右が切れて表示されます。");
            resolve({ bytes: bytes, url: URL.createObjectURL(blob), w: cw, h: ch, note: notes.join(" ") });
          });
        }, "image/jpeg", CONFIG.jpegQuality);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("この画像は読み込めませんでした。JPEG か PNG の画像を選んでください。"));
      };
      img.src = url;
    });
  }

  function takeImage(file) {
    var it = current();
    if (!it || busyGuard()) return;
    var key = it._key;
    setStatus("画像を準備しています…", "busy");
    processImage(file).then(function (im) {
      var target = itemByKey(key);
      if (!target || S.busy) { refreshStatus(); return; }
      var name = "sol-" + (ID_RE.test(target.id) ? target.id : "case") + "-" + stamp() + ".jpg";
      S.images[name] = im;
      target.image = name;
      if (!trim(target.alt) && S.selected === key) {
        $("#f-alt").focus();
        toast("画像を入れました。「画像の説明」も書いてください。");
      }
      if (S.selected === key) showImage(target);
      changed();
    }).catch(function (e) {
      toast(e.message, "error");
      refreshStatus();
    });
  }

  /* ---------- 追加・複製・削除 ---------- */
  function addItem() {
    if (busyGuard()) return;
    var it = normalizeItem({ id: uniqueId(), visible: true, tags: [] });
    var idx = S.selected ? S.items.indexOf(current()) + 1 : S.items.length;
    S.items.splice(idx, 0, it);
    changed();
    select(it._key);
    $("#f-title").focus();
  }
  function duplicateItem() {
    var src = current(); if (!src || busyGuard()) return;
    var it = normalizeItem(plainItem(src));
    it.id = uniqueId(src.id.replace(/-[a-z0-9]{5}$/, ""));
    it.title = (src.title + "（コピー）").slice(0, CONFIG.limits.title);
    it.visible = false;
    S.items.splice(S.items.indexOf(src) + 1, 0, it);
    changed();
    select(it._key);
    toast("複製しました。複製は「サイトに出さない」設定になっています。");
  }
  function deleteItem() {
    var it = current(); if (!it || busyGuard()) return;
    confirmDialog("この案件を削除しますか？",
      "「" + (it.title || "案件名なし") + "」を一覧から消します。「公開する」を押すまではサイトには影響しません。サイトに出したくないだけなら、「サイトに出す」をオフにする方法もあります。",
      "削除する", true).then(function (ok) {
      if (!ok || S.busy) return;
      var i = S.items.indexOf(it);
      if (i < 0) return;
      S.items.splice(i, 1);
      S.lastDeleted = { item: it, index: i };
      var next = S.items[Math.min(i, S.items.length - 1)];
      S.selected = next ? next._key : null;
      changed();
      fillEditor();
      updatePreview();
      toast("「" + (it.title || "案件名なし") + "」を削除しました。", "", { label: "元に戻す", run: undoDelete });
    });
  }
  function undoDelete() {
    var d = S.lastDeleted;
    if (!d || busyGuard()) return;
    S.items.splice(Math.min(d.index, S.items.length), 0, d.item);
    S.lastDeleted = null;
    changed();
    select(d.item._key);
    toast("元に戻しました。");
  }

  /* =================================================================
     プレビュー（サイトと同じ CSS・同じ HTML で組む）
     ================================================================= */
  function cardHtml(it) {
    var title = trim(it.title) || "（案件名）";
    var label = trim(it.label);
    var tags = it.tags.filter(function (t) { return trim(t.text); }).map(function (t) {
      var cls = t.color === "gold" ? "tag tag--gold" : t.color === "coral" ? "tag tag--coral" : "tag";
      return '<span class="' + cls + '">' + esc(t.text) + "</span>";
    }).join("");
    var body = String(it.body || "").split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ""); })
      .filter(function (p) { return p.trim(); }).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") || "<p>（説明文）</p>";
    var photo = it.image
      ? '<img src="' + esc(imgSrc(it.image)) + '" alt="' + esc(it.alt) + '">'
      : '<div class="pv-noimg">画像を選んでください</div>';
    return '<article class="sol' + (it._key === S.selected ? " pv-selected" : "") + '" id="pv-' + esc(it._key) + '">' +
      '<div class="sol__photo">' + photo + "</div>" +
      '<div class="sol__head"><h3 class="sol__title">' + esc(title) + (label ? '<small lang="en">' + esc(label) + "</small>" : "") + "</h3></div>" +
      '<div class="sol__body">' + body + "</div>" +
      '<div class="sol__tags">' + tags + "</div>" +
      '<div class="sol__foot"><span class="sol__link">この案件を相談する <span class="arrow" aria-hidden="true">→</span></span></div>' +
      "</article>";
  }
  function previewCards() {
    var visible = S.items.filter(function (it) { return it.visible; });
    var sel = current();
    var html = visible.map(cardHtml).join("");
    if (sel && !sel.visible) {
      html = '<p class="pv-note">選んでいる案件は「サイトに出さない」設定なので、サイトの一覧には出ません。見え方の確認用に下に出しています。</p>' +
        html + '<div class="pv-hidden">' + cardHtml(sel) + "</div>";
    }
    return html;
  }
  var previewReady = false;
  function initPreview() {
    var f = $("#preview");
    previewReady = false;
    f.addEventListener("load", function () { previewReady = true; updatePreview(); fitPreview(); scrollPreviewTo(S.selected); }, { once: true });
    f.srcdoc = '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
      '<base href="' + esc(location.href) + '">' +
      '<link rel="stylesheet" href="../assets/css/style.css">' +
      "<style>" +
      "body{background:var(--paper);margin:0}" +
      ".pv-wrap{padding:32px 0 48px}" +
      ".sol__title{word-break:normal}" +                     /* 改行位置は公開時に整えるので、ここでは普通に折る */
      ".pv-selected{outline:3px solid #c9a86a;outline-offset:5px}" +
      ".pv-noimg{position:absolute;inset:0;display:grid;place-items:center;color:#57656f;font-size:.9rem}" +
      ".pv-note{margin:0 0 1rem;color:#8a5a12;font-weight:700;font-size:.9rem}" +
      ".pv-hidden{margin-top:2rem;opacity:.75}" +
      ".pv-hidden .sol{max-width:420px}" +
      "</style></head><body><div class=\"pv-wrap\"><div class=\"wrap\"><div class=\"solutions\" id=\"pv\"></div></div></div></body></html>";
  }
  function updatePreview() {
    if (!previewReady) return;
    var doc = $("#preview").contentDocument;
    var box = doc && doc.getElementById("pv");
    if (box) box.innerHTML = previewCards();
  }
  var updatePreviewSoon = debounce(updatePreview, 150);
  /* プレビューの枠の中だけを動かす（scrollIntoView は管理画面ごと動かしてしまう） */
  function scrollPreviewTo(key) {
    if (!previewReady || !key) return;
    var win = $("#preview").contentWindow, doc = $("#preview").contentDocument;
    var el = doc && doc.getElementById("pv-" + key);
    if (!el || !win) return;
    var r = el.getBoundingClientRect();
    win.scrollTo({ top: Math.max(0, win.pageYOffset + r.top - 40), behavior: "smooth" });
  }
  function fitPreview() {
    var box = $("#preview-box"), f = $("#preview");
    var w = S.previewWidth, avail = box.clientWidth;
    var scale = Math.min(1, avail / w);
    f.style.width = w + "px";
    f.style.height = Math.ceil(box.clientHeight / scale) + "px";
    f.style.transform = "scale(" + scale + ")";
  }

  /* =================================================================
     変更があったとき
     ================================================================= */
  var renderListSoon = debounce(function () {
    var focused = document.activeElement && document.activeElement.closest && document.activeElement.closest(".item");
    var fk = focused && focused.dataset.key;
    renderList();
    if (fk) { var li = $('.item[data-key="' + fk + '"]'); if (li) li.focus(); }
  }, 60);
  function changed() {
    renderListSoon();
    showErrors();
    updatePreviewSoon();
    refreshStatus();
    saveDraftSoon();
  }

  function refreshStatus() {
    if (S.busy || !S.base) return;
    var ch = changes(), dirty = ch.count > 0;
    $("#btn-publish").disabled = !dirty;
    $("#btn-discard").disabled = !dirty;
    $("#btn-publish").textContent = dirty ? "変更を公開する（" + ch.count + "）" : "変更を公開する";
    if (S.watch.timer) return;   /* 反映の確認中は、そちらの表示を優先 */
    if (dirty) setStatus("まだ公開していない変更があります", "dirty");
    else setStatus(S.mode === "demo" ? "お試しモード（公開されません）" : "サイトと同じ内容です", "");
  }

  /* =================================================================
     公開
     ================================================================= */
  function describeChanges(ch) {
    var rows = [];
    var t = function (it) { return "「" + (it.title || "案件名なし") + "」"; };
    ch.added.forEach(function (it) { rows.push(["new", "追加", t(it) + (it.visible ? "" : "（サイトには出さない）")]); });
    ch.changed.forEach(function (it) { rows.push(["changed", "変更", t(it)]); });
    ch.shown.forEach(function (it) { rows.push(["changed", "表示", t(it) + "をサイトに出す"]); });
    ch.hidden.forEach(function (it) { rows.push(["hidden", "非表示", t(it) + "をサイトから外す"]); });
    ch.removed.forEach(function (it) { rows.push(["error", "削除", t(it)]); });
    if (ch.reordered) rows.push(["changed", "並び順", "表示の順番を変更"]);
    ch.images.forEach(function (n) { rows.push(["new", "画像", "新しい画像を追加（" + n + "）"]); });
    return rows;
  }
  function commitMessage(ch) {
    var parts = [];
    if (ch.added.length) parts.push("追加" + ch.added.length);
    if (ch.changed.length) parts.push("変更" + ch.changed.length);
    if (ch.shown.length) parts.push("表示" + ch.shown.length);
    if (ch.hidden.length) parts.push("非表示" + ch.hidden.length);
    if (ch.removed.length) parts.push("削除" + ch.removed.length);
    if (ch.reordered) parts.push("並び替え");
    return "管理画面から案件一覧を更新（" + parts.join("・") + "）";
  }

  function publish() {
    if (S.busy) return;
    var bad = validateAll();
    if (bad.length) {
      select(bad[0].item._key);
      showErrors();
      toast("入力が足りない案件があります（一覧の「要確認」）。赤字の欄を直してから公開してください。", "error");
      var first = $('[aria-invalid="true"]');
      if (first) { first.focus(); first.scrollIntoView({ block: "center", behavior: "smooth" }); }
      return;
    }
    var ch = changes();
    var ul = $("#changes");
    ul.textContent = "";
    describeChanges(ch).forEach(function (r) {
      var li = document.createElement("li");
      var b = document.createElement("span"); b.className = "badge badge--" + r[0]; b.textContent = r[1];
      var s = document.createElement("span"); s.textContent = r[2];
      li.appendChild(b); li.appendChild(s); ul.appendChild(li);
    });
    var p = ask($("#dlg-publish"), $("#btn-publish-ok"), $("#btn-publish-cancel"));
    $("#btn-publish-ok").focus();
    p.then(function (ok) { if (ok) doPublish(ch); });
  }

  function doPublish(ch) {
    /* 押した時点の内容を「これを公開する」として固定する */
    var snapshot = S.items.map(clone);
    var json = serialize(snapshot);
    var bytes = utf8(json);
    var images = ch.images.slice();

    if (S.mode === "demo") {
      download("solutions.json", bytes, "application/json");
      finishPublished(json, S.base.sha, snapshot, images);
      toast("お試しモードのため公開はしていません。変更後の内容を solutions.json に書き出しました。");
      return;
    }

    S.busy = true;
    stopWatch();          /* 前回の反映確認は打ち切る（失敗したときの表示を上書きさせない） */
    lockUi(true);
    setStatus("公開しています…", "busy");
    var message = commitMessage(ch);
    var send;

    if (S.mode === "google") {
      /* 中継が書き込み、書いた JSON の blob 名（sha）と反映確認用の rev を返す */
      send = publishViaRelay(json, images, message);
    } else {
      var files = [{ path: CONFIG.dataPath, bytes: bytes }].concat(images.map(function (n) {
        return { path: CONFIG.imgDir + n, bytes: S.images[n].bytes };
      }));
      send = gitBlobSha(bytes).then(function (mySha) {
        return commitWithRetry(files, message, S.base.sha, mySha).then(function () { return { sha: mySha }; });
      });
    }

    send.then(function (r) {
      finishPublished(json, r.sha, snapshot, images);
      clearDraft();
      saveDraft();          /* 公開中にしていた編集（まだ公開していない分）があれば残す */
      return (r.rev ? Promise.resolve(r.rev) : sha256hex(bytes).then(function (h) { return h.slice(0, 12); })).then(watchDeploy);
    }).catch(function (e) {
      S.busy = false;
      lockUi(false);
      if (e.conflict) {
        setStatus("公開できませんでした（ほかの場所で更新あり）", "error");
        confirmDialog("別の場所で一覧が更新されています",
          "この画面を開いたあとに、別の端末やパソコンから一覧が公開されました。このまま公開すると、そちらの更新を消してしまいます。いまの編集内容をファイルに書き出して残してから、最新の内容を読み込み直してください。",
          "書き出して読み込み直す").then(function (ok) {
          if (!ok) { refreshStatus(); return; }
          download("編集していた内容-" + stamp() + ".json", utf8(serialize(S.items)), "application/json");
          clearDraft();
          load().catch(function (err) { toast(err.message, "error"); });
        });
        return;
      }
      if (S.mode === "google" && e.session) {
        setStatus("公開できませんでした（ログインの期限切れ）", "error");
        reauthGoogle(e.message).then(function (ok) { if (ok) doPublish(changes()); else refreshStatus(); });
        return;
      }
      if (S.mode === "github" && (e.status === 401 || e.status === 403)) {
        setStatus("公開できませんでした（合言葉）", "error");
        reauth(e.message).then(function (ok) { if (ok) doPublish(changes()); else refreshStatus(); });
        return;
      }
      setStatus("公開できませんでした：" + (e.message || "").slice(0, 60), "error");
      toast(e.message || "公開できませんでした。", "error");
    });
  }

  function finishPublished(json, sha, snapshot, images) {
    images.forEach(function (n) { if (S.images[n]) S.images[n].committed = true; });
    S.base = { doc: parseDoc(json), raw: json, sha: sha, items: snapshot.map(clone) };
    S.busy = false;
    lockUi(false);
  }

  /* 合言葉が切れた・権限がないときに、編集内容を消さずに入れ直してもらう */
  function reauth(msg) {
    $("#dlg-token-body").textContent = (msg ? msg + " " : "") + "編集した内容はそのまま残っています。新しい合言葉を入れると、続けて公開します。";
    var input = $("#dlg-token-input");
    input.value = "";
    var p = ask($("#dlg-token"), $("#dlg-token-ok"), $("#dlg-token-cancel"));
    input.focus();
    return p.then(function (ok) {
      var token = trim(input.value);
      input.value = "";
      if (!ok || !token) return false;
      var problem = tokenProblem(token);
      if (problem) { toast(problem, "error"); return false; }
      S.token = token;
      return true;
    });
  }

  function stopWatch() {
    var w = S.watch;
    w.gen += 1;
    clearInterval(w.timer); w.timer = 0; w.check = null;
  }
  /* 反映の確認：公開ページの data-rev が、いま公開した JSON と同じになるのを待つ */
  function watchDeploy(rev) {
    var w = S.watch, gen = ++w.gen, started = Date.now();
    clearInterval(w.timer);
    setStatus("サイトに反映しています…（通常1〜2分）", "busy");
    toast("公開しました。サイトに反映されるまで1〜2分かかります。");
    function stop() { if (w.gen === gen) { clearInterval(w.timer); w.timer = 0; w.check = null; } }
    function check(final) {
      if (w.gen !== gen) return Promise.resolve(false);
      return fetch(CONFIG.site + "solutions.html?nc=" + Date.now(), { cache: "no-store", credentials: "omit" })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          if (w.gen !== gen) return false;                           /* もっと新しい確認が始まっている */
          if (t.indexOf('data-rev="' + rev + '"') >= 0) {
            stop();
            setStatus("サイトに反映されました", "ok");
            $("#link-site").href = CONFIG.site + "solutions.html?v=" + rev;
            toast("サイトに反映されました。古い表示のままなら、ページを再読み込みしてください（最大10分ほど古い表示が残ることがあります）。", "",
              { label: "ページを開く", run: function () { window.open(CONFIG.site + "solutions.html?v=" + rev, "_blank", "noopener"); } });
            setTimeout(function () { if (w.gen === gen) refreshStatus(); }, 10000);
            return true;
          }
          if (!final) setStatus("サイトに反映しています…（" + Math.round((Date.now() - started) / 1000) + "秒）", "busy");
          return false;
        }).catch(function () { return false; });
    }
    w.check = check;
    w.timer = setInterval(function () {
      if (Date.now() - started <= CONFIG.deployTimeoutMs) { check(false); return; }
      clearInterval(w.timer);
      /* 画面を離れていてタイマーが止まっていた可能性もあるので、最後にもう一度だけ確かめる */
      check(true).then(function (done) {
        if (done || w.gen !== gen) return;
        w.timer = 0; w.check = null;
        setStatus("反映の確認に時間がかかっています", "error");
        toast("公開はできていますが、サイトへの反映がまだ確認できません。10分ほどおいて「その他」→「公開中のページを開く」で確かめてください。直っていなければ制作担当にご連絡ください。", "error");
      });
    }, CONFIG.deployPollMs);
    check(false);
  }
  /* iPhone で画面を離れて戻ったとき、すぐに確かめ直す */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && S.watch.timer && S.watch.check) S.watch.check(false);
  });

  function lockUi(on) {
    $$("#app input, #app textarea, #app select, #app button, #bar-actions button").forEach(function (el) {
      if (on) { el.dataset.wasDisabled = el.disabled ? "1" : ""; el.disabled = true; }
      else if (el.dataset.wasDisabled !== undefined) { el.disabled = el.dataset.wasDisabled === "1"; delete el.dataset.wasDisabled; }
    });
    $("#drop").setAttribute("aria-disabled", on ? "true" : "false");
    renderList();
    if (!on) { fillEditor(); updatePreview(); refreshStatus(); }
  }

  function download(name, bytes, type) {
    var url = URL.createObjectURL(new Blob([bytes], { type: type }));
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function discard() {
    if (busyGuard()) return;
    confirmDialog("公開していない変更を、すべて取り消しますか？", "まだ公開していない変更（追加・編集・削除・並べ替え）をすべて取り消して、サイトと同じ内容に戻します。", "すべて取り消す", true).then(function (ok) {
      if (!ok) return;
      S.items = S.base.items.map(clone);
      Object.keys(S.images).forEach(function (n) { if (!S.images[n].committed) delete S.images[n]; });
      S.lastDeleted = null;
      clearDraft();
      if (!itemByKey(S.selected)) S.selected = S.items[0] ? S.items[0]._key : null;
      renderList(); fillEditor(); updatePreview(); refreshStatus();
      toast("変更を取り消しました。");
    });
  }

  /* =================================================================
     ログイン・読み込み
     ================================================================= */
  function tokenProblem(token) {
    if (/^ghp_/.test(token)) return "この合言葉は、すべてのリポジトリに書き込める古い形式（classic）のものです。安全のため使えません。制作担当に、このサイト専用の合言葉（github_pat_ で始まるもの）をご依頼ください。";
    if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(token)) return "合言葉の形式が違うようです。github_pat_ で始まる文字列を、前後に空白が入らないように貼り付けてください。";
    return "";
  }
  function logout(message) {
    S.token = null; S.session = null; S.email = ""; S.mode = null; S.base = null; S.items = []; S.images = {};
    stopWatch();
    $("#app").hidden = true; $("#bar-actions").hidden = true; $("#login").hidden = false;
    $("#token").value = "";
    /* 次に開いたとき、Google が自動で同じアカウントを選ばないように */
    if (window.google && window.google.accounts && window.google.accounts.id) window.google.accounts.id.disableAutoSelect();
    showLoginError(message || "");
  }
  function showLoginError(msg) {
    var p = $("#login-error");
    p.textContent = msg; p.hidden = !msg;
  }

  function load() {
    setStatus("読み込んでいます…", "busy");
    var p = S.mode === "demo"
      ? fetch("../" + CONFIG.dataPath + "?nc=" + Date.now(), { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error("data/solutions.json を読み込めませんでした。");
          return r.text();
        }).then(function (raw) { return { raw: raw, sha: "demo" }; })
      : S.mode === "google"
      ? withSession(function () { return relay("/api/solutions"); }).then(function (r) {
          if (!r || typeof r.raw !== "string" || !/^[0-9a-f]{40}$/.test(r.sha || "")) throw new Error("案件のデータを読み込めませんでした。少し待ってからやり直してください。");
          return { raw: r.raw, sha: r.sha };
        })
      : gh(R()).then(function (repo) {
          /* 読むだけの合言葉で入ってしまい、全部編集してから公開で失敗するのを防ぐ */
          if (repo && repo.permissions && repo.permissions.push === false) {
            var e = new Error("この合言葉には書き込みの権限がありません。制作担当に「書き込みできる合言葉」をご依頼ください。");
            e.status = 403; throw e;
          }
          return fetchDataFile();
        });
    return p.then(function (f) {
      setBase(f.raw, f.sha);
      S.images = {};
      S.lastDeleted = null;
      $("#login").hidden = true; $("#app").hidden = false; $("#bar-actions").hidden = false;
      $("#link-site").href = CONFIG.site + "solutions.html";
      $("#btn-logout").textContent = S.email ? "ログアウト（" + S.email + "）" : "ログアウト";
      return restoreDraft();
    }).then(function () {
      S.selected = S.items[0] ? S.items[0]._key : null;
      renderList(); fillEditor(); initPreview(); refreshStatus();
      if (S.watch.check) S.watch.check(false);   /* 反映の確認中なら、その表示にすぐ戻す */
    });
  }

  function bindTop() {
    $("#login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var token = trim($("#token").value);
      if (!token) { showLoginError("合言葉を入れてください。"); $("#token").focus(); return; }
      var problem = tokenProblem(token);
      if (problem) { showLoginError(problem); return; }
      showLoginError("");
      $("#btn-login").disabled = true;
      S.token = token; S.mode = "github";
      load().catch(function (err) {
        S.token = null; S.mode = null;
        $("#app").hidden = true; $("#bar-actions").hidden = true; $("#login").hidden = false;
        showLoginError(err.message);
        setStatus("", "");
      }).then(function () { $("#btn-login").disabled = false; });
    });
    $("#btn-demo").addEventListener("click", function () {
      S.mode = "demo";
      load().catch(function (err) { S.mode = null; showLoginError(err.message); });
    });
    $("#btn-add").addEventListener("click", addItem);
    $("#btn-duplicate").addEventListener("click", duplicateItem);
    $("#btn-delete").addEventListener("click", deleteItem);
    $("#btn-publish").addEventListener("click", publish);
    $("#btn-discard").addEventListener("click", discard);

    var menu = $("#menu"), mb = $("#btn-menu");
    var closeMenu = function () { menu.hidden = true; mb.setAttribute("aria-expanded", "false"); };
    mb.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      mb.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
      if (!menu.hidden) menu.firstElementChild.focus();
    });
    /* iPhone では何もない所のタップで click が来ないことがあるので pointerdown で閉じる */
    document.addEventListener("pointerdown", function (e) { if (!menu.hidden && !menu.contains(e.target) && !mb.contains(e.target)) closeMenu(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { closeMenu(); mb.focus(); } });
    $("#btn-discard-menu").addEventListener("click", function () { closeMenu(); if (isDirty()) discard(); else toast("公開していない変更はありません。"); });
    $("#btn-backup").addEventListener("click", function () {
      closeMenu();
      download("案件一覧の控え-" + stamp() + ".json", utf8(serialize(S.items)), "application/json");
    });
    $("#link-site").addEventListener("click", closeMenu);
    $("#btn-reload").addEventListener("click", function () {
      closeMenu();
      if (busyGuard()) return;
      var go = function () { clearDraft(); load().catch(function (e) { toast(e.message, "error"); }); };
      if (isDirty()) confirmDialog("最新の内容を読み込み直しますか？", "まだ公開していない変更は消えます。", "読み込み直す", true).then(function (ok) { if (ok) go(); });
      else go();
    });
    $("#btn-logout").addEventListener("click", function () {
      closeMenu();
      if (busyGuard()) return;
      var go = function () { logout(""); };
      if (isDirty()) confirmDialog("ログアウトしますか？", "まだ公開していない変更は、このパソコンに下書きとして残ります。次にログインしたときに続きから編集できます。", "ログアウト", false).then(function (ok) { if (ok) go(); });
      else go();
    });

    $$(".seg button").forEach(function (b) {
      b.addEventListener("click", function () {
        $$(".seg button").forEach(function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); });
        S.previewWidth = +b.dataset.width;
        fitPreview();
        scrollPreviewTo(S.selected);
      });
    });
    window.addEventListener("resize", debounce(fitPreview, 100));
    window.addEventListener("beforeunload", function (e) {
      if (S.busy) { e.preventDefault(); e.returnValue = ""; }
    });
    /* 閉じる直前の入力も下書きに残す（自動保存は少し遅れて走るため） */
    window.addEventListener("pagehide", saveDraft);
  }

  /* ---------- はじめに ---------- */
  /* 以前の版が保存していた合言葉を消す（同じオリジンの他のページから読まれないように） */
  try { localStorage.removeItem(LEGACY_TOKEN_KEY); sessionStorage.removeItem(LEGACY_TOKEN_KEY); } catch (e) {}
  bindTop();
  bindEditor();
  /* 中継の設定が済んでいれば「Google でログイン」を主にし、合言葉は制作担当向けにたたむ */
  if (GOOGLE_ON) {
    $("#login").classList.add("login--google");
    $("#google-wrap").hidden = false;
    $("#token-box").open = false;
    $("#google-hint").textContent = CONFIG.loginHint || "管理用のアカウント";
    gis.waiter = googleLogin;
    setGoogleStatus("ログインの準備をしています…");
    loadGis().then(function () { setGoogleStatus(""); renderGoogleButton($("#google-btn")); })
      .catch(function (e) { setGoogleStatus(""); showLoginError(e.message); });
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) $("#demo-wrap").hidden = false;
})();
