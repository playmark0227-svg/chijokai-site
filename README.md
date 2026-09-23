# 株式会社知上会 コーポレートサイト

素の HTML / CSS / JavaScript で作った静的サイトです。ビルド不要で、`main` に push すると
GitHub Actions（`.github/workflows/deploy.yml`）が GitHub Pages へ自動デプロイします。

公開URL: https://playmark0227-svg.github.io/chijokai-site/

## ページ構成

| ファイル | 内容 |
| --- | --- |
| `index.html` | トップ（個人向け／法人向けの入口） |
| `story.html` | 代表の想い（企業理念・経歴） |
| `service.html` | 資産形成サポート（個人向け）・よくあるご質問 |
| `solutions.html` | 法人の方へ（案件のご紹介） |
| `contact.html` | お問い合わせ・運営者情報 |
| `privacy.html` | プライバシーポリシー |
| `404.html` | 見つからないページ |

## 更新のしかた

HTML を直接編集します。共通のスタイルは `assets/css/style.css`、動きは `assets/js/main.js`。

**CSS か JS を直したら、push する前に必ず一度これを実行してください。**
先方のブラウザに古いデザインが残るのを防ぐため、ファイルの中身からハッシュを作って
読み込みURL（`?v=…`）に書き込みます。

```bash
bash tools/stamp-assets.sh
```

## 「法人の方へ」の案件一覧（管理画面）

案件カードは HTML に直接書かず、`data/solutions.json` にだけ持っています。
管理画面 **`/admin/`**（https://playmark0227-svg.github.io/chijokai-site/admin/ ）から、
追加・編集・並べ替え・非公開・削除・画像の差し替えができます。

```
管理画面 ──(GitHub API で1コミット)──▶ data/solutions.json ＋ 新しい画像
                                          │ push をきっかけに GitHub Actions
                                          ▼
                      tools/build-solutions.py が solutions.html を書き出し
                      （カード・件数・WebP・文節の改行）→ リポジトリに戻して公開
```

- **ログイン**：GitHub の fine-grained トークン（管理画面では「合言葉」と表記）を使います。
  リポジトリがこのアカウントにあるため、**発行は制作担当が行い、先方にお渡しします**
  （対象は `chijokai-site` だけ・権限は **Contents: Read and write** だけ・有効期限は90日程度）。
  手順は管理画面のログイン欄の「制作担当向け」にあります。classic トークン（`ghp_`）は受け付けません。
- **合言葉は保存しない**：`playmark0227-svg.github.io` はほかの案件サイトと同じオリジンなので、
  ページはトークンを localStorage などに残しません（メモリだけ）。記憶はブラウザのパスワード保存機能に任せます。
  知上会の独自ドメインに移したら、この制限は緩められます。
- **「サイトに出さない」の意味**：一覧に表示しないだけです。リポジトリは public なので、
  JSON と画像は誰でも見られます。社外秘の内容は入れない運用にしてください。
- **反映**：保存から 1〜2 分。公開ページの `data-rev`（JSON の SHA-256 先頭12桁）を見て、
  管理画面が反映を確かめます。
- **同時編集**：書き込む直前に、土台にするコミットでの JSON が読み込んだときと同じか確かめ、
  違えば上書きせずに止めます（ref の更新は fast-forward のみ）。編集内容はファイルに書き出して残せます。
- **下書き**：編集途中の内容はブラウザに自動で残り、閉じてしまっても次回、確認のうえ復元できます
  （同じオリジンの他のページから書き換えられうるので、画像名・画像の中身・タグの色を検査してから使います）。
- **画像**：管理画面で選んだ画像は幅1200pxの JPEG にして `assets/img/sol-<id>-<日時>.jpg` で書き込み、
  WebP は公開時に作ります。どの案件からも使われなくなった「管理画面が作った画像」は公開時に自動で片付けます。
- **お試し**：`localhost` で開くと「お試しモード」が出ます（保存はせず、操作だけ試せます）。

手元で JSON を直接直したとき、カードの HTML を変えたときは：

```bash
python3 tools/build-solutions.py          # 書き出す（budoux が必要: pip install budoux）
python3 tools/build-solutions.py --check  # 差分があるかだけ確かめる
```

`solutions.html` の `<!-- solutions:start -->` 〜 `<!-- solutions:end -->` のあいだと、
`index.html` の `data-sol-count`（公開中の件数）は自動で書き換わるので、直接編集しないでください。
カードの HTML を変えるときは `tools/build-solutions.py` の `card()` と、
`admin/admin.js` の `cardHtml()`（プレビュー用）を両方そろえてください。

## 画像

`assets/img/` に元の JPEG / PNG を置き、そこから WebP を生成して配信しています。
HTML は `<picture>` で「WebP → 元のJPEG」の順に指定しているので、WebP に対応していない
環境でも表示は崩れません。

写真を差し替え・追加したら：

```bash
bash tools/build-images.sh     # WebP を生成（3.5MB → 1.1MB 相当まで軽くなります）
bash tools/build-ogp.sh        # SNS共有用の画像 assets/img/ogp.jpg を作り直す
bash tools/build-icons.sh      # タブ用アイコン・ホーム画面用アイコンを作り直す
```

必要なもの: `cwebp`（`brew install webp`）。ほかは macOS 標準の `sips` / `qlmanage` だけです。

公開しない画像は `.gitignore` で除外しています（`_unused/` `_hero-candidates/` `_unsplash_backup/`）。

## お問い合わせフォーム

サーバーを持たないため、既定では入力内容を件名・本文に組み立てて利用者のメールソフトを
開く方式（mailto）で動いています。送信先は `assets/js/main.js` の `MAIL_TO`。

Formspree などのフォーム管理サービスを契約したら、同ファイルの `FORM_ENDPOINT` に
POST 先の URL を入れるだけで、自動送信に切り替わります（HTML の変更は不要）。

## 独自ドメインに移すとき

`chijoukai.com` などに移す場合は、次の4か所を新しいURLに置き換えます。

1. 各HTMLの `<link rel="canonical">` と `<meta property="og:url">`、`og:image`
2. `sitemap.xml` の各 `<loc>`
3. `robots.txt` の `Sitemap:` 行
4. `index.html` の構造化データ（JSON-LD）内の URL
5. `admin/admin.js` の `CONFIG.site` と、`admin/index.html` の CSP（`connect-src`）

あわせてリポジトリ直下に `CNAME` ファイル（中身はドメイン名のみ）を置き、
DNS を GitHub Pages に向けてください。

```bash
# 一括置換の例
grep -rl "playmark0227-svg.github.io/chijokai-site" --include="*.html" --include="*.xml" --include="*.txt" . \
  | xargs sed -i '' 's|https://playmark0227-svg.github.io/chijokai-site|https://chijoukai.com|g'
```

## 内部資料

`_打ち合わせ記録/` と `制作メモ.md` は `.gitignore` 済みで、リポジトリには入りません。
このリポジトリは public です。未確定の内容を置くときはご注意ください。
