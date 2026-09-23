# 管理画面の中継（Cloudflare Worker）

管理画面（`/admin/`）の「Google でログイン」を支える小さなプログラムです。
GitHub に書き込む鍵（トークン）をここに預け、次の条件を満たすときだけ書き込みます。

1. Google のログイン証明（ID トークン）の署名・発行元・宛先（このアプリのクライアント ID）・期限が正しい
2. メールアドレスが `ALLOWED_EMAILS`（いまは `info@chijoukai.com`）にあり、Google で確認済み
3. 書き込み先が `data/solutions.json` と、管理画面が作る名前の案件画像（`assets/img/sol-*.jpg`・JPEG）だけ
4. 編集を始めたときの JSON から、ほかの誰も更新していない（上書きしない。fast-forward のみ）
5. 内容が `tools/build-solutions.py` の点検に通る（サイトの公開を止める内容は書かない）

Google のパスワードは Google の画面でだけ入力するので、管理画面にもこの中継にも届きません。
ログインが通ると、中継は8時間有効な「ログインのしるし」を発行し、管理画面はそれをメモリにだけ持ちます。

```
管理画面 ─ Google でログイン ─▶ ID トークン ─▶ 中継 /api/session ─▶ ログインのしるし（8時間）
管理画面 ─ しるし ─▶ 中継 /api/solutions（読む） /api/publish（1回のコミットで書く）─▶ GitHub
```

## はじめての設定（制作担当が1回だけ）

アカウントへのログインやパスワード入力が必要な手順は、すべてご自身で行ってください。
所要 20〜30 分ほどです。無料の範囲で動きます（Cloudflare Workers 無料枠：1日10万回）。

### 1. Google Cloud でログイン用の「クライアント ID」を作る

1. https://console.cloud.google.com/ を開き、プロジェクトを新しく作る（名前の例：`chijoukai-admin`）。
2. 「Google Auth Platform」（https://console.cloud.google.com/auth/overview ）で「開始」を押し、
   - アプリ名：`知上会 管理画面`、ユーザーサポートメール：自分のアドレス
   - 対象：**外部**（chijoukai.com が Google Workspace で、その組織の中にプロジェクトを作った場合は「内部」でも可）
   - 連絡先：自分のアドレス
3. 「対象」（Audience）で **「アプリを公開」**（本番環境）にする。
   使うのはメールアドレスと名前だけ（基本の範囲）なので、Google の審査は要りません。
   だれが使えるかは中継の `ALLOWED_EMAILS` で絞ります。
4. 「クライアント」→「クライアントを作成」
   - アプリケーションの種類：**ウェブ アプリケーション**、名前：`知上会 管理画面`
   - 承認済みの JavaScript 生成元：
     - `https://playmark0227-svg.github.io`
     - `http://localhost` と `http://localhost:4173`（手元で試すとき用。不要なら入れなくてよい）
   - 承認済みのリダイレクト URI：空欄のまま
5. できあがった **クライアント ID**（`…apps.googleusercontent.com`）を控える。公開してよい値です。
   （クライアント シークレットは使いません。）

### 2. 中継（この Worker）を Cloudflare に置く

Cloudflare の無料アカウントを作っておき、ターミナルで：

```bash
cd worker
npm install
npx wrangler login          # ブラウザが開くので、Cloudflare にログインして許可
npx wrangler deploy         # 初回は workers.dev のサブドメイン名を聞かれる
```

表示される URL（例 `https://chijoukai-admin.<サブドメイン>.workers.dev`）を控えます。

### 3. 中継に秘密の値を登録する

GitHub の鍵を1本作ります（**この中継専用**。管理画面の「合言葉」とは別に作る）：

- https://github.com/settings/personal-access-tokens/new
- Token name：`知上会 管理画面の中継`
- Expiration：**1年**（カレンダーに更新日を入れておく）
- Repository access：**Only select repositories** → `chijokai-site` だけ
- Permissions → Repository permissions → **Contents: Read and write**（ほかは付けない）

```bash
npx wrangler secret put GITHUB_TOKEN          # 作った鍵を貼り付けて Enter（画面には出ません）
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
```

鍵はこの2か所（GitHub の画面と、このコマンド）以外には貼らないでください。
リポジトリ・メール・チャットに書くと、誰でも書き込めるようになってしまいます。

### 4. 管理画面に設定を入れて、公開する

リポジトリの一番上のフォルダで：

```bash
python3 tools/admin-google.py \
  --client-id 1234567890-xxxx.apps.googleusercontent.com \
  --relay https://chijoukai-admin.<サブドメイン>.workers.dev
```

`admin/admin.js`・`admin/index.html`（CSP）・`worker/wrangler.jsonc` の3か所に、同じ値がそろって入ります。

```bash
cd worker && npx wrangler deploy && cd ..       # クライアント ID を中継に反映
git add -A && git commit -m "管理画面の Google ログインを有効にする" && git push
```

### 5. 確かめる

```bash
curl -H "Origin: https://playmark0227-svg.github.io" https://chijoukai-admin.<サブドメイン>.workers.dev/api/health
# → {"ok":true}   （{"error":"misconfigured"} なら 3 の秘密の値か 4 のクライアント ID が足りない）
```

公開が終わったら（1〜2分）、https://playmark0227-svg.github.io/chijokai-site/admin/ を開き、
「Google でログイン」を **info@chijoukai.com のご本人** に押してもらいます。
一覧が出たら、どれか1件を「サイトに出す」をオフ→オンなどで試しに公開し、1〜2分で反映されることを確かめます。

## ふだんの運用

| したいこと | やり方 |
| --- | --- |
| 使える人を増やす・減らす | `wrangler.jsonc` の `ALLOWED_EMAILS`（カンマ区切り）を直して `npx wrangler deploy`。外した人はログイン中でもすぐ使えなくなる |
| 全員を強制的にログアウト | `openssl rand -base64 48 \| npx wrangler secret put SESSION_SECRET` |
| GitHub の鍵を取り替える（期限前） | 新しい鍵を作る → `npx wrangler secret put GITHUB_TOKEN` → GitHub で古い鍵を削除 |
| 何が起きたか見る | `npx wrangler tail`、または Cloudflare の管理画面 → Workers → chijoukai-admin → Logs |
| Google ログインをやめる | `python3 tools/admin-google.py --off` → push（合言葉でのログインだけに戻る） |
| テスト | `npm test`（本物の Google・GitHub にはつながず、偽物で確かめる） |

GitHub の鍵が切れると、管理画面に「中継に預けてある GitHub の鍵が期限切れか…」と出ます。
その間も、制作担当は「合言葉」でログインして更新できます。

## 独自ドメインに移したら

`wrangler.jsonc` の `ALLOWED_ORIGINS` に新しいオリジン（例 `https://chijoukai.com`）を足して `npx wrangler deploy`、
Google Cloud のクライアントの「承認済みの JavaScript 生成元」にも同じものを足します。
あわせて info@chijoukai.com の Google アカウントでは **2段階認証** を有効にしておいてください。

## ファイル

- `src/index.js` … 中継の本体（外部のライブラリは使っていません）
- `wrangler.jsonc` … 公開してよい設定だけ（秘密の値は `wrangler secret put` で登録）
- `test/` … `npm test` のテスト（`node:test`）
