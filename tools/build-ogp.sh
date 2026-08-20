#!/usr/bin/env bash
# =====================================================================
#  知上会 — OGP画像（SNS・LINEでリンクを送ったときのプレビュー画像）
#  assets/img/ogp.jpg を 1200×630 で書き出します。
#
#    bash tools/build-ogp.sh
#
#  表紙写真（hero-ocean.jpg）とロゴを合成し、明朝でコピーを載せています。
#  macOS 標準の sips / qlmanage だけで動きます（追加インストール不要）。
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d -t chijoukai-ogp)
trap 'rm -rf "$TMP"' EXIT

# 1) 表紙写真を 1200×630 に切り出す
sips -c 945 1800 assets/img/hero-ocean.jpg --out "$TMP/crop.jpg" >/dev/null
sips -z 630 1200 "$TMP/crop.jpg" --out "$TMP/bg.jpg" >/dev/null
sips -s format jpeg -s formatOptions 88 "$TMP/bg.jpg" --out "$TMP/bg2.jpg" >/dev/null

# 2) 写真・ロゴを埋め込んだ SVG を組み立てる
#    qlmanage は正方形に余白を足して書き出すため、1200×1200 の中央に
#    1200×630 の絵を置き、あとから中央で切り抜く
B64=$(base64 -i "$TMP/bg2.jpg" | tr -d '\n')
L64=$(base64 -i assets/img/logo-full.png | tr -d '\n')
python3 - "$TMP" "$B64" "$L64" <<'PY'
import sys, pathlib
T, b64, l64 = sys.argv[1], sys.argv[2], sys.argv[3]
pathlib.Path(T + "/ogp.svg").write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="1200" viewBox="0 0 1200 1200">
<defs>
  <linearGradient id="scrimX" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#000" stop-opacity=".82"/><stop offset="34%" stop-color="#000" stop-opacity=".62"/>
    <stop offset="66%" stop-color="#000" stop-opacity=".28"/><stop offset="100%" stop-color="#000" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="scrimY" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#06121f" stop-opacity=".55"/><stop offset="42%" stop-color="#06121f" stop-opacity=".06"/>
    <stop offset="100%" stop-color="#06121f" stop-opacity=".62"/>
  </linearGradient>
  <linearGradient id="brass" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#b08d4f"/><stop offset="100%" stop-color="#c9a86a"/>
  </linearGradient>
  <filter id="white"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>
  <clipPath id="frame"><rect x="0" y="285" width="1200" height="630"/></clipPath>
</defs>
<rect width="1200" height="1200" fill="#0a1c2e"/>
<g clip-path="url(#frame)">
  <image x="0" y="285" width="1200" height="630" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/jpeg;base64,{b64}"/>
  <rect x="0" y="285" width="1200" height="630" fill="url(#scrimX)"/>
  <rect x="0" y="285" width="1200" height="630" fill="url(#scrimY)"/>
  <image x="76" y="354" width="190" height="68" filter="url(#white)" preserveAspectRatio="xMinYMid meet" xlink:href="data:image/png;base64,{l64}"/>
  <text x="78" y="562" font-family="Hiragino Mincho ProN, Yu Mincho, serif" font-size="72" font-weight="600" fill="#ffffff" letter-spacing="3">お金の知識が、</text>
  <text x="78" y="662" font-family="Hiragino Mincho ProN, Yu Mincho, serif" font-size="72" font-weight="600" fill="#ffffff" letter-spacing="3">これからの安心をつくる。</text>
  <rect x="80" y="722" width="72" height="3" fill="url(#brass)"/>
  <text x="78" y="796" font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, sans-serif" font-size="26" fill="#cfe8f1" letter-spacing="4">金融教育・資産形成サポート ｜ 株式会社知上会</text>
</g>
</svg>''', encoding="utf-8")
PY

# 3) ラスタライズ → 中央で 1200×630 に切り抜き → JPEG
( cd "$TMP" && qlmanage -t -s 1200 -o . ogp.svg >/dev/null 2>&1 )
sips -c 630 1200 "$TMP/ogp.svg.png" --out "$TMP/ogp-full.png" >/dev/null
sips -s format jpeg -s formatOptions 86 "$TMP/ogp-full.png" --out assets/img/ogp.jpg >/dev/null

echo "assets/img/ogp.jpg を書き出しました（$(du -h assets/img/ogp.jpg | cut -f1)）"
