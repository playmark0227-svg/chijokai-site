/* =====================================================================
   知上会 管理画面の中継（Cloudflare Worker）

   管理画面（/admin/）は「Google でログイン」だけを行い、GitHub に書き込む鍵は持たない。
   鍵（GitHub のトークン）はこの Worker が秘密の値として預かり、次の条件を満たすときだけ書き込む。

     1. Google のログイン証明（ID トークン）の署名・発行元・宛先・期限が正しい
     2. そのメールアドレスが許可リスト（ALLOWED_EMAILS）にあり、Google が確認済み
     3. 書き込み先が data/solutions.json と、管理画面が作る名前の案件画像だけ
     4. 土台にするコミットでの JSON が、編集を始めたときの版と同じ（他人の更新を上書きしない）

   エンドポイント（すべて管理画面のオリジンからのみ）
     POST /api/session    { credential }                      → { session, email, exp }
     GET  /api/solutions                                       → { raw, sha, email }
     POST /api/publish    { baseSha, json, message, images }   → { sha, rev, already }
     GET  /api/health

   設定（wrangler.jsonc の vars）  GOOGLE_CLIENT_ID / ALLOWED_EMAILS / ALLOWED_ORIGINS / GITHUB_REPO / GITHUB_BRANCH
   秘密の値（wrangler secret put）  GITHUB_TOKEN / SESSION_SECRET / EXTRA_ALLOWED_EMAILS（任意）
   ===================================================================== */

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const SESSION_TTL_SEC = 8 * 60 * 60;          // ログインは8時間有効
const CLOCK_SKEW_SEC = 60;
const MAX_BODY_BYTES = 10 * 1024 * 1024;      // 公開1回ぶんの上限（画像込み）
const MAX_JSON_BYTES = 512 * 1024;
const MAX_IMAGES = 6;
const MAX_IMAGE_B64 = Math.ceil((6 * 1024 * 1024) / 3) * 4;   // 画像1枚 6MB まで
const DATA_PATH = "data/solutions.json";
const IMG_DIR = "assets/img";

/* tools/build-solutions.py・admin/admin.js と同じ規則 */
const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(jpg|jpeg|png)$/;
const ADMIN_IMAGE_RE = /^sol-[a-z][a-z0-9-]{0,39}-\d{8}-\d{6}\.jpg$/;
const RESERVED_IDS = new Set(["main", "faq", "top", "about", "company", "contact", "lineup", "content", "header", "footer", "nav", "menu", "navlinks", "navtoggle"]);
const LIMITS = { title: 60, label: 40, alt: 160, body: 1200, topic: 60, tag: 24, tags: 6, items: 100 };
const TAG_COLORS = new Set(["", "gold", "coral"]);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

/* Google の公開鍵は、有効期限のあいだ使い回す（リクエストをまたいで持つのは鍵だけ） */
let jwksCache = { keys: null, until: 0 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = listOf(env.ALLOWED_ORIGINS).includes(origin);
    const cors = allowed ? corsHeaders(origin) : {};

    if (request.method === "OPTIONS") {
      return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    }
    /* ブラウザの管理画面以外からは受け付けない（認証は別途必須） */
    if (!allowed) return json({ error: "origin_not_allowed" }, 403, {});

    try {
      checkConfig(env);
      if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true }, 200, cors);
      if (url.pathname === "/api/session" && request.method === "POST") return await createSession(request, env, cors);

      const who = await requireSession(request, env);
      if (url.pathname === "/api/solutions" && request.method === "GET") return await getSolutions(env, who, cors);
      if (url.pathname === "/api/publish" && request.method === "POST") return await publish(request, env, who, cors);
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status, cors);
      console.error(JSON.stringify({ event: "unhandled", message: String(e && e.message) }));
      return json({ error: "internal", message: "中継でエラーが起きました。少し待ってからやり直してください。" }, 500, cors);
    }
  }
};

/* ---------------------------------------------------------------------
   道具
   --------------------------------------------------------------------- */
function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}
function listOf(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function allowedEmails(env) {
  return new Set([...listOf(env.ALLOWED_EMAILS), ...listOf(env.EXTRA_ALLOWED_EMAILS)].map((s) => s.toLowerCase()));
}
function checkConfig(env) {
  const missing = ["GOOGLE_CLIENT_ID", "GITHUB_TOKEN", "SESSION_SECRET", "GITHUB_REPO"].filter((k) => !env[k]);
  if (missing.length || String(env.SESSION_SECRET || "").length < 32) {
    console.error(JSON.stringify({ event: "misconfigured", missing }));
    throw new HttpError(500, "misconfigured", "中継の設定が済んでいません。制作担当にご連絡ください。");
  }
}
const enc = new TextEncoder();
const dec = new TextDecoder();
function b64urlToBytes(s) {
  const bad = () => new HttpError(401, "bad_token", "ログインの情報が正しくありません。もう一度ログインしてください。");
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw bad();
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  let bin;
  try { bin = atob(b64); } catch { throw bad(); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hex(algo, bytes) {
  const buf = await crypto.subtle.digest(algo, bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/* Git の blob 名（SHA-1）。書き込みが実は届いていたかを見分けるのに使う */
function gitBlobSha(bytes) {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head, 0);
  all.set(bytes, head.length);
  return hex("SHA-1", all);
}
/* 本文は上限を超えた時点で読むのをやめる（大きさの申告は当てにしない） */
async function readJson(request, maxBytes) {
  const tooLarge = () => new HttpError(413, "too_large", "一度に送る内容が大きすぎます。画像を減らして、何回かに分けて公開してください。");
  const badJson = () => new HttpError(400, "bad_json", "送られた内容の形式が正しくありません。");
  if (Number(request.headers.get("Content-Length") || 0) > maxBytes) throw tooLarge();
  if (!request.body) throw badJson();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  let body;
  try { body = JSON.parse(dec.decode(buf)); } catch { throw badJson(); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badJson();
  return body;
}
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------
   Google のログイン証明（ID トークン）を確かめる
   --------------------------------------------------------------------- */
async function googleKey(kid) {
  const find = () => (jwksCache.keys || []).find((k) => k.kid === kid);
  if (!find() || Date.now() > jwksCache.until) {
    const unavailable = () => new HttpError(502, "google_unavailable", "Google に接続できませんでした。少し待ってからやり直してください。");
    let res, body;
    try {
      res = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600 } });
      body = res.ok ? await res.json() : null;
    } catch { throw unavailable(); }
    if (!body) throw unavailable();
    const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "");
    jwksCache = { keys: Array.isArray(body.keys) ? body.keys : [], until: Date.now() + Math.min(Number(m && m[1]) || 3600, 86400) * 1000 };
  }
  const jwk = find();
  if (!jwk || jwk.kty !== "RSA") throw new HttpError(401, "bad_token", "ログインの情報が正しくありません。もう一度ログインしてください。");
  return crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

async function verifyGoogleIdToken(credential, env) {
  const bad = () => new HttpError(401, "bad_token", "ログインの情報が正しくありません。もう一度ログインしてください。");
  if (typeof credential !== "string" || credential.length > 4096) throw bad();
  const parts = credential.split(".");
  if (parts.length !== 3) throw bad();
  let header, payload;
  try {
    header = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
  } catch { throw bad(); }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw bad();
  const key = await googleKey(header.kid);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw bad();

  const t = now();
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw bad();
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw bad();
  if (typeof payload.exp !== "number" || payload.exp < t - CLOCK_SKEW_SEC) {
    throw new HttpError(401, "expired", "ログインの有効期限が切れました。もう一度ログインしてください。");
  }
  if (typeof payload.iat === "number" && payload.iat > t + CLOCK_SKEW_SEC) throw bad();
  if (typeof payload.nbf === "number" && payload.nbf > t + CLOCK_SKEW_SEC) throw bad();

  const email = String(payload.email || "").toLowerCase();
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw new HttpError(403, "email_unverified", "この Google アカウントのメールアドレスが確認されていません。");
  }
  if (!allowedEmails(env).has(email)) {
    console.log(JSON.stringify({ event: "login_denied", domain: email.split("@")[1] || "" }));
    throw new HttpError(403, "not_allowed", `この Google アカウント（${email}）では管理画面を使えません。管理用のアカウントでログインしてください。`);
  }
  return { email, name: String(payload.name || "") };
}

/* ---------------------------------------------------------------------
   ログイン中のしるし（この Worker が署名する。8時間で切れる）
   --------------------------------------------------------------------- */
async function hmacKey(env) {
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function createSession(request, env, cors) {
  const body = await readJson(request, 16 * 1024);
  const who = await verifyGoogleIdToken(body && body.credential, env);
  const exp = now() + SESSION_TTL_SEC;
  const payload = bytesToB64url(enc.encode(JSON.stringify({ v: 1, email: who.email, iat: now(), exp, n: crypto.randomUUID() })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload)));
  console.log(JSON.stringify({ event: "login", email: who.email }));
  return json({ session: `${payload}.${bytesToB64url(sig)}`, email: who.email, name: who.name, exp }, 200, cors);
}
async function requireSession(request, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{10,2048})\.([A-Za-z0-9_-]{20,200})$/.exec(request.headers.get("Authorization") || "");
  const expired = () => new HttpError(401, "session_expired", "ログインの有効期限が切れました。もう一度ログインしてください。");
  if (!m) throw expired();
  /* crypto.subtle.verify は署名を一定時間で比べる */
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), b64urlToBytes(m[2]), enc.encode(m[1]));
  if (!ok) throw expired();
  let p;
  try { p = JSON.parse(dec.decode(b64urlToBytes(m[1]))); } catch { throw expired(); }
  if (!p || p.v !== 1 || typeof p.exp !== "number" || p.exp < now()) throw expired();
  /* 許可リストから外した人は、ログイン中でもすぐに使えなくする */
  if (!allowedEmails(env).has(String(p.email || "").toLowerCase())) throw new HttpError(403, "not_allowed", "このアカウントでは管理画面を使えなくなりました。");
  return { email: p.email };
}

/* ---------------------------------------------------------------------
   GitHub
   --------------------------------------------------------------------- */
async function gh(env, path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method: opts.method || "GET",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "chijoukai-admin-worker",
      ...(opts.body ? { "Content-Type": "application/json" } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok && !(opts.allow || []).includes(res.status)) {
    const rateLimited = res.status === 429 || (res.status === 403 && /rate limit/i.test(String(data && data.message)));
    const e = res.status === 401 || (res.status === 403 && !rateLimited)
      ? new HttpError(502, "github_auth", "中継に預けてある GitHub の鍵が期限切れか、権限が足りません。制作担当にご連絡ください（編集した内容はこの画面に残っています）。")
      : rateLimited
      ? new HttpError(503, "github_rate_limited", "GitHub の利用回数の上限に達しました。1時間ほど待ってからやり直してください。")
      : new HttpError(res.status === 422 || res.status === 409 ? 409 : 502, res.status === 422 ? "ref_moved" : "github_error",
          "GitHub との通信でエラーが起きました。少し待ってからやり直してください。");
    e.githubStatus = res.status;
    console.error(JSON.stringify({ event: "github_error", path: path.replace(/\?.*$/, ""), status: res.status, message: data && data.message }));
    throw e;
  }
  return { status: res.status, data };
}
const branch = (env) => env.GITHUB_BRANCH || "main";

async function getSolutions(env, who, cors) {
  const f = await readFile(env, DATA_PATH, branch(env));
  return json({ raw: f.text, sha: f.sha, email: who.email }, 200, cors);
}

/* ---------------------------------------------------------------------
   公開（JSON と新しい画像を1回のコミットで書き込む）
   --------------------------------------------------------------------- */
function clean(s) { return String(s == null ? "" : s).replace(/[⁠​]/g, "").trim(); }

/* ページが自動生成部分の外で使っている id（build-solutions.py の page_ids() と同じ） */
function pageIds(src) {
  const i = src.indexOf("<!-- solutions:start"), j = src.indexOf("<!-- solutions:end -->");
  const outside = i >= 0 && j > i ? src.slice(0, i) + src.slice(j) : src;
  const ids = new Set(RESERVED_IDS);
  for (const m of outside.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1].toLowerCase());
  return ids;
}
async function readFile(env, path, ref) {
  const { data } = await gh(env, `/contents/${path}?ref=${encodeURIComponent(ref)}`);
  const bin = atob(String(data.content || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { text: dec.decode(bytes), sha: data.sha };
}

/* tools/build-solutions.py の validate() と同じ規則。
   ここで弾かないと、コミットしたあとで公開の仕組み（CI）が止まってしまう。 */
function validateDoc(doc, newImages, existing, reserved) {
  const errors = [];
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.items)) throw new HttpError(400, "invalid", "案件の一覧が見つかりません。");
  if (doc.items.length > LIMITS.items) errors.push(`案件は${LIMITS.items}件までです。`);
  const seen = new Set();
  doc.items.forEach((it, i) => {
    const where = `${i + 1}件目`;
    if (!it || typeof it !== "object") { errors.push(`${where}: 形式が正しくありません`); return; }
    const id = clean(it.id);
    if (!ID_RE.test(id)) errors.push(`${where}: ページ内リンク名が正しくありません`);
    else if (seen.has(id)) errors.push(`${where}: ページ内リンク名「${id}」が重複しています`);
    else if (reserved.has(id)) errors.push(`${where}: ページ内リンク名「${id}」はページのほかの場所で使っています`);
    seen.add(id);
    const visible = it.visible !== false;
    for (const k of ["title", "body", "image", "alt"]) if (visible && !clean(it[k])) errors.push(`${where}: 必須の項目（${k}）が空です`);
    for (const k of ["title", "label", "alt", "body", "topic"]) if (clean(it[k]).length > LIMITS[k]) errors.push(`${where}: ${k} が長すぎます`);
    const img = clean(it.image);
    if (img) {
      if (!IMAGE_RE.test(img)) errors.push(`${where}: 画像のファイル名が正しくありません`);
      else if (!existing.has(img) && !newImages.has(img)) errors.push(`${where}: 画像 ${img} が見つかりません`);
    }
    const tags = it.tags || [];
    if (!Array.isArray(tags) || tags.length > LIMITS.tags) { errors.push(`${where}: タグは${LIMITS.tags}個までです`); return; }
    for (const t of tags) {
      const text = typeof t === "object" && t ? t.text : t;
      const color = typeof t === "object" && t ? t.color || "" : "";
      if (clean(text).length > LIMITS.tag) errors.push(`${where}: タグが長すぎます`);
      if (!TAG_COLORS.has(color)) errors.push(`${where}: タグの色が正しくありません`);
    }
  });
  if (errors.length) throw new HttpError(400, "invalid", "入力に直すところがあります：" + errors.slice(0, 5).join(" ／ "));
}

async function publish(request, env, who, cors) {
  const body = await readJson(request, MAX_BODY_BYTES);
  const baseSha = String(body.baseSha || "");
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new HttpError(400, "invalid", "編集を始めたときの版がわかりません。読み込み直してください。");
  if (typeof body.json !== "string") throw new HttpError(400, "invalid", "案件の一覧が送られていません。");
  const jsonBytes = enc.encode(body.json);
  if (jsonBytes.length > MAX_JSON_BYTES) throw new HttpError(413, "too_large", "案件の一覧が大きすぎます。");
  let doc;
  try { doc = JSON.parse(body.json); } catch { throw new HttpError(400, "invalid", "案件の一覧の形式が正しくありません。"); }

  /* 画像：管理画面が作る名前・JPEG・大きさの上限だけを受け付ける（中身は展開せずに GitHub へ渡す） */
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length > MAX_IMAGES) throw new HttpError(413, "too_large", `一度に公開できる新しい画像は${MAX_IMAGES}枚までです。`);
  const newImages = new Map();
  for (const im of images) {
    const name = String(im && im.name || "");
    const b64 = String(im && im.b64 || "");
    if (!ADMIN_IMAGE_RE.test(name) || newImages.has(name)) throw new HttpError(400, "invalid", "画像のファイル名が正しくありません。");
    if (!b64 || b64.length > MAX_IMAGE_B64 || b64.length % 4 !== 0) throw new HttpError(400, "invalid", "画像のデータが正しくありません。");
    /* base64 の検査は atob で行う（正規表現で1文字ずつ見ると、無料プランの CPU 時間 10ms を超えてしまう）。
       空白などを含むと atob は読み飛ばすので、復元した長さも突き合わせる。 */
    let bin;
    try { bin = atob(b64); } catch { bin = null; }
    const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    if (bin === null || bin.length !== (b64.length / 4) * 3 - pad) throw new HttpError(400, "invalid", "画像のデータが正しくありません。");
    if (bin.charCodeAt(0) !== 0xff || bin.charCodeAt(1) !== 0xd8 || bin.charCodeAt(2) !== 0xff) {
      throw new HttpError(400, "invalid", "画像は JPEG にしてから送ってください。");
    }
    newImages.set(name, b64);
  }
  const referenced = new Set((doc && Array.isArray(doc.items) ? doc.items : []).map((it) => clean(it && it.image)));
  for (const name of newImages.keys()) if (!referenced.has(name)) throw new HttpError(400, "invalid", "どの案件にも使われていない画像が含まれています。");

  const message = `${String(body.message || "管理画面から案件一覧を更新").replace(/[\u0000-\u001f]/g, " ").slice(0, 120)}（${who.email}）`;
  const mySha = await gitBlobSha(jsonBytes);
  const rev = (await hex("SHA-256", jsonBytes)).slice(0, 12);

  /* 外部への通信の回数（無料プランは1回の処理で50回まで）に収まるよう、
     中身（blob）は一度だけ作り、やり直しは4回まで。最悪でも 画像6枚+JSON 7回 ＋ 8回×4 = 39回 */
  const entries = [{ path: DATA_PATH, content: body.json, encoding: "utf-8" }];
  for (const [name, b64] of newImages) entries.push({ path: `${IMG_DIR}/${name}`, content: b64, encoding: "base64" });
  let blobs = null;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const { data: ref } = await gh(env, `/git/ref/heads/${branch(env)}`);
    const head = ref.object.sha;
    const { data: cur } = await gh(env, `/contents/${DATA_PATH}?ref=${head}`);
    if (cur.sha === mySha) {                       /* 前回の書き込みが実は届いていた */
      return json({ sha: mySha, rev, already: true }, 200, cors);
    }
    if (cur.sha !== baseSha) {
      throw new HttpError(409, "conflict", "別の場所で一覧が更新されています。最新の内容を読み込み直してください。");
    }
    /* 既存の画像の一覧（新しい画像で上書きしないため・JSON の点検のため） */
    const { status: dirStatus, data: dir } = await gh(env, `/contents/${IMG_DIR}?ref=${head}`, { allow: [404] });
    const existing = new Set(dirStatus === 200 && Array.isArray(dir) ? dir.map((f) => f.name) : []);
    for (const name of newImages.keys()) if (existing.has(name)) throw new HttpError(409, "exists", "同じ名前の画像がすでにあります。画像を選び直してください。");
    validateDoc(doc, newImages, existing, pageIds((await readFile(env, "solutions.html", head)).text));

    const { data: commit } = await gh(env, `/git/commits/${head}`);
    if (!blobs) {
      blobs = [];
      for (const e of entries) {
        const { data: blob } = await gh(env, "/git/blobs", { method: "POST", body: { content: e.content, encoding: e.encoding } });
        blobs.push({ path: e.path, mode: "100644", type: "blob", sha: blob.sha });
      }
    }
    const { data: tree } = await gh(env, "/git/trees", { method: "POST", body: { base_tree: commit.tree.sha, tree: blobs } });
    const { data: newCommit } = await gh(env, "/git/commits", {
      method: "POST",
      body: { message, tree: tree.sha, parents: [head], author: { name: "知上会 管理画面", email: who.email, date: new Date().toISOString() } }
    });
    try {
      await gh(env, `/git/refs/heads/${branch(env)}`, { method: "PATCH", body: { sha: newCommit.sha, force: false } });
      console.log(JSON.stringify({ event: "published", email: who.email, commit: newCommit.sha, images: newImages.size, attempt }));
      return json({ sha: mySha, rev, already: false }, 200, cors);
    } catch (e) {
      /* 公開の仕組みが HTML を書き戻した直後など、先に進んでいた → 最新の上に積み直す */
      if (e.code === "ref_moved" && attempt < 4) { await sleep(800 * attempt); continue; }
      throw e;
    }
  }
  throw new HttpError(409, "busy", "混み合っています。少し待ってから、もう一度「公開する」を押してください。");
}
