/* 中継（Worker）のテスト：  cd worker && npm test
   本物の Google・GitHub にはつながず、偽物（helpers.mjs）で確かめる。 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { fakeGoogle, fakeGitHub, installFetch, gitBlobSha, sha256 } from "./helpers.mjs";

const ORIGIN = "https://playmark0227-svg.github.io";
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const baseEnv = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  ALLOWED_EMAILS: "info@chijoukai.com",
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:4174`,
  GITHUB_REPO: "playmark0227-svg/chijokai-site",
  GITHUB_BRANCH: "main",
  GITHUB_TOKEN: "test-github-token",
  SESSION_SECRET: "x".repeat(48)
};
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString("base64");

let google, github, net, env;
before(async () => { google = await fakeGoogle(CLIENT_ID); });
beforeEach(() => {
  if (net) net.restore();
  github = fakeGitHub();
  net = installFetch({ google, github });
  env = { ...baseEnv };
});
after(() => net && net.restore());

function call(path, { method = "GET", body, session, origin = ORIGIN, headers = {} } = {}) {
  const h = { Origin: origin, ...headers };
  if (session) h.Authorization = `Bearer ${session}`;
  let payload;
  if (body !== undefined) { payload = typeof body === "string" ? body : JSON.stringify(body); h["Content-Type"] = "application/json"; }
  return worker.fetch(new Request(`https://chijoukai-admin.example.workers.dev${path}`, { method, headers: h, body: payload }), env);
}
async function login(claims) {
  const res = await call("/api/session", { method: "POST", body: { credential: await google.token(claims) } });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).session;
}
function currentDoc() { return JSON.parse(github.file("data/solutions.json").toString("utf8")); }
function serialize(doc) { return JSON.stringify(doc, null, 2) + "\n"; }
async function publish(session, doc, extra = {}) {
  const baseSha = extra.baseSha || gitBlobSha(github.file("data/solutions.json"));
  return call("/api/publish", { method: "POST", session, body: { baseSha, json: serialize(doc), message: "テスト", images: [], ...extra } });
}

/* ---------------- 入口 ---------------- */
test("許可したオリジンにだけ CORS を返す", async () => {
  const ok = await call("/api/health", { method: "OPTIONS" });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const ng = await call("/api/health", { method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(ng.status, 403);
  assert.equal(ng.headers.get("Access-Control-Allow-Origin"), null);
  const ng2 = await call("/api/solutions", { origin: "https://playmark0227-svg.github.io.evil.example" });
  assert.equal(ng2.status, 403);
  const none = await worker.fetch(new Request("https://w.example/api/health"), env);
  assert.equal(none.status, 403);
});

test("設定が足りないときは動かない", async () => {
  env.SESSION_SECRET = "short";
  const res = await call("/api/health");
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, "misconfigured");
});

/* ---------------- Google のログイン証明 ---------------- */
test("正しい ID トークンでログインでき、一覧を読める", async () => {
  const session = await login();
  const res = await call("/api/solutions", { session });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.email, "info@chijoukai.com");
  assert.equal(body.raw, github.file("data/solutions.json").toString("utf8"));
  assert.equal(body.sha, gitBlobSha(github.file("data/solutions.json")));
});

test("メールアドレスの大文字小文字は区別しない", async () => {
  await login({ email: "Info@ChijouKai.com" });
});

test("不正な ID トークンは受け付けない", async () => {
  const cases = [
    ["別のアプリ宛て", await google.token({ aud: "other.apps.googleusercontent.com" }), 401],
    ["発行元が違う", await google.token({ iss: "https://evil.example" }), 401],
    ["期限切れ", await google.token({ exp: Math.floor(Date.now() / 1000) - 3600 }), 401],
    ["未来の発行", await google.token({ iat: Math.floor(Date.now() / 1000) + 3600 }), 401],
    ["署名の鍵が違う", await google.token({}, { wrongKey: true }), 401],
    ["知らない鍵", await google.token({}, { kid: "unknown-kid" }), 401],
    ["alg を変えた", await google.token({}, { alg: "HS256" }), 401],
    ["許可していない人", await google.token({ email: "someone@gmail.com" }), 403],
    ["似せたアドレス", await google.token({ email: "info@chijoukai.com.evil.example" }), 403],
    ["メール未確認", await google.token({ email_verified: false }), 403],
    ["形式が壊れている", "abc.def", 401],
    ["空", "", 401]
  ];
  for (const [name, credential, status] of cases) {
    const res = await call("/api/session", { method: "POST", body: { credential } });
    assert.equal(res.status, status, name);
    assert.ok(!(await res.json()).session, name);
  }
  /* 署名部分を差し替えただけのもの */
  const t = (await google.token()).split(".");
  const forged = await google.token({ email: "someone@gmail.com" });
  const res = await call("/api/session", { method: "POST", body: { credential: `${forged.split(".")[0]}.${forged.split(".")[1]}.${t[2]}` } });
  assert.equal(res.status, 401);
  /* alg=none */
  const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${t[1]}.`;
  assert.equal((await call("/api/session", { method: "POST", body: { credential: none } })).status, 401);
});

test("壊れた JSON や大きすぎる本文は断る", async () => {
  assert.equal((await call("/api/session", { method: "POST", body: "{not json" })).status, 400);
  assert.equal((await call("/api/session", { method: "POST", body: { credential: "a".repeat(20000) } })).status, 413);
});

/* ---------------- ログイン中のしるし ---------------- */
test("しるしが無い・改ざん・期限切れ・許可から外れたら使えない", async () => {
  assert.equal((await call("/api/solutions")).status, 401);
  const session = await login();
  const [payload, sig] = session.split(".");
  const p = JSON.parse(Buffer.from(payload, "base64url").toString());
  const tampered = Buffer.from(JSON.stringify({ ...p, email: "someone@gmail.com" })).toString("base64url");
  assert.equal((await call("/api/solutions", { session: `${tampered}.${sig}` })).status, 401);
  const old = Buffer.from(JSON.stringify({ ...p, exp: 1 })).toString("base64url");
  assert.equal((await call("/api/solutions", { session: `${old}.${sig}` })).status, 401);
  assert.equal((await call("/api/solutions", { session: `${payload}.${"A".repeat(43)}` })).status, 401);
  /* 秘密の値を変えると、それまでのしるしは全部無効 */
  env.SESSION_SECRET = "y".repeat(48);
  assert.equal((await call("/api/solutions", { session })).status, 401);
  env.SESSION_SECRET = baseEnv.SESSION_SECRET;
  env.ALLOWED_EMAILS = "other@chijoukai.com";
  assert.equal((await call("/api/solutions", { session })).status, 403);
});

/* ---------------- 公開 ---------------- */
test("編集した一覧を1回のコミットで書き込む", async () => {
  const session = await login();
  const before = github.commitCount();
  const doc = currentDoc();
  doc.items[0].title = "ISS-4 ｜ 空調の省エネ（テスト）";
  const res = await publish(session, doc);
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  const bytes = Buffer.from(serialize(doc));
  assert.equal(body.already, false);
  assert.equal(body.sha, gitBlobSha(bytes));
  assert.equal(body.rev, sha256(bytes).slice(0, 12));
  assert.equal(github.file("data/solutions.json").toString(), serialize(doc));
  assert.equal(github.commitCount(), before + 1);
  const c = github.commit();
  assert.equal(c.author.email, "info@chijoukai.com");
  assert.match(c.message, /テスト（info@chijoukai\.com）$/);
});

test("新しい画像もいっしょに書き込む", async () => {
  const session = await login();
  const doc = currentDoc();
  const name = "sol-iss4-20260923-101500.jpg";
  doc.items[0].image = name;
  const res = await publish(session, doc, { images: [{ name, b64: JPEG_B64 }] });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(github.file(`assets/img/${name}`).toString("base64"), JPEG_B64);
});

test("読み込んだあとに別の場所で更新されていたら、上書きしない", async () => {
  const session = await login();
  const baseSha = gitBlobSha(github.file("data/solutions.json"));
  const other = currentDoc(); other.items[1].title = "別の端末の更新";
  github.commitFiles({ "data/solutions.json": serialize(other) }, "他の端末");
  const mine = currentDoc(); mine.items[0].title = "わたしの更新";
  const head = github.head;
  const res = await publish(session, mine, { baseSha });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "conflict");
  assert.equal(github.head, head);
  assert.equal(currentDoc().items[1].title, "別の端末の更新");
});

test("書き込みが届いたのに返事が来なかったとき、もう一度押しても二重にならない", async () => {
  const session = await login();
  const baseSha = gitBlobSha(github.file("data/solutions.json"));
  const doc = currentDoc(); doc.items[2].title = "一度だけ";
  assert.equal((await publish(session, doc, { baseSha })).status, 200);
  const count = github.commitCount();
  const again = await publish(session, doc, { baseSha });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).already, true);
  assert.equal(github.commitCount(), count);
});

test("書き込みの直前に公開の仕組みが HTML を書き戻しても、その上に積み直す", async () => {
  const session = await login();
  github.hooks.beforePatch = (g) => g.commitFiles({ "solutions.html": "<!-- bot -->" + g.file("solutions.html").toString() }, "bot");
  const doc = currentDoc(); doc.items[3].title = "積み直し";
  const res = await publish(session, doc);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(currentDoc().items[3].title, "積み直し");
  assert.ok(github.file("solutions.html").toString().startsWith("<!-- bot -->"), "bot の更新が残る");
  assert.ok(github.calls.filter((c) => c.startsWith("PATCH")).length >= 2);
});

test("GitHub が一時的に失敗したら、エラーを返して何も書かない", async () => {
  const session = await login();
  github.hooks.failOnce = { "POST /git/trees": 502 };
  const head = github.head;
  const doc = currentDoc(); doc.items[0].title = "失敗";
  const res = await publish(session, doc);
  assert.equal(res.status, 502);
  assert.equal(github.head, head);
});

test("サイトの公開を止めてしまう内容は書き込まない", async () => {
  const session = await login();
  const head = github.head;
  const mutate = [
    ["ページが使う id", (d) => { d.items[0].id = "faq"; }],
    ["ページが使う id（大文字違い）", (d) => { d.items[0].id = "navtoggle"; }],
    ["重複 id", (d) => { d.items[1].id = d.items[0].id; }],
    ["id の形式", (d) => { d.items[0].id = "9abc"; }],
    ["必須が空", (d) => { d.items[0].title = "  "; }],
    ["長すぎる", (d) => { d.items[0].body = "あ".repeat(1201); }],
    ["無い画像", (d) => { d.items[0].image = "nothing-here.jpg"; }],
    ["画像名に ..", (d) => { d.items[0].image = "../index.html"; }],
    ["タグの色", (d) => { d.items[0].tags = [{ text: "a", color: "red" }]; }],
    ["タグが多すぎる", (d) => { d.items[0].tags = Array(7).fill({ text: "a", color: "" }); }],
    ["items が無い", (d) => { delete d.items; }]
  ];
  for (const [name, fn] of mutate) {
    const doc = currentDoc(); fn(doc);
    const res = await publish(session, doc);
    assert.equal(res.status, 400, name);
  }
  /* 非表示の案件は必須が空でもよい（build-solutions.py と同じ） */
  const doc = currentDoc(); doc.items[0].visible = false; doc.items[0].title = "";
  assert.equal((await publish(session, doc)).status, 200);
  assert.notEqual(github.head, head);
});

test("画像は管理画面が作る名前の JPEG だけ、決まった場所にだけ書く", async () => {
  const session = await login();
  const bad = [
    ["別の名前", "logo-full.png", JPEG_B64],
    ["場所を抜ける", "../../index.html", JPEG_B64],
    ["既存の画像を上書き", null, JPEG_B64],
    ["JPEG ではない", "sol-iss4-20260923-101500.jpg", Buffer.from("<svg onload=alert(1)>").toString("base64")],
    ["base64 ではない", "sol-iss4-20260923-101500.jpg", "not base64!!"],
    ["空白入り", "sol-iss4-20260923-101500.jpg", JPEG_B64.slice(0, 8) + " " + JPEG_B64.slice(9)],
    ["途中に =", "sol-iss4-20260923-101500.jpg", JPEG_B64.slice(0, 8) + "=" + JPEG_B64.slice(9)]
  ];
  const existing = "sol-iss4-20260923-000000.jpg";
  github.commitFiles({ [`assets/img/${existing}`]: "old" }, "既存");
  const head = github.head;
  for (const [label, name0, b64] of bad) {
    const name = name0 || existing;
    const doc = currentDoc(); doc.items[0].image = name;
    const res = await publish(session, doc, { images: [{ name, b64 }] });
    assert.ok(res.status === 400 || res.status === 409, `${label}: ${res.status}`);
  }
  /* どの案件も使わない画像 */
  const unused = await publish(session, currentDoc(), { images: [{ name: "sol-x-20260923-101500.jpg", b64: JPEG_B64 }] });
  assert.equal(unused.status, 400);
  /* 枚数の上限 */
  const many = Array.from({ length: 7 }, (_, i) => ({ name: `sol-x-20260923-10150${i}.jpg`, b64: JPEG_B64 }));
  assert.equal((await publish(session, currentDoc(), { images: many })).status, 413);
  assert.equal(github.file("assets/img/logo-full.png").toString(), "image:logo-full.png");
  assert.equal(github.file(`assets/img/${existing}`).toString(), "old");
  assert.equal(github.head, head, "何も書き込んでいない");
});

test("公開の本文が大きすぎたら断る", async () => {
  const session = await login();
  const big = "A".repeat(11 * 1024 * 1024);
  const res = await call("/api/publish", { method: "POST", session, body: { baseSha: "0".repeat(40), json: big } });
  assert.equal(res.status, 413);
});

test("ログインせずに公開はできない", async () => {
  const doc = currentDoc(); doc.items[0].title = "勝手に";
  const res = await call("/api/publish", { method: "POST", body: { baseSha: gitBlobSha(github.file("data/solutions.json")), json: serialize(doc) } });
  assert.equal(res.status, 401);
  assert.notEqual(currentDoc().items[0].title, "勝手に");
});

test("GitHub の鍵は応答に含めない", async () => {
  const session = await login();
  github.hooks.failOnce = { "GET /contents": 500 };
  const res = await call("/api/solutions", { session });
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.ok(!text.includes("test-github-token"));
});

test("GitHub の鍵が切れていたら、そうとわかる案内を返す", async () => {
  const session = await login();
  env.GITHUB_TOKEN = "expired-token";
  const res = await call("/api/solutions", { session });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, "github_auth");
  assert.ok(!JSON.stringify(body).includes("expired-token"));
});

test("壊れた文字列や形の違う本文でも落ちずに断る", async () => {
  const t = (await google.token()).split(".");
  for (const credential of [`${t[0]}.${t[1]}.A`, `${t[0]}.${t[1]}.A=A`, `A.${t[1]}.${t[2]}`]) {
    assert.equal((await call("/api/session", { method: "POST", body: { credential } })).status, 401, credential.slice(-5));
  }
  for (const body of ["null", "123", "[]", '"x"']) {
    assert.equal((await call("/api/session", { method: "POST", body })).status, 400, body);
  }
  const session = await login();
  const [p] = session.split(".");
  assert.equal((await call("/api/solutions", { session: `${p}.${"A".repeat(21)}` })).status, 401);
  assert.equal((await call("/api/publish", { method: "POST", session, body: "null" })).status, 400);
});

test("何度やり直しても、外部への通信は50回に収まる", async () => {
  const session = await login();
  let moves = 3;
  const bump = (g) => { g.commitFiles({ "solutions.html": g.file("solutions.html").toString() + " " }, "bot"); if (--moves > 0) g.hooks.beforePatch = bump; };
  github.hooks.beforePatch = bump;
  const doc = currentDoc();
  const images = Array.from({ length: 6 }, (_, i) => ({ name: `sol-iss4-20260923-10150${i}.jpg`, b64: JPEG_B64 }));
  doc.items.slice(0, 6).forEach((it, i) => { it.image = images[i].name; });
  const before = github.calls.length;
  const res = await publish(session, doc, { images });
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(github.calls.length - before <= 50, `GitHub への通信 ${github.calls.length - before} 回`);
  assert.equal(github.calls.slice(before).filter((c) => c === "POST /git/blobs").length, 7, "中身は一度だけ作る");
});
