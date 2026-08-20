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
