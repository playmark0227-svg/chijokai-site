#!/usr/bin/env bash
# =====================================================================
#  知上会 — サイトアイコン
#  assets/img/logo-mark.png から、ブラウザのタブ用とスマホのホーム画面用を
#  書き出します。どちらも濃紺の地に白いマーク。
#
#    bash tools/build-icons.sh
#
#  macOS 標準の sips / qlmanage だけで動きます（追加インストール不要）。
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d -t chijoukai-icon)
trap 'rm -rf "$TMP"' EXIT

L64=$(base64 -i assets/img/logo-mark.png | tr -d '\n')
python3 - "$TMP" "$L64" <<'PY'
import sys, pathlib
T, l64 = sys.argv[1], sys.argv[2]
# 元のロゴは「白地に黒のマーク」。アルファ行に -1*R + 1 を与えることで
# 白い部分を透明に、黒い部分を不透明な白に変換している。
pathlib.Path(T + "/icon.svg").write_text(
'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><filter id="w" color-interpolation-filters="sRGB">
  <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -1 0 0 0 1"/>
</filter></defs>
<rect width="1024" height="1024" fill="#0a1c2e"/>
<image x="222" y="222" width="580" height="580" filter="url(#w)" xlink:href="data:image/png;base64,''' + l64 + '''"/>
</svg>''', encoding="utf-8")
PY

( cd "$TMP" && qlmanage -t -s 1024 -o . icon.svg >/dev/null 2>&1 )
sips -Z 180 "$TMP/icon.svg.png" --out assets/img/apple-touch-icon.png >/dev/null
sips -Z 192 "$TMP/icon.svg.png" --out assets/img/favicon.png >/dev/null
echo "favicon.png / apple-touch-icon.png を書き出しました"
