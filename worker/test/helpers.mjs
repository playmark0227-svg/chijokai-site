/* テスト用の偽物：Google（ID トークンの発行と公開鍵）と GitHub（Git Data API の必要な分だけ）
   本物にはつながない。worker/test/worker.test.mjs と、管理画面の通しテストでも使える。 */
import { createHash, webcrypto } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const subtle = webcrypto.subtle;
const enc = new TextEncoder();

export const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
export const gitBlobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/* ---------------- 偽の Google ---------------- */
export async function fakeGoogle(clientId) {
  const pair = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const other = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  const kid = "test-kid-1";
  const jwks = { keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid }] };
  const now = () => Math.floor(Date.now() / 1000);
  async function token(claims = {}, opts = {}) {
    const header = { alg: opts.alg || "RS256", kid: opts.kid || kid, typ: "JWT" };
    const payload = {
      iss: "https://accounts.google.com", aud: clientId, azp: clientId, sub: "1234567890",
      email: "info@chijoukai.com", email_verified: true, name: "知上会", iat: now(), exp: now() + 3600, ...claims
    };
    const input = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
    const key = opts.wrongKey ? other.privateKey : pair.privateKey;
    const sig = new Uint8Array(await subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input)));
    return `${input}.${b64url(sig)}`;
  }
  return { jwks, token, kid };
}

/* ---------------- 偽の GitHub ---------------- */
export function fakeGitHub({ repo = "playmark0227-svg/chijokai-site", branch = "main" } = {}) {
  const blobs = new Map();     // sha -> Buffer
  const trees = new Map();     // sha -> Map(path -> blobSha)
  const commits = new Map();   // sha -> { tree, parents, message, author }
  let seq = 0;
  const id = (kind) => createHash("sha1").update(`${kind}-${++seq}-${Math.random()}`).digest("hex");
  const putBlob = (buf) => { const sha = gitBlobSha(buf); blobs.set(sha, Buffer.from(buf)); return sha; };

  /* いまのリポジトリの必要なファイルで始める */
  const files = new Map();
  for (const p of ["data/solutions.json", "solutions.html", "index.html"]) files.set(p, putBlob(readFileSync(join(ROOT, p))));
  for (const name of readdirSync(join(ROOT, "assets/img"))) files.set(`assets/img/${name}`, putBlob(Buffer.from(`image:${name}`)));
  const tree0 = id("tree");
  trees.set(tree0, files);
  const c0 = id("commit");
  commits.set(c0, { tree: tree0, parents: [], message: "initial" });

  const gh = {
    head: c0,
    calls: [],
    hooks: {},            // { beforePatch(gh), failOnce: { [key]: status } }
    commitFiles(changes, message = "bot") {      // 別の誰か（公開の仕組みなど）がコミットする
      const t = new Map(trees.get(commits.get(gh.head).tree));
      for (const [p, content] of Object.entries(changes)) t.set(p, putBlob(Buffer.from(content)));
      const ts = id("tree"); trees.set(ts, t);
      const cs = id("commit"); commits.set(cs, { tree: ts, parents: [gh.head], message });
      gh.head = cs;
      return cs;
    },
    file(path, ref = gh.head) {
      const sha = trees.get(commits.get(ref).tree).get(path);
      return sha ? blobs.get(sha) : null;
    },
    commit(sha = gh.head) { return commits.get(sha); },
    commitCount() { let n = 0, c = gh.head; while (c) { n++; c = commits.get(c).parents[0]; } return n; }
  };

  const json = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const resolveRef = (ref) => (!ref || ref === branch ? gh.head : ref);

  gh.handle = async (req) => {
    const url = new URL(req.url);
    const prefix = `/repos/${repo}`;
    if (req.headers.get("Authorization") !== "Bearer test-github-token") return json(401, { message: "Bad credentials" });
    if (!req.headers.get("User-Agent")) return json(403, { message: "User-Agent required" });
    if (!url.pathname.startsWith(prefix)) return json(404, { message: "Not Found" });
    const path = url.pathname.slice(prefix.length);
    const key = `${req.method} ${path}`;
    gh.calls.push(key);
    const fail = gh.hooks.failOnce && Object.keys(gh.hooks.failOnce).find((k) => key.startsWith(k));
    if (fail) { const st = gh.hooks.failOnce[fail]; delete gh.hooks.failOnce[fail]; return json(st, { message: "injected" }); }
    const body = req.method === "GET" ? null : await req.json();

    let m;
    if (req.method === "GET" && path === `/git/ref/heads/${branch}`) return json(200, { object: { sha: gh.head } });
    if (req.method === "GET" && (m = /^\/contents\/(.+)$/.exec(path))) {
      const ref = resolveRef(url.searchParams.get("ref"));
      const c = commits.get(ref); if (!c) return json(404, { message: "No commit found" });
      const t = trees.get(c.tree), p = decodeURIComponent(m[1]);
      if (t.has(p)) return json(200, { type: "file", name: p.split("/").pop(), path: p, sha: t.get(p), encoding: "base64", content: blobs.get(t.get(p)).toString("base64").replace(/(.{60})/g, "$1\n") });
      const kids = [...t.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/"));
      if (kids.length) return json(200, kids.map((k) => ({ type: "file", name: k.slice(p.length + 1), path: k, sha: t.get(k) })));
      return json(404, { message: "Not Found" });
    }
    if (req.method === "GET" && (m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(path))) {
      const c = commits.get(m[1]); if (!c) return json(404, { message: "Not Found" });
      return json(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) });
    }
    if (req.method === "POST" && path === "/git/blobs") {
      const buf = body.encoding === "base64" ? Buffer.from(body.content, "base64") : Buffer.from(body.content, "utf8");
      return json(201, { sha: putBlob(buf) });
    }
    if (req.method === "POST" && path === "/git/trees") {
      const base = trees.get(body.base_tree); if (!base) return json(422, { message: "base_tree invalid" });
      const t = new Map(base);
      for (const e of body.tree) {
        if (!blobs.has(e.sha)) return json(422, { message: "blob missing" });
        if (e.path.split("/").some((s) => s === ".." || s === "." || s === "")) return json(422, { message: "bad path" });
        t.set(e.path, e.sha);
      }
      const sha = id("tree"); trees.set(sha, t);
      return json(201, { sha });
    }
    if (req.method === "POST" && path === "/git/commits") {
      if (!trees.has(body.tree)) return json(422, { message: "tree invalid" });
      const sha = id("commit");
      commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message, author: body.author });
      return json(201, { sha });
    }
    if (req.method === "PATCH" && path === `/git/refs/heads/${branch}`) {
      if (gh.hooks.beforePatch) { const h = gh.hooks.beforePatch; gh.hooks.beforePatch = null; h(gh); }
      const c = commits.get(body.sha);
      if (!c) return json(422, { message: "Object does not exist" });
      if (!body.force && c.parents[0] !== gh.head) return json(422, { message: "Update is not a fast forward" });
      gh.head = body.sha;
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: `Not Found (${key})` });
  };
  return gh;
}

/* fetch を差し替える（Google の公開鍵と GitHub だけに答える） */
export function installFetch({ google, github }) {
  const real = globalThis.fetch;
  const stats = { jwks: 0 };
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
      stats.jwks++;
      return new Response(JSON.stringify(google.jwks), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=20000" } });
    }
    if (url.origin === "https://api.github.com") return github.handle(req);
    throw new Error(`テストでは外部につながない: ${url.href}`);
  };
  return { stats, restore() { globalThis.fetch = real; } };
}
